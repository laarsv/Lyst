"""plants: free-form tags (Bereich)

Revision ID: 0024
Revises: 0023
Create Date: 2026-05-31 13:00:00

Adds a string-array `tags` column to plants — same column type and shape
as recipes.tags (postgresql.ARRAY(String), NOT NULL, default '{}'). Filtered
in the list endpoint with .any(), exactly like recipes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "plants",
        sa.Column("tags", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("plants", "tags")
