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


def _is_unlocked_contract(db: Session, contract_id) -> bool:
    """
    True bila kontrak sedang dalam Unlock Mode (superadmin safety valve).
    Saat unlocked, guard write BOQ di-bypass sehingga item boleh diedit
    in-place di revisi APPROVED tanpa perlu Addendum + CCO baru.

    Impor di-local untuk menghindari circular import (contracts.py
    memanggil helper ini secara tidak langsung lewat guard).
    """
    if not contract_id:
        return False
    import datetime as _dt
    c = db.query(Contract).filter(Contract.id == contract_id).first()
    if not c or c.unlock_until is None:
        return False
    return _dt.datetime.utcnow() < c.unlock_until
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


def _resolve_working_revision_id(db: Session, contract_id) -> Optional[str]:
    """
    Revisi yang sedang dikerjakan user di UI BOQ editor.

    Prioritas:
      1. Latest DRAFT revision untuk kontrak ini — artinya ada addendum
         yang baru dibuat dan belum di-approve (CCO-N+1 DRAFT), atau
         kontrak masih fresh (CCO-0 DRAFT).
      2. Revisi aktif (APPROVED + is_active=True) — kondisi normal
         kontrak ACTIVE tanpa addendum pending.
      3. None — kontrak belum punya revisi apa pun (baru dibuat).

    Dipakai oleh read path (list_by_facility, list_by_contract_flat) agar
    UI secara otomatis menampilkan revisi yang benar ketika user mulai
    mengedit setelah membuat addendum.
    """
    from app.models.models import BOQRevision, RevisionStatus

    latest_draft = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == contract_id,
            BOQRevision.status == RevisionStatus.DRAFT,
        )
        .order_by(BOQRevision.cco_number.desc())
        .first()
    )
    if latest_draft:
        return str(latest_draft.id)
    active = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == contract_id,
            BOQRevision.is_active == True,  # noqa: E712
        )
        .first()
    )
    return str(active.id) if active else None


# ═══════════════════════════════════════════ LIST / TREE ═════════════════════

@router.get("/by-facility/{facility_id}", response_model=List[dict])
def list_by_facility(
    facility_id: str,
    include_inactive: bool = False,
    revision_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    List BOQ items for a facility.

    By default returns items from the currently-active BOQ revision for
    the facility's contract (what the UI shows). Pass `revision_id` to
    read from a specific revision (e.g. a draft CCO being edited).
    """
    q = db.query(BOQItem).filter(BOQItem.facility_id == facility_id)
    if not include_inactive:
        q = q.filter(BOQItem.is_active == True)

    if revision_id:
        q = q.filter(BOQItem.boq_revision_id == revision_id)
    else:
        # Resolve the "working" revision (latest DRAFT preferred over active
        # APPROVED). This way, setelah user membuat Addendum, BOQ tab otomatis
        # menampilkan revisi DRAFT yang baru — bukan CCO-N APPROVED lama yang
        # ternyata tidak bisa diedit.
        fac = db.query(Facility).filter(Facility.id == facility_id).first()
        if fac:
            loc = db.query(Location).filter(Location.id == fac.location_id).first()
            if loc:
                working = _resolve_working_revision_id(db, loc.contract_id)
                if working:
                    q = q.filter(BOQItem.boq_revision_id == working)

    rows = q.order_by(BOQItem.display_order, BOQItem.id).all()
    return [_boq_to_dict(r) for r in rows]


@router.get("/by-contract/{contract_id}/flat", response_model=List[dict])
def list_by_contract_flat(
    contract_id: str,
    leaf_only: bool = True,
    revision_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Flat BOQ list for the weekly progress grid editor. Reads from the
    currently-active revision unless `revision_id` overrides it. Falls back
    to CCO-0 if no revision is active yet (contract still in DRAFT).
    """
    # Default: revisi DRAFT pending kalau ada (baru dibuat addendum), fallback
    # revisi aktif APPROVED. Selaras dengan list_by_facility.
    active_rev_id = revision_id or _resolve_working_revision_id(db, contract_id)

    q = (
        db.query(BOQItem, Facility, Location)
        .join(Facility, Facility.id == BOQItem.facility_id)
        .join(Location, Location.id == Facility.location_id)
        .filter(Location.contract_id == contract_id, BOQItem.is_active == True)  # noqa: E712
    )
    if active_rev_id:
        q = q.filter(BOQItem.boq_revision_id == active_rev_id)
    if leaf_only:
        q = q.filter(BOQItem.is_leaf == True)  # noqa: E712

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

def _resolve_writable_revision_for_facility(db: Session, facility_id: str):
    """
    Resolve which BOQRevision new items for this facility should be
    attached to, and guard against writing into an APPROVED revision.

    Rules:
      - Prefer the currently-active revision of the owning contract if it
        is still DRAFT (e.g. a CCO-N being built).
      - Otherwise prefer the latest DRAFT revision (CCO-0 on a new contract,
        or a freshly-cloned CCO-N not yet approved).
      - APPROVED+active revisions are read-only to new inserts — writes
        there would silently corrupt weight computations and make audit
        useless. Caller must first clone to a new CCO.

    Raises HTTPException(400) with a descriptive message instead of
    returning None so callers don't need to handle the error path.
    """
    from app.models.models import BOQRevision, RevisionStatus

    fac = db.query(Facility).filter(Facility.id == facility_id).first()
    if not fac:
        raise HTTPException(400, "Fasilitas tidak ditemukan")
    loc = db.query(Location).filter(Location.id == fac.location_id).first()
    if not loc:
        raise HTTPException(400, "Lokasi fasilitas tidak valid")

    # 1) Active draft revision?
    active_draft = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == loc.contract_id,
            BOQRevision.is_active == True,  # noqa: E712
            BOQRevision.status == RevisionStatus.DRAFT,
        )
        .first()
    )
    if active_draft:
        return active_draft

    # 2) Any approved+active? Normalnya read-only untuk item baru — tapi
    #    saat kontrak dalam Unlock Mode, guard dilewati supaya superadmin
    #    bisa memperbaiki kesalahan input langsung di revisi aktif tanpa
    #    membuat CCO baru.
    active_approved = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == loc.contract_id,
            BOQRevision.is_active == True,  # noqa: E712
            BOQRevision.status == RevisionStatus.APPROVED,
        )
        .first()
    )
    if active_approved:
        if _is_unlocked_contract(db, loc.contract_id):
            return active_approved
        raise HTTPException(
            400,
            {
                "message": (
                    f"BOQ {active_approved.revision_code} sudah APPROVED dan "
                    f"tidak bisa diedit langsung. Buat Addendum baru untuk "
                    f"menghasilkan CCO berikutnya, atau buka Unlock Mode."
                ),
                "active_revision_id": str(active_approved.id),
                "active_revision_code": active_approved.revision_code,
            },
        )

    # 3) Fall back to the newest DRAFT revision (no active draft/approved).
    latest_draft = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == loc.contract_id,
            BOQRevision.status == RevisionStatus.DRAFT,
        )
        .order_by(BOQRevision.cco_number.desc())
        .first()
    )
    if latest_draft:
        return latest_draft

    # 4) Nothing exists yet (shouldn't happen because create_contract seeds
    # CCO-0, but be defensive for legacy data).
    from app.services import boq_revision_service
    contract = db.query(Contract).filter(Contract.id == loc.contract_id).first()
    return boq_revision_service.ensure_cco_zero(db, contract, auto_approve=False)


@router.post("", response_model=dict)
def create_boq_item(
    data: BOQItemCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    rev = _resolve_writable_revision_for_facility(db, str(data.facility_id))

    if (not data.total_price or data.total_price == 0) and data.volume and data.unit_price:
        data.total_price = data.volume * data.unit_price

    payload = data.model_dump()
    # Never trust a client-supplied revision id here — the resolver decides.
    payload.pop("boq_revision_id", None)
    item = BOQItem(boq_revision_id=rev.id, **payload)
    db.add(item)
    db.flush()
    recalculate_facility_weights(db, str(data.facility_id))
    fac = db.query(Facility).filter(Facility.id == data.facility_id).first()
    if fac:
        loc = db.query(Location).filter(Location.id == fac.location_id).first()
        if loc:
            recalculate_contract_weights(db, str(loc.contract_id))

    # Keep revision totals in sync too (used by activation readiness check).
    from app.services import boq_revision_service
    boq_revision_service.recalc_revision_totals(db, rev)

    db.commit()
    log_audit(db, current_user, "create", "boq_item", str(item.id),
              changes={"revision_id": str(rev.id)}, request=request, commit=True)
    return {"id": str(item.id), "success": True, "boq_revision_id": str(rev.id)}


@router.post("/bulk", response_model=dict)
def bulk_create(
    items: List[BOQItemCreate], request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    created = 0
    touched_facilities = set()
    touched_contracts = set()
    touched_revisions: dict = {}  # facility_id -> revision (cache)

    for d in items:
        if str(d.facility_id) not in touched_revisions:
            touched_revisions[str(d.facility_id)] = _resolve_writable_revision_for_facility(
                db, str(d.facility_id)
            )
        rev = touched_revisions[str(d.facility_id)]

        if (not d.total_price or d.total_price == 0) and d.volume and d.unit_price:
            d.total_price = d.volume * d.unit_price
        payload = d.model_dump()
        payload.pop("boq_revision_id", None)
        item = BOQItem(boq_revision_id=rev.id, **payload)
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

    from app.services import boq_revision_service
    for rev in set(touched_revisions.values()):
        _recompute_is_leaf(db, rev.id)
        boq_revision_service.recalc_revision_totals(db, rev)

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

    # ── Write-guard: APPROVED revision is read-only ───────────────────────────
    # Symmetric with create_boq_item/bulk_create guard. Editing in place would
    # break audit trail and change_type diff generation across CCO revisions.
    # The only way to modify a BOQ in an active contract is to create an
    # Addendum, which clones the active revision into a new DRAFT one — atau
    # membuka Unlock Mode (superadmin) untuk koreksi kesalahan input.
    if item.boq_revision_id:
        from app.models.models import BOQRevision, RevisionStatus
        rev = db.query(BOQRevision).filter(BOQRevision.id == item.boq_revision_id).first()
        if rev and rev.status == RevisionStatus.APPROVED and rev.is_active:
            if not _is_unlocked_contract(db, rev.contract_id):
                raise HTTPException(
                    400,
                    {
                        "message": (
                            f"BOQ tidak dapat diubah karena revisi {rev.revision_code} "
                            f"sudah disetujui dan kontrak aktif. Buat Addendum untuk "
                            f"mengubah BOQ di kontrak yang sudah berjalan, atau buka "
                            f"Unlock Mode."
                        ),
                        "code": "revision_approved_readonly",
                        "active_revision_id": str(rev.id),
                        "active_revision_code": rev.revision_code,
                    },
                )

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

    parent_changed = "parent_id" in data.model_dump(exclude_unset=True)
    for field, val in data.model_dump(exclude_none=True).items():
        if field not in ("addendum_id", "change_reason") and hasattr(item, field):
            setattr(item, field, val)

    db.flush()
    if parent_changed and item.boq_revision_id:
        # Re-derive is_leaf untuk seluruh revisi karena perpindahan parent_id
        # bisa membuat parent lama jadi leaf atau parent baru jadi non-leaf.
        _recompute_is_leaf(db, item.boq_revision_id)
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

    # Write-guard: same as update (see update_boq_item for rationale).
    # Unlock Mode di-respect di sini juga.
    if item.boq_revision_id:
        from app.models.models import BOQRevision, RevisionStatus
        rev = db.query(BOQRevision).filter(BOQRevision.id == item.boq_revision_id).first()
        if rev and rev.status == RevisionStatus.APPROVED and rev.is_active:
            if not _is_unlocked_contract(db, rev.contract_id):
                raise HTTPException(
                    400,
                    {
                        "message": (
                            f"Item BOQ tidak dapat dihapus karena revisi {rev.revision_code} "
                            f"sudah disetujui dan kontrak aktif. Buat Addendum untuk "
                            f"menghapus item, atau buka Unlock Mode."
                        ),
                        "code": "revision_approved_readonly",
                        "active_revision_code": rev.revision_code,
                    },
                )

    # Soft delete item utama + cascade non-aktif ke seluruh children supaya
    # parent-child hierarchy level 0-3 tetap valid (tidak ada orphan aktif).
    item.is_active = False
    children_count = _cascade_disable_children(db, item.boq_revision_id, item.id)
    db.flush()
    recalculate_facility_weights(db, str(item.facility_id))
    db.commit()
    log_audit(
        db, current_user, "delete", "boq_item", str(item.id),
        changes={"cascaded_children": children_count},
        request=request, commit=True,
    )
    return {"success": True, "cascaded_children": children_count}


def _recompute_is_leaf(db: Session, revision_id) -> None:
    """
    Sweep semua item di revisi: item yang punya minimal 1 child (is_active=True)
    di-set is_leaf=False, item tanpa child di-set is_leaf=True. Idempotent.

    Penting karena import Excel & operasi struktural sering tidak menjaga
    flag is_leaf dengan benar. Hirarki BOQ (level 0-3) hanya bekerja kalau
    flag ini akurat — UI parent picker, cost rollup, dan VO grid semua
    bergantung padanya.
    """
    items = db.query(BOQItem).filter(
        BOQItem.boq_revision_id == revision_id
    ).all()
    parent_ids = {it.parent_id for it in items if it.parent_id is not None}
    for it in items:
        should_be_leaf = it.id not in parent_ids
        if it.is_leaf != should_be_leaf:
            it.is_leaf = should_be_leaf
    db.flush()


def _cascade_disable_children(db: Session, revision_id, parent_id) -> int:
    """BFS traversal: non-aktif semua descendant. Return jumlah children yang diproses."""
    if not parent_id:
        return 0
    total = 0
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
            BOQItem.is_active == True,  # noqa: E712
        ).all()
        for ch in children:
            ch.is_active = False
            total += 1
            to_visit.append(ch.id)
    return total


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

            # Resolve target revision for this facility. Imports must
            # always land in the currently-writable revision (DRAFT CCO-0
            # for a new contract, or the draft clone spawned by an
            # addendum). If the active revision is APPROVED this raises.
            target_revision = _resolve_writable_revision_for_facility(
                db, str(target_facility.id)
            )

            # Insert items; build hierarchy by level
            # Map original_code → BOQItem. Dipakai untuk resolve parent_code.
            code_index: dict = {}
            # Pass 1: assign auto-code untuk row yang code-nya kosong, supaya
            # row lain bisa refer balik via parent_code (kalau perlu).
            auto_idx = 0
            for it in fac_data["items"]:
                if not (it.get("original_code") or "").strip():
                    auto_idx += 1
                    it["original_code"] = f"R{auto_idx}"

            # Pass 2: dua-fase resolve parent. Fase A buat semua item dengan
            # parent=None placeholder, fase B set parent_id berdasarkan
            # parent_code lookup. Memungkinkan urutan baris bebas (parent
            # boleh muncul setelah child di Excel).
            created_items: list = []
            for order_idx, it in enumerate(fac_data["items"]):

                total_price = it.get("total_price") or 0
                volume = it.get("volume") or 0
                unit_price = it.get("unit_price") or 0
                if not total_price and volume and unit_price:
                    total_price = volume * unit_price

                new_item = BOQItem(
                    boq_revision_id=target_revision.id,
                    facility_id=target_facility.id,
                    parent_id=None,  # diisi di pass berikutnya
                    original_code=it.get("original_code"),
                    full_code=it.get("original_code") or "",  # di-update setelah parent ter-resolve
                    level=0,  # di-derive dari parent chain
                    display_order=order_idx,
                    description=it["description"],
                    unit=it.get("unit"),
                    volume=Decimal(str(volume)),
                    unit_price=Decimal(str(unit_price)),
                    total_price=Decimal(str(total_price)),
                    planned_start_week=it.get("planned_start_week"),
                    planned_duration_weeks=it.get("planned_duration_weeks"),
                    is_leaf=True,  # auto-flip via _recompute_is_leaf di akhir
                )
                db.add(new_item)
                db.flush()
                code = (it.get("original_code") or "").strip()
                code_index[code] = new_item
                created_items.append((it, new_item))
                result.items_imported += 1

            # Pass 3: resolve parent_id via parent_code lookup, derive level
            # & full_code dari rantai parent. Loop sampai stable (handle
            # forward-references — child di-create sebelum parent).
            for it, new_item in created_items:
                pc = (it.get("parent_code") or "").strip()
                if pc and pc in code_index:
                    new_item.parent_id = code_index[pc].id
            db.flush()
            # Compute level + full_code dengan BFS dari roots.
            for _, ni in created_items:
                lvl = 0
                chain = []
                cur = ni
                visited = set()
                while cur.parent_id and cur.parent_id not in visited:
                    visited.add(cur.parent_id)
                    parent = next((p for _, p in created_items if p.id == cur.parent_id), None)
                    if not parent:
                        break
                    chain.append(parent.original_code or "")
                    lvl += 1
                    cur = parent
                ni.level = lvl
                if chain:
                    ni.full_code = ".".join(reversed(chain)) + "." + (ni.original_code or "")
                else:
                    ni.full_code = ni.original_code or ""
            db.flush()

            # Post-import sweep: item yang punya children → is_leaf=False.
            _recompute_is_leaf(db, target_revision.id)

            recalculate_facility_weights(db, str(target_facility.id))
            touched_contracts.add(str(target_loc.contract_id))

            # Keep the revision's cached totals fresh.
            from app.services import boq_revision_service
            boq_revision_service.recalc_revision_totals(db, target_revision)

        for cid in touched_contracts:
            recalculate_contract_weights(db, cid)
            # Auto-sync nilai kontrak DRAFT: saat BOQ baru di-import ke
            # V0 DRAFT, current_value kontrak ikut updated supaya Total BOQ
            # di header kontrak sinkron. Untuk kontrak aktif (V0 sudah
            # APPROVED), nilai kontrak tidak otomatis berubah — perubahan
            # harus lewat Addendum resmi.
            from app.models.models import BOQRevision, RevisionStatus, ContractStatus
            c = db.query(Contract).filter(Contract.id == cid).first()
            if c and c.status == ContractStatus.DRAFT:
                working_rev = (
                    db.query(BOQRevision)
                    .filter(
                        BOQRevision.contract_id == cid,
                        BOQRevision.status == RevisionStatus.DRAFT,
                    )
                    .order_by(BOQRevision.cco_number.desc())
                    .first()
                )
                if working_rev and working_rev.total_value:
                    c.original_value = working_rev.total_value
                    c.current_value = working_rev.total_value

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


# ═══════════════════════════════════════════ BOQ REVISION (CCO) ══════════════

@router.get("/revisions/by-contract/{contract_id}", response_model=List[dict])
def list_revisions(
    contract_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission("contract.read")),
):
    """List all BOQ revisions (CCO-0, CCO-1, ...) for a contract."""
    from app.models.models import BOQRevision
    rows = (
        db.query(BOQRevision)
        .filter(BOQRevision.contract_id == contract_id)
        .order_by(BOQRevision.cco_number)
        .all()
    )
    return [
        {
            "id": str(r.id),
            "contract_id": str(r.contract_id),
            "addendum_id": str(r.addendum_id) if r.addendum_id else None,
            "cco_number": r.cco_number,
            "revision_code": r.revision_code,
            "name": r.name,
            "description": r.description,
            "status": r.status.value if hasattr(r.status, "value") else r.status,
            "is_active": r.is_active,
            "total_value": float(r.total_value or 0),
            "item_count": r.item_count or 0,
            "approved_at": r.approved_at.isoformat() if r.approved_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/revisions/{revision_id}/approve", response_model=dict)
def approve_revision(
    revision_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Approve a BOQ revision: flip status DRAFT→APPROVED, mark is_active=True,
    demote the previously-active revision to SUPERSEDED, and migrate existing
    weekly progress entries from old items to their clones (for UNCHANGED /
    MODIFIED items). See boq_revision_service.approve_revision for details.

    Precondition yang wajib terpenuhi:
      - Revisi punya minimal 1 item (kecuali CCO-0 boleh kosong).
      - Total BOQ revisi == nilai kontrak saat ini. Untuk CCO-0 artinya
        sum(item) == original_value. Untuk CCO-N yang dibuat lewat addendum,
        artinya sum(item) == new_contract_value yang dicatat di addendum
        (sudah di-set ke contract.current_value saat addendum dibuat).
        Kalau beda, approve ditolak 409 — user harus koreksi BOQ atau
        ubah nilai kontrak di addendum.
    """
    from app.models.models import BOQRevision, Contract
    from app.services import boq_revision_service

    rev = db.query(BOQRevision).filter(BOQRevision.id == revision_id).first()
    if not rev:
        raise HTTPException(404, "Revisi BOQ tidak ditemukan")

    if rev.item_count == 0 and rev.cco_number != 0:
        raise HTTPException(400, "Revisi kosong — tambahkan minimal satu item BOQ sebelum approve.")

    # Recalc dulu supaya rev.total_value fresh saat diperbandingkan.
    boq_revision_service.recalc_revision_totals(db, rev)

    contract = db.query(Contract).filter(Contract.id == rev.contract_id).first()
    if not contract:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    expected = float(contract.current_value or 0)
    actual = float(rev.total_value or 0)
    diff = round(actual - expected, 2)
    if abs(diff) >= 0.01:
        raise HTTPException(
            409,
            {
                "message": (
                    f"Total BOQ revisi {rev.revision_code} ({actual:,.2f}) tidak "
                    f"sama dengan nilai kontrak ({expected:,.2f}). Selisih "
                    f"{diff:,.2f}. Koreksi BOQ atau ubah nilai kontrak pada "
                    f"Addendum sebelum approve."
                ),
                "code": "revision_value_mismatch",
                "contract_value": expected,
                "boq_total": actual,
                "diff": diff,
                "revision_code": rev.revision_code,
            },
        )

    boq_revision_service.approve_revision(
        db, rev, approved_by_id=current_user.id, migrate_progress=True,
    )
    db.commit()
    log_audit(
        db, current_user, "approve", "boq_revision", str(rev.id),
        changes={"revision_code": rev.revision_code, "total_value": actual},
        request=request, commit=True,
    )
    return {
        "success": True,
        "id": str(rev.id),
        "revision_code": rev.revision_code,
        "status": rev.status.value,
        "is_active": rev.is_active,
    }


@router.get("/revisions/{revision_id}/diff", response_model=List[dict])
def diff_revision(
    revision_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission("contract.read")),
):
    """Row-by-row comparison of this revision vs its source (predecessor)."""
    from app.models.models import BOQRevision
    from app.services import boq_revision_service

    rev = db.query(BOQRevision).filter(BOQRevision.id == revision_id).first()
    if not rev:
        raise HTTPException(404, "Revisi BOQ tidak ditemukan")
    return boq_revision_service.diff_revisions(db, rev)


# ═══════════════════════════════════════════ LOCATION ROLLUP ═════════════════

@router.get("/by-location/{location_id}/rollup", response_model=dict)
def location_boq_rollup(
    location_id: str,
    revision_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_permission("contract.read")),
):
    """
    Consolidated BOQ view for a single Location, spanning all facilities.

    Returns facilities as groups, each with its items in hierarchy order,
    plus a grand total across the whole location. This is catatan #9's
    "Location Level View" — what used to require clicking through each
    facility tab separately.

    Reads from active revision by default; override with `revision_id` to
    preview a CCO draft.
    """
    from app.models.models import BOQRevision

    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        raise HTTPException(404, "Lokasi tidak ditemukan")

    # Resolve target revision (active > CCO-0 fallback)
    target_rev_id = revision_id
    if not target_rev_id:
        active = (
            db.query(BOQRevision)
            .filter(
                BOQRevision.contract_id == loc.contract_id,
                BOQRevision.is_active == True,  # noqa: E712
            )
            .first()
        )
        if active:
            target_rev_id = str(active.id)
        else:
            cco_zero = (
                db.query(BOQRevision)
                .filter(
                    BOQRevision.contract_id == loc.contract_id,
                    BOQRevision.cco_number == 0,
                )
                .first()
            )
            if cco_zero:
                target_rev_id = str(cco_zero.id)

    facilities = (
        db.query(Facility)
        .filter(Facility.location_id == location_id, Facility.is_active == True)  # noqa: E712
        .order_by(Facility.display_order, Facility.facility_code)
        .all()
    )

    groups = []
    grand_total = Decimal("0")
    total_items = 0
    total_leaves = 0
    for f in facilities:
        q = db.query(BOQItem).filter(
            BOQItem.facility_id == f.id,
            BOQItem.is_active == True,  # noqa: E712
        )
        if target_rev_id:
            q = q.filter(BOQItem.boq_revision_id == target_rev_id)
        items = q.order_by(BOQItem.display_order, BOQItem.id).all()

        fac_total = sum(
            (Decimal(i.total_price or 0) for i in items if i.is_leaf),
            Decimal("0"),
        )
        leaf_count = sum(1 for i in items if i.is_leaf)
        grand_total += fac_total
        total_items += len(items)
        total_leaves += leaf_count

        groups.append({
            "facility": {
                "id": str(f.id),
                "facility_code": f.facility_code,
                "facility_name": f.facility_name,
                "facility_type": f.facility_type,
                "display_order": f.display_order,
            },
            "item_count": len(items),
            "leaf_count": leaf_count,
            "facility_total": float(fac_total),
            "items": [_boq_to_dict(i) for i in items],
        })

    return {
        "location": {
            "id": str(loc.id),
            "location_code": loc.location_code,
            "name": loc.name,
            "contract_id": str(loc.contract_id),
        },
        "revision_id": target_rev_id,
        "groups": groups,
        "grand_total": float(grand_total),
        "total_items": total_items,
        "total_leaves": total_leaves,
    }
