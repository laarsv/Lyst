from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.note import Note
    from app.models.user import User


class NoteFolder(Base, TimestampMixin):
    __tablename__ = "note_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    color: Mapped[str | None] = mapped_column(String(9), nullable=True)

    owner: Mapped["User"] = relationship()
    # When a folder is deleted we want notes to fall back to "no folder",
    # not get deleted with it. The DB FK has ON DELETE SET NULL.
    notes: Mapped[list["Note"]] = relationship(back_populates="folder")
