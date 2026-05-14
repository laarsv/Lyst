from typing import TYPE_CHECKING

from sqlalchemy import ARRAY, Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Recipe(Base, TimestampMixin):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    servings: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    prep_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cook_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # Categorisation now lives entirely in `tags` — the old RecipeCategory
    # enum was migrated into per-recipe tags in alembic revision 0011.
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, nullable=False)
    # Single-recipe sharing — same shape as List.share_token.
    share_token: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    share_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owner: Mapped["User"] = relationship()
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
        order_by="RecipeIngredient.position",
    )
    steps: Mapped[list["RecipeStep"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
        order_by="RecipeStep.position",
    )


class RecipeIngredient(Base, TimestampMixin):
    __tablename__ = "recipe_ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)

    # Nutrition per 100 g of the ingredient (all optional). Used by the
    # recipe summary card to show per-serving totals.
    calories_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)

    recipe: Mapped["Recipe"] = relationship(back_populates="ingredients")


class RecipeStep(Base, TimestampMixin):
    __tablename__ = "recipe_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)

    recipe: Mapped["Recipe"] = relationship(back_populates="steps")


# =============================================================================
#  Internal sharing — added in alembic 0012
# =============================================================================
#
# Distinct from the public share_token columns on Recipe / User: these rows
# grant a specific Lyst user direct in-app access to a recipe (RecipeShare)
# or to the owner's whole recipe collection (RecipeBookShare). Read-only
# for the recipient — write/delete still goes through ownership checks.

from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, UniqueConstraint
from sqlalchemy.sql import func


class RecipeShare(Base):
    __tablename__ = "recipe_shares"
    __table_args__ = (
        UniqueConstraint(
            "recipe_id",
            "shared_with_user_id",
            name="uq_recipe_shares_recipe_user",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False
    )
    shared_with_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RecipeBookShare(Base):
    __tablename__ = "recipe_book_shares"
    __table_args__ = (
        UniqueConstraint(
            "owner_id",
            "shared_with_user_id",
            name="uq_recipe_book_shares_owner_user",
        ),
        # DB-level guard against pathological self-share rows. The service
        # layer rejects them earlier with a friendly message; this is the
        # belt to that suspenders.
        CheckConstraint(
            "owner_id <> shared_with_user_id",
            name="ck_recipe_book_shares_no_self",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    shared_with_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
