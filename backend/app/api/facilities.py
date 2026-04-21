import os
import tempfile
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import Facility, Location, MasterFacility, User
from app.schemas.schemas import (
    FacilityCreate, FacilityUpdate, FacilityBulkCreate, FacilityOut, ExcelImportResult,
)
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import log_audit

router = APIRouter(prefix="/facilities", tags=["facilities"])


def _resolve_master_facility(
    db: Session,
    *,
    master_facility_id: Optional[str] = None,
    facility_code: Optional[str] = None,
    facility_name: Optional[str] = None,
) -> Optional[MasterFacility]:
    """
    Look up a MasterFacility by id → code → name (in that priority).
    Returns the row or None if nothing matches. Used to hydrate
    master_facility_id on Facility create/bulk/import so the catalog stays
    authoritative even when the client sends a legacy payload.
    """
    if master_facility_id:
        m = db.query(MasterFacility).filter(MasterFacility.id == master_facility_id).first()
        if m:
            return m
    if facility_code:
        m = (
            db.query(MasterFacility)
            .filter(MasterFacility.code == facility_code.upper())
            .first()
        )
        if m:
            return m
    if facility_name:
        m = (
            db.query(MasterFacility)
            .filter(MasterFacility.name.ilike(facility_name.strip()))
            .first()
        )
        if m:
            return m
    return None


@router.get("/by-location/{location_id}", response_model=List[dict])
def list_by_location(location_id: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(Facility).filter(
        Facility.location_id == location_id
    ).order_by(Facility.display_order, Facility.facility_code).all()
    return [
        {
            "id": str(f.id), "location_id": str(f.location_id),
            "master_facility_id": str(f.master_facility_id) if f.master_facility_id else None,
            "facility_code": f.facility_code, "facility_type": f.facility_type,
            "facility_name": f.facility_name, "display_order": f.display_order,
            "total_value": float(f.total_value or 0), "is_active": f.is_active,
        } for f in rows
    ]


@router.post("", response_model=dict)
def create_facility(
    data: FacilityCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    if not db.query(Location).filter(Location.id == data.location_id).first():
        raise HTTPException(400, "Lokasi tidak ditemukan")
    if db.query(Facility).filter(
        Facility.location_id == data.location_id,
        Facility.facility_code == data.facility_code,
    ).first():
        raise HTTPException(400, "Kode fasilitas sudah dipakai di lokasi ini")

    payload = data.model_dump()

    # Resolve master catalog row. New rows SHOULD be picked from master; we
    # try id/code/name in that order, and fall back to legacy free-text
    # behavior if nothing matches (kept to preserve backward compat with
    # existing seed + imports).
    master = _resolve_master_facility(
        db,
        master_facility_id=payload.get("master_facility_id"),
        facility_code=payload.get("facility_code"),
        facility_name=payload.get("facility_name"),
    )
    if master:
        payload["master_facility_id"] = master.id
        if not payload.get("facility_type"):
            payload["facility_type"] = master.facility_type

    f = Facility(**payload)
    db.add(f)
    db.commit()
    db.refresh(f)
    log_audit(db, current_user, "create", "facility", str(f.id), request=request, commit=True)
    return {"id": str(f.id), "success": True, "master_facility_id": str(f.master_facility_id) if f.master_facility_id else None}


@router.post("/bulk", response_model=dict)
def bulk_create_facilities(
    data: FacilityBulkCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    if not db.query(Location).filter(Location.id == data.location_id).first():
        raise HTTPException(400, "Lokasi tidak ditemukan")

    created = 0
    skipped = 0
    for idx, row in enumerate(data.facilities):
        code = str(row.get("facility_code") or "").strip()
        name = str(row.get("facility_name") or "").strip()
        if not code or not name:
            skipped += 1
            continue
        if db.query(Facility).filter(
            Facility.location_id == data.location_id,
            Facility.facility_code == code,
        ).first():
            skipped += 1
            continue

        master = _resolve_master_facility(
            db,
            master_facility_id=row.get("master_facility_id"),
            facility_code=code,
            facility_name=name,
        )

        db.add(Facility(
            location_id=data.location_id,
            master_facility_id=master.id if master else None,
            facility_code=code,
            facility_type=str(row.get("facility_type") or "")
                or (master.facility_type if master else None),
            facility_name=name,
            display_order=int(row.get("display_order") or idx),
            notes=str(row.get("notes") or "") or None,
        ))
        created += 1
    db.commit()
    log_audit(db, current_user, "bulk_create", "facility",
              changes={"location_id": str(data.location_id), "created": created},
              entity_id=str(data.location_id), request=request, commit=True)
    return {"created": created, "skipped": skipped, "success": True}


@router.post("/by-location/{location_id}/import-excel", response_model=ExcelImportResult)
async def import_facilities_excel(
    location_id: str, file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    if not db.query(Location).filter(Location.id == location_id).first():
        raise HTTPException(404, "Lokasi tidak ditemukan")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    result = ExcelImportResult(success=False)
    try:
        df = pd.read_excel(tmp_path, sheet_name=0, dtype=object)
        cols = [str(c).strip().lower() for c in df.columns]
        if "facility_code" not in cols or "facility_name" not in cols:
            result.errors.append("Kolom 'facility_code' dan 'facility_name' wajib ada")
            return result
        for idx, row in df.iterrows():
            rec = {cols[i]: row.iloc[i] for i in range(len(cols))}
            code = str(rec.get("facility_code") or "").strip()
            name = str(rec.get("facility_name") or "").strip()
            if not code or not name:
                result.items_skipped += 1
                continue
            if db.query(Facility).filter(
                Facility.location_id == location_id, Facility.facility_code == code,
            ).first():
                result.items_skipped += 1
                continue

            master = _resolve_master_facility(
                db,
                facility_code=code,
                facility_name=name,
            )

            db.add(Facility(
                location_id=location_id,
                master_facility_id=master.id if master else None,
                facility_code=code,
                facility_type=str(rec.get("facility_type") or "")
                    or (master.facility_type if master else None),
                facility_name=name,
                display_order=int(float(rec.get("display_order") or idx)),
                notes=str(rec.get("notes") or "") or None,
            ))
            result.items_imported += 1
        db.commit()
        result.success = True
    except Exception as e:
        result.errors.append(str(e))
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    return result


@router.put("/{facility_id}", response_model=dict)
def update_facility(
    facility_id: str, data: FacilityUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    f = db.query(Facility).filter(Facility.id == facility_id).first()
    if not f:
        raise HTTPException(404, "Fasilitas tidak ditemukan")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    db.commit()
    log_audit(db, current_user, "update", "facility", str(f.id), request=request, commit=True)
    return {"success": True}


@router.delete("/{facility_id}", response_model=dict)
def delete_facility(
    facility_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    f = db.query(Facility).filter(Facility.id == facility_id).first()
    if not f:
        raise HTTPException(404, "Fasilitas tidak ditemukan")
    db.delete(f)
    db.commit()
    log_audit(db, current_user, "delete", "facility", facility_id, request=request, commit=True)
    return {"success": True}
