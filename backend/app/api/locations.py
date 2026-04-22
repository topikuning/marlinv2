import os
import tempfile
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Query
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.models.models import Location, Contract, User
from app.schemas.schemas import LocationCreate, LocationUpdate, LocationOut, ExcelImportResult
from app.api.deps import get_current_user, require_permission, user_can_access_contract
from app.api._guards import (
    assert_scope_editable_by_contract,
    assert_scope_editable_by_location,
)
from app.services.audit_service import log_audit

router = APIRouter(prefix="/locations", tags=["locations"])


@router.get("/by-contract/{contract_id}", response_model=List[dict])
def list_by_contract(
    contract_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    rows = db.query(Location).filter(Location.contract_id == contract_id).order_by(Location.location_code).all()
    return [
        {
            "id": str(r.id), "contract_id": str(r.contract_id),
            "location_code": r.location_code, "name": r.name,
            "village": r.village, "district": r.district, "city": r.city, "province": r.province,
            "latitude": float(r.latitude) if r.latitude else None,
            "longitude": float(r.longitude) if r.longitude else None,
            "is_active": r.is_active,
        } for r in rows
    ]


@router.post("/by-contract/{contract_id}", response_model=dict)
def create_location(
    contract_id: str, data: LocationCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")
    assert_scope_editable_by_contract(db, contract_id, entity="location")
    if db.query(Location).filter(
        Location.contract_id == contract_id,
        Location.location_code == data.location_code,
    ).first():
        raise HTTPException(400, "Kode lokasi sudah dipakai")
    loc = Location(contract_id=contract_id, **data.model_dump())
    db.add(loc)
    db.commit()
    db.refresh(loc)
    log_audit(db, current_user, "create", "location", str(loc.id), request=request, commit=True)
    return {"id": str(loc.id), "success": True}


@router.post("/by-contract/{contract_id}/bulk", response_model=dict)
def bulk_create_locations(
    contract_id: str, items: List[LocationCreate], request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")
    assert_scope_editable_by_contract(db, contract_id, entity="location")

    created = 0
    skipped = 0
    for d in items:
        exists = db.query(Location).filter(
            Location.contract_id == contract_id,
            Location.location_code == d.location_code,
        ).first()
        if exists:
            skipped += 1
            continue
        db.add(Location(contract_id=contract_id, **d.model_dump()))
        created += 1
    db.commit()
    log_audit(db, current_user, "bulk_create", "location",
              changes={"contract_id": contract_id, "created": created, "skipped": skipped},
              entity_id=contract_id, request=request, commit=True)
    return {"created": created, "skipped": skipped, "success": True}


@router.post("/by-contract/{contract_id}/import-excel", response_model=ExcelImportResult)
async def import_locations_excel(
    contract_id: str,
    file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")
    assert_scope_editable_by_contract(db, contract_id, entity="location")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    result = ExcelImportResult(success=False, items_imported=0, items_skipped=0)
    try:
        df = pd.read_excel(tmp_path, sheet_name=0, dtype=object)
        cols = [str(c).strip().lower() for c in df.columns]
        if "location_code" not in cols or "name" not in cols:
            result.errors.append("Kolom 'location_code' dan 'name' wajib ada")
            return result

        for _, row in df.iterrows():
            rec = {cols[i]: row.iloc[i] for i in range(len(cols))}
            code = str(rec.get("location_code") or "").strip()
            name = str(rec.get("name") or "").strip()
            if not code or not name:
                result.items_skipped += 1
                continue
            if db.query(Location).filter(
                Location.contract_id == contract_id, Location.location_code == code
            ).first():
                result.items_skipped += 1
                continue
            db.add(Location(
                contract_id=contract_id,
                location_code=code,
                name=name,
                village=str(rec.get("village") or "") or None,
                district=str(rec.get("district") or "") or None,
                city=str(rec.get("city") or "") or None,
                province=str(rec.get("province") or "") or None,
                latitude=float(rec["latitude"]) if rec.get("latitude") not in (None, "") else None,
                longitude=float(rec["longitude"]) if rec.get("longitude") not in (None, "") else None,
            ))
            result.items_imported += 1
        db.commit()
        result.success = True
        log_audit(db, current_user, "import_excel", "location",
                  changes={"contract_id": contract_id, "created": result.items_imported},
                  entity_id=contract_id, request=request, commit=True)
    except Exception as e:
        result.errors.append(str(e))
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    return result


@router.put("/{location_id}", response_model=dict)
def update_location(
    location_id: str, data: LocationUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        raise HTTPException(404, "Lokasi tidak ditemukan")
    assert_scope_editable_by_location(db, location_id, entity="location")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(loc, k, v)
    db.commit()
    log_audit(db, current_user, "update", "location", str(loc.id), request=request, commit=True)
    return {"success": True}


@router.delete("/{location_id}", response_model=dict)
def delete_location(
    location_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        raise HTTPException(404, "Lokasi tidak ditemukan")
    assert_scope_editable_by_location(db, location_id, entity="location")
    db.delete(loc)
    db.commit()
    log_audit(db, current_user, "delete", "location", location_id, request=request, commit=True)
    return {"success": True}
