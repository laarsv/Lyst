"""Shared task-field plumbing for list items + note task items.

Both `ListItem` and `TaskItem` carry the same set of task-related
columns (assignee_id, due_at, reminder_at, reminder_sent). This
module hosts the logic that's identical between them:

  - validating an assignee against the parent's access set
  - applying a patch dict in a way that respects explicit-null clears
    (update_*() helpers filter Nones, which means
    `{"assignee_id": null}` from the client would otherwise be a no-op)
  - resetting `reminder_sent` when the reminder is moved forward
  - detecting that the assignee actually CHANGED, so the caller can
    fire a TASK_ASSIGNED email at most once per (resource, assignee)
    cycle

The caller owns the final commit and the WebSocket / email side-
effects so this stays a thin in-memory helper. Email delivery itself
lives in `task_notification_service`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collaborator import ListCollaborator
from app.models.list import List as ListModel
from app.models.list_item import ListItem
from app.models.note import Note, NoteShare
from app.models.task_item import TaskItem
from app.models.user import User

# Field names we treat as "task fields" everywhere.
TASK_FIELDS = ("assignee_id", "due_at", "reminder_at")


async def list_assignable_user_ids(db: AsyncSession, list_id: int) -> set[int]:
    """Returns the set of user IDs allowed to be assigned a task on
    this list — owner + every collaborator (any permission level)."""
    list_row = (
        await db.execute(select(ListModel.owner_id).where(ListModel.id == list_id))
    ).scalar_one_or_none()
    if list_row is None:
        return set()
    out = {list_row}
    coll_rows = await db.execute(
        select(ListCollaborator.user_id).where(ListCollaborator.list_id == list_id)
    )
    out.update(uid for (uid,) in coll_rows.all())
    return out


async def note_assignable_user_ids(db: AsyncSession, note_id: int) -> set[int]:
    """Returns the set of user IDs allowed to be assigned a task on
    this note — owner + every share recipient. Both VIEW and EDIT
    recipients are eligible: a VIEW recipient can still HAVE a task
    assigned to them; they just can't edit the note's text."""
    owner = (
        await db.execute(select(Note.owner_id).where(Note.id == note_id))
    ).scalar_one_or_none()
    if owner is None:
        return set()
    out = {owner}
    rows = await db.execute(
        select(NoteShare.shared_with_user_id).where(NoteShare.note_id == note_id)
    )
    out.update(uid for (uid,) in rows.all())
    return out


def apply_task_fields(
    target: ListItem | TaskItem,
    patch: dict[str, Any],
) -> int | None:
    """Apply the task-field subset of `patch` directly onto `target`.

    Returns the assignee_id that the caller should notify (i.e. the
    NEW assignee, when assignment actually changed). None means "no
    notification needed" — either assignee wasn't part of the patch,
    it didn't actually change, or it was cleared.

    The patch dict is mutated in-place: every task field is popped so
    the caller's subsequent `update_*()` call doesn't try to apply
    them via setattr (and silently drop the explicit-null clears).
    """
    assignee_changed_to: int | None = None

    if "assignee_id" in patch:
        new = patch.pop("assignee_id")
        prev = target.assignee_id
        target.assignee_id = new
        if new is not None and new != prev:
            assignee_changed_to = new

    if "due_at" in patch:
        target.due_at = patch.pop("due_at")

    if "reminder_at" in patch:
        new_rem = patch.pop("reminder_at")
        prev_rem = target.reminder_at
        target.reminder_at = new_rem
        # Reset the "already fired" flag whenever the reminder moves —
        # forward (user pushed it out) or backward (user pulled it in).
        # Clearing reminder_at also clears the flag so re-setting it
        # later behaves like a fresh schedule.
        if new_rem != prev_rem:
            target.reminder_sent = False

    return assignee_changed_to


def is_task(target: ListItem | TaskItem) -> bool:
    """Cheap predicate: any task-y field set => the user has upgraded
    this item to a task. Used by the /tasks aggregator's filter."""
    return (
        target.assignee_id is not None
        or target.due_at is not None
        or target.reminder_at is not None
    )


def task_status(target: ListItem | TaskItem) -> str:
    """Classify a task for the status pills on the /tasks page.

    Returns one of 'done', 'overdue', 'today', 'this_week', 'open'.
    Caller is responsible for first verifying `is_task(target)`."""
    done = getattr(target, "is_checked", None)
    if done is None:
        done = getattr(target, "is_done", False)
    if done:
        return "done"
    if target.due_at is None:
        return "open"
    now = datetime.now(timezone.utc)
    due = target.due_at
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    if due < now:
        return "overdue"
    # "Today" = same calendar day in UTC. Good enough — the /tasks
    # frontend re-bucketises per the user's local TZ via display
    # heuristics anyway.
    if due.date() == now.date():
        return "today"
    if (due - now).days < 7:
        return "this_week"
    return "open"
