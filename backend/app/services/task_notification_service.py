"""Email notifications for the tasks layer (TASK_ASSIGNED + TASK_REMINDER).

Same channel as mentions: a single Resend email per event. There is
no in-app notification CENTER yet — only emails go out — so we
deliberately don't persist a notifications row beyond the dedup that
already lives in the relevant model column (`reminder_sent`).

Both calls are best-effort: failures are logged and swallowed so a
flaky Resend doesn't crash a save / scheduler tick. The caller is
expected to have committed any state change BEFORE invoking us.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.email.sender import send_email
from app.email.templates import task_assigned_email, task_reminder_email
from app.models.list import List as ListModel
from app.models.list_item import ListItem
from app.models.note import Note
from app.models.task_item import TaskItem
from app.models.user import User

logger = logging.getLogger(__name__)


def _link_for_list_item(list_id: int, item_id: int) -> str:
    base = (settings.APP_URL or "").rstrip("/")
    return f"{base or ''}/lists/{list_id}?task={item_id}"


def _link_for_note_task(note_id: int, task_id: int) -> str:
    base = (settings.APP_URL or "").rstrip("/")
    return f"{base or ''}/notes?focus={note_id}&task={task_id}"


async def notify_task_assigned_list_item(
    db: AsyncSession,
    item: ListItem,
    assigner: User,
    assignee_id: int,
) -> None:
    """Fire one TASK_ASSIGNED email for a list-item assignment change.
    No-op if the assignee row is missing (race-with-cascade-cleanup).
    Doesn't fire when the assigner assigns themselves."""
    if assignee_id == assigner.id:
        return
    user = (
        await db.execute(select(User).where(User.id == assignee_id))
    ).scalar_one_or_none()
    if not user:
        return
    list_row = (
        await db.execute(
            select(ListModel.title).where(ListModel.id == item.list_id)
        )
    ).scalar_one_or_none()
    parent_title = list_row or "(Liste)"
    # Persist an in-app notification first (cheap, local) then fire email.
    from app.services.notification_service import notify_task_assigned
    try:
        await notify_task_assigned(
            db,
            recipient_id=assignee_id,
            actor_id=assigner.id,
            actor_name=assigner.name,
            source="list",
            source_id=item.list_id,
            task_id=item.id,
            text=item.text,
        )
    except Exception as e:  # pragma: no cover
        logger.warning("Task-assign in-app notify failed list_item=%s: %s", item.id, e)
    try:
        subject, html = task_assigned_email(
            actor_name=assigner.name,
            task_text=item.text,
            parent_kind="list",
            parent_title=parent_title,
            url=_link_for_list_item(item.list_id, item.id),
        )
        await send_email(user.email, subject, html)
    except Exception as e:  # pragma: no cover
        logger.warning("Task-assign email failed list_item=%s: %s", item.id, e)


async def notify_task_assigned_note_task(
    db: AsyncSession,
    task: TaskItem,
    assigner: User,
    assignee_id: int,
) -> None:
    """Mirror of the list-item path for note tasks."""
    if assignee_id == assigner.id:
        return
    user = (
        await db.execute(select(User).where(User.id == assignee_id))
    ).scalar_one_or_none()
    if not user:
        return
    note_row = (
        await db.execute(select(Note.title).where(Note.id == task.note_id))
    ).scalar_one_or_none()
    parent_title = note_row or "(Notiz)"
    from app.services.notification_service import notify_task_assigned
    try:
        await notify_task_assigned(
            db,
            recipient_id=assignee_id,
            actor_id=assigner.id,
            actor_name=assigner.name,
            source="note",
            source_id=task.note_id,
            task_id=task.id,
            text=task.text,
        )
    except Exception as e:  # pragma: no cover
        logger.warning("Task-assign in-app notify failed task_item=%s: %s", task.id, e)
    try:
        subject, html = task_assigned_email(
            actor_name=assigner.name,
            task_text=task.text,
            parent_kind="note",
            parent_title=parent_title,
            url=_link_for_note_task(task.note_id, task.id),
        )
        await send_email(user.email, subject, html)
    except Exception as e:  # pragma: no cover
        logger.warning("Task-assign email failed task_item=%s: %s", task.id, e)


async def notify_task_reminder_list_item(
    db: AsyncSession, item: ListItem
) -> None:
    """Fire one TASK_REMINDER email for a list item. Recipient is the
    assignee when one exists, otherwise the list owner. Caller is
    expected to have already flipped `reminder_sent = True` and
    committed."""
    recipient_id = item.assignee_id
    if recipient_id is None:
        # Fall back to list owner.
        owner_id = (
            await db.execute(
                select(ListModel.owner_id).where(ListModel.id == item.list_id)
            )
        ).scalar_one_or_none()
        recipient_id = owner_id
    if recipient_id is None:
        return
    user = (
        await db.execute(select(User).where(User.id == recipient_id))
    ).scalar_one_or_none()
    if not user:
        return
    parent_title = (
        await db.execute(
            select(ListModel.title).where(ListModel.id == item.list_id)
        )
    ).scalar_one_or_none() or "(Liste)"
    from app.services.notification_service import notify_task_reminder
    try:
        await notify_task_reminder(
            db,
            recipient_id=recipient_id,
            source="list",
            source_id=item.list_id,
            task_id=item.id,
            text=item.text,
            due_at=item.due_at,
        )
    except Exception as e:  # pragma: no cover
        logger.warning("Task-reminder in-app notify failed list_item=%s: %s", item.id, e)
    try:
        subject, html = task_reminder_email(
            task_text=item.text,
            parent_kind="list",
            parent_title=parent_title,
            url=_link_for_list_item(item.list_id, item.id),
        )
        await send_email(user.email, subject, html)
    except Exception as e:  # pragma: no cover
        logger.warning("Task-reminder email failed list_item=%s: %s", item.id, e)


async def notify_task_reminder_note_task(
    db: AsyncSession, task: TaskItem
) -> None:
    recipient_id = task.assignee_id
    if recipient_id is None:
        owner_id = (
            await db.execute(
                select(Note.owner_id).where(Note.id == task.note_id)
            )
        ).scalar_one_or_none()
        recipient_id = owner_id
    if recipient_id is None:
        return
    user = (
        await db.execute(select(User).where(User.id == recipient_id))
    ).scalar_one_or_none()
    if not user:
        return
    parent_title = (
        await db.execute(
            select(Note.title).where(Note.id == task.note_id)
        )
    ).scalar_one_or_none() or "(Notiz)"
    from app.services.notification_service import notify_task_reminder
    try:
        await notify_task_reminder(
            db,
            recipient_id=recipient_id,
            source="note",
            source_id=task.note_id,
            task_id=task.id,
            text=task.text,
            due_at=task.due_at,
        )
    except Exception as e:  # pragma: no cover
        logger.warning("Task-reminder in-app notify failed task_item=%s: %s", task.id, e)
    try:
        subject, html = task_reminder_email(
            task_text=task.text,
            parent_kind="note",
            parent_title=parent_title,
            url=_link_for_note_task(task.note_id, task.id),
        )
        await send_email(user.email, subject, html)
    except Exception as e:  # pragma: no cover
        logger.warning("Task-reminder email failed task_item=%s: %s", task.id, e)
