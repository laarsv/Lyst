"""note public sharing + internal note_shares table

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-17 09:00:00

Same shape as recipes' sharing setup (alembic 0011 + 0012):
  - notes.share_token (UUID, unique, indexed) + share_enabled bool
    enable a public read-only URL.
  - note_shares grants a specific Lyst user direct in-app access to one
    note. Cascading FKs so deleting a note (or recipient) cleans the
    grant rows up automatically.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ----- 1. notes share columns ---------------------------------------
    op.add_column(
        "notes",
        sa.Column("share_token", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "notes",
        sa.Column(
            "share_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_notes_share_token", "notes", ["share_token"], unique=True
    )

    # ----- 2. note_shares table -----------------------------------------
    op.create_table(
        "note_shares",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "note_id",
            sa.Integer,
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "shared_with_user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "note_id",
            "shared_with_user_id",
            name="uq_note_shares_note_user",
        ),
    )
    op.create_index(
        "ix_note_shares_user", "note_shares", ["shared_with_user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_note_shares_user", table_name="note_shares")
    op.drop_table("note_shares")
    op.drop_index("ix_notes_share_token", table_name="notes")
    op.drop_column("notes", "share_enabled")
    op.drop_column("notes", "share_token")
