"""Auth / permission dependencies."""
from typing import List, Optional
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import decode_token
from app.models.models import User, Role, RolePermission, Permission

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak tersedia",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak valid",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User tidak aktif")
    return user


def get_user_permission_codes(db: Session, user: User) -> set:
    if not user.role_id:
        return set()
    rows = (
        db.query(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == user.role_id)
        .all()
    )
    return {r[0] for r in rows}


def require_permission(*permission_codes: str):
    """Require user's role to have ALL specified permissions (superadmin bypass)."""
    def checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        role = db.query(Role).filter(Role.id == current_user.role_id).first()
        if role and role.code == "superadmin":
            return current_user
        user_perms = get_user_permission_codes(db, current_user)
        missing = [p for p in permission_codes if p not in user_perms]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Butuh permission: {', '.join(missing)}",
            )
        return current_user
    return checker


def require_roles(*role_codes: str):
    def checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        role = db.query(Role).filter(Role.id == current_user.role_id).first()
        if not role or role.code not in role_codes:
            raise HTTPException(status_code=403, detail="Akses tidak diizinkan untuk role Anda")
        return current_user
    return checker


def get_user_role_code(db: Session, user: User) -> Optional[str]:
    role = db.query(Role).filter(Role.id == user.role_id).first()
    return role.code if role else None


def user_can_access_contract(db: Session, user: User, contract_id: str) -> bool:
    """
    Decide whether the given user can read a specific contract.

    Access matrix — must stay in lockstep with list_contracts filtering,
    otherwise the UI shows the list-vs-detail paradox (user sees contract
    in list but gets 403 on detail).

      Role                 → Scope
      ──────────────────────────────────────────────────────────────
      superadmin           → all contracts
      admin_pusat          → all contracts
      itjen                → all contracts (read-only inspectorate)
      viewer               → all contracts (read-only)
      manager              → all contracts (supervisor across satker)
      ppk                  → must be in assigned_contract_ids
      konsultan            → must be in assigned_contract_ids
      kontraktor           → must be in assigned_contract_ids
      (unknown role)       → deny
    """
    role_code = get_user_role_code(db, user)
    if role_code in ("superadmin", "admin_pusat", "itjen", "viewer", "manager"):
        return True
    if role_code in ("ppk", "konsultan", "kontraktor"):
        assigned = [str(c) for c in (user.assigned_contract_ids or [])]
        return str(contract_id) in assigned
    return False


def filter_contracts_for_user(query, user: User):
    """
    Reduce a Contract query so it only returns contracts the user may see.
    Selaras dengan user_can_access_contract — admin/manager/itjen/viewer
    lihat semua, role STRICT-scoped (ppk/konsultan/kontraktor) dibatasi
    assigned_contract_ids. Dipakai endpoint listing yang butuh filter
    massal (peta dashboard, dll).
    """
    from sqlalchemy import false
    from app.models.models import Contract

    role = user.role_obj
    role_code = role.code if role else None
    if role_code in ("superadmin", "admin_pusat", "itjen", "viewer", "manager"):
        return query
    if role_code in ("ppk", "konsultan", "kontraktor"):
        assigned = [str(c) for c in (user.assigned_contract_ids or [])]
        if not assigned:
            return query.filter(false())
        return query.filter(Contract.id.in_(assigned))
    return query.filter(false())
