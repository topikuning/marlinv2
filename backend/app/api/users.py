from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_password_hash
from app.models.models import User, Role
from app.schemas.schemas import UserCreate, UserUpdate, UserOut
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import log_audit

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=dict)
def list_users(
    q: Optional[str] = None,
    role_code: Optional[str] = None,
    is_active: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    _=Depends(require_permission("user.read")),
):
    query = db.query(User).filter(User.deleted_at.is_(None))
    if q:
        query = query.filter(or_(
            User.full_name.ilike(f"%{q}%"),
            User.email.ilike(f"%{q}%"),
            User.username.ilike(f"%{q}%"),
        ))
    if role_code:
        query = query.join(Role).filter(Role.code == role_code)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)

    total = query.count()
    users = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for u in users:
        role = db.query(Role).filter(Role.id == u.role_id).first()
        items.append({
            "id": str(u.id),
            "email": u.email,
            "username": u.username,
            "full_name": u.full_name,
            "phone": u.phone,
            "whatsapp_number": u.whatsapp_number,
            "role_id": str(u.role_id),
            "role_code": role.code if role else None,
            "role_name": role.name if role else None,
            "assigned_contract_ids": [str(c) for c in (u.assigned_contract_ids or [])],
            "is_active": u.is_active,
            "last_login_at": u.last_login_at,
            "created_at": u.created_at,
        })
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.post("", response_model=dict)
def create_user(
    data: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user.create")),
):
    if db.query(User).filter(User.email == data.email, User.deleted_at.is_(None)).first():
        raise HTTPException(400, "Email sudah terdaftar")
    role = db.query(Role).filter(Role.code == data.role_code).first()
    if not role:
        raise HTTPException(400, f"Role '{data.role_code}' tidak ditemukan")

    user = User(
        email=data.email,
        username=data.username,
        full_name=data.full_name,
        hashed_password=get_password_hash(data.password),
        role_id=role.id,
        phone=data.phone,
        whatsapp_number=data.whatsapp_number,
        assigned_contract_ids=[str(c) for c in data.assigned_contract_ids],
        created_by=current_user.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_audit(db, current_user, "create", "user", str(user.id),
              changes={"email": user.email, "role": role.code}, request=request, commit=True)
    return {"id": str(user.id), "success": True}


@router.get("/{user_id}", response_model=dict)
def get_user(user_id: str, db: Session = Depends(get_db), _=Depends(require_permission("user.read"))):
    u = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not u:
        raise HTTPException(404, "User tidak ditemukan")
    role = db.query(Role).filter(Role.id == u.role_id).first()
    return {
        "id": str(u.id),
        "email": u.email,
        "username": u.username,
        "full_name": u.full_name,
        "phone": u.phone,
        "whatsapp_number": u.whatsapp_number,
        "role_id": str(u.role_id),
        "role_code": role.code if role else None,
        "assigned_contract_ids": [str(c) for c in (u.assigned_contract_ids or [])],
        "is_active": u.is_active,
    }


@router.put("/{user_id}", response_model=dict)
def update_user(
    user_id: str,
    data: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user.update")),
):
    u = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not u:
        raise HTTPException(404, "User tidak ditemukan")

    before = {"full_name": u.full_name, "role_id": str(u.role_id), "is_active": u.is_active}

    if data.role_code:
        role = db.query(Role).filter(Role.code == data.role_code).first()
        if not role:
            raise HTTPException(400, "Role tidak ditemukan")
        u.role_id = role.id
    for field in ("full_name", "username", "phone", "whatsapp_number", "is_active"):
        val = getattr(data, field, None)
        if val is not None:
            setattr(u, field, val)
    if data.assigned_contract_ids is not None:
        u.assigned_contract_ids = [str(c) for c in data.assigned_contract_ids]

    db.commit()
    log_audit(db, current_user, "update", "user", str(u.id),
              changes={"before": before}, request=request, commit=True)
    return {"success": True}


@router.post("/{user_id}/reset-password", response_model=dict)
def reset_password(
    user_id: str,
    body: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user.update")),
):
    new_password = body.get("new_password", "")
    if len(new_password) < 8:
        raise HTTPException(400, "Password minimal 8 karakter")
    u = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not u:
        raise HTTPException(404, "User tidak ditemukan")
    u.hashed_password = get_password_hash(new_password)
    db.commit()
    log_audit(db, current_user, "reset_password", "user", str(u.id), request=request, commit=True)
    return {"success": True}


@router.delete("/{user_id}", response_model=dict)
def delete_user(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user.delete")),
):
    if str(current_user.id) == str(user_id):
        raise HTTPException(400, "Tidak bisa menghapus akun sendiri")
    u = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not u:
        raise HTTPException(404, "User tidak ditemukan")
    u.deleted_at = datetime.utcnow()
    u.is_active = False
    db.commit()
    log_audit(db, current_user, "delete", "user", str(u.id), request=request, commit=True)
    return {"success": True}
