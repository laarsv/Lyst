"""Create + fan out in-app notifications.

Every trigger calls one of the `notify_*` helpers below. The helper:
  1. Inserts a notifications row for the recipient
  2. Fans out a user-WS event of type "notification" so the recipient's
     open tab can update its bell badge without a refetch

Fan-out reuses the existing per-user WebSocket channel (the dispatcher
already has a "notification" case for this — was dead-letter until
this module started writing rows). The websocket payload is the same
shape as the persisted row so the frontend's bell state can append
the new entry directly.

All emitters are best-effort: if the WS broadcast fails, the row
still exists in the DB — the user picks it up via mount-fetch on
next visit.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.services.user_ws_manager import user_manager

logger = logging.getLogger(__name__)

KIND_SHARE_CREATED = "share_created"
KIND_MENTION = "mention"
KIND_TASK_ASSIGNED = "task_assigned"
KIND_TASK_REMINDER = "task_reminder"


async def create_notification(
    db: AsyncSession,
    *,
    user_id: int,
    kind: str,
    payload: dict[str, Any],
    actor_id: int | None = None,
) -> Notification:
    """Persist a notification row and fan it out on the user channel.

    `actor_id` is excluded from the WS payload — only sent inside the
    payload dict if the caller needs it for rendering. The WS event is
    fired AFTER the commit so a flaky fan-out can't roll back the row.
    """
    row = Notification(user_id=user_id, kind=kind, payload=payload)
    db.add(row)
    await db.commit()
    await db.refresh(row)

    # Fan out — mirrors the existing user-WS envelope shape.
    try:
        await user_manager.broadcast_to_users(
            {user_id},
            {
                "event": f"notification.{kind}",
                "resource_type": "notification",
                "resource_id": row.id,
                "parent_id": None,
                "actor_id": actor_id or 0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "payload": {
                    "id": row.id,
                    "kind": kind,
                    "payload": payload,
                    "created_at": row.created_at.isoformat(),
                    "read_at": None,
                },
            },
            exclude_client_id=None,
        )
    except Exception as e:  # pragma: no cover - best-effort fan-out
        logger.warning("notification WS fan-out failed: %s", e)
    return row


# ---------------------------------------------------------------------------
# Convenience emitters — one per trigger so call sites don't have to
# remember the kind string or the payload shape.
# ---------------------------------------------------------------------------


async def notify_share_created(
    db: AsyncSession,
    *,
    recipient_id: int,
    actor_id: int,
    actor_name: str,
    resource_type: str,  # "note" | "list" | "recipe"
    resource_id: int,
    title: str,
) -> Notification | None:
    """Someone shared a resource with `recipient_id`. Skip when the
    actor IS the recipient (book-share-to-self is rejected upstream
    but stay defensive)."""
    if recipient_id == actor_id:
        return None
    return await create_notification(
        db,
        user_id=recipient_id,
        kind=KIND_SHARE_CREATED,
        actor_id=actor_id,
        payload={
            "actor_name": actor_name,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "title": title,
        },
    )


async def notify_mention(
    db: AsyncSession,
    *,
    recipient_id: int,
    actor_id: int,
    actor_name: str,
    note_id: int,
    note_title: str,
) -> Notification | None:
    """User got @-mentioned in a note. Self-mentions skipped — they're
    almost always a typo/refactor artifact."""
    if recipient_id == actor_id:
        return None
    return await create_notification(
        db,
        user_id=recipient_id,
        kind=KIND_MENTION,
        actor_id=actor_id,
        payload={
            "actor_name": actor_name,
            "note_id": note_id,
            "note_title": note_title,
        },
    )


async def notify_task_assigned(
    db: AsyncSession,
    *,
    recipient_id: int,
    actor_id: int,
    actor_name: str,
    source: str,  # "list" | "note"
    source_id: int,
    task_id: int,
    text: str,
) -> Notification | None:
    """Someone assigned a task to `recipient_id`. `source` + source_id
    + task_id are enough for the bell row to deep-link to the right
    surface (/lists/<id>?task=<task_id> or /notes?focus=<id>&task=<task>)."""
    if recipient_id == actor_id:
        return None
    return await create_notification(
        db,
        user_id=recipient_id,
        kind=KIND_TASK_ASSIGNED,
        actor_id=actor_id,
        payload={
            "actor_name": actor_name,
            "source": source,
            "source_id": source_id,
            "task_id": task_id,
            "text": text[:140],
        },
    )


async def notify_task_reminder(
    db: AsyncSession,
    *,
    recipient_id: int,
    source: str,
    source_id: int,
    task_id: int,
    text: str,
    due_at: datetime | None,
) -> Notification | None:
    """Scheduler fired a reminder for an assigned task. actor_id=0
    because the system is the actor."""
    return await create_notification(
        db,
        user_id=recipient_id,
        kind=KIND_TASK_REMINDER,
        actor_id=0,
        payload={
            "source": source,
            "source_id": source_id,
            "task_id": task_id,
            "text": text[:140],
            "due_at": due_at.isoformat() if due_at else None,
        },
    )


# ---------------------------------------------------------------------------
# Read-path helpers used by the router
# ---------------------------------------------------------------------------


async def list_recent_for_user(
    db: AsyncSession, user_id: int, limit: int = 20
) -> list[Notification]:
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def count_unread_for_user(db: AsyncSession, user_id: int) -> int:
    from sqlalchemy import func

    result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
        )
    )
    return int(result.scalar_one())


async def mark_read(db: AsyncSession, notification_id: int, user_id: int) -> bool:
    """Returns False when the row doesn't exist for this user (404 path).
    Idempotent — re-marking an already-read row is a no-op."""
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return False
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        await db.commit()
    return True


async def mark_all_read(db: AsyncSession, user_id: int) -> int:
    """Bulk-update every unread row to read_at=now. Returns how many
    rows were affected so the response can drive a "Alle gelesen
    markiert (n)" toast."""
    from sqlalchemy import update

    now = datetime.now(timezone.utc)
    result = await db.execute(
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
        )
        .values(read_at=now)
    )
    await db.commit()
    return result.rowcount or 0
