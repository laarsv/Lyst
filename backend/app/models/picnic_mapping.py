from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class PicnicMapping(Base, TimestampMixin):
    """A remembered "list term -> Picnic product" choice, e.g. "butter" -> Streichzart.

    Household-wide, NOT per user: the Picnic integration talks to ONE shared
    account, so everyone's "Butter" resolves to the same product. `term` is stored
    normalised (lower-case, whitespace collapsed) and is unique, so re-confirming a
    term overwrites its product. `product_name` is a display snapshot only — the
    Picnic product id is the source of truth. `created_by_id` is informational and
    goes NULL if that user is deleted; the mapping itself outlives them.
    """

    __tablename__ = "picnic_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    term: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    product_id: Mapped[str] = mapped_column(String(32), nullable=False)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_by: Mapped["User | None"] = relationship()
