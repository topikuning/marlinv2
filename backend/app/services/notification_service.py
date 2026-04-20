"""
WhatsApp + in-app notification queue.
Supports multiple providers — default Fonnte-style POST.
"""
import httpx
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.models import (
    NotificationQueue, NotificationRule, NotificationStatus, NotificationChannel,
    WhatsappLog, User, Contract, WeeklyReport, DailyReport, PaymentTerm,
    FieldReviewFinding, EarlyWarning, Role,
)


def render_template(template: str, context: Dict[str, Any]) -> str:
    """Simple {{key}} replacement."""
    out = template
    for k, v in context.items():
        out = out.replace("{{" + str(k) + "}}", str(v) if v is not None else "")
    return out


def enqueue_notification(
    db: Session,
    rule: Optional[NotificationRule],
    channel: NotificationChannel,
    recipient_user_id: Optional[str],
    recipient_address: str,
    message: str,
    context: Dict[str, Any],
    subject: Optional[str] = None,
    scheduled_at: Optional[datetime] = None,
) -> NotificationQueue:
    entry = NotificationQueue(
        rule_id=rule.id if rule else None,
        channel=channel,
        recipient_user_id=recipient_user_id,
        recipient_address=recipient_address,
        subject=subject,
        message=message,
        context=context,
        status=NotificationStatus.PENDING,
        scheduled_at=scheduled_at or datetime.utcnow(),
    )
    db.add(entry)
    return entry


def _send_whatsapp_fonnte(phone: str, message: str) -> Dict[str, Any]:
    if not settings.WA_API_TOKEN:
        return {"success": False, "status": 0, "body": "WA_API_TOKEN belum dikonfigurasi"}
    try:
        resp = httpx.post(
            settings.WA_API_URL,
            data={"target": phone, "message": message},
            headers={"Authorization": settings.WA_API_TOKEN},
            timeout=15.0,
        )
        return {"success": resp.status_code < 400, "status": resp.status_code, "body": resp.text}
    except Exception as e:
        return {"success": False, "status": 0, "body": str(e)}


def process_notification_queue(db: Session, limit: int = 50) -> int:
    """Process pending queue items. Returns count sent."""
    pending = (
        db.query(NotificationQueue)
        .filter(
            NotificationQueue.status == NotificationStatus.PENDING,
            NotificationQueue.scheduled_at <= datetime.utcnow(),
        )
        .limit(limit)
        .all()
    )
    sent_count = 0
    for item in pending:
        if not settings.WA_ENABLED and item.channel == NotificationChannel.WHATSAPP:
            item.status = NotificationStatus.SKIPPED
            item.error_message = "WhatsApp dinonaktifkan"
            continue

        if item.channel == NotificationChannel.WHATSAPP:
            result = _send_whatsapp_fonnte(item.recipient_address, item.message)
            db.add(WhatsappLog(
                queue_id=item.id,
                phone=item.recipient_address,
                message=item.message,
                provider=settings.WA_PROVIDER,
                response_status=result["status"],
                response_body=result["body"][:2000],
                success=result["success"],
            ))
            if result["success"]:
                item.status = NotificationStatus.SENT
                item.sent_at = datetime.utcnow()
                sent_count += 1
            else:
                item.attempts += 1
                item.error_message = result["body"][:1000]
                if item.attempts >= 3:
                    item.status = NotificationStatus.FAILED
        elif item.channel == NotificationChannel.IN_APP:
            item.status = NotificationStatus.SENT
            item.sent_at = datetime.utcnow()
            sent_count += 1
        else:
            item.status = NotificationStatus.SKIPPED
    db.commit()
    return sent_count


def _get_recipients(db: Session, target_roles, contract: Optional[Contract]) -> list:
    """Find users matching target roles. Filter by assigned contract if relevant."""
    if not target_roles:
        return []
    q = db.query(User).join(Role).filter(
        Role.code.in_(target_roles),
        User.is_active == True,
        User.deleted_at.is_(None),
    )
    users = q.all()
    out = []
    for u in users:
        role_code = u.role_obj.code if u.role_obj else None
        if role_code in ("konsultan", "kontraktor", "ppk") and contract:
            assigned = [str(c) for c in (u.assigned_contract_ids or [])]
            if assigned and str(contract.id) not in assigned:
                continue
        if u.whatsapp_number or u.phone:
            out.append(u)
    return out


def _check_missing_daily_reports(db: Session):
    """Send alert for each contract that requires daily report and has none yesterday."""
    from app.models.models import NotificationRule as NR

    rule = db.query(NR).filter(NR.trigger_type == "daily_report_missing", NR.is_active == True).first()
    if not rule:
        return

    from datetime import date
    yesterday = date.today() - timedelta(days=1)

    contracts = db.query(Contract).filter(
        Contract.daily_report_required == True,
        Contract.status == "active",
        Contract.deleted_at.is_(None),
    ).all()

    for c in contracts:
        has_report = db.query(DailyReport).filter(
            DailyReport.contract_id == c.id,
            DailyReport.report_date == yesterday,
            DailyReport.is_deleted == False,
        ).first()
        if has_report:
            continue

        ctx = {
            "contract_number": c.contract_number,
            "contract_name": c.contract_name,
            "date": yesterday.strftime("%d %b %Y"),
        }
        msg = render_template(rule.message_template, ctx)

        for u in _get_recipients(db, rule.target_roles, c):
            phone = u.whatsapp_number or u.phone
            if phone:
                enqueue_notification(
                    db, rule, NotificationChannel.WHATSAPP,
                    str(u.id), phone, msg, ctx,
                )
    db.commit()


def _check_missing_weekly_reports(db: Session):
    from app.models.models import NotificationRule as NR
    from datetime import date

    rule = db.query(NR).filter(NR.trigger_type == "weekly_report_missing", NR.is_active == True).first()
    if not rule:
        return

    # Check each active contract — has report for last completed week?
    contracts = db.query(Contract).filter(
        Contract.status == "active",
        Contract.deleted_at.is_(None),
    ).all()

    for c in contracts:
        if not c.start_date:
            continue
        elapsed = (date.today() - c.start_date).days
        if elapsed < 7:
            continue
        last_week = elapsed // 7
        has_report = db.query(WeeklyReport).filter(
            WeeklyReport.contract_id == c.id,
            WeeklyReport.week_number == last_week,
            WeeklyReport.is_deleted == False,
        ).first()
        if has_report:
            continue

        ctx = {
            "contract_number": c.contract_number,
            "week_number": last_week,
            "date": date.today().strftime("%d %b %Y"),
        }
        msg = render_template(rule.message_template, ctx)
        for u in _get_recipients(db, rule.target_roles, c):
            phone = u.whatsapp_number or u.phone
            if phone:
                enqueue_notification(
                    db, rule, NotificationChannel.WHATSAPP,
                    str(u.id), phone, msg, ctx,
                )
    db.commit()


def _check_deviation_warnings(db: Session):
    """Dispatch a WA message for each unresolved deviation/spi warning."""
    warnings = db.query(EarlyWarning).filter(EarlyWarning.is_resolved == False).all()
    if not warnings:
        return

    from app.models.models import NotificationRule as NR
    rules = db.query(NR).filter(
        NR.trigger_type.in_(["deviation_warning", "deviation_critical", "spi_warning", "spi_critical"]),
        NR.is_active == True,
    ).all()
    rules_by_type = {r.trigger_type: r for r in rules}

    for w in warnings:
        key = f"{w.warning_type}_{w.severity}"
        rule = rules_by_type.get(key)
        if not rule:
            continue

        # avoid duplicate: don't send if already queued for same warning
        existing = db.query(NotificationQueue).filter(
            NotificationQueue.rule_id == rule.id,
            NotificationQueue.context["warning_id"].astext == str(w.id),
        ).first()
        if existing:
            continue

        c = db.query(Contract).filter(Contract.id == w.contract_id).first()
        if not c:
            continue
        ctx = {
            "contract_number": c.contract_number,
            "warning": w.message,
            "severity": w.severity,
            "warning_id": str(w.id),
        }
        msg = render_template(rule.message_template, ctx)

        for u in _get_recipients(db, rule.target_roles, c):
            phone = u.whatsapp_number or u.phone
            if phone:
                enqueue_notification(
                    db, rule, NotificationChannel.WHATSAPP,
                    str(u.id), phone, msg, ctx,
                )
    db.commit()


def run_all_scheduled_checks(db: Session):
    """Called by APScheduler daily."""
    _check_missing_daily_reports(db)
    _check_missing_weekly_reports(db)
    _check_deviation_warnings(db)
    # Then process queue
    process_notification_queue(db)
