"""picnic mappings — remembered "list term -> Picnic product" choices

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-01 17:00:00

Additive: one table, no enums, nothing touched on existing tables. Household-wide
(the Picnic integration uses one shared account), term is unique. created_by_id
is SET NULL so deleting a user never drops the household's mappings.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0033"
down_revision: Union[str, None] = "0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "picnic_mappings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("term", sa.String(length=100), nullable=False),
        sa.Column("product_id", sa.String(length=32), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_picnic_mappings_term", "picnic_mappings", ["term"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_picnic_mappings_term", table_name="picnic_mappings")
    op.drop_table("picnic_mappings")
