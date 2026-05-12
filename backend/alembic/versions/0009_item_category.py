"""list_item.category + lists.sort_by_category

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-12 14:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("list_items", sa.Column("category", sa.String(64), nullable=True))
    op.create_index("ix_list_items_category", "list_items", ["category"])

    op.add_column(
        "lists",
        sa.Column("sort_by_category", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    # Default the new flag ON for existing SHOPPING lists so users don't
    # have to flip a switch on every old shopping list to benefit.
    op.execute("UPDATE lists SET sort_by_category = true WHERE type = 'SHOPPING'")


def downgrade() -> None:
    op.drop_column("lists", "sort_by_category")
    op.drop_index("ix_list_items_category", table_name="list_items")
    op.drop_column("list_items", "category")
