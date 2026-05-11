import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.database import AsyncSessionLocal
from app.services.reminder_service import deliver_reminder, fetch_due_reminders

logger = logging.getLogger(__name__)
scheduler: AsyncIOScheduler | None = None


async def _check_due() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        due = await fetch_due_reminders(db, now)
        for rem in due:
            try:
                await deliver_reminder(db, rem)
                logger.info("reminder delivered id=%s list_id=%s", rem.id, rem.list_id)
            except Exception as e:
                logger.error("reminder delivery failed id=%s err=%s", rem.id, e)


def start_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(_check_due, "interval", minutes=1, id="reminder-check", max_instances=1)
    scheduler.start()
    logger.info("Scheduler started")


def stop_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        scheduler.shutdown(wait=False)
        scheduler = None
        logger.info("Scheduler stopped")
