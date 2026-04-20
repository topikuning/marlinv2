import os
import tempfile
import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import io

from app.core.database import get_db
from app.models.models import (
    BOQItem, BOQItemVersion, Facility, Location, Contract, User,
)
from app.schemas.schemas import (
    BOQItemCreate, BOQItemUpdate, BOQItemOut, ExcelImportResult,
)
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import log_audit
from app.services.progress_service import (
    recalculate_facility_weights, recalculate_contract_weights,
)
from app.services.boq_import_service import parse_boq_file, detect_format
from app.services.template_service import template_boq_simple

router = APIRouter(prefix="/boq", tags=["boq"])


def _boq_to_dict(b: BOQItem) -> dict:
    return {
        "id": str(b.id),
        "facility_id": str(b.facility_id),
        "parent_id": str(b.parent_id) if b.parent_id else None,
        "master_work_code": b.master_work_code,
        "original_code": b.original_code,
        "full_code": b.full_code,
        "level": b.level,
        "display_order": b.display_order,
        "description": b.description,
        "unit": b.unit,
        "volume": float(b.volume or 0),
        "unit_price": float(b.unit_price or 0),
        "total_price": float(b.total_price or 0),
        "weight_pct": float(b.weight_pct or 0),
        "planned_start_week": b.planned_start_week,
        "planned_duration_weeks": b.planned_duration_weeks,
        "planned_end_week": b.planned_end_week,
        "version": b.version,
        "is_active": b.is_active,
        "is_leaf": b.is_leaf,
        "is_addendum_item": b.is_addendum_item,
    }


# ═══════════════════════════════════════════ LIST / TREE ═════════════════════

@router.get("/by-facility/{facility_id}", response_model=List[dict])
def list_by_facility(
    facility_id: str,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(BOQItem).filter(BOQItem.facility_id == facility_id)
    if not include_inactive:
        q = q.filter(BOQItem.is_active == True)
    rows = q.order_by(BOQItem.display_order, BOQItem.id).all()
    return [_boq_to_dict(r) for r in rows]


@router.get("/by-contract/{contract_id}/flat", response_model=List[dict])
def list_by_contract_flat(
    contract_id: str,
    leaf_only: bool = True,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Flat BOQ list for grid progress editor."""
    q = (
        db.query(BOQItem, Facility, Location)
        .join(Facility, Facility.id == BOQItem.facility_id)
        .join(Location, Location.id == Facility.location_id)
        .filter(Location.contract_id == contract_id, BOQItem.is_active == True)
    )
    if leaf_only:
        q = q.filter(BOQItem.is_leaf == True)

    rows = q.order_by(Location.location_code, Facility.display_order, BOQItem.display_order).all()
    return [
        {
            **_boq_to_dict(b),
            "location_id": str(l.id),
            "location_name": l.name,
            "location_code": l.location_code,
            "facility_code": f.facility_code,
            "facility_name": f.facility_name,
        }
        for b, f, l in rows
    ]


# ═══════════════════════════════════════════ CRUD ════════════════════════════

@router.post("", response_model=dict)
def create_boq_item(
    data: BOQItemCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    if not db.query(Facility).filter(Facility.id == data.facility_id).first():
        raise HTTPException(400, "Fasilitas tidak ditemukan")

    if (not data.total_price or data.total_price == 0) and data.volume and data.unit_price:
        data.total_price = data.volume * data.unit_price

    item = BOQItem(**data.model_dump())
    db.add(item)
    db.flush()
    recalculate_facility_weights(db, str(data.facility_id))
    fac = db.query(Facility).filter(Facility.id == data.facility_id).first()
    if fac:
        loc = db.query(Location).filter(Location.id == fac.location_id).first()
        if loc:
            recalculate_contract_weights(db, str(loc.contract_id))
    db.commit()
    log_audit(db, current_user, "create", "boq_item", str(item.id), request=request, commit=True)
    return {"id": str(item.id), "success": True}


@router.post("/bulk", response_model=dict)
def bulk_create(
    items: List[BOQItemCreate], request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    created = 0
    touched_facilities = set()
    touched_contracts = set()
    for d in items:
        if (not d.total_price or d.total_price == 0) and d.volume and d.unit_price:
            d.total_price = d.volume * d.unit_price
        item = BOQItem(**d.model_dump())
        db.add(item)
        touched_facilities.add(str(d.facility_id))
        created += 1
    db.flush()
    for fid in touched_facilities:
        recalculate_facility_weights(db, fid)
        fac = db.query(Facility).filter(Facility.id == fid).first()
        if fac:
            loc = db.query(Location).filter(Location.id == fac.location_id).first()
            if loc:
                touched_contracts.add(str(loc.contract_id))
    for cid in touched_contracts:
        recalculate_contract_weights(db, cid)
    db.commit()
    return {"created": created, "success": True}


@router.put("/{item_id}", response_model=dict)
def update_boq_item(
    item_id: str, data: BOQItemUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    item = db.query(BOQItem).filter(BOQItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item tidak ditemukan")

    # Snapshot for addendum history
    if data.addendum_id:
        snapshot = {
            "volume": float(item.volume or 0),
            "unit_price": float(item.unit_price or 0),
            "total_price": float(item.total_price or 0),
            "weight_pct": float(item.weight_pct or 0),
            "planned_start_week": item.planned_start_week,
            "planned_duration_weeks": item.planned_duration_weeks,
            "is_active": item.is_active,
            "description": item.description,
        }
        version = BOQItemVersion(
            boq_item_id=item.id,
            addendum_id=data.addendum_id,
            version_number=item.version,
            snapshot=snapshot,
            change_reason=data.change_reason,
            created_by=current_user.id,
        )
        db.add(version)
        item.version += 1

    for field, val in data.model_dump(exclude_none=True).items():
        if field not in ("addendum_id", "change_reason") and hasattr(item, field):
            setattr(item, field, val)

    db.flush()
    recalculate_facility_weights(db, str(item.facility_id))
    fac = db.query(Facility).filter(Facility.id == item.facility_id).first()
    if fac:
        loc = db.query(Location).filter(Location.id == fac.location_id).first()
        if loc:
            recalculate_contract_weights(db, str(loc.contract_id))
    db.commit()
    log_audit(db, current_user, "update", "boq_item", str(item.id), request=request, commit=True)
    return {"success": True, "version": item.version}


@router.delete("/{item_id}", response_model=dict)
def delete_boq_item(
    item_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    item = db.query(BOQItem).filter(BOQItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item tidak ditemukan")
    item.is_active = False  # soft delete
    db.flush()
    recalculate_facility_weights(db, str(item.facility_id))
    db.commit()
    log_audit(db, current_user, "delete", "boq_item", str(item.id), request=request, commit=True)
    return {"success": True}


# ═══════════════════════════════════════════ TEMPLATE ════════════════════════

@router.get("/template/download")
def download_template(_=Depends(get_current_user)):
    data = template_boq_simple()
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=template_boq.xlsx"},
    )


# ═══════════════════════════════════════════ IMPORT EXCEL ════════════════════

@router.post("/preview-excel", response_model=dict)
async def preview_excel(
    file: UploadFile = File(...),
    _=Depends(require_permission("contract.update")),
):
    """
    Preview an uploaded BOQ file. Return detected format + facilities parsed.
    Client uses this to show facility mapping UI before final import.
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        fmt = detect_format(tmp_path)
        parsed = parse_boq_file(tmp_path, fmt)
        return {
            "format": fmt,
            "success": parsed["success"],
            "warnings": parsed.get("warnings", []),
            "errors": parsed.get("errors", []),
            "facilities": [
                {
                    "facility_code": f["facility_code"],
                    "facility_name": f["facility_name"],
                    "sheet_name": f.get("sheet_name"),
                    "item_count": len(f["items"]),
                    "total_value": f.get("total_value", 0),
                    "preview": f["items"][:5],
                }
                for f in parsed.get("facilities", [])
            ],
        }
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


@router.post("/import-excel/{location_id}", response_model=ExcelImportResult)
async def import_excel(
    location_id: str,
    file: UploadFile = File(...),
    create_missing_facilities: bool = Query(True),
    mapping: Optional[str] = Query(None,
        description='JSON string: {"source_facility_code": "target_facility_uuid"} to force a mapping'),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Import BOQ from Excel into facilities under a location.
    - Auto-detects format (simple template vs engineer multi-sheet).
    - For each facility in file, map to existing Facility by code, or create new.
    - Items are inserted with hierarchy preserved.
    """
    import json as _json
    target_loc = db.query(Location).filter(Location.id == location_id).first()
    if not target_loc:
        raise HTTPException(404, "Lokasi tidak ditemukan")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    mapping_dict = {}
    if mapping:
        try:
            mapping_dict = _json.loads(mapping)
        except Exception:
            pass

    result = ExcelImportResult(success=False)
    try:
        parsed = parse_boq_file(tmp_path)
        if not parsed["success"]:
            result.errors.extend(parsed.get("errors", []))
            return result

        touched_contracts = set()

        for fac_data in parsed["facilities"]:
            src_code = fac_data["facility_code"]
            target_facility: Optional[Facility] = None

            # 1) explicit mapping
            if src_code in mapping_dict:
                target_facility = db.query(Facility).filter(
                    Facility.id == mapping_dict[src_code]).first()
            # 2) match by code in same location
            if not target_facility:
                target_facility = db.query(Facility).filter(
                    Facility.location_id == location_id,
                    Facility.facility_code == src_code,
                ).first()
            # 3) match by name
            if not target_facility:
                target_facility = db.query(Facility).filter(
                    Facility.location_id == location_id,
                    Facility.facility_name.ilike(fac_data["facility_name"]),
                ).first()
            # 4) create new
            if not target_facility:
                if not create_missing_facilities:
                    result.warnings.append(f"Fasilitas '{src_code}' dilewati (tidak ada mapping)")
                    continue
                target_facility = Facility(
                    location_id=location_id,
                    facility_code=src_code,
                    facility_name=fac_data["facility_name"],
                    facility_type=None,
                    display_order=len(result.preview),
                )
                db.add(target_facility)
                db.flush()
                result.facilities_created += 1

            # Insert items; build hierarchy by level
            parent_stack: List[BOQItem] = []  # indexed by level
            for order_idx, it in enumerate(fac_data["items"]):
                lvl = int(it.get("level") or 0)
                # find parent: last pushed item with level < lvl
                parent = None
                while parent_stack and parent_stack[-1].level >= lvl:
                    parent_stack.pop()
                if parent_stack:
                    parent = parent_stack[-1]

                total_price = it.get("total_price") or 0
                volume = it.get("volume") or 0
                unit_price = it.get("unit_price") or 0
                if not total_price and volume and unit_price:
                    total_price = volume * unit_price

                full_code = it.get("original_code", "")
                if parent and parent.full_code:
                    full_code = f"{parent.full_code}.{it.get('original_code','')}"

                new_item = BOQItem(
                    facility_id=target_facility.id,
                    parent_id=parent.id if parent else None,
                    original_code=it.get("original_code"),
                    full_code=full_code,
                    level=lvl,
                    display_order=order_idx,
                    description=it["description"],
                    unit=it.get("unit"),
                    volume=Decimal(str(volume)),
                    unit_price=Decimal(str(unit_price)),
                    total_price=Decimal(str(total_price)),
                    planned_start_week=it.get("planned_start_week"),
                    planned_duration_weeks=it.get("planned_duration_weeks"),
                    is_leaf=bool(it.get("is_leaf", True)),
                )
                db.add(new_item)
                db.flush()
                parent_stack.append(new_item)
                result.items_imported += 1

            recalculate_facility_weights(db, str(target_facility.id))
            touched_contracts.add(str(target_loc.contract_id))

        for cid in touched_contracts:
            recalculate_contract_weights(db, cid)

        db.commit()
        result.success = True
        log_audit(db, current_user, "import_excel", "boq",
                  changes={
                      "location_id": location_id,
                      "items_imported": result.items_imported,
                      "facilities_created": result.facilities_created,
                  },
                  entity_id=location_id, request=request, commit=True)
    except Exception as e:
        db.rollback()
        result.errors.append(str(e))
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    return result
