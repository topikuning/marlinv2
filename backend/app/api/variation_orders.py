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

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import (
    Contract, VariationOrder, VariationOrderItem, VOStatus, VOItemAction,
    BOQItem, User,
)
from app.schemas.schemas import (
    VariationOrderCreate, VariationOrderUpdate, VOActionRequest,
)
from app.api.deps import get_current_user, require_permission, user_can_access_contract
from app.services.audit_service import log_audit
from app.services.vo_service import (
    is_god_mode_active, log_god_mode_bypass,
    assert_vo_can_transition, assert_contract_allows_vo,
    generate_vo_number,
)


router = APIRouter(prefix="/variation-orders", tags=["variation_orders"])


def _item_to_dict(i: VariationOrderItem) -> dict:
    return {
        "id": str(i.id),
        "action": i.action.value if hasattr(i.action, "value") else i.action,
        "boq_item_id": str(i.boq_item_id) if i.boq_item_id else None,
        "facility_id": str(i.facility_id) if i.facility_id else None,
        "master_work_code": i.master_work_code,
        "description": i.description,
        "unit": i.unit,
        "volume_delta": float(i.volume_delta or 0),
        "unit_price": float(i.unit_price or 0),
        "cost_impact": float(i.cost_impact or 0),
        "old_description": i.old_description,
        "old_unit": i.old_unit,
        "notes": i.notes,
    }


def _to_dict(vo: VariationOrder, with_items: bool = True) -> dict:
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
    }
    if with_items:
        d["items"] = [_item_to_dict(it) for it in vo.items]
    return d


def _recompute_cost_impact(vo: VariationOrder) -> None:
    """Jumlahkan cost_impact dari semua items — digunakan setelah items diupdate."""
    total = Decimal("0")
    for it in vo.items:
        delta = Decimal(it.volume_delta or 0)
        price = Decimal(it.unit_price or 0)
        it.cost_impact = delta * price
        total += it.cost_impact
    vo.cost_impact = total


def _apply_items_from_payload(vo: VariationOrder, items_input, db: Session):
    """Replace items in VO from the input list."""
    # Delete existing
    for existing in list(vo.items):
        db.delete(existing)
    db.flush()

    for it in items_input:
        action = VOItemAction(it.action)
        # ADD needs facility_id; others need boq_item_id
        if action == VOItemAction.ADD:
            if not it.facility_id:
                raise HTTPException(
                    400,
                    "Item ADD harus menyertakan facility_id (di fasilitas mana item baru akan ditambahkan).",
                )
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

        db.add(VariationOrderItem(
            variation_order_id=vo.id,
            action=action,
            boq_item_id=it.boq_item_id,
            facility_id=it.facility_id,
            master_work_code=it.master_work_code,
            description=it.description,
            unit=it.unit,
            volume_delta=it.volume_delta,
            unit_price=it.unit_price,
            cost_impact=Decimal(it.volume_delta or 0) * Decimal(it.unit_price or 0),
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
    return _to_dict(vo)


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
    _recompute_cost_impact(vo)
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
    return _to_dict(vo)


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
        _recompute_cost_impact(vo)
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
    return _to_dict(vo)


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
    return _to_dict(vo)


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
    return _to_dict(vo)


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
    _transition(vo, VOStatus.APPROVED, contract, current_user, db, request=request, notes=data.notes)
    db.commit()
    db.refresh(vo)
    return _to_dict(vo)


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
    _transition(vo, VOStatus.REJECTED, contract, current_user, db, request=request, reason=data.reason)
    db.commit()
    db.refresh(vo)
    return _to_dict(vo)
