"""
BOQ Lifecycle helpers — enforcement state machine + Perpres 16/2018 ps. 54.

Alur:
  Contract aktif + BOQ V0 terkunci
      ↓
  FieldObservation (MC-0 / MC-N) — non-legal, hanya identifikasi
      ↓
  VariationOrder DRAFT (usulan; bisa dikerjakan iteratif)
      ↓
  submit_vo  → UNDER_REVIEW
      ↓
  review_vo  (konsultan catat review_notes, tidak ubah status)
      ↓
  approve_vo → APPROVED  (PPK)
      OR
  reject_vo  → REJECTED  (terminal, append-only)
      ↓
  sign_addendum  (bundle >= 1 VO APPROVED jadi 1 Addendum,
                  threshold 10% → butuh KPA sign-off,
                  spawn BOQ V(N+1) DRAFT)
      ↓
  activate_new_boq (V(N+1) APPROVED + is_active, V(N) SUPERSEDED)

GOD-MODE (Unlock Mode superadmin):
  Saat contract.unlock_until masih aktif, SEMUA state transition di atas
  boleh dilewati. Setiap pelewatan otomatis:
    - ter-log ke audit_logs dengan action="godmode_bypass"
    - set flag god_mode_bypass=True di entitas terkait (VO/Addendum)
  Sistem normal tidak terganggu — god-mode hanya aktif per-kontrak sesuai
  unlock_until.
"""
import datetime as _dt
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import (
    Contract, ContractAddendum, ContractStatus, AddendumType,
    VariationOrder, VariationOrderItem, VOStatus, VOItemAction,
    FieldObservation, FieldObservationType,
    BOQRevision, BOQItem, BOQChangeType, RevisionStatus,
    User, Facility, Location,
)
from app.services.audit_service import log_audit


# ─── God-Mode helper ────────────────────────────────────────────────────────

def is_god_mode_active(contract: Contract) -> bool:
    """
    True bila contract.unlock_until masih di masa depan (window unlock aktif).
    Dipakai semua validator untuk bypass rule normal — tapi pemakai harus
    log_god_mode_bypass() supaya audit BPK bisa trace.
    """
    if contract.unlock_until is None:
        return False
    return _dt.datetime.utcnow() < contract.unlock_until


def log_god_mode_bypass(
    db: Session, user: User, contract: Contract, *,
    action: str, target_type: str, target_id: str = None, details: dict = None,
    request=None,
) -> None:
    """Tag audit khusus saat rule normal dilewati via God-Mode."""
    log_audit(
        db, user, "godmode_bypass", target_type, target_id,
        changes={
            "bypassed_action": action,
            "unlock_reason": contract.unlock_reason,
            "unlock_until": contract.unlock_until.isoformat() if contract.unlock_until else None,
            **(details or {}),
        },
        request=request, commit=False,  # caller yang commit
    )


# ─── VO state-transition guards ──────────────────────────────────────────────

# Transisi legal (non-god-mode)
_VO_TRANSITIONS = {
    VOStatus.DRAFT: {VOStatus.UNDER_REVIEW, VOStatus.REJECTED},
    VOStatus.UNDER_REVIEW: {VOStatus.APPROVED, VOStatus.REJECTED, VOStatus.DRAFT},
    VOStatus.APPROVED: {VOStatus.BUNDLED, VOStatus.REJECTED},
    VOStatus.REJECTED: set(),   # terminal
    VOStatus.BUNDLED: set(),    # terminal (legal setelah Addendum sign)
}


def assert_vo_can_transition(
    vo: VariationOrder, to_status: VOStatus, *,
    god_mode: bool = False,
) -> None:
    if god_mode:
        return  # bypass — caller harus log_god_mode_bypass
    allowed = _VO_TRANSITIONS.get(vo.status, set())
    if to_status not in allowed:
        raise HTTPException(
            400,
            {
                "code": "invalid_vo_transition",
                "message": (
                    f"VO {vo.vo_number} berstatus {vo.status.value}, tidak "
                    f"bisa langsung ke {to_status.value}. Transisi yang "
                    f"diperbolehkan: {[s.value for s in allowed] or 'tidak ada (terminal)'}."
                ),
            },
        )


def assert_contract_allows_vo(contract: Contract, *, god_mode: bool = False) -> None:
    """Kontrak yang menerima VO baru: hanya yang sedang aktif (bukan draft/
    completed/terminated). God-mode bypass boleh untuk koreksi retroaktif."""
    if god_mode:
        return
    s = contract.status
    if s in (ContractStatus.DRAFT, ContractStatus.COMPLETED, ContractStatus.TERMINATED):
        raise HTTPException(
            400,
            {
                "code": "contract_status_invalid_for_vo",
                "message": (
                    f"Kontrak berstatus {s.value} tidak menerima VO baru. "
                    f"VO hanya dibuat pada kontrak AKTIF atau dalam fase Addendum."
                ),
            },
        )


# ─── VO number generator ────────────────────────────────────────────────────

def generate_vo_number(db: Session, contract_id) -> str:
    """Next VO number per kontrak: VO-001, VO-002, ..."""
    count = (
        db.query(VariationOrder)
        .filter(VariationOrder.contract_id == contract_id)
        .count()
    )
    return f"VO-{count + 1:03d}"


# ─── Threshold Perpres 16/2018 ps. 54 ───────────────────────────────────────

PERPRES_KPA_THRESHOLD = Decimal("0.10")  # 10% dari nilai kontrak awal


def requires_kpa_approval(contract: Contract, new_contract_value: Decimal) -> bool:
    """
    True bila delta_value / original_value > 10%. Dalam kondisi ini,
    Addendum wajib ditandatangani KPA (Kuasa Pengguna Anggaran) atau PA,
    bukan cukup PPK saja (Perpres 16/2018 ps. 54 jo. Perpres 12/2021).
    """
    original = Decimal(contract.original_value or 0)
    if original <= 0:
        return False
    delta = (Decimal(new_contract_value or 0) - original) / original
    return abs(delta) > PERPRES_KPA_THRESHOLD


# ─── Sign addendum + bundle VO → spawn BOQ V(N+1) ────────────────────────────

def bundle_vos_to_addendum(
    db: Session,
    contract: Contract,
    addendum: ContractAddendum,
    vo_ids: List[str],
    *,
    god_mode: bool = False,
    user: User = None,
) -> List[VariationOrder]:
    """
    Tautkan semua VO APPROVED yang dipilih ke Addendum yang baru di-sign,
    lalu set status VO → BUNDLED. Dipanggil dari endpoint sign_addendum.
    """
    vos = (
        db.query(VariationOrder)
        .filter(
            VariationOrder.id.in_(vo_ids),
            VariationOrder.contract_id == contract.id,
        )
        .all()
    )
    if len(vos) != len(vo_ids):
        if not god_mode:
            raise HTTPException(
                400,
                "Sebagian VO tidak ditemukan atau bukan milik kontrak ini.",
            )
    for vo in vos:
        if vo.status != VOStatus.APPROVED and not god_mode:
            raise HTTPException(
                400,
                {
                    "code": "vo_not_approved_for_bundle",
                    "message": f"VO {vo.vo_number} berstatus {vo.status.value}, hanya VO APPROVED yang boleh di-bundle.",
                },
            )
        vo.bundled_addendum_id = addendum.id
        vo.status = VOStatus.BUNDLED
        if god_mode:
            vo.god_mode_bypass = True
    return vos
