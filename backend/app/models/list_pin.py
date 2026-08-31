from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.list import List
    from app.models.user import User


class ListPin(Base, TimestampMixin):
    """A list a user pinned to their "Heute" screen.

    Per USER, not per list: a shared shopping list can sit on one person's
    dashboard without appearing on everyone else's. Both FKs cascade, so
    deleting a list (or a user) takes the pin with it and the dashboard can
    never render a dangling row.
    """

    __tablename__ = "list_pins"
    __table_args__ = (UniqueConstraint("list_id", "user_id", name="uq_list_pin_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    list: Mapped["List"] = relationship()
    user: Mapped["User"] = relationship()
