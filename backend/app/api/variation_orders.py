"""
Variation Order endpoints — dokumen usulan perubahan pekerjaan.

State machine (dicerminkan di vo_service):
  DRAFT → UNDER_REVIEW → APPROVED → BUNDLED (legal setelah Addendum sign)
                  ↓
               REJECTED (terminal)

God-mode (Unlock Mode): bila contract.unlock_until aktif, semua validasi
state transition di-bypass. Setiap bypass di-log dengan tag khusus.
"""
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query, UploadFile, File
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import (
    Contract, VariationOrder, VariationOrderItem, VOStatus, VOItemAction,
    BOQItem, Facility, User,
)
from app.schemas.schemas import (
    VariationOrderCreate, VariationOrderUpdate, VOActionRequest,
)
from app.api.deps import (
    get_current_user, require_permission, user_can_access_contract,
    get_user_role_code, assert_role_in,
)
from app.services.audit_service import log_audit
from app.services.vo_service import (
    is_god_mode_active, log_god_mode_bypass,
    assert_vo_can_transition, assert_contract_allows_vo,
    generate_vo_number,
)


router = APIRouter(prefix="/variation-orders", tags=["variation_orders"])


def _item_to_dict(i: VariationOrderItem, *, db: Session = None) -> dict:
    """
    Return item dict + enrichment target.
    Enrichment memberi PPK konteks Sebelum vs Sesudah:
      - target_boq: data BOQItem yang direfer (untuk INCREASE/DECREASE/MODIFY_SPEC/REMOVE)
      - target_facility: data Facility (untuk ADD / REMOVE_FACILITY)
    """
    d = {
        "id": str(i.id),
        "action": i.action.value if hasattr(i.action, "value") else i.action,
        "boq_item_id": str(i.boq_item_id) if i.boq_item_id else None,
        "facility_id": str(i.facility_id) if i.facility_id else None,
        "parent_boq_item_id": str(i.parent_boq_item_id) if i.parent_boq_item_id else None,
        "parent_code": getattr(i, "parent_code", None),
        "new_item_code": getattr(i, "new_item_code", None),
        "location_id": str(i.location_id) if getattr(i, "location_id", None) else None,
        "new_facility_code": getattr(i, "new_facility_code", None),
        "master_work_code": i.master_work_code,
        "description": i.description,
        "unit": i.unit,
        "volume_delta": float(i.volume_delta or 0),
        "unit_price": float(i.unit_price or 0),
        "cost_impact": float(i.cost_impact or 0),
        "old_description": i.old_description,
        "old_unit": i.old_unit,
        "notes": i.notes,
        "target_boq": None,
        "target_facility": None,
        "target_location": None,
    }
    if db is None:
        return d
    # Enrichment — target BOQItem
    if i.boq_item_id:
        bi = db.query(BOQItem).filter(BOQItem.id == i.boq_item_id).first()
        if bi:
            fac = db.query(Facility).filter(Facility.id == bi.facility_id).first()
            loc = None
            if fac:
                from app.models.models import Location
                loc = db.query(Location).filter(Location.id == fac.location_id).first()
            d["target_boq"] = {
                "id": str(bi.id),
                "description": bi.description,
                "unit": bi.unit,
                "volume": float(bi.volume or 0),
                "unit_price": float(bi.unit_price or 0),
                "total_price": float(bi.total_price or 0),
                "full_code": bi.full_code,
                "facility_id": str(bi.facility_id) if bi.facility_id else None,
                "facility_code": fac.facility_code if fac else None,
                "facility_name": fac.facility_name if fac else None,
                "location_code": loc.location_code if loc else None,
                "location_name": loc.name if loc else None,
            }
    # Enrichment — target Facility
    if i.facility_id:
        fac = db.query(Facility).filter(Facility.id == i.facility_id).first()
        if fac:
            from app.models.models import Location
            loc = db.query(Location).filter(Location.id == fac.location_id).first()
            item_count = db.query(BOQItem).filter(
                BOQItem.facility_id == fac.id,
                BOQItem.is_active == True,  # noqa: E712
            ).count()
            d["target_facility"] = {
                "id": str(fac.id),
                "code": fac.facility_code,
                "name": fac.facility_name,
                "total_value": float(fac.total_value or 0),
                "item_count": item_count,
                "location_code": loc.location_code if loc else None,
                "location_name": loc.name if loc else None,
            }
    # Enrichment — target Location (untuk ADD_FACILITY)
    if getattr(i, "location_id", None):
        from app.models.models import Location
        loc = db.query(Location).filter(Location.id == i.location_id).first()
        if loc:
            d["target_location"] = {
                "id": str(loc.id),
                "code": loc.location_code,
                "name": loc.name,
            }
    return d


def _to_dict(vo: VariationOrder, with_items: bool = True, *, db: Session = None) -> dict:
    d = {
        "id": str(vo.id),
        "contract_id": str(vo.contract_id),
        "vo_number": vo.vo_number,
        "status": vo.status.value if hasattr(vo.status, "value") else vo.status,
        "title": vo.title,
        "technical_justification": vo.technical_justification,
        "quantity_calculation": vo.quantity_calculation,
        "cost_impact": float(vo.cost_impact or 0),
        "source_observation_id": str(vo.source_observation_id) if vo.source_observation_id else None,
        "submitted_by_user_id": str(vo.submitted_by_user_id) if vo.submitted_by_user_id else None,
        "submitted_at": vo.submitted_at.isoformat() if vo.submitted_at else None,
        "reviewed_by_user_id": str(vo.reviewed_by_user_id) if vo.reviewed_by_user_id else None,
        "reviewed_at": vo.reviewed_at.isoformat() if vo.reviewed_at else None,
        "review_notes": vo.review_notes,
        "approved_by_user_id": str(vo.approved_by_user_id) if vo.approved_by_user_id else None,
        "approved_at": vo.approved_at.isoformat() if vo.approved_at else None,
        "rejected_by_user_id": str(vo.rejected_by_user_id) if vo.rejected_by_user_id else None,
        "rejected_at": vo.rejected_at.isoformat() if vo.rejected_at else None,
        "rejection_reason": vo.rejection_reason,
        "bundled_addendum_id": str(vo.bundled_addendum_id) if vo.bundled_addendum_id else None,
        "god_mode_bypass": vo.god_mode_bypass,
        "created_at": vo.created_at.isoformat() if vo.created_at else None,
        "source_observation": None,
    }
    # Enrichment — MC / observasi yang memicu VO ini
    if vo.source_observation_id and db is not None:
        from app.models.models import FieldObservation
        obs = db.query(FieldObservation).filter(
            FieldObservation.id == vo.source_observation_id
        ).first()
        if obs:
            d["source_observation"] = {
                "id": str(obs.id),
                "type": obs.type.value if hasattr(obs.type, "value") else obs.type,
                "title": obs.title,
                "observation_date": obs.observation_date.isoformat() if obs.observation_date else None,
            }
    if with_items:
        # Pakai query langsung (bukan vo.items relationship) untuk hindari
        # cache stale setelah update payload
        if db is not None:
            items = (
                db.query(VariationOrderItem)
                .filter(VariationOrderItem.variation_order_id == vo.id)
                .order_by(VariationOrderItem.created_at)
                .all()
            )
        else:
            items = vo.items or []
        d["items"] = [_item_to_dict(it, db=db) for it in items]
    return d


def _recompute_cost_impact(db: Session, vo: VariationOrder) -> None:
    """
    Jumlahkan cost_impact dari semua items → simpan ke vo.cost_impact.
    Pakai query langsung (bukan vo.items relationship) karena setelah
    apply_items_from_payload, relationship cache bisa stale. Ini bug
    'Dampak 0 di list VO' yang dilaporkan: items tersimpan benar, tapi
    aggregate di header VO gagal karena loop pakai relationship lama.

    REMOVE_FACILITY dapat perlakuan khusus: cost_impact = -facility.total_value
    (volume_delta/unit_price selalu 0 untuk action ini, jadi formula delta×price
    = 0 akan salah-menimpa nilai yang benar).
    """
    items = (
        db.query(VariationOrderItem)
        .filter(VariationOrderItem.variation_order_id == vo.id)
        .all()
    )
    total = Decimal("0")
    for it in items:
        if it.action == VOItemAction.REMOVE_FACILITY:
            # Re-query facility supaya sinkron kalau total_value berubah
            fac = db.query(Facility).filter(Facility.id == it.facility_id).first() if it.facility_id else None
            expected = -Decimal(str(fac.total_value or 0)) if fac else Decimal(str(it.cost_impact or 0))
        elif it.action == VOItemAction.ADD_FACILITY:
            # Fasilitas baru tanpa items = 0; items ADD ditangani terpisah
            expected = Decimal("0")
        else:
            delta = Decimal(it.volume_delta or 0)
            price = Decimal(it.unit_price or 0)
            expected = delta * price
        # Normalisasi — setiap item cost_impact harus sinkron dengan
        # volume_delta × unit_price (kalau tidak, integrity rusak).
        if it.cost_impact is None or Decimal(it.cost_impact) != expected:
            it.cost_impact = expected
        total += expected
    vo.cost_impact = total
    db.flush()


def _apply_items_from_payload(vo: VariationOrder, items_input, db: Session):
    """Replace items in VO from the input list."""
    # Delete existing
    for existing in list(vo.items):
        db.delete(existing)
    db.flush()

    for it in items_input:
        action = VOItemAction(it.action)
        # Validasi field wajib per action:
        #   ADD             → facility_id (item baru di fasilitas mana)
        #   REMOVE_FACILITY → facility_id (fasilitas mana yang dihapus)
        #   ADD_FACILITY    → location_id + new_facility_code + description (nama)
        #   INCREASE/DECREASE/MODIFY_SPEC/REMOVE → boq_item_id (item yang diubah)
        if action in (VOItemAction.ADD, VOItemAction.REMOVE_FACILITY):
            if not it.facility_id:
                raise HTTPException(400, f"Item {action.value} harus menyertakan facility_id.")
        elif action == VOItemAction.ADD_FACILITY:
            if not it.location_id:
                raise HTTPException(400, "Item add_facility harus menyertakan location_id.")
            if not (it.new_facility_code or "").strip():
                raise HTTPException(400, "Item add_facility harus menyertakan new_facility_code.")
            if not (it.description or "").strip():
                raise HTTPException(400, "Item add_facility harus menyertakan description (nama fasilitas).")
        else:
            if not it.boq_item_id:
                raise HTTPException(
                    400,
                    f"Item {action.value} harus merujuk boq_item_id yang sudah ada.",
                )
        # Snapshot old description for MODIFY_SPEC if client didn't provide
        old_desc, old_unit = it.old_description, it.old_unit
        if action == VOItemAction.MODIFY_SPEC and it.boq_item_id:
            existing_boq = db.query(BOQItem).filter(BOQItem.id == it.boq_item_id).first()
            if existing_boq:
                old_desc = old_desc or existing_boq.description
                old_unit = old_unit or existing_boq.unit

        # Cost impact untuk REMOVE_FACILITY = negatif dari total facility
        # (sum total_price semua leaf item aktif di fasilitas ini).
        # User tidak perlu input volume_delta/unit_price; dihitung otomatis.
        if action == VOItemAction.REMOVE_FACILITY:
            from app.models.models import Facility
            fac = db.query(Facility).filter(Facility.id == it.facility_id).first()
            fac_total = Decimal(str(fac.total_value or 0)) if fac else Decimal("0")
            cost_impact_val = -fac_total
            desc_override = it.description or (
                f"Hilangkan seluruh fasilitas {fac.facility_code} {fac.facility_name}"
                if fac else "Hilangkan fasilitas"
            )
        elif action == VOItemAction.ADD_FACILITY:
            # Fasilitas baru = 0 nilai sampai item ADD ditambahkan terpisah
            cost_impact_val = Decimal("0")
            desc_override = it.description
        else:
            cost_impact_val = Decimal(it.volume_delta or 0) * Decimal(it.unit_price or 0)
            desc_override = it.description

        zero_actions = (VOItemAction.REMOVE_FACILITY, VOItemAction.ADD_FACILITY)
        db.add(VariationOrderItem(
            variation_order_id=vo.id,
            action=action,
            boq_item_id=it.boq_item_id,
            facility_id=it.facility_id,
            parent_boq_item_id=it.parent_boq_item_id if action == VOItemAction.ADD else None,
            parent_code=it.parent_code if action == VOItemAction.ADD else None,
            new_item_code=it.new_item_code if action == VOItemAction.ADD else None,
            location_id=it.location_id if action == VOItemAction.ADD_FACILITY else None,
            new_facility_code=it.new_facility_code if action == VOItemAction.ADD_FACILITY else None,
            master_work_code=it.master_work_code,
            description=desc_override,
            unit=it.unit,
            volume_delta=Decimal("0") if action in zero_actions else it.volume_delta,
            unit_price=Decimal("0") if action in zero_actions else it.unit_price,
            cost_impact=cost_impact_val,
            old_description=old_desc,
            old_unit=old_unit,
            notes=it.notes,
        ))
    db.flush()


# ─── List / Detail ──────────────────────────────────────────────────────────

@router.get("/by-contract/{contract_id}", response_model=dict)
def list_by_contract(
    contract_id: str,
    status: Optional[str] = None,
    include_rejected: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    q = db.query(VariationOrder).filter(VariationOrder.contract_id == contract_id)
    if status:
        q = q.filter(VariationOrder.status == VOStatus(status))
    if not include_rejected and not status:
        q = q.filter(VariationOrder.status != VOStatus.REJECTED)
    rows = q.order_by(VariationOrder.created_at.desc()).all()
    return {"items": [_to_dict(vo, with_items=False) for vo in rows]}


@router.get("/{vo_id}", response_model=dict)
def get_vo(
    vo_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    vo = db.query(VariationOrder).filter(VariationOrder.id == vo_id).first()
    if not vo:
        raise HTTPException(404, "VO tidak ditemukan")
    if not user_can_access_contract(db, current_user, str(vo.contract_id)):
        raise HTTPException(403, "Akses ditolak")
    # Auto-heal: recompute cost_impact setiap kali detail dibuka.
    # Penting untuk VO legacy yang cost_impact REMOVE_FACILITY-nya masih 0
    # (bug lama). Idempotent & murah — query beberapa items + Facility.
    # Skip kalau VO sudah BUNDLED (immutable ke addendum yang sudah signed).
    if vo.status != VOStatus.BUNDLED:
        _recompute_cost_impact(db, vo)
        db.commit()
    return _to_dict(vo, db=db)


# ─── Create / Edit (DRAFT) ──────────────────────────────────────────────────

@router.post("/by-contract/{contract_id}", response_model=dict)
def create_vo(
    contract_id: str, data: VariationOrderCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    gm = is_god_mode_active(c)
    assert_contract_allows_vo(c, god_mode=gm)

    vo = VariationOrder(
        contract_id=contract_id,
        vo_number=generate_vo_number(db, contract_id),
        status=VOStatus.DRAFT,
        title=data.title,
        technical_justification=data.technical_justification,
        quantity_calculation=data.quantity_calculation,
        source_observation_id=data.source_observation_id,
        submitted_by_user_id=current_user.id,
        god_mode_bypass=gm,
    )
    db.add(vo)
    db.flush()
    _apply_items_from_payload(vo, data.items or [], db)
    _recompute_cost_impact(db, vo)
    db.commit()
    db.refresh(vo)
    if gm:
        log_god_mode_bypass(
            db, current_user, c,
            action="create_vo_on_non_active_contract",
            target_type="variation_order", target_id=str(vo.id),
            request=request,
        )
    log_audit(
        db, current_user, "create", "variation_order", str(vo.id),
        changes={"vo_number": vo.vo_number, "title": vo.title, "god_mode_bypass": gm},
        request=request, commit=True,
    )
    return _to_dict(vo, db=db)


@router.put("/{vo_id}", response_model=dict)
def update_vo(
    vo_id: str, data: VariationOrderUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    vo = db.query(VariationOrder).filter(VariationOrder.id == vo_id).first()
    if not vo:
        raise HTTPException(404, "VO tidak ditemukan")
    contract = db.query(Contract).filter(Contract.id == vo.contract_id).first()
    gm = is_god_mode_active(contract)

    if vo.status != VOStatus.DRAFT and not gm:
        raise HTTPException(
            400,
            {
                "code": "vo_not_editable",
                "message": (
                    f"VO {vo.vo_number} berstatus {vo.status.value} — hanya "
                    f"VO DRAFT yang bisa diedit. Kalau butuh revisi setelah "
                    f"submit, minta reviewer mengembalikan ke DRAFT atau buat VO baru."
                ),
            },
        )

    for field in ("title", "technical_justification", "quantity_calculation", "source_observation_id"):
        val = getattr(data, field, None)
        if val is not None:
            setattr(vo, field, val)
    if data.items is not None:
        _apply_items_from_payload(vo, data.items, db)
        _recompute_cost_impact(db, vo)
    if gm:
        vo.god_mode_bypass = True
        log_god_mode_bypass(
            db, current_user, contract,
            action="edit_vo_non_draft_status",
            target_type="variation_order", target_id=str(vo.id),
            details={"current_status": vo.status.value},
            request=request,
        )
    db.commit()
    db.refresh(vo)
    log_audit(db, current_user, "update", "variation_order", str(vo.id),
              changes={"vo_number": vo.vo_number, "god_mode_bypass": gm},
              request=request, commit=True)
    return _to_dict(vo, db=db)


# ─── Excel Bulk Edit (snapshot export + import) ─────────────────────────────

@router.get("/by-contract/{contract_id}/excel-snapshot")
def export_excel_snapshot(
    contract_id: str,
    facility_ids: Optional[str] = Query(None, description="comma-separated facility IDs; kosong = semua"),
    vo_id: Optional[str] = Query(None, description="VO yang sedang di-edit (item-nya pre-fill vol_baru)"),
    mode: str = Query("flat", description="flat | per_facility"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    from fastapi.responses import Response
    from app.services import vo_excel_service
    if mode not in ("flat", "per_facility"):
        raise HTTPException(400, "mode harus 'flat' atau 'per_facility'")
    fac_list = None
    if facility_ids:
        fac_list = [s.strip() for s in facility_ids.split(",") if s.strip()]
    try:
        data = vo_excel_service.export_snapshot(db, contract_id, fac_list, exclude_vo_id=vo_id, mode=mode)
    except ValueError as e:
        raise HTTPException(400, str(e))
    fname = f"vo_snapshot_{contract_id[:8]}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/by-contract/{contract_id}/excel-parse", response_model=dict)
async def parse_excel_snapshot(
    contract_id: str,
    file: UploadFile = File(...),
    vo_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """
    Parse uploaded Excel snapshot. Tidak menulis ke DB — return list
    VOItemInput dicts + warnings supaya client bisa preview lalu replace
    items di form sebelum save VO.
    """
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    from app.services import vo_excel_service
    raw = await file.read()
    try:
        result = vo_excel_service.parse_snapshot(db, contract_id, raw, exclude_vo_id=vo_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.delete("/{vo_id}", response_model=dict)
def delete_vo(
    vo_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    vo = db.query(VariationOrder).filter(VariationOrder.id == vo_id).first()
    if not vo:
        raise HTTPException(404, "VO tidak ditemukan")
    contract = db.query(Contract).filter(Contract.id == vo.contract_id).first()
    gm = is_god_mode_active(contract)

    if vo.status not in (VOStatus.DRAFT, VOStatus.REJECTED) and not gm:
        raise HTTPException(
            400,
            {
                "code": "vo_not_deletable",
                "message": (
                    f"VO {vo.vo_number} berstatus {vo.status.value} tidak bisa dihapus. "
                    f"Hanya VO DRAFT atau REJECTED yang boleh dihapus."
                ),
            },
        )

    if gm and vo.status in (VOStatus.APPROVED, VOStatus.BUNDLED, VOStatus.UNDER_REVIEW):
        log_god_mode_bypass(
            db, current_user, contract,
            action="delete_vo_non_draft_status",
            target_type="variation_order", target_id=str(vo.id),
            details={"current_status": vo.status.value},
            request=request,
        )

    log_audit(db, current_user, "delete", "variation_order", str(vo.id),
              changes={"vo_number": vo.vo_number, "status": vo.status.value, "god_mode_bypass": gm},
              request=request, commit=False)
    db.delete(vo)
    db.commit()
    return {"success": True}


# ─── State transitions ──────────────────────────────────────────────────────

from datetime import datetime


def _transition(
    vo: VariationOrder, to_status: VOStatus,
    contract: Contract, user: User, db: Session, request=None,
    *,
    reason: str = None, notes: str = None,
) -> None:
    """Fungsi tunggal yang di-wrap tiap endpoint (submit/review/approve/reject)."""
    gm = is_god_mode_active(contract)
    assert_vo_can_transition(vo, to_status, god_mode=gm)

    old = vo.status
    vo.status = to_status
    now = datetime.utcnow()

    if to_status == VOStatus.UNDER_REVIEW:
        pass  # submit_vo event
    elif to_status == VOStatus.APPROVED:
        vo.approved_by_user_id = user.id
        vo.approved_at = now
        if notes: vo.review_notes = notes
    elif to_status == VOStatus.REJECTED:
        if not reason or len(reason.strip()) < 20:
            if not gm:
                raise HTTPException(
                    400,
                    "Alasan penolakan wajib diisi minimal 20 karakter (kebutuhan audit).",
                )
        vo.rejected_by_user_id = user.id
        vo.rejected_at = now
        vo.rejection_reason = reason
    elif to_status == VOStatus.DRAFT:
        # Kembali ke DRAFT dari UNDER_REVIEW untuk revisi
        if notes: vo.review_notes = notes

    if gm:
        vo.god_mode_bypass = True
        log_god_mode_bypass(
            db, user, contract,
            action=f"vo_transition_{old.value}_to_{to_status.value}",
            target_type="variation_order", target_id=str(vo.id),
            request=request,
        )
    log_audit(
        db, user, f"vo_{to_status.value}", "variation_order", str(vo.id),
        changes={
            "vo_number": vo.vo_number,
            "from_status": old.value,
            "to_status": to_status.value,
            "notes": notes, "reason": reason,
            "god_mode_bypass": gm,
        },
        request=request, commit=False,
    )


@router.post("/{vo_id}/submit", response_model=dict)
def submit_vo(
    vo_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """DRAFT → UNDER_REVIEW. Kontraktor submit VO untuk review konsultan."""
    vo = db.query(VariationOrder).filter(VariationOrder.id == vo_id).first()
    if not vo:
        raise HTTPException(404, "VO tidak ditemukan")
    if not vo.items and not is_god_mode_active(
        db.query(Contract).filter(Contract.id == vo.contract_id).first()
    ):
        raise HTTPException(400, "VO tanpa items tidak bisa disubmit.")
    contract = db.query(Contract).filter(Contract.id == vo.contract_id).first()
    vo.submitted_by_user_id = current_user.id
    vo.submitted_at = datetime.utcnow()
    _transition(vo, VOStatus.UNDER_REVIEW, contract, current_user, db, request=request)
    db.commit()
    db.refresh(vo)
    return _to_dict(vo, db=db)


@router.post("/{vo_id}/review", response_model=dict)
def review_vo(
    vo_id: str, data: VOActionRequest, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """Konsultan catat review_notes tanpa mengubah status.
    Untuk flow: UNDER_REVIEW → DRAFT (dikembalikan untuk revisi)."""
    vo = db.query(VariationOrder).filter(VariationOrder.id == vo_id).first()
    if not vo:
        raise HTTPException(404, "VO tidak ditemukan")
    contract = db.query(Contract).filter(Contract.id == vo.contract_id).first()
    vo.reviewed_by_user_id = current_user.id
    vo.reviewed_at = datetime.utcnow()
    vo.review_notes = data.notes or data.reason
    _transition(vo, VOStatus.DRAFT, contract, current_user, db, request=request, notes=vo.review_notes)
    db.commit()
    db.refresh(vo)
    return _to_dict(vo, db=db)


@router.post("/{vo_id}/approve", response_model=dict)
def approve_vo(
    vo_id: str, data: VOActionRequest, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """UNDER_REVIEW → APPROVED oleh PPK. Belum ubah BOQ; menunggu bundle ke Addendum."""
    vo = db.query(VariationOrder).filter(VariationOrder.id == vo_id).first()
    if not vo:
        raise HTTPException(404, "VO tidak ditemukan")
    contract = db.query(Contract).filter(Contract.id == vo.contract_id).first()
    if not is_god_mode_active(contract):
        assert_role_in(db, current_user, "ppk", "admin_pusat", action="Approve VO")
    _transition(vo, VOStatus.APPROVED, contract, current_user, db, request=request, notes=data.notes)
    db.commit()
    db.refresh(vo)
    return _to_dict(vo, db=db)


@router.post("/{vo_id}/reject", response_model=dict)
def reject_vo(
    vo_id: str, data: VOActionRequest, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    """Terminal: set REJECTED. Alasan wajib min 20 char."""
    vo = db.query(VariationOrder).filter(VariationOrder.id == vo_id).first()
    if not vo:
        raise HTTPException(404, "VO tidak ditemukan")
    contract = db.query(Contract).filter(Contract.id == vo.contract_id).first()
    if not is_god_mode_active(contract):
        assert_role_in(db, current_user, "ppk", "admin_pusat", action="Reject VO")
    _transition(vo, VOStatus.REJECTED, contract, current_user, db, request=request, reason=data.reason)
    db.commit()
    db.refresh(vo)
    return _to_dict(vo, db=db)
