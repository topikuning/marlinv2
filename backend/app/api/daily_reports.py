import os
from decimal import Decimal
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import (
    DailyReport, DailyReportPhoto, Contract, Location, Facility, User,
)
from app.schemas.schemas import DailyReportCreate, DailyReportUpdate
from app.api.deps import get_current_user, require_permission, user_can_access_contract
from app.services.audit_service import log_audit
from app.services.file_service import save_upload, delete_file, ALLOWED_IMAGE_EXT

router = APIRouter(prefix="/reports/daily", tags=["daily_reports"])


def _to_dict(r: DailyReport, detail=False, *, db: Session = None) -> dict:
    loc_name = None
    fac_name = None
    fac_code = None
    if db is not None:
        if r.location_id:
            loc = db.query(Location).filter(Location.id == r.location_id).first()
            if loc:
                loc_name = loc.name
        if r.facility_id:
            fac = db.query(Facility).filter(Facility.id == r.facility_id).first()
            if fac:
                fac_name = fac.facility_name
                fac_code = fac.facility_code
    d = {
        "id": str(r.id),
        "contract_id": str(r.contract_id),
        "location_id": str(r.location_id) if r.location_id else None,
        "location_name": loc_name,
        "facility_id": str(r.facility_id) if r.facility_id else None,
        "facility_name": fac_name,
        "facility_code": fac_code,
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
                "facility_id": str(p.facility_id) if p.facility_id else None,
            }
            for p in r.photos
        ]
    return d


def _assert_facility_belongs(db: Session, contract_id, location_id, facility_id) -> tuple:
    """
    Validasi bahwa facility_id berada di location_id, yang berada di
    contract_id. Return (Location, Facility) atau raise 400. Salah satu
    atau kedua id boleh None (laporan legacy / location-wide).
    """
    loc = None
    if location_id is not None:
        loc = db.query(Location).filter(Location.id == location_id).first()
        if not loc:
            raise HTTPException(400, "Lokasi tidak ditemukan")
        if str(loc.contract_id) != str(contract_id):
            raise HTTPException(400, "Lokasi tidak termasuk dalam kontrak ini")
    fac = None
    if facility_id is not None:
        fac = db.query(Facility).filter(Facility.id == facility_id).first()
        if not fac:
            raise HTTPException(400, "Fasilitas tidak ditemukan")
        if location_id and str(fac.location_id) != str(location_id):
            raise HTTPException(400, "Fasilitas tidak termasuk dalam lokasi yang dipilih")
        # Kalau user cuma kasih facility_id tanpa location_id, isi location_id
        # dari fasilitas supaya tetap konsisten.
        if not loc:
            loc = db.query(Location).filter(Location.id == fac.location_id).first()
            if loc and str(loc.contract_id) != str(contract_id):
                raise HTTPException(400, "Fasilitas tidak termasuk dalam kontrak ini")
    return loc, fac


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
    return {"items": [_to_dict(r, db=db) for r in rows]}


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
    return _to_dict(r, detail=True, db=db)


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

    # Validasi + normalisasi lokasi/fasilitas. Laporan baru seharusnya
    # selalu mengirim facility_id; kalau tidak, laporan tetap dibuat tapi
    # foto-fotonya tidak akan muncul di galeri Dashboard Eksekutif per-
    # fasilitas.
    loc_row, fac_row = _assert_facility_belongs(
        db, data.contract_id, data.location_id, data.facility_id,
    )

    r = DailyReport(
        contract_id=data.contract_id,
        location_id=(loc_row.id if loc_row else data.location_id),
        facility_id=(fac_row.id if fac_row else None),
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
    facility_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("report.update")),
):
    r = db.query(DailyReport).filter(
        DailyReport.id == report_id, DailyReport.is_deleted == False
    ).first()
    if not r:
        raise HTTPException(404, "Laporan tidak ditemukan")
    # Foto inherit facility_id dari parent report agar galeri Dashboard
    # Eksekutif otomatis menemukannya. Client boleh override (misalnya
    # laporan harian satu lokasi tapi foto split ke beberapa fasilitas).
    target_facility = facility_id or (str(r.facility_id) if r.facility_id else None)
    if target_facility:
        # Pastikan fasilitas yang dioverride tetap di kontrak yang sama.
        _assert_facility_belongs(db, r.contract_id, None, target_facility)
    rel, thumb = save_upload(file, "daily", ALLOWED_IMAGE_EXT)
    p = DailyReportPhoto(
        daily_report_id=r.id,
        facility_id=target_facility,
        file_path=rel,
        thumbnail_path=thumb,
        caption=caption,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {
        "id": str(p.id), "file_path": rel, "thumbnail_path": thumb, "caption": caption,
        "facility_id": target_facility,
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
