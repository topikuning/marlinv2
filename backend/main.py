"""FastAPI entry point."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import engine, Base
from app.tasks.scheduler import start_scheduler, stop_scheduler

from app.api import (
    auth, users, rbac, master, contracts, locations, facilities, boq,
    weekly_reports, daily_reports, payments, reviews, notifications,
    analytics, templates, audit,
    variation_orders, field_observations,
)


def _ensure_enum_values():
    """
    Tambahan nilai enum Postgres yang muncul setelah DB pertama kali dibuat.
    ALTER TYPE ... ADD VALUE IF NOT EXISTS idempotent dan aman dijalankan
    berulang kali pada startup.
    """
    from sqlalchemy import text
    pending = [
        ("voitemaction", "REMOVE_FACILITY"),
        ("voitemaction", "ADD_FACILITY"),
    ]
    with engine.begin() as conn:
        for enum_name, value in pending:
            try:
                conn.execute(text(
                    f"ALTER TYPE {enum_name} ADD VALUE IF NOT EXISTS '{value}'"
                ))
            except Exception:
                pass


def _ensure_columns():
    """Auto-migration untuk kolom baru tanpa Alembic. Idempotent."""
    from sqlalchemy import text
    pending = [
        # (table, column, ddl_after_ADD_COLUMN)
        ("variation_order_items", "parent_boq_item_id", "UUID REFERENCES boq_items(id)"),
        # PPN per-contract — default 11% (UU HPP 2021)
        ("contracts", "ppn_pct", "NUMERIC(5,2) NOT NULL DEFAULT 11.00"),
        # ADD chain: parent di antara item-item ADD baru di VO yang sama
        ("variation_order_items", "parent_code", "VARCHAR(100)"),
        ("variation_order_items", "new_item_code", "VARCHAR(100)"),
        # ADD_FACILITY: lokasi target + facility_code yang akan dibuat
        ("variation_order_items", "location_id", "UUID REFERENCES locations(id)"),
        ("variation_order_items", "new_facility_code", "VARCHAR(50)"),
        # Traceability: link Facility/Location ke addendum yang membuatnya
        ("facilities", "addendum_id", "UUID REFERENCES contract_addenda(id)"),
        ("locations", "addendum_id", "UUID REFERENCES contract_addenda(id)"),
    ]
    with engine.begin() as conn:
        for table, col, ddl in pending:
            try:
                exists = conn.execute(text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name=:t AND column_name=:c"
                ), {"t": table, "c": col}).first()
                if not exists:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
            except Exception:
                pass


def _ensure_column_precision_5dp():
    """One-time ALTER kolom Numeric ke (18, 5) — tanpa ini, DB truncate input
    5 dp jadi 4 dp (volume) atau 2 dp (unit_price/total_price/cost_impact).
    PostgreSQL: ALTER ke presisi yang lebih tinggi aman, tidak mengubah data.
    Idempotent — kalau sudah (18, 5) tidak ada efek."""
    from sqlalchemy import text
    alters = [
        # Item-level (BOQ) — sumber data per row
        "ALTER TABLE boq_items ALTER COLUMN volume TYPE NUMERIC(18, 5)",
        "ALTER TABLE boq_items ALTER COLUMN unit_price TYPE NUMERIC(18, 5)",
        "ALTER TABLE boq_items ALTER COLUMN total_price TYPE NUMERIC(18, 5)",
        # Item-level (VO)
        "ALTER TABLE variation_order_items ALTER COLUMN volume_delta TYPE NUMERIC(18, 5)",
        "ALTER TABLE variation_order_items ALTER COLUMN unit_price TYPE NUMERIC(18, 5)",
        "ALTER TABLE variation_order_items ALTER COLUMN cost_impact TYPE NUMERIC(18, 5)",
        "ALTER TABLE variation_orders ALTER COLUMN cost_impact TYPE NUMERIC(18, 5)",
        # Progress mingguan (volume realisasi)
        "ALTER TABLE weekly_progress_items ALTER COLUMN volume_this_week TYPE NUMERIC(18, 5)",
        "ALTER TABLE weekly_progress_items ALTER COLUMN volume_cumulative TYPE NUMERIC(18, 5)",
        # Aggregate totals (sum of items) — wajib 5 dp juga, kalau tidak hasil sum
        # ter-truncate dan total kontrak yang ditampilkan ke user salah.
        "ALTER TABLE facilities ALTER COLUMN total_value TYPE NUMERIC(18, 5)",
        "ALTER TABLE boq_revisions ALTER COLUMN total_value TYPE NUMERIC(18, 5)",
        "ALTER TABLE contracts ALTER COLUMN original_value TYPE NUMERIC(18, 5)",
        "ALTER TABLE contracts ALTER COLUMN current_value TYPE NUMERIC(18, 5)",
        "ALTER TABLE contract_addenda ALTER COLUMN old_contract_value TYPE NUMERIC(18, 5)",
        "ALTER TABLE contract_addenda ALTER COLUMN new_contract_value TYPE NUMERIC(18, 5)",
    ]
    with engine.begin() as conn:
        for stmt in alters:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass


def _ensure_quantized_5dp():
    """One-time normalize legacy data to 5-decimal-place precision.
    Aturan sistem: volume & unit_price selalu 5 dp. Data yang ter-import
    sebelum aturan ini berlaku bisa punya presisi 4-6 dp, menyebabkan
    display (rounded 5 dp) tidak match dengan vol×price hasil sistem.
    Idempotent — quantize lagi nilai yang sudah 5 dp adalah no-op.
    """
    from sqlalchemy import text
    statements = [
        # BOQ items
        "UPDATE boq_items SET volume = ROUND(volume, 5) WHERE volume IS NOT NULL AND volume <> ROUND(volume, 5)",
        "UPDATE boq_items SET unit_price = ROUND(unit_price, 5) WHERE unit_price IS NOT NULL AND unit_price <> ROUND(unit_price, 5)",
        "UPDATE boq_items SET total_price = ROUND(volume * unit_price, 5) WHERE volume IS NOT NULL AND unit_price IS NOT NULL AND total_price <> ROUND(volume * unit_price, 5)",
        # VO items
        "UPDATE variation_order_items SET volume_delta = ROUND(volume_delta, 5) WHERE volume_delta IS NOT NULL AND volume_delta <> ROUND(volume_delta, 5)",
        "UPDATE variation_order_items SET unit_price = ROUND(unit_price, 5) WHERE unit_price IS NOT NULL AND unit_price <> ROUND(unit_price, 5)",
        "UPDATE variation_order_items SET cost_impact = ROUND(cost_impact, 5) WHERE cost_impact IS NOT NULL AND cost_impact <> ROUND(cost_impact, 5)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    for sub in ("daily", "weekly", "review", "payments", "documents"):
        os.makedirs(os.path.join(settings.UPLOAD_DIR, sub), exist_ok=True)
    _ensure_enum_values()
    _ensure_columns()
    _ensure_column_precision_5dp()
    _ensure_quantized_5dp()
    if settings.SCHEDULER_ENABLED:
        start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Marlin",
    description="Monitoring, Analysis, Reporting & Learning for Infrastructure Network",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files for uploaded photos
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# ─── register routes ─────────────────────────────────────────────────────────
ROUTERS = [
    auth.router, users.router, rbac.router, master.router,
    contracts.router, locations.router, facilities.router, boq.router,
    weekly_reports.router, daily_reports.router,
    payments.router, reviews.router,
    notifications.router, analytics.router, templates.router,
    audit.router,
    variation_orders.router, field_observations.router,
]
for r in ROUTERS:
    app.include_router(r, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok", "env": settings.ENVIRONMENT}


@app.get("/")
def root():
    return {"app": "Marlin", "docs": "/api/docs"}
