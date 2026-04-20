from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.models.models import (
    NotificationRule, NotificationQueue, EarlyWarning, User,
    NotificationChannel, NotificationStatus,
)
from app.schemas.schemas import (
    NotificationRuleCreate, NotificationRuleUpdate, NotificationRuleOut,
)
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import log_audit
from app.services.notification_service import (
    process_notification_queue, enqueue_notification, run_all_scheduled_checks,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ═══════════════════════════════════════════ RULES ═══════════════════════════

@router.get("/rules", response_model=List[NotificationRuleOut])
def list_rules(
    db: Session = Depends(get_db),
    _=Depends(require_permission("notification.read")),
):
    return db.query(NotificationRule).order_by(NotificationRule.code).all()


@router.post("/rules", response_model=dict)
def create_rule(
    data: NotificationRuleCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notification.manage")),
):
    if db.query(NotificationRule).filter(NotificationRule.code == data.code).first():
        raise HTTPException(400, "Kode rule sudah dipakai")
    r = NotificationRule(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    log_audit(db, current_user, "create", "notification_rule", str(r.id), request=request, commit=True)
    return {"id": str(r.id), "success": True}


@router.put("/rules/{rule_id}", response_model=dict)
def update_rule(
    rule_id: str, data: NotificationRuleUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notification.manage")),
):
    r = db.query(NotificationRule).filter(NotificationRule.id == rule_id).first()
    if not r:
        raise HTTPException(404, "Rule tidak ditemukan")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    db.commit()
    log_audit(db, current_user, "update", "notification_rule", str(r.id), request=request, commit=True)
    return {"success": True}


@router.delete("/rules/{rule_id}", response_model=dict)
def delete_rule(
    rule_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notification.manage")),
):
    r = db.query(NotificationRule).filter(NotificationRule.id == rule_id).first()
    if not r:
        raise HTTPException(404, "Rule tidak ditemukan")
    db.delete(r)
    db.commit()
    log_audit(db, current_user, "delete", "notification_rule", rule_id, request=request, commit=True)
    return {"success": True}


# ═══════════════════════════════════════════ QUEUE ═══════════════════════════

@router.get("/queue", response_model=dict)
def list_queue(
    status: Optional[NotificationStatus] = None,
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    _=Depends(require_permission("notification.read")),
):
    q = db.query(NotificationQueue)
    if status:
        q = q.filter(NotificationQueue.status == status)
    items = q.order_by(NotificationQueue.created_at.desc()).limit(limit).all()
    return {
        "items": [
            {
                "id": str(i.id),
                "channel": i.channel.value if hasattr(i.channel, "value") else i.channel,
                "recipient_address": i.recipient_address,
                "subject": i.subject,
                "message": i.message,
                "status": i.status.value if hasattr(i.status, "value") else i.status,
                "attempts": i.attempts,
                "error_message": i.error_message,
                "scheduled_at": i.scheduled_at.isoformat() if i.scheduled_at else None,
                "sent_at": i.sent_at.isoformat() if i.sent_at else None,
                "created_at": i.created_at.isoformat(),
            }
            for i in items
        ]
    }


@router.post("/process", response_model=dict)
def process_queue(
    db: Session = Depends(get_db),
    _=Depends(require_permission("notification.manage")),
):
    count = process_notification_queue(db)
    return {"sent": count}


@router.post("/run-checks", response_model=dict)
def run_checks(
    db: Session = Depends(get_db),
    _=Depends(require_permission("notification.manage")),
):
    run_all_scheduled_checks(db)
    return {"success": True, "ran_at": datetime.utcnow().isoformat()}


@router.post("/test-send", response_model=dict)
def test_send(
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(require_permission("notification.manage")),
):
    """Body: {phone, message}. Enqueues immediately."""
    phone = body.get("phone")
    message = body.get("message", "Test pesan dari KNMP Monitor")
    if not phone:
        raise HTTPException(400, "phone wajib diisi")
    entry = enqueue_notification(
        db, None, NotificationChannel.WHATSAPP, None, phone, message, {"test": True},
    )
    db.commit()
    process_notification_queue(db)
    return {"id": str(entry.id), "success": True}


# ═══════════════════════════════════════════ EARLY WARNING ═══════════════════

@router.get("/warnings", response_model=dict)
def list_warnings(
    resolved: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.read")),
):
    from app.models.models import Contract
    q = db.query(EarlyWarning).join(Contract, Contract.id == EarlyWarning.contract_id)
    if resolved is not None:
        q = q.filter(EarlyWarning.is_resolved == resolved)
    rows = q.order_by(EarlyWarning.created_at.desc()).all()
    items = []
    for w in rows:
        c = db.query(Contract).filter(Contract.id == w.contract_id).first()
        items.append({
            "id": str(w.id),
            "contract_id": str(w.contract_id),
            "contract_number": c.contract_number if c else "",
            "contract_name": c.contract_name if c else "",
            "warning_type": w.warning_type,
            "severity": w.severity,
            "message": w.message,
            "parameter_name": w.parameter_name,
            "parameter_value": float(w.parameter_value) if w.parameter_value else None,
            "threshold_value": float(w.threshold_value) if w.threshold_value else None,
            "is_resolved": w.is_resolved,
            "resolved_at": w.resolved_at.isoformat() if w.resolved_at else None,
            "created_at": w.created_at.isoformat(),
        })
    return {"items": items}


@router.post("/warnings/{warning_id}/resolve", response_model=dict)
def resolve_warning(
    warning_id: str, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("contract.update")),
):
    w = db.query(EarlyWarning).filter(EarlyWarning.id == warning_id).first()
    if not w:
        raise HTTPException(404, "Warning tidak ditemukan")
    w.is_resolved = True
    w.resolved_at = datetime.utcnow()
    w.resolved_by = current_user.id
    db.commit()
    log_audit(db, current_user, "resolve", "early_warning", str(w.id), request=request, commit=True)
    return {"success": True}
