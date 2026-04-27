"""
Lifecycle write-guards untuk entitas yang membentuk SCOPE kontrak.

Yang termasuk SCOPE: Lokasi, Fasilitas, item BOQ, Addendum.
Mereka hanya editable di status DRAFT (fase build awal) atau ADDENDUM
(window CCO yang membuka kembali scope). Di status lain — ACTIVE, ON_HOLD,
COMPLETED, TERMINATED — perubahan scope harus lewat Addendum baru, yang akan
mengubah status kontrak ke ADDENDUM dan melahirkan revisi BOQ DRAFT yang
bisa diedit bebas.

Helper di sini dipakai bersama oleh router locations / facilities /
contracts.addenda supaya logic-nya seragam dan banner UI konsisten.
"""
import datetime as _dt
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import Contract, ContractStatus, Facility, Location


SCOPE_EDITABLE_STATUSES = {ContractStatus.DRAFT, ContractStatus.ADDENDUM}


def _is_unlocked(unlock_until) -> bool:
    """True bila contract.unlock_until masih di masa depan (window aktif)."""
    if unlock_until is None:
        return False
    return _dt.datetime.utcnow() < unlock_until

_ENTITY_LABEL = {
    "location": "Lokasi",
    "facility": "Fasilitas",
    "addendum": "Addendum",
    "boq": "Item BOQ",
}


def _raise_locked(contract_number: str, status: ContractStatus, *, entity: str) -> None:
    label = _ENTITY_LABEL.get(entity, "Item")
    raise HTTPException(
        status_code=409,
        detail={
            "message": (
                f"{label} tidak dapat diubah karena kontrak {contract_number} "
                f"berstatus {status.value}. Buat Addendum untuk membuka kembali "
                f"perubahan scope pada kontrak yang sudah berjalan."
            ),
            "code": "contract_not_editable",
            "contract_status": status.value,
            "entity": entity,
        },
    )


def assert_scope_editable_by_contract(
    db: Session, contract_id: str, *, entity: str = "location"
) -> None:
    row = (
        db.query(Contract.status, Contract.contract_number, Contract.unlock_until)
        .filter(Contract.id == contract_id)
        .first()
    )
    if not row:
        return
    status, number, unlock_until = row
    if status in SCOPE_EDITABLE_STATUSES or _is_unlocked(unlock_until):
        return
    _raise_locked(number, status, entity=entity)


def assert_scope_editable_by_location(
    db: Session, location_id: str, *, entity: str = "facility"
) -> None:
    row = (
        db.query(Contract.status, Contract.contract_number, Contract.unlock_until)
        .join(Location, Location.contract_id == Contract.id)
        .filter(Location.id == location_id)
        .first()
    )
    if not row:
        return
    status, number, unlock_until = row
    if status in SCOPE_EDITABLE_STATUSES or _is_unlocked(unlock_until):
        return
    _raise_locked(number, status, entity=entity)


def assert_scope_editable_by_facility(
    db: Session, facility_id: str, *, entity: str = "facility"
) -> None:
    row = (
        db.query(Contract.status, Contract.contract_number, Contract.unlock_until)
        .join(Location, Location.contract_id == Contract.id)
        .join(Facility, Facility.location_id == Location.id)
        .filter(Facility.id == facility_id)
        .first()
    )
    if not row:
        return
    status, number, unlock_until = row
    if status in SCOPE_EDITABLE_STATUSES or _is_unlocked(unlock_until):
        return
    _raise_locked(number, status, entity=entity)


def resolve_active_addendum_id(db: Session, contract_id: str) -> Optional[str]:
    """
    Resolusi addendum yang sedang aktif (sedang dibangun) untuk kontrak.

    Dipakai oleh facilities/locations create endpoints supaya kolom
    addendum_id ter-isi otomatis saat scope diubah dalam ADDENDUM mode —
    audit trail eksplisit "fasilitas/lokasi ini ditambahkan via adendum X".

    Returns None bila kontrak masih DRAFT (baseline V0) atau tidak dalam
    mode ADDENDUM. Strateginya: cari ContractAddendum terbaru yang BELUM
    ditandatangani; kalau tidak ada, ambil yang signed_at paling baru
    (window ADDENDUM masih terbuka sampai BOQ revisinya di-approve).
    """
    from app.models.models import ContractAddendum
    # Prefer addendum DRAFT (baru dibuat, belum signed) — itu konteks aktif paling jelas
    pending = (
        db.query(ContractAddendum)
        .filter(
            ContractAddendum.contract_id == contract_id,
            ContractAddendum.signed_at.is_(None),
        )
        .order_by(ContractAddendum.created_at.desc())
        .first()
    )
    if pending:
        return str(pending.id)
    # Fallback: addendum tersigned terakhir (window ADDENDUM masih terbuka)
    latest = (
        db.query(ContractAddendum)
        .filter(ContractAddendum.contract_id == contract_id)
        .order_by(ContractAddendum.signed_at.desc().nullslast())
        .first()
    )
    return str(latest.id) if latest else None
