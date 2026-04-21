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

@router.get("/roles", response_model=List[dict])
def list_roles(db: Session = Depends(get_db), _=Depends(require_permission("role.read"))):
    """
    Return roles with live permission_count, menu_count, user_count so the
    UI card shows real numbers instead of always showing 0.
    Previously used response_model=List[RoleOut] which stripped the counts.
    """
    from sqlalchemy import func
    roles = db.query(Role).order_by(Role.code).all()
    result = []
    for role in roles:
        perm_count = (
            db.query(func.count(RolePermission.permission_id))
            .filter(RolePermission.role_id == role.id)
            .scalar() or 0
        )
        menu_count = (
            db.query(func.count(RoleMenu.menu_id))
            .filter(RoleMenu.role_id == role.id)
            .scalar() or 0
        )
        user_count = (
            db.query(func.count(User.id))
            .filter(User.role_id == role.id, User.deleted_at.is_(None))
            .scalar() or 0
        )
        result.append({
            "id": str(role.id),
            "code": role.code,
            "name": role.name,
            "description": role.description,
            "is_system": role.is_system,
            "is_active": role.is_active,
            "permission_count": perm_count,
            "menu_count": menu_count,
            "user_count": user_count,
        })
    return result


@router.get("/roles/{role_id}", response_model=dict)
def get_role_detail(role_id: str, db: Session = Depends(get_db), _=Depends(require_permission("role.read"))):
    """
    Return role with BOTH permission/menu UUIDs (for checkbox binding in UI)
    AND codes (for human readability). Previously only returned codes which
    caused the frontend normalizeInitial() to find no matching field and
    silently initialize empty arrays — breaking the checkbox matrix.
    """
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role tidak ditemukan")

    perms = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role.id)
        .all()
    )
    menus = (
        db.query(MenuItem)
        .join(RoleMenu, RoleMenu.menu_id == MenuItem.id)
        .filter(RoleMenu.role_id == role.id)
        .all()
    )
    return {
        "id": str(role.id),
        "code": role.code,
        "name": role.name,
        "description": role.description,
        "is_system": role.is_system,
        "is_active": role.is_active,
        # UUID arrays — consumed by frontend checkbox binding
        "permission_ids": [str(p.id) for p in perms],
        "menu_ids": [str(m.id) for m in menus],
        # Object arrays — consumed by normalizeInitial() fallback
        "permissions": [{"id": str(p.id), "code": p.code, "module": p.module, "action": p.action} for p in perms],
        "menus": [{"id": str(m.id), "code": m.code, "label": m.label} for m in menus],
    }


@router.post("/roles", response_model=dict)
def create_role(
    data: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("role.create")),
):
    code = (data.get("code") or "").strip()
    name = (data.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(400, "Field 'code' dan 'name' wajib diisi")
    if db.query(Role).filter(Role.code == code).first():
        raise HTTPException(400, "Kode role sudah dipakai")

    role = Role(
        code=code,
        name=name,
        description=data.get("description"),
    )
    db.add(role)
    db.flush()

    # Accept both permission_ids (UUID) and permission_codes (string)
    perm_ids_raw = data.get("permission_ids")
    perm_codes   = data.get("permission_codes", [])
    if perm_ids_raw:
        for pid in perm_ids_raw:
            perm = db.query(Permission).filter(Permission.id == str(pid)).first()
            if perm:
                db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    else:
        for p_code in perm_codes:
            perm = db.query(Permission).filter(Permission.code == p_code).first()
            if perm:
                db.add(RolePermission(role_id=role.id, permission_id=perm.id))

    menu_ids_raw = data.get("menu_ids")
    menu_codes   = data.get("menu_codes", [])
    if menu_ids_raw:
        for mid in menu_ids_raw:
            menu = db.query(MenuItem).filter(MenuItem.id == str(mid)).first()
            if menu:
                db.add(RoleMenu(role_id=role.id, menu_id=menu.id))
    else:
        for m_code in menu_codes:
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
    data: dict,  # accept raw dict so we can handle both id and code variants
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("role.update")),
):
    """
    Update a role's metadata, permissions, and menu access.

    Accepts two equivalent payload shapes (frontend may send either):
      { permission_ids: [uuid, ...], menu_ids: [uuid, ...] }   ← new UI shape
      { permission_codes: [str, ...], menu_codes: [str, ...] } ← legacy shape

    Both are handled transparently.
    """
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role tidak ditemukan")
    if role.is_system and data.get("is_active") is False:
        raise HTTPException(400, "Role sistem tidak bisa dinonaktifkan")

    # Metadata
    if data.get("name") is not None:
        role.name = data["name"]
    if data.get("description") is not None:
        role.description = data["description"]
    if data.get("is_active") is not None:
        role.is_active = data["is_active"]

    # ── Permissions ──────────────────────────────────────────────────────────
    # Accept either permission_ids (UUIDs from the new UI) or permission_codes
    # (strings from the old API). If both present, permission_ids wins.
    perm_ids_raw = data.get("permission_ids")   # list of UUID strings
    perm_codes   = data.get("permission_codes")  # list of "module.action" strings

    if perm_ids_raw is not None or perm_codes is not None:
        db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()

        if perm_ids_raw is not None:
            for pid in perm_ids_raw:
                perm = db.query(Permission).filter(Permission.id == str(pid)).first()
                if perm:
                    db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        elif perm_codes is not None:
            for code in perm_codes:
                perm = db.query(Permission).filter(Permission.code == code).first()
                if perm:
                    db.add(RolePermission(role_id=role.id, permission_id=perm.id))

    # ── Menus ─────────────────────────────────────────────────────────────────
    menu_ids_raw = data.get("menu_ids")    # list of UUID strings
    menu_codes   = data.get("menu_codes")  # list of menu code strings

    if menu_ids_raw is not None or menu_codes is not None:
        db.query(RoleMenu).filter(RoleMenu.role_id == role.id).delete()

        if menu_ids_raw is not None:
            for mid in menu_ids_raw:
                menu = db.query(MenuItem).filter(MenuItem.id == str(mid)).first()
                if menu:
                    db.add(RoleMenu(role_id=role.id, menu_id=menu.id))
        elif menu_codes is not None:
            for code in menu_codes:
                menu = db.query(MenuItem).filter(MenuItem.code == code).first()
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
