from datetime import datetime
from typing import TYPE_CHECKING

import enum

from sqlalchemy import ARRAY, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class NutritionSource(str, enum.Enum):
    """Where an ingredient's nutrition values originated.

    NULL on the column (no enum value) means "no nutrition data yet" —
    kept distinct from `manual` so the auto-lookup pipeline can tell
    apart "never tried" from "user supplied these by hand".

    USDA was added in alembic 0021 as the primary source for raw
    cooking ingredients (Foundation + SR Legacy datasets); OFF stays
    around for branded packaged products.
    """
    USDA = "usda"
    OFF = "off"
    AI = "ai"
    MANUAL = "manual"

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

    # Cooking-experience polish (alembic 0028). Owner-scoped on the recipe
    # itself (not per-user) — recipients see the owner's values. rating 0 =
    # "noch nicht bewertet". cooked_count / last_cooked_at are denormalised
    # caches bumped by mark_cooked() (recipe_cook_logs holds the individual
    # entries + notes); kept on the row so the overview can sort by
    # "Bewertung / zuletzt gekocht / Häufigkeit" without joining the log table.
    rating: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cooked_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_cooked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # AI variants (alembic 0029): link a generated variant to its original;
    # source marks provenance ("ai_variant"). No ORM relationship — children
    # are queried directly to avoid async self-referential lazy-loads.
    parent_recipe_id: Mapped[int | None] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Stable per-recipe hash from a Picnic image URL (alembic 0030) — primary
    # dedup key for the Picnic .eml import; NULL for everything else.
    picnic_image_hash: Mapped[str | None] = mapped_column(
        String(128), nullable=True, index=True
    )

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
    fiber_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugar_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)
    salt_per_100g: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Provenance — null when no values are set. See NutritionSource above.
    #
    # `values_callable` is load-bearing here. SQLAlchemy's Enum() defaults
    # to writing the Python enum's NAME ("OFF") to the DB column. Our
    # Postgres enum type, however, only knows the lowercase VALUES
    # ("off", "ai", "manual") — that's what alembic 0020 created and what
    # the API contract uses end-to-end. Without this callable, every
    # PATCH /ingredients carrying nutrition_source hits an
    # "invalid input value for enum nutrition_source: OFF" and 500s.
    # (CollaboratorPermission gets away without it because its names
    # already coincide with its values, "VIEW"/"EDIT".)
    nutrition_source: Mapped[NutritionSource | None] = mapped_column(
        Enum(
            NutritionSource,
            name="nutrition_source",
            create_type=False,
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=True,
    )
    # OFF barcode the row was filled from; only set when nutrition_source == OFF.
    off_product_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # USDA FoodData Central food ID; only set when nutrition_source == USDA.
    # Same intent as off_product_code — lets "Werte aktualisieren" re-hit
    # the same food row and link back to the source.
    usda_fdc_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

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
#  Internal sharing — added in alembic 0012, permission column in 0014
# =============================================================================
#
# Distinct from the public share_token columns on Recipe / User: these rows
# grant a specific Lyst user direct in-app access to a recipe (RecipeShare)
# or to the owner's whole recipe collection (RecipeBookShare). Each grant
# carries a VIEW/EDIT permission (alembic 0014, reusing the
# `collaborator_permission` enum from list collaborators).

from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, Enum, UniqueConstraint
from sqlalchemy.sql import func

from app.models.collaborator import CollaboratorPermission


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
    permission: Mapped[CollaboratorPermission] = mapped_column(
        Enum(CollaboratorPermission, name="collaborator_permission", create_type=False),
        nullable=False,
        default=CollaboratorPermission.VIEW,
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
    permission: Mapped[CollaboratorPermission] = mapped_column(
        Enum(CollaboratorPermission, name="collaborator_permission", create_type=False),
        nullable=False,
        default=CollaboratorPermission.VIEW,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# =============================================================================
#  Cook history — alembic 0028
# =============================================================================
#
# Append-only "ich hab das heute gekocht" log behind the denormalised
# cooked_count / last_cooked_at caches on Recipe (both bumped together in
# mark_cooked). Owner-scoped via the recipe — no own owner_id. Rows are
# removed with the recipe through the FK's ON DELETE CASCADE; there is
# deliberately NO ORM relationship on Recipe so the async delete path never
# tries to lazy-load these rows.

class RecipeCookLog(Base):
    __tablename__ = "recipe_cook_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    cooked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
