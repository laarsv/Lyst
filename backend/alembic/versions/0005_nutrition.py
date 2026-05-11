"""nutrition columns on recipe_ingredients

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-11 22:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("recipe_ingredients", sa.Column("calories_per_100g", sa.Float, nullable=True))
    op.add_column("recipe_ingredients", sa.Column("protein_per_100g", sa.Float, nullable=True))
    op.add_column("recipe_ingredients", sa.Column("carbs_per_100g", sa.Float, nullable=True))
    op.add_column("recipe_ingredients", sa.Column("fat_per_100g", sa.Float, nullable=True))


def downgrade() -> None:
    op.drop_column("recipe_ingredients", "fat_per_100g")
    op.drop_column("recipe_ingredients", "carbs_per_100g")
    op.drop_column("recipe_ingredients", "protein_per_100g")
    op.drop_column("recipe_ingredients", "calories_per_100g")
