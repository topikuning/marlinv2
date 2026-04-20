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
    analytics, templates,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    for sub in ("daily", "weekly", "review", "payments", "documents"):
        os.makedirs(os.path.join(settings.UPLOAD_DIR, sub), exist_ok=True)
    if settings.SCHEDULER_ENABLED:
        start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="KNMP Monitor v2",
    description="Monitoring konstruksi multi-lokasi — Kampung Nelayan Merah Putih",
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
]
for r in ROUTERS:
    app.include_router(r, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok", "env": settings.ENVIRONMENT}


@app.get("/")
def root():
    return {"app": "KNMP Monitor v2", "docs": "/api/docs"}
