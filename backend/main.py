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


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    for sub in ("daily", "weekly", "review", "payments", "documents"):
        os.makedirs(os.path.join(settings.UPLOAD_DIR, sub), exist_ok=True)
    _ensure_enum_values()
    _ensure_columns()
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
