"""note_mentions join table — dedup for mention notifications

Revision ID: 0017
Revises: 0016
Create Date: 2026-05-15 21:00:00

One row per (note_id, mentioned_user_id) the FIRST time that user is
mentioned in that note. The PATCH /notes handler reads this set to
decide whether a save introduces *new* mentions (and therefore should
fire a notification email) vs. a re-save of a note that already
contained the mention.

Cascading deletes from notes / users keep the table free of orphans.
A unique constraint on (note_id, mentioned_user_id) makes the dedup
check a single insert-or-ignore.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "note_mentions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "note_id",
            sa.Integer,
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "mentioned_user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "note_id",
            "mentioned_user_id",
            name="uq_note_mentions_note_user",
        ),
    )


def downgrade() -> None:
    op.drop_table("note_mentions")
