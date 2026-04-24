"""
Field Observation endpoints — MC-0 dan MC-N.
Non-legal: hanya identifikasi, tidak mengubah kontrak atau BOQ.
"""
from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import (
    FieldObservation, FieldObservationType, Contract, User,
)
from app.schemas.schemas import FieldObservationCreate, FieldObservationOut
from app.api.deps import get_current_user, require_permission, user_can_access_contract
from app.services.audit_service import log_audit


router = APIRouter(prefix="/field-observations", tags=["field_observations"])


def _to_dict(o: FieldObservation, *, db: Session = None) -> dict:
    d = {
        "id": str(o.id),
        "contract_id": str(o.contract_id),
        "type": o.type.value if hasattr(o.type, "value") else o.type,
        "observation_date": o.observation_date.isoformat() if o.observation_date else None,
        "title": o.title,
        "findings": o.findings,
        "attendees": o.attendees,
        "submitted_by_user_id": str(o.submitted_by_user_id) if o.submitted_by_user_id else None,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "triggered_vos": [],
    }
    # Enrichment — VO yang sourced dari observasi ini (backlink visual)
    if db is not None:
        from app.models.models import VariationOrder
        vos = db.query(VariationOrder).filter(
            VariationOrder.source_observation_id == o.id
        ).order_by(VariationOrder.created_at).all()
        d["triggered_vos"] = [
            {
                "id": str(v.id),
                "vo_number": v.vo_number,
                "status": v.status.value if hasattr(v.status, "value") else v.status,
                "cost_impact": float(v.cost_impact or 0),
            }
            for v in vos
        ]
    return d


@router.get("/by-contract/{contract_id}", response_model=dict)
def list_by_contract(
    contract_id: str,
    type: Optional[str] = Query(None, description="filter: mc_0 atau mc_interim"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    q = db.query(FieldObservation).filter(FieldObservation.contract_id == contract_id)
    if type:
        q = q.filter(FieldObservation.type == FieldObservationType(type))
    rows = q.order_by(FieldObservation.observation_date.desc(), FieldObservation.created_at.desc()).all()
    return {"items": [_to_dict(o, db=db) for o in rows]}


@router.post("/by-contract/{contract_id}", response_model=dict)
def create(
    contract_id: str, data: FieldObservationCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    c = db.query(Contract).filter(Contract.id == contract_id, Contract.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Kontrak tidak ditemukan")

    try:
        obs_type = FieldObservationType(data.type)
    except ValueError:
        raise HTTPException(400, "type harus 'mc_0' atau 'mc_interim'")

    # MC-0 unik per kontrak
    if obs_type == FieldObservationType.MC_0:
        existing = db.query(FieldObservation).filter(
            FieldObservation.contract_id == contract_id,
            FieldObservation.type == FieldObservationType.MC_0,
        ).first()
        if existing:
            raise HTTPException(
                400,
                "MC-0 sudah ada untuk kontrak ini. Gunakan tipe mc_interim untuk pengukuran selanjutnya.",
            )

    o = FieldObservation(
        contract_id=contract_id,
        type=obs_type,
        observation_date=data.observation_date,
        title=data.title,
        findings=data.findings,
        attendees=data.attendees,
        submitted_by_user_id=current_user.id,
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    log_audit(
        db, current_user, "create", "field_observation", str(o.id),
        changes={"type": obs_type.value, "title": data.title},
        request=request, commit=True,
    )
    return _to_dict(o, db=db)


@router.put("/{obs_id}", response_model=dict)
def update(
    obs_id: str, data: FieldObservationCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    o = db.query(FieldObservation).filter(FieldObservation.id == obs_id).first()
    if not o:
        raise HTTPException(404, "Observasi tidak ditemukan")
    # MC-0 unique per kontrak — kalau user coba ubah tipe ke MC_0 sementara
    # sudah ada MC_0 lain, tolak.
    try:
        new_type = FieldObservationType(data.type)
    except ValueError:
        raise HTTPException(400, "type harus 'mc_0' atau 'mc_interim'")
    if new_type == FieldObservationType.MC_0 and o.type != FieldObservationType.MC_0:
        conflict = db.query(FieldObservation).filter(
            FieldObservation.contract_id == o.contract_id,
            FieldObservation.type == FieldObservationType.MC_0,
            FieldObservation.id != o.id,
        ).first()
        if conflict:
            raise HTTPException(400, "MC-0 sudah ada untuk kontrak ini.")
    o.type = new_type
    o.observation_date = data.observation_date
    o.title = data.title
    o.findings = data.findings
    o.attendees = data.attendees
    db.commit()
    db.refresh(o)
    log_audit(
        db, current_user, "update", "field_observation", str(o.id),
        changes={"title": data.title}, request=request, commit=True,
    )
    return _to_dict(o, db=db)


@router.delete("/{obs_id}", response_model=dict)
def delete(
    obs_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    o = db.query(FieldObservation).filter(FieldObservation.id == obs_id).first()
    if not o:
        raise HTTPException(404, "Observasi tidak ditemukan")
    # Role gate: hanya PPK yang boleh hapus BA (kontraktor tidak boleh hapus
    # bukti lapangan yang sudah disepakati)
    from app.api.deps import assert_role_in
    from app.models.models import Contract
    contract = db.query(Contract).filter(Contract.id == o.contract_id).first()
    from app.services.vo_service import is_god_mode_active
    if not (contract and is_god_mode_active(contract)):
        assert_role_in(
            db, current_user, "ppk", "admin_pusat",
            action="Hapus Observasi Lapangan (BA)",
        )
    # Kalau sudah dirujuk oleh VO, tolak delete
    from app.models.models import VariationOrder
    referenced = db.query(VariationOrder).filter(
        VariationOrder.source_observation_id == obs_id
    ).count()
    if referenced:
        raise HTTPException(
            400,
            f"Observasi ini menjadi sumber {referenced} VO — tidak bisa dihapus.",
        )
    db.delete(o)
    db.commit()
    log_audit(db, current_user, "delete", "field_observation", obs_id, request=request, commit=True)
    return {"success": True}
