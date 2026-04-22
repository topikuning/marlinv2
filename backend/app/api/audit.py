"""
Audit Log API — read-only listing dari audit_logs.

Audit log ditulis oleh services/audit_service.log_audit di banyak endpoint
(create/update/delete kontrak, unlock mode, approve revisi BOQ, login, dll).
Endpoint ini memberi UI cara browse + filter history-nya.

Hanya superadmin & admin_pusat yang bisa akses (tipikal: audit adalah
tool untuk admin/itjen, bukan user operasional).
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import AuditLog, User
from app.api.deps import get_current_user, get_user_role_code


router = APIRouter(prefix="/audit", tags=["audit"])


_ALLOWED_ROLES = {"superadmin", "admin_pusat", "itjen"}


@router.get("/logs", response_model=dict)
def list_logs(
    q: Optional[str] = Query(None, description="Cari di entity_id atau nama user"),
    action: Optional[str] = Query(None, description="Filter action exact (create/update/delete/login/unlock/lock/approve/…)"),
    entity_type: Optional[str] = Query(None, description="Filter entity_type (contract/boq_item/user/…)"),
    user_id: Optional[str] = None,
    date_from: Optional[str] = Query(None, description="ISO datetime atau YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="ISO datetime atau YYYY-MM-DD"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if get_user_role_code(db, current_user) not in _ALLOWED_ROLES:
        raise HTTPException(403, "Hanya superadmin / admin pusat / itjen yang bisa melihat audit log.")

    query = db.query(AuditLog, User).outerjoin(User, User.id == AuditLog.user_id)

    if action:
        query = query.filter(AuditLog.action == action)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(AuditLog.entity_id.ilike(like), User.full_name.ilike(like), User.email.ilike(like)))
    if date_from:
        try:
            df = datetime.fromisoformat(date_from)
        except ValueError:
            df = datetime.strptime(date_from, "%Y-%m-%d")
        query = query.filter(AuditLog.created_at >= df)
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
        except ValueError:
            dt = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
        query = query.filter(AuditLog.created_at < dt)

    total = query.count()
    rows = (
        query.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = [
        {
            "id": str(a.id),
            "created_at": a.created_at.isoformat() + "Z" if a.created_at else None,
            "user_id": str(a.user_id) if a.user_id else None,
            "user_name": u.full_name if u else None,
            "user_email": u.email if u else None,
            "action": a.action,
            "entity_type": a.entity_type,
            "entity_id": a.entity_id,
            "changes": a.changes,
            "ip_address": a.ip_address,
            "user_agent": a.user_agent,
        }
        for a, u in rows
    ]
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/facets", response_model=dict)
def list_facets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Daftar action & entity_type unik untuk bantu bangun dropdown filter."""
    if get_user_role_code(db, current_user) not in _ALLOWED_ROLES:
        raise HTTPException(403, "Akses ditolak")
    actions = [r[0] for r in db.query(AuditLog.action).distinct().order_by(AuditLog.action).all() if r[0]]
    entity_types = [r[0] for r in db.query(AuditLog.entity_type).distinct().order_by(AuditLog.entity_type).all() if r[0]]
    return {"actions": actions, "entity_types": entity_types}
