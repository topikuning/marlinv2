"""Audit log writer."""
from typing import Optional, Any
from sqlalchemy.orm import Session
from fastapi import Request
from app.models.models import AuditLog, User
import json


def _json_safe(obj: Any) -> Any:
    """Best-effort JSON serialization helper."""
    if obj is None:
        return None
    try:
        return json.loads(json.dumps(obj, default=str))
    except Exception:
        return str(obj)


def log_audit(
    db: Session,
    user: Optional[User],
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    changes: Optional[dict] = None,
    request: Optional[Request] = None,
    commit: bool = False,
):
    entry = AuditLog(
        user_id=user.id if user else None,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id else None,
        changes=_json_safe(changes) if changes else None,
        ip_address=(request.client.host if request and request.client else None),
        user_agent=(request.headers.get("user-agent") if request else None),
    )
    db.add(entry)
    if commit:
        db.commit()
