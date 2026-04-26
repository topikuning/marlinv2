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
from app.api._guards import assert_scope_editable_by_contract
from app.services.audit_service import log_audit
from sqlalchemy import func
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel, Field
import datetime as _dt

router = APIRouter(prefix="/contracts", tags=["contracts"])


def contract_is_unlocked(c: Contract) -> bool:
    """True bila kontrak dalam unlock window yang belum kedaluwarsa."""
    if c.unlock_until is None:
        return False
    return _dt.datetime.utcnow() < c.unlock_until


def _sum_active_boq(db: Session, contract: Contract) -> float:
    """
    Hitung total BOQ "working": revisi aktif dulu (V>=0 APPROVED), fallback
    ke revisi DRAFT terbaru (V0 DRAFT saat kontrak belum aktif, atau V(N)
    DRAFT saat sedang dalam fase addendum). Selaras dengan logic read path
    _resolve_working_revision_id di boq.py sehingga angka di header kontrak
    konsisten dengan isi tab BOQ.
    """
    from app.models.models import BOQRevision, BOQItem, RevisionStatus
    # 1. Revisi APPROVED yang aktif — kondisi normal kontrak berjalan
    rev = (
        db.query(BOQRevision)
        .filter(BOQRevision.contract_id == contract.id, BOQRevision.is_active == True)  # noqa: E712
        .first()
    )
    # 2. Fallback: revisi DRAFT terbaru (kontrak DRAFT atau adendum pending)
    if not rev:
        rev = (
            db.query(BOQRevision)
            .filter(
                BOQRevision.contract_id == contract.id,
                BOQRevision.status == RevisionStatus.DRAFT,
            )
            .order_by(BOQRevision.cco_number.desc())
            .first()
        )
    if not rev:
        return 0.0
    total = (
        db.query(func.coalesce(func.sum(BOQItem.total_price), 0))
        .filter(
            BOQItem.boq_revision_id == rev.id,
            BOQItem.is_leaf == True,  # noqa: E712
            BOQItem.is_active == True,  # noqa: E712
        )
        .scalar()
    )
    return float(total or 0)


# Role yang tunduk pada STRICT access control (harus ada di
# assigned_contract_ids). Lihat user_can_access_contract di deps.py.
_SCOPED_ROLES = {"ppk", "konsultan", "kontraktor"}


def _assign_contract_to_user(db: Session, user: User, contract_id: str) -> bool:
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
    # Deteksi fasilitas yang dihapus via REMOVE_FACILITY di revisi BOQ aktif.
    # Kriteria: facility punya item di revisi aktif tapi seluruhnya is_active=False.
    from app.models.models import BOQRevision
    active_rev = (
        db.query(BOQRevision)
        .filter(BOQRevision.contract_id == c.id, BOQRevision.is_active == True)  # noqa: E712
        .first()
    )
    removed_facility_ids: set = set()
    if active_rev:
        all_in_rev = {
            str(r.facility_id)
            for r in db.query(BOQItem.facility_id)
            .filter(BOQItem.boq_revision_id == active_rev.id)
            .distinct()
            .all()
        }
        still_active = {
            str(r.facility_id)
            for r in db.query(BOQItem.facility_id)
            .filter(BOQItem.boq_revision_id == active_rev.id, BOQItem.is_active == True)  # noqa: E712
            .distinct()
            .all()
        }
        removed_facility_ids = all_in_rev - still_active

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
                    "is_removed_in_active_rev": str(f.id) in removed_facility_ids,
                }
                for f in sorted(loc.facilities, key=lambda x: x.display_order)
            ],
        }
        locations.append(loc_d)

    addenda = []
    for a in c.addenda:
        # Bundled / linked VOs (DRAFT addendum: status APPROVED + bundled_addendum_id;
        # SIGNED addendum: status BUNDLED + bundled_addendum_id)
        from app.models.models import VariationOrder
        linked_vos = (
            db.query(VariationOrder)
            .filter(VariationOrder.bundled_addendum_id == a.id)
            .all()
        )
        addenda.append({
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
            "signed_at": a.signed_at.isoformat() if a.signed_at else None,
            "signed_by_id": str(a.signed_by_id) if a.signed_by_id else None,
            "kpa_approved_by_id": str(a.kpa_approved_by_id) if a.kpa_approved_by_id else None,
            "kpa_approved_at": a.kpa_approved_at.isoformat() if a.kpa_approved_at else None,
            "created_at": a.created_at.isoformat(),
            "bundled_vos": [
                {
                    "id": str(v.id),
                    "vo_number": v.vo_number,
                    "title": v.title,
                    "status": v.status.value if hasattr(v.status, "value") else v.status,
                    "cost_impact": float(v.cost_impact or 0),
                }
                for v in linked_vos
            ],
        })

    company = db.query(Company).filter(Company.id == c.company_id).first()
    ppk = db.query(PPK).filter(PPK.id == c.ppk_id).first()
    konsultan = db.query(Company).filter(Company.id == c.konsultan_id).first() if c.konsultan_id else None

    # Surface the currently-active BOQ revision (if any) so the UI can show
    # "CCO-N · approved/draft" next to the BOQ tab and decide which revision
    # the progress grid should read from.
    from app.models.models import BOQRevision, RevisionStatus

    def _rev_payload(r):
        if not r:
            return None
        return {
            "id": str(r.id),
            "cco_number": r.cco_number,
            "revision_code": r.revision_code,
            "status": r.status.value if hasattr(r.status, "value") else r.status,
            "total_value": float(r.total_value or 0),
            "item_count": r.item_count or 0,
            "approved_at": r.approved_at.isoformat() if r.approved_at else None,
        }

    active_rev = (
        db.query(BOQRevision)
        .filter(BOQRevision.contract_id == c.id, BOQRevision.is_active == True)  # noqa: E712
        .first()
    )
    active_rev_payload = _rev_payload(active_rev)

    # Working revision = revisi DRAFT terbaru kalau ada (addendum pending),
    # jatuh ke active kalau tidak ada. UI BOQ pakai ini untuk memutuskan
    # locked vs editable supaya alur setelah buat addendum jelas.
    latest_draft = (
        db.query(BOQRevision)
        .filter(BOQRevision.contract_id == c.id, BOQRevision.status == RevisionStatus.DRAFT)
        .order_by(BOQRevision.cco_number.desc())
        .first()
    )
    working_rev_payload = _rev_payload(latest_draft) or active_rev_payload

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
        "ppn_pct": float(c.ppn_pct or 0),
        # Live sum BOQ revisi aktif. BOQ disimpan PRE-PPN. Total kontrak
        # POST-PPN = boq_total × (1 + ppn_pct/100). UI tampilkan breakdown.
        "boq_total": _sum_active_boq(db, c),
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
        "unlocked_at": (c.unlocked_at.isoformat() + "Z") if c.unlocked_at else None,
        "unlock_until": (c.unlock_until.isoformat() + "Z") if c.unlock_until else None,
        "unlocked_by_id": str(c.unlocked_by_id) if c.unlocked_by_id else None,
        "unlock_reason": c.unlock_reason,
        "active_revision": active_rev_payload,
        "working_revision": working_rev_payload,
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
        ppn_pct=data.ppn_pct,
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
    assigned_notes = []

    # 1. PPK → user_id
    ppk_row = db.query(PPK).filter(PPK.id == data.ppk_id).first()
    if ppk_row and ppk_row.user_id:
        ppk_user = db.query(User).filter(User.id == ppk_row.user_id).first()
        if _assign_contract_to_user(db, ppk_user, contract.id):
            assigned_notes.append(f"ppk:{ppk_user.id}")

    # 2. Kontraktor (company_id) → default_user_id
    contractor = db.query(Company).filter(Company.id == data.company_id).first()
    if contractor and contractor.default_user_id:
        contractor_user = db.query(User).filter(User.id == contractor.default_user_id).first()
        if _assign_contract_to_user(db, contractor_user, contract.id):
            assigned_notes.append(f"kontraktor:{contractor_user.id}")

    # 3. Konsultan (konsultan_id) → default_user_id
    if data.konsultan_id:
        konsultan = db.query(Company).filter(Company.id == data.konsultan_id).first()
        if konsultan and konsultan.default_user_id:
            konsultan_user = db.query(User).filter(User.id == konsultan.default_user_id).first()
            if _assign_contract_to_user(db, konsultan_user, contract.id):
                assigned_notes.append(f"konsultan:{konsultan_user.id}")

    # 4. Pembuat kontrak sendiri (bila role scoped: ppk/konsultan/kontraktor)
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

      * Role gate:  kontraktor DITOLAK — edit field admin kontrak
                    (nama/nilai/tanggal/PPK/dll) hanya oleh PPK/admin.
                    Kontraktor tetap bisa bikin VO via endpoint VO terpisah.
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

    # Role gate: kontraktor/konsultan tidak boleh edit field admin kontrak.
    # God-mode (Unlock) tetap bypass karena superadmin yang trigger.
    from app.api.deps import assert_role_in
    unlocked = contract_is_unlocked(c)
    if not unlocked:
        assert_role_in(
            db, current_user, "ppk", "admin_pusat", "kpa",
            action="Edit field administratif kontrak",
        )

    status_value = c.status.value if hasattr(c.status, "value") else str(c.status)

    # COMPLETED / TERMINATED normalnya read-only. Unlock mode menggantikan
    # batasan itu karena safety-valve didesain untuk koreksi retroaktif
    # yang kadang muncul setelah kontrak selesai.
    if status_value in ("completed", "terminated") and not unlocked:
        raise HTTPException(
            400,
            f"Kontrak berstatus '{status_value}' tidak dapat diedit. "
            f"Gunakan Addendum jika perlu perubahan, atau buka Unlock Mode.",
        )

    incoming = data.model_dump(exclude_unset=True)
    rejected: List[str] = []
    # Field DRAFT-only dibuka juga saat unlock — ini inti safety-valve:
    # membiarkan superadmin memperbaiki nilai/tanggal/ppk yang salah input
    # tanpa memaksa membuat Addendum administratif yang tidak sesuai
    # konteks (kesalahan input manusia, bukan perubahan scope).
    if status_value != "draft" and not unlocked:
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
                    "'draft', atau lewat Addendum setelah kontrak aktif, atau "
                    "dengan Unlock Mode."
                ),
                "rejected_fields": rejected,
                "hint": "Perbaiki nomor/nilai/tanggal sebelum Activate, buat Addendum, atau buka Unlock Mode.",
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

    # Di DRAFT, ubah original_value otomatis meng-update current_value (belum
    # ada addendum). Di mode unlock, superadmin mungkin ingin mengubah
    # current_value sendiri (misal: mencocokkan dengan total BOQ setelah
    # koreksi manual), jadi biarkan ia eksplisit lewat field current_value.
    if "original_value" in incoming and status_value == "draft" and not unlocked:
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
    Sign Addendum — satu-satunya titik LEGAL yang mengubah BOQ.

    Selaras Perpres 16/2018 ps. 54:
      - Kalau perubahan nilai > 10% dari nilai kontrak awal, Addendum harus
        ditandatangani KPA (kpa_approved_by_id wajib). Kalau tidak, 400.
      - Kalau VO sudah ada dan APPROVED, di-bundle ke Addendum ini via
        vo_ids payload. Status VO berubah jadi BUNDLED.

    God-Mode (Unlock Mode): kalau unlock_until aktif, semua syarat (threshold,
    bundling, VO check) bisa di-bypass. Addendum ditandai god_mode_bypass=True
    dan semua aksi ter-log di audit_logs.

    Setelah addendum signed:
      - BOQ revisi baru (V1, V2, ...) di-clone dari revisi aktif
      - Perubahan VO items diterapkan ke revisi baru (ADD/INCREASE/DECREASE/
        MODIFY_SPEC/REMOVE)
      - Revisi baru DRAFT, menunggu approve_revision untuk activate
    """
    from app.services.vo_service import (
        is_god_mode_active, log_god_mode_bypass,
        requires_kpa_approval, bundle_vos_to_addendum,
    )

    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    gm = is_god_mode_active(c)

    # Role gate: sign_addendum = aksi LEGAL yang mengubah BOQ. Kontraktor
    # boleh submit VO tapi TIDAK boleh sign addendum. Hanya PPK (atau KPA
    # kalau nilai > 10%). God-mode superadmin bypass otomatis.
    if not gm:
        from app.api.deps import assert_role_in
        assert_role_in(
            db, current_user, "ppk", "admin_pusat", "kpa",
            action="Tanda-tangan Addendum (sign_addendum)",
        )

    # Threshold check (Perpres ps. 54 — 10% rule)
    needs_kpa = False
    if data.new_contract_value is not None:
        needs_kpa = requires_kpa_approval(c, data.new_contract_value)
    if needs_kpa and not data.kpa_approved_by_id and not gm:
        raise HTTPException(
            400,
            {
                "code": "kpa_approval_required",
                "message": (
                    "Perubahan nilai > 10% dari nilai kontrak awal. "
                    "Perpres 16/2018 ps. 54: Addendum ini wajib disetujui KPA. "
                    "Isi kpa_approved_by_id dengan user KPA yang menandatangani."
                ),
                "threshold_percent": 10,
                "original_value": float(c.original_value or 0),
                "new_value": float(data.new_contract_value or 0),
            },
        )

    # Validasi KPA user (bila diisi)
    kpa_user = None
    if data.kpa_approved_by_id:
        kpa_user = db.query(User).filter(User.id == data.kpa_approved_by_id).first()
        if not kpa_user:
            raise HTTPException(400, "User KPA tidak ditemukan")
        from app.api.deps import get_user_role_code
        if get_user_role_code(db, kpa_user) not in ("kpa", "superadmin") and not gm:
            raise HTTPException(400, "User yang dipilih bukan KPA.")

    # Konvensi baru: addendum dibuat sebagai DRAFT (signed_at=None).
    # Tidak bundle VO (status tetap APPROVED), tidak buat BOQ revision baru,
    # tidak ubah contract.status / value / end_date. Semua side-effects baru
    # terjadi saat user POST /sign endpoint terpisah.
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
        signed_by_id=None,
        signed_at=None,  # DRAFT
        kpa_approved_by_id=data.kpa_approved_by_id,
        kpa_approved_at=None,
        kpa_approval_notes=data.kpa_approval_notes,
        god_mode_bypass=gm,
        created_by=current_user.id,
    )
    db.add(addendum)
    db.flush()

    # Link VO ter-pilih sebagai DRAFT — set bundled_addendum_id tapi
    # status VO TETAP APPROVED. Status berubah ke BUNDLED hanya saat sign.
    linked_vo_ids = []
    if data.vo_ids:
        from app.models.models import VariationOrder, VOStatus
        for vid in data.vo_ids:
            vo = db.query(VariationOrder).filter(VariationOrder.id == vid).first()
            if not vo or vo.contract_id != c.id:
                continue
            if vo.status != VOStatus.APPROVED:
                continue
            vo.bundled_addendum_id = addendum.id
            linked_vo_ids.append(str(vo.id))

    db.commit()
    db.refresh(addendum)
    log_audit(
        db, current_user, "create_addendum_draft", "addendum", str(addendum.id),
        changes={
            "contract_id": contract_id,
            "number": data.number,
            "type": data.addendum_type.value,
            "linked_vo_ids": linked_vo_ids,
            "status": "DRAFT",
        },
        request=request, commit=True,
    )
    return {
        "id": str(addendum.id),
        "success": True,
        "status": "draft",
        "linked_vos": linked_vo_ids,
        "god_mode_bypass": gm,
        "message": "Addendum tersimpan sebagai DRAFT. Klik 'Tanda Tangan & Apply' di tab Addendum untuk menerapkan ke kontrak.",
    }


@router.put("/{contract_id}/addenda/{addendum_id}", response_model=dict)
def update_addendum(
    contract_id: str, addendum_id: str, data: AddendumCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Edit Addendum DRAFT — boleh ubah metadata + re-pilih VO yang dilink.
    Tidak boleh untuk Addendum yang sudah SIGNED (signed_at != NULL) —
    untuk koreksi SIGNED, user harus delete + buat ulang.
    """
    a = db.query(ContractAddendum).filter(
        ContractAddendum.id == addendum_id,
        ContractAddendum.contract_id == contract_id,
    ).first()
    if not a:
        raise HTTPException(404, "Addendum tidak ditemukan")
    if a.signed_at is not None:
        raise HTTPException(
            400,
            "Addendum sudah SIGNED — tidak bisa di-edit. Hapus dan buat ulang kalau perlu koreksi.",
        )

    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    from app.api.deps import assert_role_in
    from app.services.vo_service import is_god_mode_active
    gm = is_god_mode_active(c)
    if not gm:
        assert_role_in(
            db, current_user, "ppk", "admin_pusat", "kpa",
            action="Edit Addendum DRAFT",
        )

    # Update metadata
    a.number = data.number
    a.addendum_type = data.addendum_type
    a.effective_date = data.effective_date
    a.extension_days = data.extension_days
    a.new_end_date = data.new_end_date
    a.new_contract_value = data.new_contract_value
    a.description = data.description
    a.kpa_approved_by_id = data.kpa_approved_by_id
    a.kpa_approval_notes = data.kpa_approval_notes

    # Re-link VOs: clear bundled_addendum_id semua yang ter-link ke addendum ini,
    # lalu set ulang sesuai vo_ids baru.
    from app.models.models import VariationOrder, VOStatus
    db.query(VariationOrder).filter(
        VariationOrder.bundled_addendum_id == a.id
    ).update({"bundled_addendum_id": None}, synchronize_session=False)

    linked = []
    if data.vo_ids:
        for vid in data.vo_ids:
            vo = db.query(VariationOrder).filter(VariationOrder.id == vid).first()
            if not vo or vo.contract_id != c.id:
                continue
            if vo.status != VOStatus.APPROVED:
                continue
            vo.bundled_addendum_id = a.id
            linked.append(str(vo.id))

    db.commit()
    db.refresh(a)
    log_audit(
        db, current_user, "update_addendum_draft", "addendum", str(a.id),
        changes={"linked_vo_ids": linked}, request=request, commit=True,
    )
    return {"id": str(a.id), "success": True, "linked_vos": linked}


@router.post("/{contract_id}/addenda/{addendum_id}/sign", response_model=dict)
def sign_addendum(
    contract_id: str, addendum_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Tanda-tangani Addendum DRAFT — titik LEGAL yang menerapkan perubahan
    ke kontrak: bundle VO (status BUNDLED), clone BOQ revision baru DRAFT,
    apply VO items ke revisi, ubah contract.status/value/end_date.

    Setelah signed, addendum jadi immutable kecuali rollback via delete.
    """
    from app.services.vo_service import (
        is_god_mode_active, log_god_mode_bypass,
        requires_kpa_approval, bundle_vos_to_addendum,
    )

    a = db.query(ContractAddendum).filter(
        ContractAddendum.id == addendum_id,
        ContractAddendum.contract_id == contract_id,
    ).first()
    if not a:
        raise HTTPException(404, "Addendum tidak ditemukan")
    if a.signed_at is not None:
        raise HTTPException(400, "Addendum sudah SIGNED.")

    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    gm = is_god_mode_active(c)

    # Role gate — sign = aksi LEGAL, hanya PPK/admin_pusat/KPA
    if not gm:
        from app.api.deps import assert_role_in
        assert_role_in(
            db, current_user, "ppk", "admin_pusat", "kpa",
            action="Tanda-tangan Addendum (sign_addendum)",
        )

    # Threshold check (Perpres ps. 54 — 10% rule)
    needs_kpa = False
    if a.new_contract_value is not None:
        needs_kpa = requires_kpa_approval(c, a.new_contract_value)
    if needs_kpa and not a.kpa_approved_by_id and not gm:
        raise HTTPException(
            400,
            {
                "code": "kpa_approval_required",
                "message": (
                    "Perubahan nilai > 10% dari nilai kontrak awal. "
                    "Perpres 16/2018 ps. 54: Addendum ini wajib disetujui KPA. "
                    "Edit Addendum dan isi kpa_approved_by_id sebelum sign."
                ),
                "threshold_percent": 10,
                "original_value": float(c.original_value or 0),
                "new_value": float(a.new_contract_value or 0),
            },
        )

    # Resolve VO yang ter-link sebagai DRAFT (bundled_addendum_id=this addendum)
    from app.models.models import VariationOrder, VOStatus
    linked_vos = db.query(VariationOrder).filter(
        VariationOrder.bundled_addendum_id == a.id
    ).all()

    # Set signed_at + signed_by + KPA approved_at
    a.signed_at = datetime.utcnow()
    a.signed_by_id = current_user.id
    if a.kpa_approved_by_id:
        a.kpa_approved_at = datetime.utcnow()

    # Bundle VOs: status APPROVED → BUNDLED
    for vo in linked_vos:
        vo.status = VOStatus.BUNDLED

    # Apply schedule / value changes to contract header
    if a.new_end_date:
        c.old_end_date = c.end_date
        c.end_date = a.new_end_date
        c.duration_days = (c.end_date - c.start_date).days
    elif a.extension_days:
        import datetime as _dt
        c.end_date = c.end_date + _dt.timedelta(days=a.extension_days)
        c.duration_days = (c.end_date - c.start_date).days
    if a.new_contract_value:
        c.current_value = a.new_contract_value
    c.status = ContractStatus.ADDENDUM

    new_revision_id = None
    touches_boq = a.addendum_type in (
        AddendumType.CCO,
        AddendumType.VALUE_CHANGE,
        AddendumType.COMBINED,
    ) or bool(linked_vos)
    if touches_boq:
        from app.services import boq_revision_service
        new_rev = boq_revision_service.clone_revision_for_addendum(
            db, a, created_by_id=current_user.id,
        )
        if linked_vos:
            _apply_vo_items_to_revision(db, new_rev, linked_vos)
        new_revision_id = str(new_rev.id)

    db.commit()
    db.refresh(a)
    if gm:
        log_god_mode_bypass(
            db, current_user, c,
            action="sign_addendum_with_bypass",
            target_type="contract_addendum", target_id=str(a.id),
            details={"needs_kpa": needs_kpa, "vo_ids": [str(v.id) for v in linked_vos]},
            request=request,
        )
        db.commit()
    log_audit(
        db, current_user, "sign_addendum", "addendum", str(a.id),
        changes={
            "contract_id": contract_id,
            "new_revision_id": new_revision_id,
            "bundled_vo_ids": [str(v.id) for v in linked_vos],
            "kpa_required": needs_kpa,
            "god_mode_bypass": gm,
        },
        request=request, commit=True,
    )
    return {
        "id": str(a.id),
        "success": True,
        "status": "signed",
        "new_revision_id": new_revision_id,
        "bundled_vos": [str(v.id) for v in linked_vos],
    }


def _cascade_remove_children(db: Session, revision_id, parent_id) -> None:
    """
    Cascade non-aktifkan seluruh descendant dari parent_id di revisi tertentu.
    Traversal iteratif (BFS) — hindari rekursi stack overflow pada pohon dalam.
    Selaras hirarki BOQ level 0-3 (atau lebih): hapus parent → semua children
    & sub-children non-aktif dengan change_type="removed".
    """
    from app.models.models import BOQItem
    to_visit = [parent_id]
    visited = set()
    while to_visit:
        pid = to_visit.pop()
        if pid in visited:
            continue
        visited.add(pid)
        children = db.query(BOQItem).filter(
            BOQItem.boq_revision_id == revision_id,
            BOQItem.parent_id == pid,
        ).all()
        for ch in children:
            ch.is_active = False
            ch.change_type = "removed"
            to_visit.append(ch.id)


def _apply_vo_items_to_revision(db: Session, new_rev, bundled_vos):
    """
    Terapkan perubahan dari VO items ke revisi BOQ baru:
      - ADD: create new BOQItem di facility target
      - INCREASE/DECREASE: update volume item hasil clone
      - MODIFY_SPEC: update description/unit item hasil clone
      - REMOVE: set is_active=False pada item hasil clone
    Revisi baru sudah berisi clone dari revisi lama (via clone_revision_for_addendum);
    kita tinggal patch sesuai VO items.

    ADD chain support: item ADD bisa menjadi parent item ADD lain di VO yang sama.
    Resolusi dilakukan multi-pass (topological order) menggunakan parent_code string.
    """
    from app.models.models import VOItemAction, BOQItem
    from app.services.boq_revision_service import recalc_revision_totals

    # Build map: source_item_id (revisi lama) → cloned item (revisi baru)
    all_cloned = db.query(BOQItem).filter(BOQItem.boq_revision_id == new_rev.id).all()
    cloned_items = {
        str(it.source_item_id): it for it in all_cloned if it.source_item_id
    }
    # Build map: (facility_id_str, original_code) → cloned item
    # Dipakai untuk resolve parent_code ke item existing di revisi baru
    cloned_by_fac_code = {
        (str(it.facility_id), str(it.original_code)): it
        for it in all_cloned if it.original_code
    }

    # Pisahkan ADD dari non-ADD
    add_vis = []
    non_add_vis = []
    for vo in bundled_vos:
        for vi in vo.items:
            if vi.action == VOItemAction.ADD:
                add_vis.append(vi)
            else:
                non_add_vis.append(vi)

    # ── Non-ADD items ─────────────────────────────────────────────────────────
    for vi in non_add_vis:
        if vi.action in (VOItemAction.INCREASE, VOItemAction.DECREASE):
            target = cloned_items.get(str(vi.boq_item_id))
            if target:
                from decimal import Decimal
                delta = Decimal(vi.volume_delta or 0)
                target.volume = (target.volume or Decimal("0")) + delta
                target.total_price = target.volume * (target.unit_price or Decimal("0"))
                target.change_type = "modified"
        elif vi.action == VOItemAction.MODIFY_SPEC:
            target = cloned_items.get(str(vi.boq_item_id))
            if target:
                target.description = vi.description or target.description
                if vi.unit:
                    target.unit = vi.unit
                target.change_type = "modified"
        elif vi.action == VOItemAction.REMOVE:
            target = cloned_items.get(str(vi.boq_item_id))
            if target:
                target.is_active = False
                target.change_type = "removed"
                # Cascade: anak-anak juga non-aktif
                _cascade_remove_children(db, new_rev.id, target.id)
        elif vi.action == VOItemAction.REMOVE_FACILITY:
            # Hilangkan seluruh fasilitas — set is_active=False pada semua
            # item BOQ di fasilitas ini (di revisi baru).
            items_in_fac = db.query(BOQItem).filter(
                BOQItem.boq_revision_id == new_rev.id,
                BOQItem.facility_id == vi.facility_id,
            ).all()
            for it in items_in_fac:
                it.is_active = False
                it.change_type = "removed"

    # ── ADD items: multi-pass untuk resolve parent chain (ADD → ADD) ──────────
    # new_items_by_code: (facility_id_str, new_item_code) → BOQItem baru
    new_items_by_code: dict = {}

    unresolved = list(add_vis)
    for _ in range(6):  # BOQ max 4 level, margin 2 untuk safety
        if not unresolved:
            break
        still_unresolved = []
        created_this_pass = []

        for vi in unresolved:
            parent_clone = None

            if vi.parent_boq_item_id:
                # Parent = item existing di revisi lama, sudah di-clone ke revisi baru
                parent_clone = cloned_items.get(str(vi.parent_boq_item_id))
            elif vi.parent_code and vi.facility_id:
                fac_id_str = str(vi.facility_id)
                # 1. Coba item existing di revisi baru (dari revisi lama)
                parent_clone = cloned_by_fac_code.get((fac_id_str, vi.parent_code))
                if not parent_clone:
                    # 2. Coba item ADD baru yang sudah dibuat di pass sebelumnya
                    parent_clone = new_items_by_code.get((fac_id_str, vi.parent_code))
                if not parent_clone:
                    # Parent belum ada — tunda ke pass berikutnya
                    still_unresolved.append(vi)
                    continue

            parent_level = (parent_clone.level or 0) + 1 if parent_clone else 0
            if parent_clone:
                parent_clone.is_leaf = False

            new_item = BOQItem(
                boq_revision_id=new_rev.id,
                facility_id=vi.facility_id,
                parent_id=parent_clone.id if parent_clone else None,
                original_code=vi.new_item_code or None,
                level=parent_level,
                master_work_code=vi.master_work_code,
                description=vi.description,
                unit=vi.unit,
                volume=vi.volume_delta,
                unit_price=vi.unit_price,
                total_price=vi.cost_impact,
                is_active=True,
                is_leaf=True,
                is_addendum_item=True,
                change_type="added",
            )
            db.add(new_item)
            created_this_pass.append((vi, new_item))

        if created_this_pass:
            db.flush()  # agar ID tersedia untuk child di pass berikutnya
            for vi, new_item in created_this_pass:
                if vi.new_item_code and vi.facility_id:
                    new_items_by_code[(str(vi.facility_id), vi.new_item_code)] = new_item

        unresolved = still_unresolved

    # Sisa yang tidak bisa di-resolve (data tidak valid/circular) → buat sebagai root
    for vi in unresolved:
        new_item = BOQItem(
            boq_revision_id=new_rev.id,
            facility_id=vi.facility_id,
            parent_id=None,
            original_code=vi.new_item_code or None,
            level=0,
            master_work_code=vi.master_work_code,
            description=vi.description,
            unit=vi.unit,
            volume=vi.volume_delta,
            unit_price=vi.unit_price,
            total_price=vi.cost_impact,
            is_active=True,
            is_leaf=True,
            is_addendum_item=True,
            change_type="added",
        )
        db.add(new_item)

    db.flush()
    recalc_revision_totals(db, new_rev)


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
    from app.api.deps import assert_role_in
    from app.models.models import VariationOrder, VOStatus, BOQRevision, RevisionStatus
    c = db.query(Contract).filter(Contract.id == contract_id).first()
    from app.services.vo_service import is_god_mode_active
    gm = c is not None and is_god_mode_active(c)
    if not gm:
        assert_role_in(
            db, current_user, "ppk", "admin_pusat", "kpa",
            action="Hapus Addendum",
        )

    is_signed = a.signed_at is not None
    if is_signed:
        # Untuk SIGNED addendum, scope kontrak harus masih editable (DRAFT/ADDENDUM
        # window). Setelah kontrak kembali ACTIVE pasca-approve revisi, rollback
        # otomatis tidak aman.
        assert_scope_editable_by_contract(db, contract_id, entity="addendum")

    # Un-link VO yang sebelumnya ter-bundle ke addendum ini.
    # - DRAFT addendum: VO status tetap APPROVED (tidak pernah BUNDLED)
    # - SIGNED addendum: VO status BUNDLED → APPROVED
    linked = db.query(VariationOrder).filter(
        VariationOrder.bundled_addendum_id == addendum_id
    ).all()
    for vo in linked:
        vo.bundled_addendum_id = None
        if vo.status == VOStatus.BUNDLED:
            vo.status = VOStatus.APPROVED

    deleted_revision_id = None
    if is_signed:
        # Revert contract — only kalau SIGNED. DRAFT tidak pernah ubah contract.
        if c and a.old_contract_value:
            c.current_value = a.old_contract_value
        if c and a.old_end_date:
            c.end_date = a.old_end_date
            c.duration_days = (c.end_date - c.start_date).days

        # Bug fix: BOQRevision yang dihasilkan saat sign harus ikut dihapus
        # kalau masih DRAFT (belum di-approve). Kalau sudah APPROVED, jangan
        # delete — itu sudah bagian history valid.
        rev = (
            db.query(BOQRevision)
            .filter(BOQRevision.addendum_id == a.id)
            .first()
        )
        if rev and rev.status == RevisionStatus.DRAFT:
            from app.models.models import BOQItem
            db.query(BOQItem).filter(BOQItem.boq_revision_id == rev.id).delete(synchronize_session=False)
            db.delete(rev)
            deleted_revision_id = str(rev.id)
        elif rev and rev.status == RevisionStatus.APPROVED:
            # Revisi sudah aktif — tidak boleh di-rollback otomatis.
            raise HTTPException(
                400,
                {
                    "code": "revision_already_approved",
                    "message": (
                        f"Revisi BOQ {rev.revision_code} dari addendum ini sudah "
                        "APPROVED dan menjadi aktif. Rollback otomatis tidak aman. "
                        "Buat addendum baru untuk koreksi."
                    ),
                    "revision_id": str(rev.id),
                },
            )

    db.delete(a)
    db.flush()
    # Kalau tidak ada addendum lain dan status masih ADDENDUM, kembalikan ke ACTIVE.
    remaining = db.query(ContractAddendum).filter(
        ContractAddendum.contract_id == contract_id
    ).count()
    if c and remaining == 0 and c.status == ContractStatus.ADDENDUM:
        c.status = ContractStatus.ACTIVE
    db.commit()
    log_audit(
        db, current_user,
        "delete_addendum_signed" if is_signed else "delete_addendum_draft",
        "addendum", addendum_id,
        changes={
            "was_signed": is_signed,
            "unlinked_vo_ids": [str(v.id) for v in linked],
            "deleted_revision_id": deleted_revision_id,
        },
        request=request, commit=True,
    )
    return {
        "success": True,
        "was_signed": is_signed,
        "unlinked_vos": len(linked),
        "deleted_revision_id": deleted_revision_id,
    }


# ═══════════════════════════════════════════ ACTIVATION / LIFECYCLE ══════════

@router.get("/{contract_id}/chain-status", response_model=dict)
def get_chain_status(
    contract_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    """
    Aggregate kronologis lifecycle kontrak untuk UI rantai MC→VO→Adendum.

    Return:
      - timeline: list event kronologis (TTD, BOQ V0, MC, VO, Adendum, revisi)
      - summary: counter + next_action untuk panel status di Overview
    """
    from app.models.models import (
        FieldObservation, VariationOrder, VOStatus, BOQRevision, RevisionStatus,
    )
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    events = []

    # 1. Kontrak ditandatangani (start)
    events.append({
        "type": "contract_signed",
        "date": c.start_date.isoformat() if c.start_date else None,
        "label": "TTD Kontrak",
        "status": "done",
        "sort_key": c.start_date.isoformat() if c.start_date else "0000-00-00",
    })

    # 2. BOQ baseline V0 + revisi
    revisions = (
        db.query(BOQRevision)
        .filter(BOQRevision.contract_id == contract_id)
        .order_by(BOQRevision.cco_number)
        .all()
    )
    for r in revisions:
        rs = r.status.value if hasattr(r.status, "value") else r.status
        events.append({
            "type": "boq_revision",
            "date": (r.approved_at or r.created_at).isoformat() if (r.approved_at or r.created_at) else None,
            "label": f"BOQ {r.revision_code or f'V{r.cco_number}'}",
            "status": "done" if r.is_active else rs,
            "id": str(r.id),
            "revision_code": r.revision_code,
            "is_active": r.is_active,
            "sort_key": (r.approved_at or r.created_at).isoformat() if (r.approved_at or r.created_at) else "0000-00-00",
        })

    # 3. MC / observasi
    observations = (
        db.query(FieldObservation)
        .filter(FieldObservation.contract_id == contract_id)
        .order_by(FieldObservation.observation_date)
        .all()
    )
    for o in observations:
        otype = o.type.value if hasattr(o.type, "value") else o.type
        events.append({
            "type": "mc",
            "date": o.observation_date.isoformat() if o.observation_date else None,
            "label": "MC-0" if otype == "mc_0" else "MC Lanjutan",
            "status": "done",
            "id": str(o.id),
            "obs_type": otype,
            "title": o.title,
            "sort_key": o.observation_date.isoformat() if o.observation_date else "0000-00-00",
        })

    # 4. VO
    vos = (
        db.query(VariationOrder)
        .filter(VariationOrder.contract_id == contract_id)
        .order_by(VariationOrder.created_at)
        .all()
    )
    for v in vos:
        vs = v.status.value if hasattr(v.status, "value") else v.status
        events.append({
            "type": "vo",
            "date": v.created_at.isoformat() if v.created_at else None,
            "label": v.vo_number,
            "status": vs,
            "id": str(v.id),
            "title": v.title,
            "cost_impact": float(v.cost_impact or 0),
            "bundled": v.bundled_addendum_id is not None,
            "sort_key": v.created_at.isoformat() if v.created_at else "0000-00-00",
        })

    # 5. Adendum
    addenda = (
        db.query(ContractAddendum)
        .filter(ContractAddendum.contract_id == contract_id)
        .order_by(ContractAddendum.effective_date)
        .all()
    )
    for i, a in enumerate(addenda, start=1):
        bundled_count = db.query(VariationOrder).filter(
            VariationOrder.bundled_addendum_id == a.id
        ).count()
        events.append({
            "type": "addendum",
            "date": a.effective_date.isoformat() if a.effective_date else None,
            "label": f"Adendum-{i}",
            "status": "done",
            "id": str(a.id),
            "number": a.number,
            "addendum_type": a.addendum_type.value if hasattr(a.addendum_type, "value") else a.addendum_type,
            "bundled_vo_count": bundled_count,
            "sort_key": a.effective_date.isoformat() if a.effective_date else "0000-00-00",
        })

    # Sort kronologis
    events.sort(key=lambda e: e.get("sort_key") or "")
    for e in events:
        e.pop("sort_key", None)

    # Summary / next action
    vo_approved_unbundled = [v for v in vos if v.status == VOStatus.APPROVED and not v.bundled_addendum_id]
    vo_under_review = [v for v in vos if v.status == VOStatus.UNDER_REVIEW]
    vo_draft = [v for v in vos if v.status == VOStatus.DRAFT]
    has_mc0 = any(
        (o.type.value if hasattr(o.type, "value") else o.type) == "mc_0"
        for o in observations
    )
    active_rev = next((r for r in revisions if r.is_active), None)
    pending_revs = [r for r in revisions if r.status == RevisionStatus.DRAFT]
    vo_approved_unbundled_total = sum(float(v.cost_impact or 0) for v in vo_approved_unbundled)

    # Next action heuristik
    next_action = None
    next_action_msg = None
    if pending_revs:
        next_action = "approve_revision"
        next_action_msg = f"Revisi BOQ {pending_revs[0].revision_code or f'V{pending_revs[0].cco_number}'} DRAFT menunggu approval PPK."
    elif vo_approved_unbundled:
        next_action = "create_addendum"
        next_action_msg = (
            f"Ada {len(vo_approved_unbundled)} VO APPROVED belum di-bundle "
            f"(total Δ {vo_approved_unbundled_total:+,.0f}). Buat Adendum untuk menerapkannya ke BOQ."
        )
    elif vo_under_review:
        next_action = "approve_vo"
        next_action_msg = f"{len(vo_under_review)} VO menunggu review PPK."
    elif not has_mc0 and (c.status.value if hasattr(c.status, "value") else c.status) in ("active", "addendum"):
        next_action = "create_mc0"
        next_action_msg = "MC-0 belum dibuat — pemeriksaan bersama awal biasanya dilakukan 7-14 hari setelah kontrak aktif."

    summary = {
        "mc_total": len(observations),
        "mc_0_done": has_mc0,
        "vo_total": len(vos),
        "vo_draft": len(vo_draft),
        "vo_under_review": len(vo_under_review),
        "vo_approved_unbundled": len(vo_approved_unbundled),
        "vo_approved_unbundled_total_cost": vo_approved_unbundled_total,
        "addenda_count": len(addenda),
        "revisions_count": len(revisions),
        "pending_revisions": len(pending_revs),
        "active_revision_code": active_rev.revision_code if active_rev else None,
        "next_action": next_action,
        "next_action_message": next_action_msg,
    }
    return {"timeline": events, "summary": summary}


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


class UnlockRequest(BaseModel):
    reason: str = Field(
        ...,
        min_length=10,
        max_length=2000,
        description="Alasan membuka edit-mode. Minimum 10 karakter.",
    )
    duration_minutes: int = Field(
        default=30,
        ge=1,
        le=1440,
        description="Durasi window unlock dalam menit (default 30, maks 1440 = 24 jam).",
    )


@router.post("/{contract_id}/unlock", response_model=dict)
def unlock_contract(
    contract_id: str, payload: UnlockRequest, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Buka kontrak untuk edit bebas di luar alur Addendum. Safety valve untuk
    koreksi kesalahan input manusia — BUKAN pengganti Addendum resmi.

    Hanya superadmin. Kontrak harus sudah di luar DRAFT (DRAFT sudah editable
    penuh, tidak perlu unlock). Idempotent: unlock pada kontrak yang sudah
    terbuka akan memperbarui alasan dan pencatat (kasus wajar: superadmin
    kedua meneruskan pekerjaan koreksi).
    """
    if get_user_role_code(db, current_user) != "superadmin":
        raise HTTPException(403, "Hanya superadmin yang boleh membuka edit-mode kontrak.")

    c = db.query(Contract).filter(
        Contract.id == contract_id, Contract.deleted_at.is_(None),
    ).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    status_value = c.status.value if hasattr(c.status, "value") else str(c.status)
    if status_value == "draft":
        raise HTTPException(
            400,
            "Kontrak masih DRAFT — seluruh field sudah editable, tidak perlu unlock.",
        )

    now = _dt.datetime.utcnow()
    c.unlocked_at = now
    c.unlock_until = now + _dt.timedelta(minutes=payload.duration_minutes)
    c.unlocked_by_id = current_user.id
    c.unlock_reason = payload.reason.strip()
    db.commit()
    log_audit(
        db, current_user, "unlock", "contract", str(c.id),
        changes={
            "reason": c.unlock_reason,
            "duration_minutes": payload.duration_minutes,
            "unlock_until": c.unlock_until.isoformat(),
        },
        request=request, commit=True,
    )
    return {
        "success": True,
        "unlocked_at": c.unlocked_at.isoformat() + "Z",
        "unlock_until": c.unlock_until.isoformat() + "Z",
        "unlocked_by_id": str(c.unlocked_by_id),
        "unlock_reason": c.unlock_reason,
    }


@router.get("/{contract_id}/sync-status", response_model=dict)
def contract_sync_status(
    contract_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Bandingkan total BOQ revisi aktif vs nilai kontrak. Dipakai frontend
    untuk menampilkan indikator live saat mode unlock (hijau = sinkron,
    merah = ada selisih → tombol Kunci-kembali di-disable).
    """
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    c = db.query(Contract).filter(Contract.id == contract_id).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")
    boq_total = _sum_active_boq(db, c)
    current_value = float(c.current_value or 0)
    diff = round(boq_total - current_value, 2)
    return {
        "contract_value": current_value,
        "boq_total": boq_total,
        "diff": diff,
        "in_sync": abs(diff) < 0.01,
    }


@router.post("/{contract_id}/lock", response_model=dict)
def lock_contract(
    contract_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Tutup kembali edit-mode. Memvalidasi total BOQ revisi aktif == nilai
    kontrak sebelum menutup; kalau beda, 409 + detail selisih supaya UI
    bisa menampilkan panduan perbaikan.
    """
    if get_user_role_code(db, current_user) != "superadmin":
        raise HTTPException(403, "Hanya superadmin yang boleh menutup edit-mode kontrak.")

    c = db.query(Contract).filter(
        Contract.id == contract_id, Contract.deleted_at.is_(None),
    ).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    if not contract_is_unlocked(c):
        # Idempoten: sudah terkunci, kembalikan state saat ini.
        return {"success": True, "already_locked": True}

    boq_total = _sum_active_boq(db, c)
    current_value = float(c.current_value or 0)
    diff = round(boq_total - current_value, 2)
    if abs(diff) >= 0.01:
        raise HTTPException(
            409,
            {
                "message": (
                    f"Total BOQ aktif ({boq_total:,.2f}) tidak sama dengan "
                    f"nilai kontrak ({current_value:,.2f}). Selisih {diff:,.2f}. "
                    "Sesuaikan salah satu sebelum mengunci."
                ),
                "code": "unlock_sync_mismatch",
                "contract_value": current_value,
                "boq_total": boq_total,
                "diff": diff,
            },
        )

    c.unlocked_at = None
    c.unlock_until = None
    c.unlocked_by_id = None
    c.unlock_reason = None
    db.commit()
    log_audit(
        db, current_user, "lock", "contract", str(c.id),
        changes={"boq_total": boq_total, "contract_value": current_value},
        request=request, commit=True,
    )
    return {"success": True, "locked_at": datetime.utcnow().isoformat()}


@router.post("/{contract_id}/complete", response_model=dict)
def complete_contract(
    contract_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    finalize_contract event — satu-satunya cara legal men-transisi kontrak
    ke COMPLETED. Hanya PPK (atau superadmin) yang boleh trigger.

    Setelah ini:
      - Kontrak read-only permanen (kecuali Unlock Mode untuk koreksi
        administratif)
      - Semua BOQ version terkunci
      - VO yang masih DRAFT/UNDER_REVIEW otomatis jadi REJECTED
        (karena tidak akan pernah di-bundle)
      - BAST siap di-generate via GET /contracts/{id}/bast
    """
    from app.services.vo_service import is_god_mode_active, log_god_mode_bypass
    from app.api.deps import get_user_role_code
    from app.models.models import VariationOrder, VOStatus

    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")
    gm = is_god_mode_active(c)
    role = get_user_role_code(db, current_user)
    if role not in ("ppk", "superadmin") and not gm:
        raise HTTPException(
            403,
            "Hanya PPK yang berhak menyelesaikan kontrak (penyelesaian akhir).",
        )

    status_value = c.status.value if hasattr(c.status, "value") else str(c.status)
    if status_value not in ("active", "addendum") and not gm:
        raise HTTPException(400, f"Kontrak berstatus '{status_value}' tidak bisa di-complete.")

    # Auto-reject VO yang belum sempat di-bundle — prevent dangling states
    pending_vos = db.query(VariationOrder).filter(
        VariationOrder.contract_id == contract_id,
        VariationOrder.status.in_([VOStatus.DRAFT, VOStatus.UNDER_REVIEW, VOStatus.APPROVED]),
    ).all()
    for vo in pending_vos:
        vo.status = VOStatus.REJECTED
        vo.rejected_by_user_id = current_user.id
        vo.rejected_at = datetime.utcnow()
        vo.rejection_reason = "Ditolak otomatis — kontrak diselesaikan (finalize_contract)."

    c.status = ContractStatus.COMPLETED
    db.commit()
    if gm:
        log_god_mode_bypass(
            db, current_user, c,
            action=f"finalize_contract_from_{status_value}",
            target_type="contract", target_id=str(c.id),
            request=request,
        )
        db.commit()
    log_audit(
        db, current_user, "finalize_contract", "contract", str(c.id),
        changes={
            "from_status": status_value,
            "auto_rejected_vos": [str(v.id) for v in pending_vos],
            "god_mode_bypass": gm,
        },
        request=request, commit=True,
    )
    return {
        "success": True,
        "status": c.status.value,
        "auto_rejected_vos": len(pending_vos),
        "god_mode_bypass": gm,
    }


@router.get("/{contract_id}/bast", response_model=dict)
def get_bast(
    contract_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    """
    Berita Acara Serah Terima (BAST) — laporan rekonsiliasi akhir kontrak.

    Berisi:
      - Snapshot BOQ V-final (versi aktif terakhir)
      - Realisasi fisik per item (volume terbayar kumulatif)
      - Selisih volume (realisasi vs BOQ)
      - Rekapitulasi pembayaran: total planned vs paid
      - Sisa/kelebihan terhadap nilai kontrak final
      - Daftar addendum + VO bundled (audit chain)
    """
    from app.models.models import (
        BOQRevision, BOQItem, PaymentTerm, PaymentTermStatus,
        VariationOrder, VOStatus, ContractAddendum, WeeklyProgressItem,
        Facility, Location,
    )
    from decimal import Decimal as _D

    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")

    # BOQ V-final
    active = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == contract_id,
            BOQRevision.is_active == True,  # noqa: E712
        )
        .first()
    )

    # Realisasi kumulatif per BOQ item (dari progress terakhir masing-masing)
    realisasi = {}
    if active:
        # MAX progress per boq_item_id pada revisi aktif
        from sqlalchemy import func as _func
        prog_rows = (
            db.query(
                WeeklyProgressItem.boq_item_id,
                _func.max(WeeklyProgressItem.volume_cumulative),
            )
            .join(BOQItem, BOQItem.id == WeeklyProgressItem.boq_item_id)
            .filter(BOQItem.boq_revision_id == active.id)
            .group_by(WeeklyProgressItem.boq_item_id)
            .all()
        )
        realisasi = {str(r[0]): float(r[1] or 0) for r in prog_rows}

    # Items aktif + metadata
    items_out = []
    total_boq_value = _D("0")
    total_realized_value = _D("0")
    if active:
        rows = (
            db.query(BOQItem, Facility, Location)
            .join(Facility, Facility.id == BOQItem.facility_id)
            .join(Location, Location.id == Facility.location_id)
            .filter(
                BOQItem.boq_revision_id == active.id,
                BOQItem.is_active == True,  # noqa: E712
                BOQItem.is_leaf == True,  # noqa: E712
            )
            .order_by(Location.location_code, Facility.display_order, BOQItem.display_order)
            .all()
        )
        for b, f, l in rows:
            vol_boq = _D(b.volume or 0)
            vol_real = _D(str(realisasi.get(str(b.id), 0)))
            price = _D(b.unit_price or 0)
            value_boq = vol_boq * price
            value_real = vol_real * price
            total_boq_value += value_boq
            total_realized_value += value_real
            items_out.append({
                "boq_item_id": str(b.id),
                "location_code": l.location_code,
                "facility_code": f.facility_code,
                "facility_name": f.facility_name,
                "description": b.description,
                "unit": b.unit,
                "volume_boq": float(vol_boq),
                "volume_realized": float(vol_real),
                "volume_diff": float(vol_real - vol_boq),
                "unit_price": float(price),
                "value_boq": float(value_boq),
                "value_realized": float(value_real),
                "completion_pct": float((vol_real / vol_boq * 100) if vol_boq > 0 else 0),
            })

    # Pembayaran rekap
    terms = (
        db.query(PaymentTerm)
        .filter(PaymentTerm.contract_id == contract_id)
        .order_by(PaymentTerm.term_number)
        .all()
    )
    total_planned = sum((_D(t.amount or 0) for t in terms), _D("0"))
    total_paid = sum(
        (_D(t.amount or 0) for t in terms if t.status == PaymentTermStatus.PAID),
        _D("0"),
    )
    payments_out = [
        {
            "term_number": t.term_number,
            "name": t.name,
            "amount": float(t.amount or 0),
            "status": t.status.value if hasattr(t.status, "value") else t.status,
            "paid_date": t.paid_date.isoformat() if t.paid_date else None,
            "boq_revision_id": str(t.boq_revision_id) if t.boq_revision_id else None,
        }
        for t in terms
    ]

    # Audit chain: addenda + VO bundled
    addenda = (
        db.query(ContractAddendum)
        .filter(ContractAddendum.contract_id == contract_id)
        .order_by(ContractAddendum.effective_date)
        .all()
    )
    addenda_out = []
    for a in addenda:
        bundled_vos = (
            db.query(VariationOrder)
            .filter(VariationOrder.bundled_addendum_id == a.id)
            .all()
        )
        addenda_out.append({
            "id": str(a.id),
            "number": a.number,
            "type": a.addendum_type.value if hasattr(a.addendum_type, "value") else a.addendum_type,
            "effective_date": a.effective_date.isoformat() if a.effective_date else None,
            "old_value": float(a.old_contract_value or 0),
            "new_value": float(a.new_contract_value or 0),
            "signed_by_id": str(a.signed_by_id) if a.signed_by_id else None,
            "kpa_approved_by_id": str(a.kpa_approved_by_id) if a.kpa_approved_by_id else None,
            "bundled_vos": [{"id": str(v.id), "vo_number": v.vo_number, "title": v.title} for v in bundled_vos],
        })

    return {
        "contract": {
            "id": str(c.id),
            "number": c.contract_number,
            "name": c.contract_name,
            "status": c.status.value if hasattr(c.status, "value") else c.status,
            "original_value": float(c.original_value or 0),
            "final_value": float(c.current_value or 0),
            "start_date": c.start_date.isoformat() if c.start_date else None,
            "end_date": c.end_date.isoformat() if c.end_date else None,
        },
        "active_revision": {
            "id": str(active.id) if active else None,
            "version_code": active.revision_code if active else None,
        } if active else None,
        "boq_items": items_out,
        "summary": {
            "total_boq_value": float(total_boq_value),
            "total_realized_value": float(total_realized_value),
            "realization_pct": float(
                (total_realized_value / total_boq_value * 100) if total_boq_value > 0 else 0
            ),
            "total_planned_payment": float(total_planned),
            "total_paid_payment": float(total_paid),
            "payment_gap": float(total_planned - total_paid),
        },
        "payments": payments_out,
        "addenda_chain": addenda_out,
    }
