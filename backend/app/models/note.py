import enum
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


class NoteContentFormat(str, enum.Enum):
    """Transitional marker for the Markdown -> HTML editor migration
    (alembic 0016 / data-migration 0017).

    Newly-created notes are HTML (TipTap's serialized output). Existing
    notes start as MARKDOWN and get flipped to HTML by the one-shot
    `scripts/migrate_notes_to_html.py` run once after the schema is
    applied. The column stays for one release so a botched conversion
    can be rolled back per-note from a DB backup."""

    MARKDOWN = "MARKDOWN"
    HTML = "HTML"


class Note(Base, TimestampMixin):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Format of `content`: MARKDOWN for pre-migration rows, HTML for
    # everything new. See NoteContentFormat docstring + alembic 0016.
    content_format: Mapped[NoteContentFormat] = mapped_column(
        Enum(NoteContentFormat, name="note_content_format"),
        nullable=False,
        default=NoteContentFormat.HTML,
    )
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


class NoteMention(Base):
    """Tracks which users have ever been notified about being mentioned
    in a given note. The PATCH /notes handler diffs the set of mention
    IDs in the new content against this table — anyone NEW gets an email
    + a row inserted here; anyone already present is ignored (re-saves
    don't spam the recipient with duplicate notifications).

    Cascading deletes from notes / users keep the table self-cleaning."""

    __tablename__ = "note_mentions"
    __table_args__ = (
        UniqueConstraint(
            "note_id",
            "mentioned_user_id",
            name="uq_note_mentions_note_user",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mentioned_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


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
