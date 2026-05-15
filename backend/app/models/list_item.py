from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.list import List
    from app.models.user import User


class ListItem(Base, TimestampMixin):
    __tablename__ = "list_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(String(500), nullable=False)
    is_checked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    # Filled in asynchronously by the Ollama categorizer for SHOPPING-type
    # lists. Null means "not yet categorized" and the UI shows a pending state.
    category: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # When true, the user manually picked this category — auto-categorizer
    # MUST NOT overwrite it (unless explicitly forced by the regenerate flow).
    category_locked: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    # ---- Task fields (alembic 0018) -----------------------------------------
    # Setting any of these "upgrades" the item to a task — the /tasks
    # aggregator picks it up, the per-item popover surfaces its state,
    # and the scheduler watches reminder_at. assignee_id MUST be a user
    # who already has access to the parent list (owner or collaborator);
    # the cascade in list_share_service NULLs it when access is revoked.
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
    # Flipped to true by the scheduler the first time the reminder
    # fires, so a single reminder_at value never produces two emails.
    # Cleared back to false if the user moves reminder_at forward.
    reminder_sent: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    list: Mapped["List"] = relationship(back_populates="items")
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assignee_id])
