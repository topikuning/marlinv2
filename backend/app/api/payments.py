from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import (
    PaymentTerm, PaymentTermDocument, Contract, WeeklyReport, User,
    PaymentTermStatus,
)
from app.schemas.schemas import PaymentTermCreate, PaymentTermUpdate
from app.api.deps import get_current_user, require_permission, user_can_access_contract
from app.services.audit_service import log_audit
from app.services.file_service import save_upload, delete_file

router = APIRouter(prefix="/payments", tags=["payments"])


def _term_to_dict(t: PaymentTerm, detail=False) -> dict:
    d = {
        "id": str(t.id),
        "contract_id": str(t.contract_id),
        "term_number": t.term_number,
        "name": t.name,
        "required_progress_pct": float(t.required_progress_pct or 0),
        "payment_pct": float(t.payment_pct or 0),
        "amount": float(t.amount or 0),
        "retention_pct": float(t.retention_pct or 0),
        "planned_date": t.planned_date.isoformat() if t.planned_date else None,
        "eligible_date": t.eligible_date.isoformat() if t.eligible_date else None,
        "submitted_date": t.submitted_date.isoformat() if t.submitted_date else None,
        "paid_date": t.paid_date.isoformat() if t.paid_date else None,
        "status": t.status.value if hasattr(t.status, "value") else t.status,
        "invoice_number": t.invoice_number,
        "notes": t.notes,
    }
    if detail:
        d["documents"] = [
            {
                "id": str(dc.id),
                "doc_type": dc.doc_type,
                "file_path": dc.file_path,
                "caption": dc.caption,
                "created_at": dc.created_at.isoformat(),
            }
            for dc in t.documents
        ]
    return d


def _update_eligibility(db: Session, contract_id: str):
    """Mark terms as eligible if latest actual cumulative >= required_progress_pct."""
    latest = (
        db.query(WeeklyReport)
        .filter(WeeklyReport.contract_id == contract_id, WeeklyReport.is_deleted == False)
        .order_by(WeeklyReport.week_number.desc())
        .first()
    )
    if not latest:
        return
    actual = float(latest.actual_cumulative_pct or 0)
    terms = db.query(PaymentTerm).filter(
        PaymentTerm.contract_id == contract_id,
        PaymentTerm.status == PaymentTermStatus.PLANNED,
    ).all()
    for t in terms:
        if actual >= float(t.required_progress_pct or 0):
            t.status = PaymentTermStatus.ELIGIBLE
            t.eligible_date = date.today()


@router.get("/by-contract/{contract_id}", response_model=dict)
def list_terms(
    contract_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("payment.read")),
):
    if not user_can_access_contract(db, current_user, contract_id):
        raise HTTPException(403, "Akses ditolak")
    _update_eligibility(db, contract_id)
    db.commit()
    rows = db.query(PaymentTerm).filter(
        PaymentTerm.contract_id == contract_id
    ).order_by(PaymentTerm.term_number).all()
    return {"items": [_term_to_dict(r) for r in rows]}


@router.get("/{term_id}", response_model=dict)
def get_term(term_id: str, db: Session = Depends(get_db),
             _=Depends(require_permission("payment.read"))):
    t = db.query(PaymentTerm).filter(PaymentTerm.id == term_id).first()
    if not t:
        raise HTTPException(404, "Termin tidak ditemukan")
    return _term_to_dict(t, detail=True)


@router.post("/by-contract/{contract_id}", response_model=dict)
def create_term(
    contract_id: str, data: PaymentTermCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("payment.create")),
):
    if not db.query(Contract).filter(Contract.id == contract_id).first():
        raise HTTPException(404, "Kontrak tidak ditemukan")
    if db.query(PaymentTerm).filter(
        PaymentTerm.contract_id == contract_id, PaymentTerm.term_number == data.term_number,
    ).first():
        raise HTTPException(400, "Nomor termin sudah ada")
    t = PaymentTerm(contract_id=contract_id, created_by=current_user.id, **data.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    log_audit(db, current_user, "create", "payment_term", str(t.id), request=request, commit=True)
    return {"id": str(t.id), "success": True}


@router.put("/{term_id}", response_model=dict)
def update_term(
    term_id: str, data: PaymentTermUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("payment.update")),
):
    t = db.query(PaymentTerm).filter(PaymentTerm.id == term_id).first()
    if not t:
        raise HTTPException(404, "Termin tidak ditemukan")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    db.commit()
    log_audit(db, current_user, "update", "payment_term", str(t.id), request=request, commit=True)
    return {"success": True}


@router.delete("/{term_id}", response_model=dict)
def delete_term(
    term_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("payment.delete")),
):
    t = db.query(PaymentTerm).filter(PaymentTerm.id == term_id).first()
    if not t:
        raise HTTPException(404, "Termin tidak ditemukan")
    db.delete(t)
    db.commit()
    log_audit(db, current_user, "delete", "payment_term", term_id, request=request, commit=True)
    return {"success": True}


# Documents

@router.post("/{term_id}/documents", response_model=dict)
async def upload_term_document(
    term_id: str,
    file: UploadFile = File(...),
    doc_type: str = Form("invoice"),
    caption: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("payment.update")),
):
    t = db.query(PaymentTerm).filter(PaymentTerm.id == term_id).first()
    if not t:
        raise HTTPException(404, "Termin tidak ditemukan")
    rel, _ = save_upload(file, "payments")
    doc = PaymentTermDocument(
        term_id=t.id,
        doc_type=doc_type,
        file_path=rel,
        caption=caption,
        uploaded_by=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {"id": str(doc.id), "file_path": rel, "success": True}


@router.delete("/{term_id}/documents/{doc_id}", response_model=dict)
def delete_term_document(
    term_id: str, doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("payment.update")),
):
    d = db.query(PaymentTermDocument).filter(
        PaymentTermDocument.id == doc_id, PaymentTermDocument.term_id == term_id,
    ).first()
    if not d:
        raise HTTPException(404, "Dokumen tidak ditemukan")
    delete_file(d.file_path)
    db.delete(d)
    db.commit()
    return {"success": True}
