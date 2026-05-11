"""recipes

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-11 14:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    recipe_category = sa.Enum(
        "BREAKFAST", "LUNCH", "DINNER", "SNACK", "DESSERT", "DRINK", "OTHER",
        name="recipe_category",
    )

    op.create_table(
        "recipes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("servings", sa.Integer, nullable=False, server_default="2"),
        sa.Column("prep_time_minutes", sa.Integer, nullable=True),
        sa.Column("cook_time_minutes", sa.Integer, nullable=True),
        sa.Column("category", recipe_category, nullable=False, server_default="OTHER"),
        sa.Column("image_url", sa.String(1024), nullable=True),
        sa.Column("source_url", sa.String(1024), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_recipes_owner_id", "recipes", ["owner_id"])

    op.create_table(
        "recipe_ingredients",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("recipe_id", sa.Integer, sa.ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("quantity", sa.Float, nullable=True),
        sa.Column("unit", sa.String(32), nullable=True),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_recipe_ingredients_recipe_id", "recipe_ingredients", ["recipe_id"])
    op.create_index("ix_recipe_ingredients_position", "recipe_ingredients", ["position"])

    op.create_table(
        "recipe_steps",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("recipe_id", sa.Integer, sa.ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_recipe_steps_recipe_id", "recipe_steps", ["recipe_id"])
    op.create_index("ix_recipe_steps_position", "recipe_steps", ["position"])


def downgrade() -> None:
    op.drop_table("recipe_steps")
    op.drop_table("recipe_ingredients")
    op.drop_table("recipes")
    op.execute("DROP TYPE IF EXISTS recipe_category")
