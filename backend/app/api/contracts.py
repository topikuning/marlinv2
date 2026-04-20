from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_
from typing import Optional, List
from datetime import datetime, date

from app.core.database import get_db
from app.models.models import (
    Contract, ContractAddendum, Location, Facility, BOQItem,
    Company, PPK, ContractStatus, AddendumType, User, BOQItemVersion,
)
from app.schemas.schemas import (
    ContractCreate, ContractUpdate, ContractOut, ContractDetail,
    AddendumCreate, AddendumOut,
    LocationOut, FacilityOut, CompanyOut, PPKOut,
)
from app.api.deps import (
    get_current_user, require_permission, user_can_access_contract,
)
from app.services.audit_service import log_audit

router = APIRouter(prefix="/contracts", tags=["contracts"])


def _contract_to_detail(c: Contract, db: Session) -> dict:
    locations = []
    for loc in c.locations:
        loc_d = {
            "id": str(loc.id),
            "contract_id": str(loc.contract_id),
            "location_code": loc.location_code,
            "name": loc.name,
            "village": loc.village,
            "district": loc.district,
            "city": loc.city,
            "province": loc.province,
            "latitude": float(loc.latitude) if loc.latitude else None,
            "longitude": float(loc.longitude) if loc.longitude else None,
            "is_active": loc.is_active,
            "facilities": [
                {
                    "id": str(f.id),
                    "location_id": str(f.location_id),
                    "facility_code": f.facility_code,
                    "facility_type": f.facility_type,
                    "facility_name": f.facility_name,
                    "display_order": f.display_order,
                    "total_value": float(f.total_value or 0),
                    "is_active": f.is_active,
                }
                for f in sorted(loc.facilities, key=lambda x: x.display_order)
            ],
        }
        locations.append(loc_d)

    addenda = [
        {
            "id": str(a.id),
            "contract_id": str(a.contract_id),
            "number": a.number,
            "addendum_type": a.addendum_type.value if hasattr(a.addendum_type, "value") else a.addendum_type,
            "effective_date": a.effective_date.isoformat() if a.effective_date else None,
            "extension_days": a.extension_days,
            "old_end_date": a.old_end_date.isoformat() if a.old_end_date else None,
            "new_end_date": a.new_end_date.isoformat() if a.new_end_date else None,
            "old_contract_value": float(a.old_contract_value or 0),
            "new_contract_value": float(a.new_contract_value or 0),
            "description": a.description,
            "created_at": a.created_at.isoformat(),
        }
        for a in c.addenda
    ]

    company = db.query(Company).filter(Company.id == c.company_id).first()
    ppk = db.query(PPK).filter(PPK.id == c.ppk_id).first()
    konsultan = db.query(Company).filter(Company.id == c.konsultan_id).first() if c.konsultan_id else None

    return {
        "id": str(c.id),
        "contract_number": c.contract_number,
        "contract_name": c.contract_name,
        "company_id": str(c.company_id),
        "company_name": company.name if company else "",
        "ppk_id": str(c.ppk_id),
        "ppk_name": ppk.name if ppk else "",
        "konsultan_id": str(c.konsultan_id) if c.konsultan_id else None,
        "konsultan_name": konsultan.name if konsultan else None,
        "fiscal_year": c.fiscal_year,
        "original_value": float(c.original_value),
        "current_value": float(c.current_value),
        "start_date": c.start_date.isoformat() if c.start_date else None,
        "original_end_date": c.original_end_date.isoformat() if c.original_end_date else None,
        "end_date": c.end_date.isoformat() if c.end_date else None,
        "duration_days": c.duration_days,
        "status": c.status.value if hasattr(c.status, "value") else c.status,
        "description": c.description,
        "weekly_report_due_day": c.weekly_report_due_day,
        "daily_report_required": c.daily_report_required,
        "created_at": c.created_at.isoformat(),
        "locations": locations,
        "addenda": addenda,
    }


# ═══════════════════════════════════════════ LIST & SEARCH ═══════════════════

@router.get("", response_model=dict)
def list_contracts(
    q: Optional[str] = None,
    status: Optional[ContractStatus] = None,
    fiscal_year: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    query = db.query(Contract).filter(Contract.deleted_at.is_(None))
    if q:
        query = query.filter(or_(
            Contract.contract_number.ilike(f"%{q}%"),
            Contract.contract_name.ilike(f"%{q}%"),
        ))
    if status:
        query = query.filter(Contract.status == status)
    if fiscal_year:
        query = query.filter(Contract.fiscal_year == fiscal_year)

    # Scope by assigned contracts for konsultan/kontraktor
    role = current_user.role_obj
    if role and role.code in ("konsultan", "kontraktor", "ppk"):
        assigned = [str(c) for c in (current_user.assigned_contract_ids or [])]
        if assigned:
            query = query.filter(Contract.id.in_(assigned))

    total = query.count()
    items = query.order_by(Contract.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    rows = []
    for c in items:
        company = db.query(Company).filter(Company.id == c.company_id).first()
        ppk = db.query(PPK).filter(PPK.id == c.ppk_id).first()
        loc_count = db.query(Location).filter(Location.contract_id == c.id).count()
        rows.append({
            "id": str(c.id),
            "contract_number": c.contract_number,
            "contract_name": c.contract_name,
            "company_name": company.name if company else "",
            "ppk_name": ppk.name if ppk else "",
            "fiscal_year": c.fiscal_year,
            "current_value": float(c.current_value),
            "start_date": c.start_date.isoformat() if c.start_date else None,
            "end_date": c.end_date.isoformat() if c.end_date else None,
            "duration_days": c.duration_days,
            "status": c.status.value if hasattr(c.status, "value") else c.status,
            "location_count": loc_count,
        })
    return {"total": total, "page": page, "page_size": page_size, "items": rows}


@router.get("/{contract_id}", response_model=dict)
def get_contract(contract_id: str, db: Session = Depends(get_db),
                 current_user: User = Depends(require_permission("contract.read"))):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses kontrak ditolak")
    c = (
        db.query(Contract)
        .options(selectinload(Contract.locations).selectinload(Location.facilities))
        .options(selectinload(Contract.addenda))
        .filter(Contract.id == contract_id, Contract.deleted_at.is_(None))
        .first()
    )
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")
    return _contract_to_detail(c, db)


# ═══════════════════════════════════════════ CREATE ═══════════════════════════

@router.post("", response_model=dict)
def create_contract(
    data: ContractCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.create")),
):
    if db.query(Contract).filter(
        Contract.contract_number == data.contract_number,
        Contract.deleted_at.is_(None),
    ).first():
        raise HTTPException(400, "Nomor kontrak sudah ada")

    if not db.query(Company).filter(Company.id == data.company_id).first():
        raise HTTPException(400, "Perusahaan tidak ditemukan")
    if not db.query(PPK).filter(PPK.id == data.ppk_id).first():
        raise HTTPException(400, "PPK tidak ditemukan")

    duration = (data.end_date - data.start_date).days

    contract = Contract(
        contract_number=data.contract_number,
        contract_name=data.contract_name,
        company_id=data.company_id,
        ppk_id=data.ppk_id,
        konsultan_id=data.konsultan_id,
        fiscal_year=data.fiscal_year,
        original_value=data.original_value,
        current_value=data.original_value,
        start_date=data.start_date,
        original_end_date=data.end_date,
        end_date=data.end_date,
        duration_days=duration,
        status=ContractStatus.DRAFT,
        description=data.description,
        weekly_report_due_day=data.weekly_report_due_day,
        daily_report_required=data.daily_report_required,
        created_by=current_user.id,
    )
    db.add(contract)
    db.flush()

    # Multi-location upfront (fix for old UX bug)
    for loc_data in data.locations:
        if db.query(Location).filter(
            Location.contract_id == contract.id,
            Location.location_code == loc_data.location_code,
        ).first():
            continue
        loc = Location(contract_id=contract.id, **loc_data.model_dump())
        db.add(loc)

    db.commit()
    db.refresh(contract)
    log_audit(db, current_user, "create", "contract", str(contract.id),
              changes={"contract_number": contract.contract_number}, request=request, commit=True)
    return {"id": str(contract.id), "success": True}


@router.put("/{contract_id}", response_model=dict)
def update_contract(
    contract_id: str, data: ContractUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    before = {"status": str(c.status), "contract_name": c.contract_name}
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    log_audit(db, current_user, "update", "contract", str(c.id),
              changes={"before": before}, request=request, commit=True)
    return {"success": True}


@router.delete("/{contract_id}", response_model=dict)
def delete_contract(
    contract_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.delete")),
):
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")
    c.deleted_at = datetime.utcnow()
    db.commit()
    log_audit(db, current_user, "delete", "contract", str(c.id), request=request, commit=True)
    return {"success": True}


# ═══════════════════════════════════════════ ADDENDA ═════════════════════════

@router.get("/{contract_id}/addenda", response_model=List[AddendumOut])
def list_addenda(
    contract_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission("contract.read")),
):
    return db.query(ContractAddendum).filter(
        ContractAddendum.contract_id == contract_id
    ).order_by(ContractAddendum.effective_date).all()


@router.post("/{contract_id}/addenda", response_model=dict)
def create_addendum(
    contract_id: str, data: AddendumCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    addendum = ContractAddendum(
        contract_id=contract_id,
        number=data.number,
        addendum_type=data.addendum_type,
        effective_date=data.effective_date,
        extension_days=data.extension_days,
        old_end_date=c.end_date,
        new_end_date=data.new_end_date,
        old_contract_value=c.current_value,
        new_contract_value=data.new_contract_value,
        description=data.description,
        created_by=current_user.id,
    )
    db.add(addendum)

    # Apply changes to the contract
    if data.extension_days:
        c.end_date = c.end_date + (data.new_end_date - c.end_date if data.new_end_date else
                                    __import__("datetime").timedelta(days=data.extension_days))
        c.duration_days = (c.end_date - c.start_date).days
    if data.new_contract_value:
        c.current_value = data.new_contract_value
    c.status = ContractStatus.ADDENDUM

    db.commit()
    db.refresh(addendum)
    log_audit(db, current_user, "create", "addendum", str(addendum.id),
              changes={"contract_id": contract_id, "type": data.addendum_type.value},
              request=request, commit=True)
    return {"id": str(addendum.id), "success": True}


@router.delete("/{contract_id}/addenda/{addendum_id}", response_model=dict)
def delete_addendum(
    contract_id: str, addendum_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    a = db.query(ContractAddendum).filter(
        ContractAddendum.id == addendum_id,
        ContractAddendum.contract_id == contract_id,
    ).first()
    if not a:
        raise HTTPException(404, "Addendum tidak ditemukan")
    # revert contract — best effort
    c = db.query(Contract).filter(Contract.id == contract_id).first()
    if c and a.old_contract_value:
        c.current_value = a.old_contract_value
    if c and a.old_end_date:
        c.end_date = a.old_end_date
        c.duration_days = (c.end_date - c.start_date).days
    db.delete(a)
    db.commit()
    log_audit(db, current_user, "delete", "addendum", addendum_id, request=request, commit=True)
    return {"success": True}
