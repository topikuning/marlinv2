from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List
from datetime import datetime

from app.core.database import get_db
from app.models.models import Company, PPK, MasterWorkCode, User
from app.schemas.schemas import (
    CompanyCreate, CompanyUpdate, CompanyOut,
    PPKCreate, PPKUpdate, PPKOut,
    MasterWorkCodeCreate, MasterWorkCodeOut,
)
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import log_audit

router = APIRouter(prefix="/master", tags=["master"])


# ═══════════════════════════════════════════ COMPANIES ═══════════════════════

@router.get("/companies", response_model=dict)
def list_companies(
    q: Optional[str] = None,
    is_active: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Company).filter(Company.deleted_at.is_(None))
    if q:
        query = query.filter(or_(Company.name.ilike(f"%{q}%"), Company.npwp.ilike(f"%{q}%")))
    if is_active is not None:
        query = query.filter(Company.is_active == is_active)
    total = query.count()
    items = query.order_by(Company.name).offset((page - 1) * page_size).limit(page_size).all()
    return {"total": total, "page": page, "page_size": page_size,
            "items": [CompanyOut.model_validate(i).model_dump(mode="json") for i in items]}


@router.post("/companies", response_model=dict)
def create_company(
    data: CompanyCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.create")),
):
    c = Company(**data.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    log_audit(db, current_user, "create", "company", str(c.id), request=request, commit=True)
    return {"id": str(c.id), "success": True}


@router.put("/companies/{company_id}", response_model=dict)
def update_company(
    company_id: str, data: CompanyUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.update")),
):
    c = db.query(Company).filter(Company.id == company_id, Company.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Perusahaan tidak ditemukan")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    log_audit(db, current_user, "update", "company", str(c.id), request=request, commit=True)
    return {"success": True}


@router.delete("/companies/{company_id}", response_model=dict)
def delete_company(
    company_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.delete")),
):
    c = db.query(Company).filter(Company.id == company_id, Company.deleted_at.is_(None)).first()
    if not c:
        raise HTTPException(404, "Perusahaan tidak ditemukan")
    c.deleted_at = datetime.utcnow()
    c.is_active = False
    db.commit()
    log_audit(db, current_user, "delete", "company", str(c.id), request=request, commit=True)
    return {"success": True}


# ═══════════════════════════════════════════ PPK ═════════════════════════════

@router.get("/ppk", response_model=dict)
def list_ppk(
    q: Optional[str] = None,
    is_active: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(PPK).filter(PPK.deleted_at.is_(None))
    if q:
        query = query.filter(or_(PPK.name.ilike(f"%{q}%"), PPK.nip.ilike(f"%{q}%"),
                                 PPK.satker.ilike(f"%{q}%")))
    if is_active is not None:
        query = query.filter(PPK.is_active == is_active)
    total = query.count()
    items = query.order_by(PPK.name).offset((page - 1) * page_size).limit(page_size).all()
    return {"total": total, "page": page, "page_size": page_size,
            "items": [PPKOut.model_validate(i).model_dump(mode="json") for i in items]}


@router.post("/ppk", response_model=dict)
def create_ppk(
    data: PPKCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.create")),
):
    p = PPK(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    log_audit(db, current_user, "create", "ppk", str(p.id), request=request, commit=True)
    return {"id": str(p.id), "success": True}


@router.put("/ppk/{ppk_id}", response_model=dict)
def update_ppk(
    ppk_id: str, data: PPKUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.update")),
):
    p = db.query(PPK).filter(PPK.id == ppk_id, PPK.deleted_at.is_(None)).first()
    if not p:
        raise HTTPException(404, "PPK tidak ditemukan")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    log_audit(db, current_user, "update", "ppk", str(p.id), request=request, commit=True)
    return {"success": True}


@router.delete("/ppk/{ppk_id}", response_model=dict)
def delete_ppk(
    ppk_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.delete")),
):
    p = db.query(PPK).filter(PPK.id == ppk_id, PPK.deleted_at.is_(None)).first()
    if not p:
        raise HTTPException(404, "PPK tidak ditemukan")
    p.deleted_at = datetime.utcnow()
    p.is_active = False
    db.commit()
    log_audit(db, current_user, "delete", "ppk", str(p.id), request=request, commit=True)
    return {"success": True}


# ═══════════════════════════════════════════ MASTER WORK CODES ═══════════════

@router.get("/work-codes", response_model=List[MasterWorkCodeOut])
def list_work_codes(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(MasterWorkCode).filter(MasterWorkCode.is_active == True)
    if category:
        q = q.filter(MasterWorkCode.category == category)
    return q.order_by(MasterWorkCode.category, MasterWorkCode.code).all()


@router.post("/work-codes", response_model=dict)
def create_work_code(
    data: MasterWorkCodeCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.create")),
):
    if db.query(MasterWorkCode).filter(MasterWorkCode.code == data.code).first():
        raise HTTPException(400, "Kode sudah ada")
    m = MasterWorkCode(**data.model_dump())
    db.add(m)
    db.commit()
    log_audit(db, current_user, "create", "master_work_code", data.code, request=request, commit=True)
    return {"code": data.code, "success": True}


@router.put("/work-codes/{code}", response_model=dict)
def update_work_code(
    code: str, data: dict, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.update")),
):
    m = db.query(MasterWorkCode).filter(MasterWorkCode.code == code).first()
    if not m:
        raise HTTPException(404, "Kode tidak ditemukan")
    for k, v in data.items():
        if hasattr(m, k) and k != "code":
            setattr(m, k, v)
    db.commit()
    log_audit(db, current_user, "update", "master_work_code", code, request=request, commit=True)
    return {"success": True}


@router.delete("/work-codes/{code}", response_model=dict)
def delete_work_code(
    code: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("master.delete")),
):
    m = db.query(MasterWorkCode).filter(MasterWorkCode.code == code).first()
    if not m:
        raise HTTPException(404, "Kode tidak ditemukan")
    m.is_active = False
    db.commit()
    log_audit(db, current_user, "delete", "master_work_code", code, request=request, commit=True)
    return {"success": True}
