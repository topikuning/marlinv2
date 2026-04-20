from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    verify_password, get_password_hash, create_access_token,
    create_refresh_token, decode_token,
)
from app.models.models import User, Role
from app.schemas.schemas import (
    LoginRequest, Token, RefreshRequest, ChangePasswordRequest,
    UserOut, RoleOut,
)
from app.api.deps import get_current_user, get_user_permission_codes
from app.services.audit_service import log_audit

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_dict(db: Session, user: User):
    role = db.query(Role).filter(Role.id == user.role_id).first()
    perms = list(get_user_permission_codes(db, user))
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": {"id": str(role.id), "code": role.code, "name": role.name} if role else None,
        "phone": user.phone,
        "whatsapp_number": user.whatsapp_number,
        "permissions": perms,
        "assigned_contract_ids": [str(c) for c in (user.assigned_contract_ids or [])],
    }


@router.post("/login", response_model=Token)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.email == req.email, User.deleted_at.is_(None)
    ).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User dinonaktifkan")

    user.last_login_at = datetime.utcnow()
    db.commit()

    access = create_access_token({"sub": str(user.id)})
    refresh = create_refresh_token({"sub": str(user.id)})
    log_audit(db, user, "login", "user", str(user.id), request=request, commit=True)
    return Token(access_token=access, refresh_token=refresh, user=_user_dict(db, user))


@router.post("/refresh", response_model=Token)
def refresh(req: RefreshRequest, db: Session = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Refresh token tidak valid")
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User tidak ditemukan")
    access = create_access_token({"sub": str(user.id)})
    refresh_new = create_refresh_token({"sub": str(user.id)})
    return Token(access_token=access, refresh_token=refresh_new, user=_user_dict(db, user))


@router.get("/me")
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _user_dict(db, current_user)


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(req.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Password saat ini salah")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password baru minimal 8 karakter")
    current_user.hashed_password = get_password_hash(req.new_password)
    db.commit()
    log_audit(db, current_user, "change_password", "user", str(current_user.id), request=request, commit=True)
    return {"success": True}
