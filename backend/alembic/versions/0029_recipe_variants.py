"""recipe variants — parent link + source

Revision ID: 0029
Revises: 0028
Create Date: 2026-06-11 12:00:00

Additive — links an AI-generated variant back to its original:
  - recipes.parent_recipe_id (self-FK, ON DELETE SET NULL so deleting an
    original orphans rather than cascades its variants)
  - recipes.source ("ai_variant" for generated variants; NULL otherwise)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column(
            "parent_recipe_id",
            sa.Integer(),
            sa.ForeignKey("recipes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("recipes", sa.Column("source", sa.String(32), nullable=True))
    op.create_index("ix_recipes_parent_recipe_id", "recipes", ["parent_recipe_id"])


def downgrade() -> None:
    op.drop_index("ix_recipes_parent_recipe_id", table_name="recipes")
    op.drop_column("recipes", "source")
    op.drop_column("recipes", "parent_recipe_id")
