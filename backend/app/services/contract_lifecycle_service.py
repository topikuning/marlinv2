"""
Contract activation service.

A Contract stays in status=DRAFT until someone calls `activate_contract`.
Activation is a *gate*, not an approval workflow — there is no
multi-party sign-off. It simply checks that the contract is ready for
daily/weekly reporting to start:

  1. Has at least one Location.
  2. Each Location has at least one Facility.
  3. There is an APPROVED, active CCO-0 BOQ revision.
  4. The revision's total_value is <= the contract's current_value
     (you can't have a BOQ worth more than the contract itself).

If any check fails we raise `ActivationError` with a human-readable
message. The API layer turns that into a 400.

Authorization (who can trigger this) is decided upstream by RBAC; this
service doesn't care.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional
import uuid
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import (
    Contract,
    ContractStatus,
    Location,
    Facility,
    BOQRevision,
    BOQItem,
    RevisionStatus,
)


class ActivationError(Exception):
    """Raised when a contract fails pre-activation checks."""
    def __init__(self, reasons: List[str]):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


@dataclass
class ActivationReadiness:
    ready: bool
    reasons: List[str]
    has_locations: bool
    has_facilities: bool
    has_approved_cco_zero: bool
    value_ok: bool
    boq_total_value: float
    contract_value: float


def check_readiness(db: Session, contract: Contract) -> ActivationReadiness:
    """Run all pre-activation checks without changing anything."""
    reasons: List[str] = []

    loc_count = (
        db.query(func.count(Location.id))
        .filter(Location.contract_id == contract.id)
        .scalar()
        or 0
    )
    has_locations = loc_count > 0
    if not has_locations:
        reasons.append("Kontrak harus memiliki minimal 1 lokasi.")

    fac_count = (
        db.query(func.count(Facility.id))
        .join(Location, Facility.location_id == Location.id)
        .filter(Location.contract_id == contract.id)
        .scalar()
        or 0
    )
    has_facilities = fac_count > 0
    if has_locations and not has_facilities:
        reasons.append("Setiap lokasi harus memiliki minimal 1 fasilitas.")

    rev = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == contract.id,
            BOQRevision.cco_number == 0,
        )
        .first()
    )
    has_approved_cco_zero = bool(
        rev and rev.status == RevisionStatus.APPROVED and rev.is_active
    )
    if not has_approved_cco_zero:
        reasons.append(
            "BOQ awal (CCO-0) belum disetujui. "
            "Buat & approve BOQ CCO-0 terlebih dahulu."
        )

    boq_total = float(rev.total_value or 0) if rev else 0.0
    contract_val = float(contract.current_value or 0)
    # Small tolerance (1 Rp) for floating-point sums of large numbers.
    value_ok = True if not rev else (
        Decimal(str(boq_total)) <= Decimal(str(contract_val)) + Decimal("1")
    )
    if rev and not value_ok:
        reasons.append(
            f"Total nilai BOQ (Rp {boq_total:,.0f}) melebihi nilai kontrak "
            f"(Rp {contract_val:,.0f})."
        )

    return ActivationReadiness(
        ready=(not reasons),
        reasons=reasons,
        has_locations=has_locations,
        has_facilities=has_facilities,
        has_approved_cco_zero=has_approved_cco_zero,
        value_ok=value_ok,
        boq_total_value=boq_total,
        contract_value=contract_val,
    )


def activate_contract(
    db: Session,
    contract: Contract,
    *,
    activated_by_id: Optional[uuid.UUID] = None,
    force: bool = False,
) -> Contract:
    """
    Flip a DRAFT contract to ACTIVE after passing readiness checks.

    `force=True` bypasses checks — intended for data-recovery scripts only,
    never exposed in the API.
    """
    if contract.status == ContractStatus.ACTIVE:
        return contract  # idempotent

    if contract.status in (ContractStatus.COMPLETED, ContractStatus.TERMINATED):
        raise ActivationError(
            [f"Kontrak dengan status '{contract.status.value}' tidak dapat diaktifkan."]
        )

    if not force:
        readiness = check_readiness(db, contract)
        if not readiness.ready:
            raise ActivationError(readiness.reasons)

    contract.status = ContractStatus.ACTIVE
    contract.activated_at = datetime.utcnow()
    contract.activated_by_id = activated_by_id
    db.add(contract)
    db.flush()
    return contract
