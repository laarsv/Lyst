"""categorization mode + category_locked

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-12 16:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    mode = sa.Enum("OFF", "MANUAL", "AUTO", name="categorization_mode")
    mode.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "lists",
        sa.Column("categorization_mode", mode, nullable=False, server_default="OFF"),
    )
    # Migrate existing setting: sort_by_category=true → AUTO, false → OFF.
    op.execute(
        "UPDATE lists SET categorization_mode = 'AUTO' WHERE sort_by_category = true"
    )
    op.drop_column("lists", "sort_by_category")

    op.add_column(
        "list_items",
        sa.Column("category_locked", sa.Boolean, nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("list_items", "category_locked")
    op.add_column(
        "lists",
        sa.Column("sort_by_category", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.execute(
        "UPDATE lists SET sort_by_category = true WHERE categorization_mode = 'AUTO'"
    )
    op.drop_column("lists", "categorization_mode")
    sa.Enum(name="categorization_mode").drop(op.get_bind(), checkfirst=True)
