import os
from decimal import Decimal
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import DailyReport, DailyReportPhoto, Contract, User
from app.schemas.schemas import DailyReportCreate, DailyReportUpdate
from app.api.deps import get_current_user, require_permission, user_can_access_contract
from app.services.audit_service import log_audit
from app.services.file_service import save_upload, delete_file, ALLOWED_IMAGE_EXT

router = APIRouter(prefix="/reports/daily", tags=["daily_reports"])


def _to_dict(r: DailyReport, detail=False) -> dict:
    d = {
        "id": str(r.id),
        "contract_id": str(r.contract_id),
        "location_id": str(r.location_id) if r.location_id else None,
        "report_date": r.report_date.isoformat(),
        "activities": r.activities,
        "manpower_count": r.manpower_count,
        "manpower_skilled": r.manpower_skilled,
        "manpower_unskilled": r.manpower_unskilled,
        "equipment_used": r.equipment_used,
        "materials_received": r.materials_received,
        "weather_morning": r.weather_morning,
        "weather_afternoon": r.weather_afternoon,
        "rain_hours": float(r.rain_hours or 0),
        "obstacles": r.obstacles,
        "notes": r.notes,
        "submitted_by": r.submitted_by,
        "created_at": r.created_at.isoformat(),
    }
    if detail:
        d["photos"] = [
            {
                "id": str(p.id),
                "file_path": p.file_path,
                "thumbnail_path": p.thumbnail_path,
                "caption": p.caption,
                "taken_at": p.taken_at.isoformat() if p.taken_at else None,
            }
            for p in r.photos
        ]
    return d


# ═══════════════════════════════════════════ LIST / DETAIL ═══════════════════

@router.get("/by-contract/{contract_id}", response_model=dict)
def list_daily(
    contract_id: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("report.read")),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    q = db.query(DailyReport).filter(
        DailyReport.contract_id == contract_id, DailyReport.is_deleted == False
    )
    if date_from:
        q = q.filter(DailyReport.report_date >= date_from)
    if date_to:
        q = q.filter(DailyReport.report_date <= date_to)
    rows = q.order_by(DailyReport.report_date.desc()).all()
    return {"items": [_to_dict(r) for r in rows]}


@router.get("/{report_id}", response_model=dict)
def get_daily(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("report.read")),
):
    r = db.query(DailyReport).filter(
        DailyReport.id == report_id, DailyReport.is_deleted == False
    ).first()
    if not r:
        raise HTTPException(404, "Laporan harian tidak ditemukan")
    if not user_can_access_contract(db, current_user, str(r.contract_id)):
        raise HTTPException(403, "Akses ditolak")
    return _to_dict(r, detail=True)


# ═══════════════════════════════════════════ CREATE ══════════════════════════

@router.post("", response_model=dict)
def create_daily(
    data: DailyReportCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("report.create")),
):
    if not user_can_access_contract(db, current_user, str(data.contract_id)):
        raise HTTPException(403, "Akses ditolak")
    c = db.query(Contract).filter(Contract.id == data.contract_id).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    # Status gate. DRAFT allowed (catatan #6); completed/terminated blocked.
    status_value = c.status.value if hasattr(c.status, "value") else str(c.status)
    if status_value in ("completed", "terminated"):
        raise HTTPException(
            400,
            f"Kontrak berstatus '{status_value}' tidak menerima laporan baru.",
        )

    r = DailyReport(
        contract_id=data.contract_id,
        location_id=data.location_id,
        report_date=data.report_date,
        activities=data.activities,
        manpower_count=data.manpower_count,
        manpower_skilled=data.manpower_skilled,
        manpower_unskilled=data.manpower_unskilled,
        equipment_used=data.equipment_used,
        materials_received=data.materials_received,
        weather_morning=data.weather_morning,
        weather_afternoon=data.weather_afternoon,
        rain_hours=data.rain_hours,
        obstacles=data.obstacles,
        notes=data.notes,
        submitted_by=current_user.full_name,
        submitted_by_user_id=current_user.id,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    log_audit(db, current_user, "create", "daily_report", str(r.id),
              changes={"contract_id": str(data.contract_id), "date": data.report_date.isoformat()},
              request=request, commit=True)
    return {"id": str(r.id), "success": True}


@router.put("/{report_id}", response_model=dict)
def update_daily(
    report_id: str, data: DailyReportUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("report.update")),
):
    r = db.query(DailyReport).filter(
        DailyReport.id == report_id, DailyReport.is_deleted == False
    ).first()
    if not r:
        raise HTTPException(404, "Laporan tidak ditemukan")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    db.commit()
    log_audit(db, current_user, "update", "daily_report", str(r.id), request=request, commit=True)
    return {"success": True}


@router.delete("/{report_id}", response_model=dict)
def delete_daily(
    report_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("report.delete")),
):
    r = db.query(DailyReport).filter(DailyReport.id == report_id).first()
    if not r:
        raise HTTPException(404, "Laporan tidak ditemukan")
    r.is_deleted = True
    db.commit()
    log_audit(db, current_user, "delete", "daily_report", str(r.id), request=request, commit=True)
    return {"success": True}


# ═══════════════════════════════════════════ PHOTOS ══════════════════════════

@router.post("/{report_id}/photos", response_model=dict)
async def upload_photo(
    report_id: str,
    file: UploadFile = File(...),
    caption: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("report.update")),
):
    r = db.query(DailyReport).filter(
        DailyReport.id == report_id, DailyReport.is_deleted == False
    ).first()
    if not r:
        raise HTTPException(404, "Laporan tidak ditemukan")
    rel, thumb = save_upload(file, "daily", ALLOWED_IMAGE_EXT)
    p = DailyReportPhoto(
        daily_report_id=r.id,
        file_path=rel,
        thumbnail_path=thumb,
        caption=caption,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {
        "id": str(p.id), "file_path": rel, "thumbnail_path": thumb, "caption": caption,
    }


@router.delete("/{report_id}/photos/{photo_id}", response_model=dict)
def delete_photo(
    report_id: str, photo_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("report.update")),
):
    p = db.query(DailyReportPhoto).filter(
        DailyReportPhoto.id == photo_id, DailyReportPhoto.daily_report_id == report_id,
    ).first()
    if not p:
        raise HTTPException(404, "Foto tidak ditemukan")
    delete_file(p.file_path)
    delete_file(p.thumbnail_path)
    db.delete(p)
    db.commit()
    return {"success": True}
