"""recipe picnic_image_hash — robust dedup key for Picnic .eml import

Revision ID: 0030
Revises: 0029
Create Date: 2026-06-11 14:00:00

Additive — the per-recipe hash from a Picnic image URL
(…/recipes/<HASH>/1000x1000.png) is a stable id that survives Picnic title
typo-fixes/renames, so it's the primary duplicate-check key (title is the
fallback). NULL for every non-Picnic recipe.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0030"
down_revision: Union[str, None] = "0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("picnic_image_hash", sa.String(128), nullable=True))
    op.create_index("ix_recipes_picnic_image_hash", "recipes", ["picnic_image_hash"])


def downgrade() -> None:
    op.drop_index("ix_recipes_picnic_image_hash", table_name="recipes")
    op.drop_column("recipes", "picnic_image_hash")
