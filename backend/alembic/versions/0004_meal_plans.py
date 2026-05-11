"""meal plans

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-11 21:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    meal_type = sa.Enum("BREAKFAST", "LUNCH", "DINNER", "SNACK", name="meal_type")

    op.create_table(
        "meal_plans",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("week_start", sa.Date, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_id", "week_start", name="uq_owner_week"),
    )
    op.create_index("ix_meal_plans_owner_id", "meal_plans", ["owner_id"])
    op.create_index("ix_meal_plans_week_start", "meal_plans", ["week_start"])

    op.create_table(
        "meal_plan_entries",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("meal_plan_id", sa.Integer, sa.ForeignKey("meal_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipe_id", sa.Integer, sa.ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_of_week", sa.Integer, nullable=False),
        sa.Column("meal_type", meal_type, nullable=False),
        sa.Column("servings", sa.Integer, nullable=False, server_default="2"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_meal_plan_entries_meal_plan_id", "meal_plan_entries", ["meal_plan_id"])
    op.create_index("ix_meal_plan_entries_recipe_id", "meal_plan_entries", ["recipe_id"])


def downgrade() -> None:
    op.drop_table("meal_plan_entries")
    op.drop_table("meal_plans")
    op.execute("DROP TYPE IF EXISTS meal_type")
