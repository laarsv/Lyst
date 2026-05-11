from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.email.sender import send_email
from app.email.templates import reminder_email
from app.models.list import List as ListModel
from app.models.reminder import Reminder
from app.models.user import User


async def list_reminders(db: AsyncSession, list_id: int) -> list[Reminder]:
    result = await db.execute(
        select(Reminder).where(Reminder.list_id == list_id).order_by(Reminder.remind_at)
    )
    return list(result.scalars().all())


async def create_reminder(
    db: AsyncSession,
    list_id: int,
    user_id: int,
    remind_at: datetime,
    message: str | None,
) -> Reminder:
    if remind_at.tzinfo is None:
        remind_at = remind_at.replace(tzinfo=timezone.utc)
    rem = Reminder(list_id=list_id, user_id=user_id, remind_at=remind_at, message=message)
    db.add(rem)
    await db.commit()
    await db.refresh(rem)
    return rem


async def delete_reminder(db: AsyncSession, list_id: int, reminder_id: int) -> None:
    result = await db.execute(
        select(Reminder).where(Reminder.id == reminder_id, Reminder.list_id == list_id)
    )
    rem = result.scalar_one_or_none()
    if not rem:
        raise ValueError("Reminder not found")
    await db.delete(rem)
    await db.commit()


async def fetch_due_reminders(db: AsyncSession, now: datetime) -> list[Reminder]:
    result = await db.execute(
        select(Reminder)
        .options(selectinload(Reminder.list), selectinload(Reminder.user))
        .where(Reminder.sent.is_(False), Reminder.remind_at <= now)
    )
    return list(result.scalars().all())


async def deliver_reminder(db: AsyncSession, reminder: Reminder) -> bool:
    user: User = reminder.user
    lst: ListModel = reminder.list
    if not user or not lst or not user.is_active:
        reminder.sent = True
        await db.commit()
        return False
    app_url = f"{settings.FRONTEND_URL}/lists/{lst.id}"
    subject, html = reminder_email(lst.title, reminder.message, app_url)
    await send_email(user.email, subject, html)
    reminder.sent = True
    await db.commit()
    return True
