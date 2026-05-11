import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.collaborator import ListCollaborator
    from app.models.list_item import ListItem
    from app.models.reminder import Reminder
    from app.models.user import User


class ListType(str, enum.Enum):
    SHOPPING = "SHOPPING"
    PACKING = "PACKING"
    CHECKLIST = "CHECKLIST"
    CUSTOM = "CUSTOM"


def _gen_share_token() -> str:
    return uuid.uuid4().hex


class List(Base, TimestampMixin):
    __tablename__ = "lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[ListType] = mapped_column(
        Enum(ListType, name="list_type"), nullable=False, default=ListType.CUSTOM
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_template: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    template_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    share_token: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    share_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owner: Mapped["User"] = relationship(back_populates="lists")
    items: Mapped[list["ListItem"]] = relationship(
        back_populates="list",
        cascade="all, delete-orphan",
        order_by="ListItem.position",
    )
    collaborators: Mapped[list["ListCollaborator"]] = relationship(
        back_populates="list", cascade="all, delete-orphan"
    )
    reminders: Mapped[list["Reminder"]] = relationship(
        back_populates="list", cascade="all, delete-orphan"
    )
