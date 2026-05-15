"""Global tasks aggregator at GET /tasks.

Unifies the two storage shapes (`list_items.{assignee_id,due_at,
reminder_at}` and `task_items.*`) into one wire format per row. The
frontend builds the /tasks page on top of this — group-by-source +
filter chips.

Scope (?scope=):
  - mine          : tasks I OWN (parent resource owner) regardless of
                    assignee. Includes ones I assigned to someone else.
  - assigned_to_me: tasks where I'm the assignee. Default.
  - all           : any task whose parent I can see (own or shared).

Status (?status=):
  - open       : is_done = false (default)
  - done       : is_done = true
  - overdue    : open AND due_at < now
  - today      : open AND due_at is today (UTC date match)
  - this_week  : open AND due_at within next 7 days
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.collaborator import ListCollaborator
from app.models.list import List as ListModel
from app.models.list_item import ListItem
from app.models.note import Note, NoteShare
from app.models.task_item import TaskItem
from app.models.user import User
from app.schemas.task_item import AggregatedTask

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _is_task_li(it: ListItem) -> bool:
    return (
        it.assignee_id is not None
        or it.due_at is not None
        or it.reminder_at is not None
    )


def _is_task_ti(t: TaskItem) -> bool:
    # Note task rows ALWAYS count as tasks once they exist — they're
    # the addressable backing of a TipTap checkbox, so the row's mere
    # presence is the user signal. Filtering by assignee/due here
    # would hide tasks the user just hasn't scheduled yet.
    return True


@router.get("")
async def list_tasks(
    scope: str = Query("assigned_to_me", pattern="^(mine|assigned_to_me|all)$"),
    status: str = Query("open", pattern="^(open|done|overdue|today|this_week|all)$"),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    # ---- Reachable parent ids by access type ------------------------------
    # Lists I own
    owned_lists = (
        await db.execute(select(ListModel.id).where(ListModel.owner_id == user.id))
    ).scalars().all()
    # Lists shared with me
    shared_lists = (
        await db.execute(
            select(ListCollaborator.list_id).where(ListCollaborator.user_id == user.id)
        )
    ).scalars().all()
    # Notes I own
    owned_notes = (
        await db.execute(select(Note.id).where(Note.owner_id == user.id))
    ).scalars().all()
    # Notes shared with me
    shared_notes = (
        await db.execute(
            select(NoteShare.note_id).where(NoteShare.shared_with_user_id == user.id)
        )
    ).scalars().all()

    owned_list_ids = set(owned_lists)
    shared_list_ids = set(shared_lists)
    accessible_list_ids = owned_list_ids | shared_list_ids
    owned_note_ids = set(owned_notes)
    shared_note_ids = set(shared_notes)
    accessible_note_ids = owned_note_ids | shared_note_ids

    # ---- Fetch list items + note task items in the access scope -----------
    list_items_q = (
        select(ListItem)
        .where(ListItem.list_id.in_(accessible_list_ids or {0}))
        .options(selectinload(ListItem.assignee))
    )
    list_items_rows = (await db.execute(list_items_q)).scalars().all()

    note_tasks_q = (
        select(TaskItem)
        .where(TaskItem.note_id.in_(accessible_note_ids or {0}))
        .options(selectinload(TaskItem.assignee))
    )
    note_tasks_rows = (await db.execute(note_tasks_q)).scalars().all()

    # ---- Parent title lookups (single query each) -------------------------
    list_titles_q = (
        await db.execute(
            select(ListModel.id, ListModel.title, ListModel.owner_id).where(
                ListModel.id.in_(accessible_list_ids or {0})
            )
        )
    ).all()
    list_meta = {lid: (title, owner) for lid, title, owner in list_titles_q}
    note_titles_q = (
        await db.execute(
            select(Note.id, Note.title, Note.owner_id).where(
                Note.id.in_(accessible_note_ids or {0})
            )
        )
    ).all()
    note_meta = {nid: (title, owner) for nid, title, owner in note_titles_q}

    now = datetime.now(timezone.utc)
    week_ahead = now + timedelta(days=7)

    def _due_aware(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)

    def _status_match(is_done: bool, due_at: datetime | None) -> bool:
        if status == "all":
            return True
        if status == "done":
            return is_done
        if is_done:
            return False
        if status == "open":
            return True
        if status == "overdue":
            return due_at is not None and _due_aware(due_at) < now
        if status == "today":
            return due_at is not None and _due_aware(due_at).date() == now.date()
        if status == "this_week":
            return due_at is not None and now <= _due_aware(due_at) <= week_ahead
        return True

    def _scope_match_li(it: ListItem) -> bool:
        owner_id = list_meta.get(it.list_id, (None, None))[1]
        if scope == "mine":
            return owner_id == user.id
        if scope == "assigned_to_me":
            return it.assignee_id == user.id
        return True  # all

    def _scope_match_ti(t: TaskItem) -> bool:
        owner_id = note_meta.get(t.note_id, (None, None))[1]
        if scope == "mine":
            return owner_id == user.id
        if scope == "assigned_to_me":
            return t.assignee_id == user.id
        return True

    out: list[dict] = []

    for it in list_items_rows:
        if not _is_task_li(it):
            continue
        if not _scope_match_li(it):
            continue
        if not _status_match(it.is_checked, it.due_at):
            continue
        title, owner_id = list_meta.get(it.list_id, ("", 0))
        out.append(
            AggregatedTask(
                id=it.id,
                source="list",
                source_id=it.list_id,
                source_title=title,
                owner_id=owner_id,
                text=it.text,
                is_done=it.is_checked,
                assignee_id=it.assignee_id,
                assignee_name=getattr(it.__dict__.get("assignee"), "name", None),
                due_at=it.due_at,
                reminder_at=it.reminder_at,
            ).model_dump(mode="json")
        )

    for t in note_tasks_rows:
        if not _is_task_ti(t):
            continue
        if not _scope_match_ti(t):
            continue
        if not _status_match(t.is_done, t.due_at):
            continue
        title, owner_id = note_meta.get(t.note_id, ("", 0))
        out.append(
            AggregatedTask(
                id=t.id,
                source="note",
                source_id=t.note_id,
                source_title=title,
                owner_id=owner_id,
                text=t.text,
                is_done=t.is_done,
                assignee_id=t.assignee_id,
                assignee_name=getattr(t.__dict__.get("assignee"), "name", None),
                due_at=t.due_at,
                reminder_at=t.reminder_at,
            ).model_dump(mode="json")
        )

    # Sort: due-soonest first (None = no due, sort to the end), then
    # by source/id for a stable order.
    def _sort_key(row: dict) -> tuple[int, str, int]:
        due = row.get("due_at")
        epoch = float("inf") if due is None else datetime.fromisoformat(due).timestamp()
        return (epoch, row["source"], row["id"])

    out.sort(key=_sort_key)
    return ok(out)
