from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.models import Role, Permission, RolePermission, MenuItem, RoleMenu, User
from app.schemas.schemas import (
    RoleCreate, RoleUpdate, RoleOut, PermissionOut, MenuOut,
)
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import log_audit

router = APIRouter(prefix="/rbac", tags=["rbac"])


# ─── Permissions (read-only list) ────────────────────────────────────────────

@router.get("/permissions", response_model=List[PermissionOut])
def list_permissions(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Permission).order_by(Permission.module, Permission.action).all()


# ─── Menus ───────────────────────────────────────────────────────────────────

@router.get("/menus", response_model=List[MenuOut])
def list_menus(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(MenuItem).filter(MenuItem.is_active == True).order_by(MenuItem.order_index).all()


@router.get("/my-menus", response_model=List[MenuOut])
def list_my_menus(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    role = db.query(Role).filter(Role.id == current_user.role_id).first()
    if not role:
        return []
    if role.code == "superadmin":
        return db.query(MenuItem).filter(MenuItem.is_active == True).order_by(MenuItem.order_index).all()
    menu_ids = [rm.menu_id for rm in db.query(RoleMenu).filter(RoleMenu.role_id == role.id).all()]
    return (
        db.query(MenuItem)
        .filter(MenuItem.id.in_(menu_ids), MenuItem.is_active == True)
        .order_by(MenuItem.order_index)
        .all()
    )


# ─── Roles CRUD ──────────────────────────────────────────────────────────────

@router.get("/roles", response_model=List[RoleOut])
def list_roles(db: Session = Depends(get_db), _=Depends(require_permission("role.read"))):
    return db.query(Role).order_by(Role.code).all()


@router.get("/roles/{role_id}", response_model=dict)
def get_role_detail(role_id: str, db: Session = Depends(get_db), _=Depends(require_permission("role.read"))):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role tidak ditemukan")
    perm_codes = [
        p.code for p in db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role.id).all()
    ]
    menu_codes = [
        m.code for m in db.query(MenuItem)
        .join(RoleMenu, RoleMenu.menu_id == MenuItem.id)
        .filter(RoleMenu.role_id == role.id).all()
    ]
    return {
        "id": str(role.id),
        "code": role.code,
        "name": role.name,
        "description": role.description,
        "is_system": role.is_system,
        "is_active": role.is_active,
        "permission_codes": perm_codes,
        "menu_codes": menu_codes,
    }


@router.post("/roles", response_model=dict)
def create_role(
    data: RoleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("role.create")),
):
    if db.query(Role).filter(Role.code == data.code).first():
        raise HTTPException(400, "Kode role sudah dipakai")
    role = Role(code=data.code, name=data.name, description=data.description)
    db.add(role)
    db.flush()

    for p_code in data.permission_codes:
        perm = db.query(Permission).filter(Permission.code == p_code).first()
        if perm:
            db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    for m_code in data.menu_codes:
        menu = db.query(MenuItem).filter(MenuItem.code == m_code).first()
        if menu:
            db.add(RoleMenu(role_id=role.id, menu_id=menu.id))

    db.commit()
    log_audit(db, current_user, "create", "role", str(role.id),
              changes={"code": role.code}, request=request, commit=True)
    return {"id": str(role.id), "success": True}


@router.put("/roles/{role_id}", response_model=dict)
def update_role(
    role_id: str,
    data: RoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("role.update")),
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role tidak ditemukan")
    if role.is_system and data.is_active is False:
        raise HTTPException(400, "Role sistem tidak bisa dinonaktifkan")

    if data.name is not None:
        role.name = data.name
    if data.description is not None:
        role.description = data.description
    if data.is_active is not None:
        role.is_active = data.is_active

    if data.permission_codes is not None:
        db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()
        for p_code in data.permission_codes:
            perm = db.query(Permission).filter(Permission.code == p_code).first()
            if perm:
                db.add(RolePermission(role_id=role.id, permission_id=perm.id))

    if data.menu_codes is not None:
        db.query(RoleMenu).filter(RoleMenu.role_id == role.id).delete()
        for m_code in data.menu_codes:
            menu = db.query(MenuItem).filter(MenuItem.code == m_code).first()
            if menu:
                db.add(RoleMenu(role_id=role.id, menu_id=menu.id))

    db.commit()
    log_audit(db, current_user, "update", "role", str(role.id), request=request, commit=True)
    return {"success": True}


@router.delete("/roles/{role_id}", response_model=dict)
def delete_role(
    role_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("role.delete")),
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role tidak ditemukan")
    if role.is_system:
        raise HTTPException(400, "Role sistem tidak bisa dihapus")
    if db.query(User).filter(User.role_id == role.id, User.deleted_at.is_(None)).count() > 0:
        raise HTTPException(400, "Role masih dipakai oleh user aktif")
    db.delete(role)
    db.commit()
    log_audit(db, current_user, "delete", "role", str(role_id), request=request, commit=True)
    return {"success": True}
