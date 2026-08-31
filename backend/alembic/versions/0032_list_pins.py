"""list pins — lists a user pinned to the "Heute" screen

Revision ID: 0032
Revises: 0031
Create Date: 2026-08-31 12:00:00

Additive: one join table, no enums, nothing touched on existing tables. The
pin is per USER (a shared list can sit on one person's dashboard only), and
both FKs cascade so a deleted list or user can't leave a dangling pin.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0032"
down_revision: Union[str, None] = "0031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "list_pins",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("list_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["list_id"], ["lists.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("list_id", "user_id", name="uq_list_pin_user"),
    )
    op.create_index("ix_list_pins_list_id", "list_pins", ["list_id"])
    op.create_index("ix_list_pins_user_id", "list_pins", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_list_pins_user_id", table_name="list_pins")
    op.drop_index("ix_list_pins_list_id", table_name="list_pins")
    op.drop_table("list_pins")
