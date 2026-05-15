"""Note task — one row per task-list checkbox inside a note's TipTap doc.

The note's HTML still owns the rendering (so backlinks, public share
view, version history all keep working), but each `<li data-type=
"taskItem">` carries a `data-task-id` attribute pointing at a row in
this table. That makes the task individually addressable: the
/tasks aggregator can list it, the per-task popover can attach an
assignee/due/reminder to it, and the scheduler can fire reminders.

The TipTap node-view diffs (data-task-ids in the doc) against
(rows in this table) on every save:
  - new node, no taskId -> POST creates a row, attribute is written back
  - existing node, text changed -> PATCH text
  - missing node -> DELETE row

Permission: same shape as the parent note. Owner or share recipient
(EDIT) can read/write; VIEW recipients can see the task list rendered
but can't mutate.
"""
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.note import Note
    from app.models.user import User


class TaskItem(Base, TimestampMixin):
    __tablename__ = "task_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    is_done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Document order. The editor doesn't strictly need this — the doc
    # itself is the canonical order — but the /tasks aggregator and any
    # future "list all tasks in a note" view want a stable sort.
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    due_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    reminder_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    reminder_sent: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    note: Mapped["Note"] = relationship()
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assignee_id])
