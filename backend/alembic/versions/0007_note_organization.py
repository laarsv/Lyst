"""note folders + pin / archive flags

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-12 09:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "note_folders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("color", sa.String(9), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_note_folders_owner_id", "note_folders", ["owner_id"])

    op.add_column(
        "notes",
        sa.Column(
            "folder_id",
            sa.Integer,
            sa.ForeignKey("note_folders.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_notes_folder_id", "notes", ["folder_id"])
    op.add_column("notes", sa.Column("is_pinned", sa.Boolean, nullable=False, server_default=sa.false()))
    op.add_column("notes", sa.Column("is_archived", sa.Boolean, nullable=False, server_default=sa.false()))
    op.create_index("ix_notes_is_pinned", "notes", ["is_pinned"])
    op.create_index("ix_notes_is_archived", "notes", ["is_archived"])


def downgrade() -> None:
    op.drop_index("ix_notes_is_archived", table_name="notes")
    op.drop_index("ix_notes_is_pinned", table_name="notes")
    op.drop_column("notes", "is_archived")
    op.drop_column("notes", "is_pinned")
    op.drop_index("ix_notes_folder_id", table_name="notes")
    op.drop_column("notes", "folder_id")
    op.drop_table("note_folders")
