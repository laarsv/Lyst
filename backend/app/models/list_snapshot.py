from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.list import List


class ListSnapshot(Base, TimestampMixin):
    """Frozen view of a shopping list's items at "reset" time, so the user
    can later restore a session as a new list with the same checked state.

    The items are denormalized (text/quantity/unit + was_checked) into a
    single JSONB column — they don't need to point at the still-living
    ListItem rows, which would have been wiped or re-checked anyway."""

    __tablename__ = "list_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    items_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    list: Mapped["List"] = relationship()
