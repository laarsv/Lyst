import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.list import List
    from app.models.note import Note
    from app.models.tag import Tag


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    USER = "user"


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        # values_callable: store the enum *value* ("admin"/"user") in PG instead of
        # the enum *name* ("ADMIN"/"USER"). The Postgres enum type was created with
        # lowercase labels in migration 0001, and the wire format used by Pydantic
        # in API responses is also lowercase, so this keeps everything consistent.
        Enum(
            UserRole,
            name="user_role",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=UserRole.USER,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Recipe-book sharing — see alembic 0011. Token gives anyone the URL
    # public read-only access to the user's whole recipe collection.
    recipe_book_share_token: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    recipe_book_share_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    lists: Mapped[list["List"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    notes: Mapped[list["Note"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    tags: Mapped[list["Tag"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
