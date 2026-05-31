"""plants: seasonal/month-based care — fertilize season, prune month, bloom window

Revision ID: 0025
Revises: 0024
Create Date: 2026-05-31 14:00:00

Adds month-based (1–12) calendar care fields, distinct from the existing
day-interval recurrence:
  - fertilize_start_month / fertilize_end_month: gate the fertilize reminder
    to a season.
  - prune_month + prune_reminder_year: annual "time to prune" reminder with
    per-year dedup.
  - bloom_start_month / bloom_end_month: display-only bloom window.
All nullable integers; no enum.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS = (
    "fertilize_start_month",
    "fertilize_end_month",
    "prune_month",
    "prune_reminder_year",
    "bloom_start_month",
    "bloom_end_month",
)


def upgrade() -> None:
    for col in _COLUMNS:
        op.add_column("plants", sa.Column(col, sa.Integer, nullable=True))


def downgrade() -> None:
    for col in reversed(_COLUMNS):
        op.drop_column("plants", col)
