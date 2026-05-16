"""Persistent in-app notification record (alembic 0019).

One row per fanned-out signal that should surface in the user's
notification bell. Distinct from the existing user-WS broadcasts —
those are transient cache-invalidation pings; these survive across
sessions and let the user catch up on what they missed.

Kinds (string, kept loose so adding new triggers doesn't need a
migration):
  - share_created    — someone shared a list/note/recipe with this user
  - mention          — someone @-mentioned this user in a note
  - task_assigned    — someone assigned this user a list-item or note-task
  - task_reminder    — scheduler fired a reminder for a task owned by this user

Payload is JSON — the routing target (list_id, note_id, task_id, …)
plus enough denormalised fields to render the bell entry without a
follow-up query (actor name, resource title). Read state is a single
nullable `read_at` timestamp; null = unread.
"""
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Free-form kind string — see module docstring for current vocabulary.
    # Kept as a plain VARCHAR rather than an enum so adding a new trigger
    # (e.g. "task_overdue") doesn't need a migration.
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    # Denormalised payload. Always a JSON object. Per-kind expected keys:
    #   share_created: actor_name, resource_type, resource_id, title
    #   mention:       actor_name, note_id, note_title
    #   task_assigned: actor_name, source ("list"|"note"), source_id,
    #                  task_id, text
    #   task_reminder: source, source_id, task_id, text, due_at
    # The frontend reads these to render the row + navigate on click.
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # null = unread. Set to utcnow() when the user opens the bell or
    # explicitly marks the entry read.
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    user: Mapped["User"] = relationship()
