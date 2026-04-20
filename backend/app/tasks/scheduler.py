"""APScheduler task wiring."""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from app.core.database import SessionLocal
from app.core.config import settings
from app.services.notification_service import run_all_scheduled_checks
import logging

log = logging.getLogger("scheduler")


def _run_daily_check_job():
    db = SessionLocal()
    try:
        log.info("Running daily scheduled checks...")
        run_all_scheduled_checks(db)
        log.info("Daily checks done.")
    except Exception as e:
        log.error(f"Daily check error: {e}")
    finally:
        db.close()


scheduler: BackgroundScheduler | None = None


def start_scheduler():
    global scheduler
    if not settings.SCHEDULER_ENABLED:
        return
    if scheduler and scheduler.running:
        return
    scheduler = BackgroundScheduler(timezone="Asia/Jakarta")
    scheduler.add_job(
        _run_daily_check_job,
        trigger=CronTrigger(hour=settings.DAILY_CHECK_HOUR, minute=0),
        id="daily_check",
        replace_existing=True,
    )
    scheduler.start()
    log.info("Scheduler started.")


def stop_scheduler():
    global scheduler
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
        log.info("Scheduler stopped.")
