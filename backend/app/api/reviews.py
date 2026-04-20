from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import (
    FieldReview, FieldReviewFinding, FieldReviewPhoto, Contract, User,
)
from app.schemas.schemas import (
    FieldReviewCreate, FieldReviewUpdate, FindingCreate, FindingUpdate,
)
from app.api.deps import get_current_user, require_permission, user_can_access_contract
from app.services.audit_service import log_audit
from app.services.file_service import save_upload, delete_file, ALLOWED_IMAGE_EXT

router = APIRouter(prefix="/reviews", tags=["field_reviews"])


def _finding_to_dict(f: FieldReviewFinding) -> dict:
    return {
        "id": str(f.id),
        "review_id": str(f.review_id),
        "finding_number": f.finding_number,
        "title": f.title,
        "description": f.description,
        "severity": f.severity.value if hasattr(f.severity, "value") else f.severity,
        "status": f.status.value if hasattr(f.status, "value") else f.status,
        "recommendation": f.recommendation,
        "response": f.response,
        "response_date": f.response_date.isoformat() if f.response_date else None,
        "due_date": f.due_date.isoformat() if f.due_date else None,
        "closed_date": f.closed_date.isoformat() if f.closed_date else None,
        "photos": [
            {
                "id": str(p.id),
                "file_path": p.file_path,
                "thumbnail_path": p.thumbnail_path,
                "caption": p.caption,
            }
            for p in f.photos
        ],
    }


def _review_to_dict(r: FieldReview, detail=False) -> dict:
    d = {
        "id": str(r.id),
        "contract_id": str(r.contract_id),
        "location_id": str(r.location_id) if r.location_id else None,
        "review_number": r.review_number,
        "review_date": r.review_date.isoformat(),
        "reviewer_name": r.reviewer_name,
        "reviewer_institution": r.reviewer_institution,
        "status": r.status.value if hasattr(r.status, "value") else r.status,
        "summary": r.summary,
        "recommendations": r.recommendations,
        "created_at": r.created_at.isoformat(),
    }
    if detail:
        d["findings"] = [_finding_to_dict(f) for f in r.findings]
    return d


# ═══════════════════════════════════════════ REVIEWS ═════════════════════════

@router.get("/by-contract/{contract_id}", response_model=dict)
def list_reviews(
    contract_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("review.read")),
):
    rows = db.query(FieldReview).filter(FieldReview.contract_id == contract_id).order_by(FieldReview.review_date.desc()).all()
    return {"items": [_review_to_dict(r) for r in rows]}


@router.get("/{review_id}", response_model=dict)
def get_review(
    review_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission("review.read")),
):
    r = db.query(FieldReview).filter(FieldReview.id == review_id).first()
    if not r:
        raise HTTPException(404, "Review tidak ditemukan")
    return _review_to_dict(r, detail=True)


@router.post("", response_model=dict)
def create_review(
    data: FieldReviewCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("review.create")),
):
    if not db.query(Contract).filter(Contract.id == data.contract_id).first():
        raise HTTPException(404, "Kontrak tidak ditemukan")
    r = FieldReview(created_by=current_user.id, **data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    log_audit(db, current_user, "create", "field_review", str(r.id), request=request, commit=True)
    return {"id": str(r.id), "success": True}


@router.put("/{review_id}", response_model=dict)
def update_review(
    review_id: str, data: FieldReviewUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("review.update")),
):
    r = db.query(FieldReview).filter(FieldReview.id == review_id).first()
    if not r:
        raise HTTPException(404, "Review tidak ditemukan")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    db.commit()
    log_audit(db, current_user, "update", "field_review", str(r.id), request=request, commit=True)
    return {"success": True}


@router.delete("/{review_id}", response_model=dict)
def delete_review(
    review_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("review.delete")),
):
    r = db.query(FieldReview).filter(FieldReview.id == review_id).first()
    if not r:
        raise HTTPException(404, "Review tidak ditemukan")
    db.delete(r)
    db.commit()
    log_audit(db, current_user, "delete", "field_review", review_id, request=request, commit=True)
    return {"success": True}


# ═══════════════════════════════════════════ FINDINGS ════════════════════════

@router.post("/{review_id}/findings", response_model=dict)
def create_finding(
    review_id: str, data: FindingCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("review.update")),
):
    if not db.query(FieldReview).filter(FieldReview.id == review_id).first():
        raise HTTPException(404, "Review tidak ditemukan")
    next_num = data.finding_number
    if not next_num:
        next_num = db.query(FieldReviewFinding).filter(
            FieldReviewFinding.review_id == review_id
        ).count() + 1
    f = FieldReviewFinding(
        review_id=review_id,
        finding_number=next_num,
        title=data.title,
        description=data.description,
        severity=data.severity,
        recommendation=data.recommendation,
        due_date=data.due_date,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    log_audit(db, current_user, "create", "finding", str(f.id), request=request, commit=True)
    return {"id": str(f.id), "success": True}


@router.put("/findings/{finding_id}", response_model=dict)
def update_finding(
    finding_id: str, data: FindingUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("review.update")),
):
    f = db.query(FieldReviewFinding).filter(FieldReviewFinding.id == finding_id).first()
    if not f:
        raise HTTPException(404, "Temuan tidak ditemukan")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    db.commit()
    log_audit(db, current_user, "update", "finding", str(f.id), request=request, commit=True)
    return {"success": True}


@router.delete("/findings/{finding_id}", response_model=dict)
def delete_finding(
    finding_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("review.update")),
):
    f = db.query(FieldReviewFinding).filter(FieldReviewFinding.id == finding_id).first()
    if not f:
        raise HTTPException(404, "Temuan tidak ditemukan")
    db.delete(f)
    db.commit()
    log_audit(db, current_user, "delete", "finding", finding_id, request=request, commit=True)
    return {"success": True}


@router.post("/findings/{finding_id}/photos", response_model=dict)
async def upload_finding_photo(
    finding_id: str,
    file: UploadFile = File(...),
    caption: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("review.update")),
):
    f = db.query(FieldReviewFinding).filter(FieldReviewFinding.id == finding_id).first()
    if not f:
        raise HTTPException(404, "Temuan tidak ditemukan")
    rel, thumb = save_upload(file, "review", ALLOWED_IMAGE_EXT)
    p = FieldReviewPhoto(
        finding_id=f.id, file_path=rel, thumbnail_path=thumb, caption=caption,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": str(p.id), "file_path": rel, "thumbnail_path": thumb}


@router.delete("/findings/{finding_id}/photos/{photo_id}", response_model=dict)
def delete_finding_photo(
    finding_id: str, photo_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission("review.update")),
):
    p = db.query(FieldReviewPhoto).filter(
        FieldReviewPhoto.id == photo_id, FieldReviewPhoto.finding_id == finding_id
    ).first()
    if not p:
        raise HTTPException(404, "Foto tidak ditemukan")
    delete_file(p.file_path)
    delete_file(p.thumbnail_path)
    db.delete(p)
    db.commit()
    return {"success": True}
