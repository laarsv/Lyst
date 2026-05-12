from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.note import Note


class NoteVersion(Base, TimestampMixin):
    """Frozen snapshot of a note at a point in time. Written by the notes
    router on PATCH whenever title/content changes and the previous version
    is older than NOTE_VERSION_DEBOUNCE_SECONDS. The list is trimmed to
    NOTE_VERSION_MAX_PER_NOTE per note (oldest first)."""

    __tablename__ = "note_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")

    note: Mapped["Note"] = relationship()
