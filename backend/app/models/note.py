from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base, TimestampMixin
from app.models.collaborator import CollaboratorPermission

if TYPE_CHECKING:
    from app.models.note_folder import NoteFolder
    from app.models.user import User


class Note(Base, TimestampMixin):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, nullable=False)
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("note_folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    # Public sharing — alembic 0013. Same shape as Recipe.share_token.
    share_token: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    share_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owner: Mapped["User"] = relationship(back_populates="notes")
    folder: Mapped["NoteFolder | None"] = relationship(back_populates="notes")


class NoteShare(Base):
    """Internal share row — grants a Lyst user direct in-app access to one
    note. Carries a VIEW/EDIT permission (alembic 0014). Distinct from the
    public share_token, which gives anyone-with-URL read-only access.
    Cascading deletes from notes/users keep the table free of orphans
    without cleanup jobs."""

    __tablename__ = "note_shares"
    __table_args__ = (
        UniqueConstraint(
            "note_id",
            "shared_with_user_id",
            name="uq_note_shares_note_user",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    shared_with_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    permission: Mapped[CollaboratorPermission] = mapped_column(
        Enum(CollaboratorPermission, name="collaborator_permission", create_type=False),
        nullable=False,
        default=CollaboratorPermission.VIEW,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
