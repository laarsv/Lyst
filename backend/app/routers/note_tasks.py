"""CRUD endpoints for note task items (the rows that back each
<li data-type="taskItem"> in a note's TipTap doc).

Mounted by `app/main.py` as a sibling of /notes. Permission gate is
the same as PATCH /notes — owner or share recipient with EDIT.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.collaborator import CollaboratorPermission
from app.models.note import Note
from app.models.task_item import TaskItem
from app.models.user import User
from app.schemas.task_item import TaskItemCreate, TaskItemOut, TaskItemUpdate
from app.services.note_share_service import get_accessible_note
from app.services.task_notification_service import notify_task_assigned_note_task
from app.services.task_service import apply_task_fields, note_assignable_user_ids

router = APIRouter(prefix="/notes/{note_id}/tasks", tags=["note-tasks"])


def _out(t: TaskItem) -> dict:
    payload = TaskItemOut.model_validate(t).model_dump(mode="json")
    loaded = t.__dict__.get("assignee")
    if loaded is not None and getattr(loaded, "name", None):
        payload["assignee_name"] = loaded.name
    return payload


async def _require_note_edit(db: AsyncSession, note_id: int, user_id: int) -> Note:
    try:
        note, _src, perm = await get_accessible_note(db, note_id, user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if perm != CollaboratorPermission.EDIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Du hast keine Bearbeitungsrechte für diese Notiz.",
        )
    return note


@router.get("")
async def list_tasks(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """List all task items for a note. Read access is sufficient — any
    user with access to the note (owner, VIEW recipient, EDIT recipient)
    can read the task list. Mutating endpoints below require EDIT."""
    try:
        await get_accessible_note(db, note_id, user.id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    rows = (
        await db.execute(
            select(TaskItem)
            .where(TaskItem.note_id == note_id)
            .options(selectinload(TaskItem.assignee))
            .order_by(TaskItem.position, TaskItem.id)
        )
    ).scalars().all()
    return ok([_out(t) for t in rows])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(
    note_id: int,
    payload: TaskItemCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a task row. Called by the TipTap node-view when a brand-
    new task-list checkbox is typed in the doc — the node-view then
    writes the returned id back into the node's `data-task-id`."""
    await _require_note_edit(db, note_id, user.id)
    row = TaskItem(
        note_id=note_id,
        text=payload.text,
        is_done=payload.is_done,
        position=payload.position,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ok(_out(row))


@router.patch("/{task_id}")
async def patch_task(
    note_id: int,
    task_id: int,
    payload: TaskItemUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Mutate a task row — text, is_done, position, assignee, due,
    reminder. Assignee is validated against the note's access set;
    a 400 fires if the client tries to assign someone outside it."""
    await _require_note_edit(db, note_id, user.id)
    row = (
        await db.execute(
            select(TaskItem).where(
                TaskItem.id == task_id, TaskItem.note_id == note_id
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    patch = payload.model_dump(exclude_unset=True)

    if "assignee_id" in patch and patch["assignee_id"] is not None:
        allowed = await note_assignable_user_ids(db, note_id)
        if patch["assignee_id"] not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Diese Person hat keinen Zugriff auf diese Notiz.",
            )

    new_assignee = apply_task_fields(row, patch)

    # Apply remaining (non-task) fields inline so explicit nulls are
    # respected — same trick as the list-items PATCH.
    for k, v in patch.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    if row.assignee_id is not None:
        await db.refresh(row, attribute_names=["assignee"])

    if new_assignee is not None:
        try:
            await notify_task_assigned_note_task(db, row, user, new_assignee)
        except Exception:  # pragma: no cover
            pass

    return ok(_out(row))


@router.delete("/{task_id}")
async def delete_task(
    note_id: int,
    task_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_note_edit(db, note_id, user.id)
    row = (
        await db.execute(
            select(TaskItem).where(
                TaskItem.id == task_id, TaskItem.note_id == note_id
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.delete(row)
    await db.commit()
    return ok({"message": "Deleted"})
