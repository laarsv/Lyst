"""permission column on internal share tables

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-14 12:00:00

Brings recipe / recipe-book / note internal shares up to parity with
list collaborators: each share row now carries a VIEW/EDIT permission.
Reuses the existing `collaborator_permission` Postgres enum so we don't
need a parallel type.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Existing enum from alembic 0001 — `create_type=False` so we reference it
# instead of trying to redefine it on every column add.
PERM_ENUM = postgresql.ENUM(
    "VIEW",
    "EDIT",
    name="collaborator_permission",
    create_type=False,
)


def upgrade() -> None:
    for table in ("recipe_shares", "recipe_book_shares", "note_shares"):
        op.add_column(
            table,
            sa.Column(
                "permission",
                PERM_ENUM,
                nullable=False,
                # Existing rows default to VIEW — pre-permission shares
                # were always read-only.
                server_default="VIEW",
            ),
        )


def downgrade() -> None:
    for table in ("note_shares", "recipe_book_shares", "recipe_shares"):
        op.drop_column(table, "permission")
