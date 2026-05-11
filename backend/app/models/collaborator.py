import enum
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.list import List
    from app.models.user import User


class CollaboratorPermission(str, enum.Enum):
    VIEW = "VIEW"
    EDIT = "EDIT"


class ListCollaborator(Base, TimestampMixin):
    __tablename__ = "list_collaborators"
    __table_args__ = (UniqueConstraint("list_id", "user_id", name="uq_list_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    permission: Mapped[CollaboratorPermission] = mapped_column(
        Enum(CollaboratorPermission, name="collaborator_permission"),
        nullable=False,
        default=CollaboratorPermission.VIEW,
    )

    list: Mapped["List"] = relationship(back_populates="collaborators")
    user: Mapped["User"] = relationship()
