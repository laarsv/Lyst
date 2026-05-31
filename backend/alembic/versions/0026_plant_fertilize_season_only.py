"""plants: drop fertilize interval, make fertilizing season-only (annual reminder)

Revision ID: 0026
Revises: 0025
Create Date: 2026-05-31 15:00:00

Fertilizing is no longer interval-based — the season alone drives it:
  - DROP fertilize_interval_days and fertilize_reminder_sent (interval cycle).
  - ADD fertilize_reminder_year — yearly dedup for the new annual reminder that
    fires when fertilize_start_month arrives (mirrors prune_reminder_year).
last_fertilized_at stays as a log only ("Zuletzt gedüngt").
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("plants", sa.Column("fertilize_reminder_year", sa.Integer, nullable=True))
    op.drop_column("plants", "fertilize_interval_days")
    op.drop_column("plants", "fertilize_reminder_sent")


def downgrade() -> None:
    op.add_column(
        "plants",
        sa.Column("fertilize_reminder_sent", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.add_column("plants", sa.Column("fertilize_interval_days", sa.Integer, nullable=True))
    op.drop_column("plants", "fertilize_reminder_year")
