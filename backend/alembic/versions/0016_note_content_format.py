"""add Note.content_format (transitional: MARKDOWN -> HTML)

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-15 19:00:00

Adds the column that tracks whether a note's content is still raw
Markdown (everything created before the TipTap editor switch) or
TipTap-serialised HTML (everything after).

Existing rows are flipped to MARKDOWN so the one-shot conversion
script in `backend/scripts/migrate_notes_to_html.py` can pick them up.
New rows default to HTML — the TipTap editor is the only writer going
forward. The column stays for one release so a bad conversion can be
spotted and rolled back from a backup per-note; the next migration
will drop it.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    fmt = sa.Enum("MARKDOWN", "HTML", name="note_content_format")
    fmt.create(op.get_bind(), checkfirst=True)

    # Default to MARKDOWN for the column-add so existing rows get
    # MARKDOWN automatically; new inserts use the model's HTML default.
    # Once everything is migrated we can drop the server_default but
    # leave the column NOT NULL.
    op.add_column(
        "notes",
        sa.Column(
            "content_format",
            fmt,
            nullable=False,
            server_default="MARKDOWN",
        ),
    )
    # Flip the server-side default to HTML so future inserts don't have
    # to specify the column. The model's Python-side default keeps
    # working alongside this.
    op.alter_column("notes", "content_format", server_default="HTML")


def downgrade() -> None:
    op.drop_column("notes", "content_format")
    sa.Enum(name="note_content_format").drop(op.get_bind(), checkfirst=True)
