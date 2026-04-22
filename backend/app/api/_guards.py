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
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import Contract, ContractStatus, Facility, Location


SCOPE_EDITABLE_STATUSES = {ContractStatus.DRAFT, ContractStatus.ADDENDUM}

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
        db.query(Contract.status, Contract.contract_number)
        .filter(Contract.id == contract_id)
        .first()
    )
    if not row:
        return
    status, number = row
    if status in SCOPE_EDITABLE_STATUSES:
        return
    _raise_locked(number, status, entity=entity)


def assert_scope_editable_by_location(
    db: Session, location_id: str, *, entity: str = "facility"
) -> None:
    row = (
        db.query(Contract.status, Contract.contract_number)
        .join(Location, Location.contract_id == Contract.id)
        .filter(Location.id == location_id)
        .first()
    )
    if not row:
        return
    status, number = row
    if status in SCOPE_EDITABLE_STATUSES:
        return
    _raise_locked(number, status, entity=entity)


def assert_scope_editable_by_facility(
    db: Session, facility_id: str, *, entity: str = "facility"
) -> None:
    row = (
        db.query(Contract.status, Contract.contract_number)
        .join(Location, Location.contract_id == Contract.id)
        .join(Facility, Facility.location_id == Location.id)
        .filter(Facility.id == facility_id)
        .first()
    )
    if not row:
        return
    status, number = row
    if status in SCOPE_EDITABLE_STATUSES:
        return
    _raise_locked(number, status, entity=entity)
