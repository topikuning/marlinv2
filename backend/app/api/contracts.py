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
    get_user_role_code,
)
from app.services.audit_service import log_audit
from sqlalchemy.orm.attributes import flag_modified

router = APIRouter(prefix="/contracts", tags=["contracts"])


# Role yang tunduk pada STRICT access control (harus ada di
# assigned_contract_ids). Lihat user_can_access_contract di deps.py.
_SCOPED_ROLES = {"ppk", "konsultan", "kontraktor"}


def _assign_contract_to_user(db: Session, user: User, contract_id: str) -> bool:
    """
    Tambahkan contract_id ke User.assigned_contract_ids kalau belum ada.
    Mengembalikan True bila terjadi perubahan.

    `assigned_contract_ids` disimpan sebagai JSONB; SQLAlchemy tidak
    mendeteksi mutasi in-place, jadi kita rebind list + flag_modified
    supaya perubahan kebawa ke UPDATE.
    """
    if not user:
        return False
    current = list(user.assigned_contract_ids or [])
    as_str = {str(c) for c in current}
    cid = str(contract_id)
    if cid in as_str:
        return False
    current.append(cid)
    user.assigned_contract_ids = current
    flag_modified(user, "assigned_contract_ids")
    return True


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

    # Surface the currently-active BOQ revision (if any) so the UI can show
    # "CCO-N · approved/draft" next to the BOQ tab and decide which revision
    # the progress grid should read from.
    from app.models.models import BOQRevision
    active_rev = (
        db.query(BOQRevision)
        .filter(BOQRevision.contract_id == c.id, BOQRevision.is_active == True)  # noqa: E712
        .first()
    )
    active_rev_payload = None
    if active_rev:
        active_rev_payload = {
            "id": str(active_rev.id),
            "cco_number": active_rev.cco_number,
            "revision_code": active_rev.revision_code,
            "status": active_rev.status.value if hasattr(active_rev.status, "value") else active_rev.status,
            "total_value": float(active_rev.total_value or 0),
            "item_count": active_rev.item_count or 0,
            "approved_at": active_rev.approved_at.isoformat() if active_rev.approved_at else None,
        }

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
        "activated_at": c.activated_at.isoformat() if c.activated_at else None,
        "activated_by_id": str(c.activated_by_id) if c.activated_by_id else None,
        "active_revision": active_rev_payload,
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
    include_draft: bool = True,
    reportable_only: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    """
    List contracts. By default returns every non-deleted contract in any
    status — including DRAFT — so that users can start typing daily/weekly
    reports against a contract that hasn't been formally activated yet
    (addresses catatan #6, "kontrak gaib di menu laporan").

    Flags:
      * include_draft=False  → hide DRAFT contracts (cosmetic filter)
      * reportable_only=True → keep only contracts that can legitimately
                               have reports attached (active, addendum,
                               optionally draft when include_draft=True).
                               Excludes completed/terminated.
    """
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

    if not include_draft:
        query = query.filter(Contract.status != ContractStatus.DRAFT)
    if reportable_only:
        allowed = [ContractStatus.ACTIVE, ContractStatus.ADDENDUM]
        if include_draft:
            allowed.append(ContractStatus.DRAFT)
        query = query.filter(Contract.status.in_(allowed))

    # ── STRICT contract access control ───────────────────────────────────────
    # For roles ppk/konsultan/kontraktor, only contracts in their
    # assigned_contract_ids are visible. Empty assignment → empty list
    # (consistent with user_can_access_contract rejecting detail access).
    # This prevents the paradox where users could see contracts in the
    # list but get 403 when clicking them.
    #
    # Roles that always see all: superadmin, admin_pusat, itjen, viewer, manager.
    role = current_user.role_obj
    if role and role.code in ("ppk", "konsultan", "kontraktor"):
        assigned = [str(c) for c in (current_user.assigned_contract_ids or [])]
        if not assigned:
            # No assignments → no contracts. Short-circuit to empty result.
            return {"total": 0, "page": page, "page_size": page_size, "items": []}
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
    db.flush()

    # Bootstrap an empty CCO-0 BOQ revision in DRAFT state.
    # BOQ imports and the inline grid editor will attach their items to this
    # revision. Admin has to explicitly approve it before activating the
    # contract (see POST /contracts/{id}/activate and
    # POST /boq/revisions/{id}/approve).
    from app.services import boq_revision_service
    boq_revision_service.ensure_cco_zero(
        db, contract, created_by_id=current_user.id, auto_approve=False,
    )

    # Auto-assign kontrak baru ke (1) user PPK yang dipilih dan (2) pembuat
    # kontrak bila role-nya STRICT-scoped. Tanpa ini, PPK login yang
    # membuat kontrak langsung terkunci dari kontraknya sendiri — paradoks
    # yang membingungkan user. Admin pusat / superadmin tidak perlu
    # di-assign karena mereka sudah bypass access control.
    ppk_row = db.query(PPK).filter(PPK.id == data.ppk_id).first()
    assigned_notes = []
    if ppk_row and ppk_row.user_id:
        ppk_user = db.query(User).filter(User.id == ppk_row.user_id).first()
        if _assign_contract_to_user(db, ppk_user, contract.id):
            assigned_notes.append(f"ppk_user:{ppk_user.id}")
    creator_role = get_user_role_code(db, current_user)
    if creator_role in _SCOPED_ROLES:
        if _assign_contract_to_user(db, current_user, contract.id):
            assigned_notes.append(f"creator:{current_user.id}")

    db.commit()
    db.refresh(contract)
    log_audit(db, current_user, "create", "contract", str(contract.id),
              changes={
                  "contract_number": contract.contract_number,
                  "auto_assigned": assigned_notes,
              }, request=request, commit=True)
    return {"id": str(contract.id), "success": True}


# Fields that can always be edited regardless of contract status.
# These are descriptive/administrative; they never change the legal
# meaning of the contract (value, dates, parties).
_ALWAYS_EDITABLE_FIELDS = {
    "contract_name",
    "description",
    "document_file",
    "weekly_report_due_day",
    "daily_report_required",
}

# Fields that are only editable while the contract is still DRAFT.
# Once ACTIVE, these can only be changed via an Addendum (which creates
# an auditable paper trail). COMPLETED/TERMINATED contracts are frozen.
_DRAFT_ONLY_FIELDS = {
    "contract_number",
    "company_id",
    "ppk_id",
    "konsultan_id",          # legacy contract-wide fallback
    "fiscal_year",
    "original_value",
    "current_value",
    "start_date",
    "end_date",
}


@router.put("/{contract_id}", response_model=dict)
def update_contract(
    contract_id: str, data: ContractUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Edit a contract with status-aware rules:

      * DRAFT         → all fields editable (fix for catatan #8: typo recovery)
      * ACTIVE        → only descriptive fields; value/dates/parties need an Addendum
      * COMPLETED /
        TERMINATED   → read-only (only way back is an Addendum)

    This is *business logic*, not permission. Who can call this endpoint
    at all is decided by the `contract.update` permission upstream.
    """
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    status_value = c.status.value if hasattr(c.status, "value") else str(c.status)

    if status_value in ("completed", "terminated"):
        raise HTTPException(
            400,
            f"Kontrak berstatus '{status_value}' tidak dapat diedit. "
            f"Gunakan Addendum jika perlu perubahan.",
        )

    incoming = data.model_dump(exclude_unset=True)
    rejected: List[str] = []
    if status_value != "draft":
        for key in list(incoming.keys()):
            if key in _DRAFT_ONLY_FIELDS:
                rejected.append(key)
                incoming.pop(key)
    if rejected:
        raise HTTPException(
            400,
            {
                "message": (
                    "Field berikut hanya bisa diubah saat status kontrak masih "
                    "'draft', atau lewat Addendum setelah kontrak aktif."
                ),
                "rejected_fields": rejected,
                "hint": "Perbaiki nomor/ nilai/ tanggal sebelum Activate, atau buat Addendum.",
            },
        )

    # Nomor kontrak yang baru (kalau diedit di DRAFT) harus tetap unik.
    if "contract_number" in incoming and incoming["contract_number"] != c.contract_number:
        clash = (
            db.query(Contract)
            .filter(
                Contract.contract_number == incoming["contract_number"],
                Contract.id != c.id,
                Contract.deleted_at.is_(None),
            )
            .first()
        )
        if clash:
            raise HTTPException(400, "Nomor kontrak sudah digunakan kontrak lain.")

    before = {
        k: (v.isoformat() if hasattr(v, "isoformat") else (float(v) if hasattr(v, "real") and not isinstance(v, bool) else v))
        for k, v in {key: getattr(c, key) for key in incoming}.items()
    }

    for k, v in incoming.items():
        setattr(c, k, v)

    # If start/end changed in DRAFT, keep duration in sync.
    if "start_date" in incoming or "end_date" in incoming:
        c.duration_days = (c.end_date - c.start_date).days
        # Keep original_end_date in sync too — we haven't activated yet.
        if "end_date" in incoming:
            c.original_end_date = c.end_date

    # If original_value changed in DRAFT, keep current_value in sync
    # (no addendum has been applied yet).
    if "original_value" in incoming:
        c.current_value = c.original_value

    db.commit()
    log_audit(
        db, current_user, "update", "contract", str(c.id),
        changes={"before": before, "after": {k: incoming[k] for k in incoming}},
        request=request, commit=True,
    )
    return {"success": True, "fields_updated": list(incoming.keys())}


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
    """
    Create an Addendum / CCO. If the addendum affects the BOQ
    (`cco`, `value_change`, `combined`) we also clone the currently-active
    BOQ revision into a new DRAFT revision bound to this addendum. The
    admin edits the new revision, then calls
    `POST /boq/revisions/{id}/approve` to make it active.
    """
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
    db.flush()

    # Apply schedule / value changes to the contract header immediately.
    if data.new_end_date:
        c.end_date = data.new_end_date
        c.duration_days = (c.end_date - c.start_date).days
    elif data.extension_days:
        import datetime as _dt
        c.end_date = c.end_date + _dt.timedelta(days=data.extension_days)
        c.duration_days = (c.end_date - c.start_date).days
    if data.new_contract_value:
        c.current_value = data.new_contract_value
    c.status = ContractStatus.ADDENDUM

    new_revision_id = None
    # Spawn a new draft BOQ revision if this addendum touches the BOQ.
    touches_boq = data.addendum_type in (
        AddendumType.CCO,
        AddendumType.VALUE_CHANGE,
        AddendumType.COMBINED,
    )
    if touches_boq:
        from app.services import boq_revision_service
        new_rev = boq_revision_service.clone_revision_for_addendum(
            db, addendum, created_by_id=current_user.id,
        )
        new_revision_id = str(new_rev.id)

    db.commit()
    db.refresh(addendum)
    log_audit(
        db, current_user, "create", "addendum", str(addendum.id),
        changes={
            "contract_id": contract_id,
            "type": data.addendum_type.value,
            "new_revision_id": new_revision_id,
        },
        request=request, commit=True,
    )
    return {
        "id": str(addendum.id),
        "success": True,
        "new_revision_id": new_revision_id,
    }


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


# ═══════════════════════════════════════════ ACTIVATION / LIFECYCLE ══════════

@router.get("/{contract_id}/readiness", response_model=dict)
def get_activation_readiness(
    contract_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission("contract.read")),
):
    """
    Non-mutating preview of activation checks. The UI calls this to render
    a readiness checklist ("✓ Lokasi ada · ✗ BOQ belum di-approve · ...")
    next to the Activate button so the admin knows what's missing.
    """
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    from app.services.contract_lifecycle_service import check_readiness
    r = check_readiness(db, c)
    return {
        "ready": r.ready,
        "reasons": r.reasons,
        "checks": {
            "has_locations": r.has_locations,
            "has_facilities": r.has_facilities,
            "has_approved_cco_zero": r.has_approved_cco_zero,
            "value_ok": r.value_ok,
        },
        "boq_total_value": r.boq_total_value,
        "contract_value": r.contract_value,
        "status": c.status.value if hasattr(c.status, "value") else c.status,
    }


@router.post("/{contract_id}/activate", response_model=dict)
def activate_contract_endpoint(
    contract_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Flip DRAFT contract to ACTIVE after passing readiness checks. Idempotent.
    Returns a 400 with `reasons` array if checks fail.
    """
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    from app.services.contract_lifecycle_service import activate_contract, ActivationError
    try:
        activate_contract(db, c, activated_by_id=current_user.id)
    except ActivationError as e:
        raise HTTPException(400, {"message": "Kontrak belum siap diaktifkan.", "reasons": e.reasons})

    db.commit()
    log_audit(
        db, current_user, "activate", "contract", str(c.id),
        changes={"new_status": "active"}, request=request, commit=True,
    )
    return {
        "success": True,
        "status": c.status.value,
        "activated_at": c.activated_at.isoformat() if c.activated_at else None,
    }


@router.post("/{contract_id}/complete", response_model=dict)
def complete_contract(
    contract_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Mark an ACTIVE (or ADDENDUM) contract as COMPLETED. After this point the
    contract is read-only. Reactivation would require a new addendum.
    """
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    status_value = c.status.value if hasattr(c.status, "value") else str(c.status)
    if status_value not in ("active", "addendum"):
        raise HTTPException(400, f"Kontrak berstatus '{status_value}' tidak bisa di-complete.")

    c.status = ContractStatus.COMPLETED
    db.commit()
    log_audit(db, current_user, "complete", "contract", str(c.id), request=request, commit=True)
    return {"success": True, "status": c.status.value}
