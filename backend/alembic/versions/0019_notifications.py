"""in-app notifications — notifications table

Revision ID: 0019
Revises: 0018
Create Date: 2026-05-16 11:00:00

Persistent in-app notification records. Sits parallel to the existing
user-WS event channel (which is transient cache-invalidation pings):
this table lets a user catch up across sessions on who shared what,
who mentioned them, who assigned them a task, etc.

`kind` is kept as a plain VARCHAR rather than an enum so adding a new
trigger (e.g. "task_overdue") doesn't need another migration.
`payload` is JSONB on Postgres so kind-specific shape stays denormalised
on the read path.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_notifications_user_id", "notifications", ["user_id"], unique=False
    )
    op.create_index(
        "ix_notifications_read_at", "notifications", ["read_at"], unique=False
    )
    # Common query: "unread for user X, newest first". A composite
    # index over (user_id, created_at desc) speeds it up significantly
    # once a user has more than ~50 notifications. Partial on
    # read_at IS NULL keeps the index tight (read entries dominate
    # over time but rarely get queried).
    op.create_index(
        "ix_notifications_user_unread",
        "notifications",
        ["user_id", sa.text("created_at DESC")],
        unique=False,
        postgresql_where=sa.text("read_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_user_unread", table_name="notifications")
    op.drop_index("ix_notifications_read_at", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
