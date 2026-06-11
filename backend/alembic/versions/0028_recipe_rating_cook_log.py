"""recipe rating, favorite, cook history

Revision ID: 0028
Revises: 0027
Create Date: 2026-06-11 10:00:00

Additive — cooking-experience polish for recipes:
  - recipes.rating (0-5, 0 = unrated), recipes.is_favorite
  - recipes.cooked_count / recipes.last_cooked_at — denormalised caches the
    overview sorts on; bumped together with each recipe_cook_logs insert.
  - recipe_cook_logs — append-only "heute gekocht" entries + optional notes,
    removed with the recipe via ON DELETE CASCADE.

server_default backfills existing rows; the model carries Python-side
defaults for new inserts.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column("rating", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "recipes",
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "recipes",
        sa.Column("cooked_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "recipes",
        sa.Column("last_cooked_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "recipe_cook_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "recipe_id",
            sa.Integer,
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "cooked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("notes", sa.Text, nullable=True),
    )
    op.create_index("ix_recipe_cook_logs_recipe_id", "recipe_cook_logs", ["recipe_id"])


def downgrade() -> None:
    op.drop_index("ix_recipe_cook_logs_recipe_id", table_name="recipe_cook_logs")
    op.drop_table("recipe_cook_logs")
    op.drop_column("recipes", "last_cooked_at")
    op.drop_column("recipes", "cooked_count")
    op.drop_column("recipes", "is_favorite")
    op.drop_column("recipes", "rating")
