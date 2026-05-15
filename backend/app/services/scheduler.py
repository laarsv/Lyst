import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.list_item import ListItem
from app.models.task_item import TaskItem
from app.services.reminder_service import deliver_reminder, fetch_due_reminders
from app.services.task_notification_service import (
    notify_task_reminder_list_item,
    notify_task_reminder_note_task,
)

logger = logging.getLogger(__name__)
scheduler: AsyncIOScheduler | None = None


async def _check_due_list_reminders() -> None:
    """Existing per-list reminder fan-out — unchanged from before the
    task layer landed."""
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        due = await fetch_due_reminders(db, now)
        for rem in due:
            try:
                await deliver_reminder(db, rem)
                logger.info("reminder delivered id=%s list_id=%s", rem.id, rem.list_id)
            except Exception as e:
                logger.error("reminder delivery failed id=%s err=%s", rem.id, e)


async def _check_due_task_reminders() -> None:
    """Fire TASK_REMINDER emails on:
       - ListItem.reminder_at <= now AND reminder_sent=false AND is_checked=false
       - TaskItem.reminder_at <= now AND reminder_sent=false AND is_done=false
       Marks reminder_sent=true in the same transaction so a single
       reminder_at value never fires twice. The user can re-arm by
       editing reminder_at — apply_task_fields() clears the flag
       whenever the timestamp moves.

       Recipient is the assignee when set, else the parent resource
       owner — both paths are inside the notify_* helpers.
    """
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        # ListItems
        li_rows = (
            await db.execute(
                select(ListItem).where(
                    ListItem.reminder_at.is_not(None),
                    ListItem.reminder_at <= now,
                    ListItem.reminder_sent.is_(False),
                    ListItem.is_checked.is_(False),
                )
            )
        ).scalars().all()
        for li in li_rows:
            try:
                li.reminder_sent = True
            except Exception as e:  # pragma: no cover
                logger.error("Couldn't mark list_item reminder sent: %s", e)
                continue
        await db.commit()
        for li in li_rows:
            try:
                await notify_task_reminder_list_item(db, li)
                logger.info("task reminder fired list_item=%s", li.id)
            except Exception as e:  # pragma: no cover
                logger.error("task reminder delivery failed list_item=%s err=%s", li.id, e)

        # Note TaskItems
        ti_rows = (
            await db.execute(
                select(TaskItem).where(
                    TaskItem.reminder_at.is_not(None),
                    TaskItem.reminder_at <= now,
                    TaskItem.reminder_sent.is_(False),
                    TaskItem.is_done.is_(False),
                )
            )
        ).scalars().all()
        for ti in ti_rows:
            ti.reminder_sent = True
        await db.commit()
        for ti in ti_rows:
            try:
                await notify_task_reminder_note_task(db, ti)
                logger.info("task reminder fired task_item=%s", ti.id)
            except Exception as e:  # pragma: no cover
                logger.error("task reminder delivery failed task_item=%s err=%s", ti.id, e)


async def _check_due() -> None:
    """Combined tick — runs both reminder kinds. Kept as one entry
    point so the APScheduler config below stays single-line."""
    await _check_due_list_reminders()
    await _check_due_task_reminders()


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
