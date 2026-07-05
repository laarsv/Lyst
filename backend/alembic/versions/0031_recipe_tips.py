"""recipe tips — free-form cook's tip

Revision ID: 0031
Revises: 0030
Create Date: 2026-07-05 12:00:00

Additive — a nullable free-text tip shown as a highlighted box at the end of
the recipe detail view. NULL for every existing recipe (no backfill). The
Picnic .eml importer fills it from the mail's "Tipp" block.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("tips", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "tips")
