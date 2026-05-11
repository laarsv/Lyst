"""list snapshots

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-11 23:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "list_snapshots",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("list_id", sa.Integer, sa.ForeignKey("lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("items_json", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_list_snapshots_list_id", "list_snapshots", ["list_id"])
    op.create_index("ix_list_snapshots_created_at", "list_snapshots", ["created_at"])


def downgrade() -> None:
    op.drop_table("list_snapshots")
