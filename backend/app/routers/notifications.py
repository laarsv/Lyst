"""In-app notification feed (alembic 0019).

Three endpoints:
  GET    /notifications              — newest 20 + unread count
  PATCH  /notifications/{id}/read    — mark one row read
  POST   /notifications/mark-all-read — bulk mark every unread row

Write-path lives in `app/services/notification_service.py`; mutating
endpoints across the app (share/email, mention diff, task assignment,
scheduler) call the matching notify_* helper which both inserts the
row and fans out a user-WS event.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.notification import NotificationListResponse, NotificationOut
from app.services.notification_service import (
    count_unread_for_user,
    list_recent_for_user,
    mark_all_read,
    mark_read,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def get_notifications(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Newest 20 entries + total unread count for the bell badge.
    Total is across ALL entries, not just the 20-row page — so the
    badge stays correct even with more unread than the dropdown shows."""
    rows = await list_recent_for_user(db, user.id, limit=20)
    unread = await count_unread_for_user(db, user.id)
    return ok(
        NotificationListResponse(
            items=[NotificationOut.model_validate(r) for r in rows],
            unread_count=unread,
        ).model_dump(mode="json")
    )


@router.patch("/{notification_id}/read")
async def patch_mark_read(
    notification_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a single row as read. Idempotent on already-read rows.
    404 when the row doesn't belong to the caller (no leaking that
    a notification exists for someone else)."""
    found = await mark_read(db, notification_id, user.id)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Benachrichtigung nicht gefunden",
        )
    return ok({"message": "Marked read"})


@router.post("/mark-all-read")
async def post_mark_all_read(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Bulk-mark every unread row. Returns the count so the UI can
    show "n Benachrichtigungen gelesen markiert"."""
    n = await mark_all_read(db, user.id)
    return ok({"updated": n})
