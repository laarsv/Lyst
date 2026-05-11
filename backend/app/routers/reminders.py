from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.reminder import ReminderCreate, ReminderOut
from app.services.list_service import get_list_for_user
from app.services.reminder_service import (
    create_reminder,
    delete_reminder,
    list_reminders,
)

router = APIRouter(prefix="/lists/{list_id}/reminders", tags=["reminders"])


@router.get("")
async def get_reminders(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    rems = await list_reminders(db, list_id)
    return ok([ReminderOut.model_validate(r).model_dump(mode="json") for r in rems])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_reminder(
    list_id: int,
    payload: ReminderCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    rem = await create_reminder(db, list_id, user.id, payload.remind_at, payload.message)
    return ok(ReminderOut.model_validate(rem).model_dump(mode="json"))


@router.delete("/{reminder_id}")
async def del_reminder(
    list_id: int,
    reminder_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    try:
        await delete_reminder(db, list_id, reminder_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok({"message": "Reminder deleted"})
