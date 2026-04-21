"""
BOQ Revision service — the CCO lifecycle.

Responsibilities:
  1. `ensure_cco_zero(contract)` — idempotent; every contract has one.
  2. `clone_revision(source_rev, addendum)` — used when a new CCO addendum
     is drafted. Deep-clones every BOQItem into a new DRAFT revision with
     `source_item_id` wired so we can diff CCO-N vs CCO-(N-1) later.
  3. `approve_revision(rev)` — atomically flips the old active revision to
     SUPERSEDED and the new one to APPROVED+active, then re-points existing
     weekly progress rows from the old items to their clones (so that the
     history of actual work done is preserved across the addendum).
  4. `recalc_revision_totals(rev)` — sums leaf total_price + weight_pct.

Design constraint enforced by the DB (see models.py): exactly one revision
per contract can have is_active=True at any instant. Our approve step uses
a short-lived flip (old→False, then new→True, same transaction) to respect
that partial unique index.
"""
import uuid
from typing import List, Optional, Dict
from datetime import datetime
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import (
    Contract,
    ContractAddendum,
    BOQRevision,
    BOQItem,
    WeeklyProgressItem,
    RevisionStatus,
    BOQChangeType,
    AddendumType,
)


# ─────────────────────────────────────────────────────────────────────────────
# CCO-0: bootstrap revision for the original BOQ
# ─────────────────────────────────────────────────────────────────────────────

def ensure_cco_zero(
    db: Session,
    contract: Contract,
    *,
    created_by_id: Optional[uuid.UUID] = None,
    auto_approve: bool = False,
) -> BOQRevision:
    """
    Ensure contract has a CCO-0 revision. Idempotent.

    If any BOQItems belong to this contract but have no revision yet
    (migration case), they are all attached to this CCO-0 revision.
    """
    rev = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == contract.id,
            BOQRevision.cco_number == 0,
        )
        .first()
    )
    if rev is None:
        rev = BOQRevision(
            contract_id=contract.id,
            addendum_id=None,
            cco_number=0,
            revision_code="CCO-0",
            name="BOQ Kontrak Awal",
            description="Revisi BOQ dari kontrak asli (sebelum addendum)",
            status=RevisionStatus.APPROVED if auto_approve else RevisionStatus.DRAFT,
            is_active=auto_approve,
            created_by=created_by_id,
            approved_by_id=created_by_id if auto_approve else None,
            approved_at=datetime.utcnow() if auto_approve else None,
        )
        db.add(rev)
        db.flush()

    # Attach any orphan BOQItems belonging to this contract to CCO-0.
    # We reach BOQItems via facility -> location -> contract.
    from app.models.models import Facility, Location

    orphan_items = (
        db.query(BOQItem)
        .join(Facility, BOQItem.facility_id == Facility.id)
        .join(Location, Facility.location_id == Location.id)
        .filter(
            Location.contract_id == contract.id,
            BOQItem.boq_revision_id.is_(None),
        )
        .all()
    )
    for item in orphan_items:
        item.boq_revision_id = rev.id
        db.add(item)

    if orphan_items:
        db.flush()
        recalc_revision_totals(db, rev)
    return rev


# ─────────────────────────────────────────────────────────────────────────────
# Totals & weights
# ─────────────────────────────────────────────────────────────────────────────

def recalc_revision_totals(db: Session, rev: BOQRevision) -> None:
    """Sum leaf total_prices into rev.total_value and update item_count.
    Also recomputes weight_pct for every leaf as its share of the whole."""
    leaves: List[BOQItem] = (
        db.query(BOQItem)
        .filter(
            BOQItem.boq_revision_id == rev.id,
            BOQItem.is_leaf == True,  # noqa: E712
            BOQItem.is_active == True,  # noqa: E712
        )
        .all()
    )
    grand = sum((Decimal(l.total_price or 0) for l in leaves), Decimal("0"))
    for l in leaves:
        tp = Decimal(l.total_price or 0)
        l.weight_pct = (tp / grand) if grand > 0 else Decimal("0")
        db.add(l)

    rev.total_value = grand
    rev.item_count = (
        db.query(func.count(BOQItem.id))
        .filter(BOQItem.boq_revision_id == rev.id)
        .scalar()
        or 0
    )
    db.add(rev)
    db.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Cloning a revision (for a new CCO)
# ─────────────────────────────────────────────────────────────────────────────

def _next_cco_number(db: Session, contract_id: uuid.UUID) -> int:
    highest = (
        db.query(func.max(BOQRevision.cco_number))
        .filter(BOQRevision.contract_id == contract_id)
        .scalar()
    )
    return (highest or 0) + 1


def clone_revision_for_addendum(
    db: Session,
    addendum: ContractAddendum,
    *,
    created_by_id: Optional[uuid.UUID] = None,
) -> BOQRevision:
    """
    Create a new DRAFT revision for this addendum by deep-cloning every
    BOQItem from the currently-active revision. Each cloned item points to
    its source via source_item_id and is marked change_type=UNCHANGED. The
    admin then edits the draft and the service flips change_type to
    MODIFIED on save if volume/unit_price/description differs, or ADDED
    for new rows, or REMOVED for tombstoned rows (handled by the API layer).

    Returns the new BOQRevision.
    """
    # Pick the current active revision as the source of truth.
    source = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == addendum.contract_id,
            BOQRevision.is_active == True,  # noqa: E712
        )
        .first()
    )
    if source is None:
        raise RuntimeError(
            f"Contract {addendum.contract_id} has no active BOQ revision — "
            f"cannot clone for addendum {addendum.number}."
        )

    cco_n = _next_cco_number(db, addendum.contract_id)
    new_rev = BOQRevision(
        contract_id=addendum.contract_id,
        addendum_id=addendum.id,
        cco_number=cco_n,
        revision_code=f"CCO-{cco_n}",
        name=f"CCO-{cco_n} · {addendum.number}",
        description=addendum.description,
        status=RevisionStatus.DRAFT,
        is_active=False,
        created_by=created_by_id,
    )
    db.add(new_rev)
    db.flush()

    # Clone every BOQItem, preserving hierarchy. We do two passes:
    # 1) copy all rows flat, keeping a map {old_id -> new_item}
    # 2) rewire parent_id using that map
    source_items: List[BOQItem] = (
        db.query(BOQItem).filter(BOQItem.boq_revision_id == source.id).all()
    )
    id_map: Dict[uuid.UUID, BOQItem] = {}
    for old in source_items:
        new = BOQItem(
            boq_revision_id=new_rev.id,
            facility_id=old.facility_id,
            master_work_code=old.master_work_code,
            source_item_id=old.id,
            change_type=BOQChangeType.UNCHANGED,
            parent_id=None,  # rewired in pass 2
            original_code=old.original_code,
            full_code=old.full_code,
            level=old.level,
            display_order=old.display_order,
            description=old.description,
            unit=old.unit,
            volume=old.volume,
            unit_price=old.unit_price,
            total_price=old.total_price,
            weight_pct=old.weight_pct,
            planned_start_week=old.planned_start_week,
            planned_duration_weeks=old.planned_duration_weeks,
            planned_end_week=old.planned_end_week,
            is_active=True,
            is_leaf=old.is_leaf,
        )
        db.add(new)
        db.flush()
        id_map[old.id] = new

    for old in source_items:
        if old.parent_id and old.parent_id in id_map:
            id_map[old.id].parent_id = id_map[old.parent_id].id
            db.add(id_map[old.id])
    db.flush()

    recalc_revision_totals(db, new_rev)
    return new_rev


# ─────────────────────────────────────────────────────────────────────────────
# Approving / activating a revision
# ─────────────────────────────────────────────────────────────────────────────

def approve_revision(
    db: Session,
    rev: BOQRevision,
    *,
    approved_by_id: Optional[uuid.UUID] = None,
    migrate_progress: bool = True,
) -> BOQRevision:
    """
    Atomically:
      1. Recalc totals & weights on `rev`.
      2. Find the currently-active revision for this contract (if any),
         flip it to SUPERSEDED + is_active=False.
      3. Flip `rev` to APPROVED + is_active=True.
      4. (If migrate_progress) update WeeklyProgressItem rows that pointed
         at the old revision's items so they now point at the corresponding
         items in the new revision, using source_item_id as the mapping.
         Only UNCHANGED and MODIFIED items get remapped — ADDED items have
         no predecessor, REMOVED items intentionally lose their progress.

    Note: the partial unique index `uq_one_active_revision_per_contract`
    forbids having TWO rows active at the same time. We flip the old one
    to False first (within the same transaction) to satisfy it.
    """
    if rev.status == RevisionStatus.APPROVED and rev.is_active:
        return rev  # idempotent

    recalc_revision_totals(db, rev)

    prev = (
        db.query(BOQRevision)
        .filter(
            BOQRevision.contract_id == rev.contract_id,
            BOQRevision.is_active == True,  # noqa: E712
            BOQRevision.id != rev.id,
        )
        .first()
    )

    if prev is not None:
        prev.is_active = False
        prev.status = RevisionStatus.SUPERSEDED
        db.add(prev)
        db.flush()  # release partial unique index slot

    rev.status = RevisionStatus.APPROVED
    rev.is_active = True
    rev.approved_at = datetime.utcnow()
    rev.approved_by_id = approved_by_id
    db.add(rev)
    db.flush()

    if migrate_progress and prev is not None:
        _migrate_progress(db, old_rev=prev, new_rev=rev)

    return rev


def _migrate_progress(db: Session, *, old_rev: BOQRevision, new_rev: BOQRevision) -> None:
    """
    Repoint WeeklyProgressItem rows from old_rev's items to new_rev's
    corresponding items, using source_item_id mapping.
    """
    # Build reverse map: old_item_id -> new_item_id
    mapping: Dict[uuid.UUID, uuid.UUID] = {
        new.source_item_id: new.id
        for new in db.query(BOQItem)
        .filter(
            BOQItem.boq_revision_id == new_rev.id,
            BOQItem.source_item_id.isnot(None),
            BOQItem.change_type.in_([BOQChangeType.UNCHANGED, BOQChangeType.MODIFIED]),
        )
        .all()
    }
    if not mapping:
        return

    # Progress rows that reference any of the mapped old items.
    old_item_ids = list(mapping.keys())
    progress_rows: List[WeeklyProgressItem] = (
        db.query(WeeklyProgressItem)
        .filter(WeeklyProgressItem.boq_item_id.in_(old_item_ids))
        .all()
    )
    for p in progress_rows:
        p.boq_item_id = mapping[p.boq_item_id]
        db.add(p)
    db.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Diff between two revisions (for the Compare UI later)
# ─────────────────────────────────────────────────────────────────────────────

def diff_revisions(
    db: Session,
    new_rev: BOQRevision,
) -> List[dict]:
    """
    Produce a row-level diff of new_rev vs its source revision.
    Returns list of { change_type, new_item, old_item, delta_volume,
    delta_unit_price, delta_total } suitable for a comparison table.
    """
    out: List[dict] = []
    new_items: List[BOQItem] = (
        db.query(BOQItem).filter(BOQItem.boq_revision_id == new_rev.id).all()
    )
    for n in new_items:
        old = None
        if n.source_item_id:
            old = db.query(BOQItem).filter(BOQItem.id == n.source_item_id).first()
        entry = {
            "change_type": n.change_type.value if n.change_type else None,
            "new_id": str(n.id),
            "old_id": str(old.id) if old else None,
            "description": n.description,
            "unit": n.unit,
            "new_volume": float(n.volume or 0),
            "old_volume": float(old.volume or 0) if old else None,
            "new_unit_price": float(n.unit_price or 0),
            "old_unit_price": float(old.unit_price or 0) if old else None,
            "new_total": float(n.total_price or 0),
            "old_total": float(old.total_price or 0) if old else None,
            "delta_total": float((n.total_price or 0) - (old.total_price if old else 0) or 0),
        }
        out.append(entry)
    return out
