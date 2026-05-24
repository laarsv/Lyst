"""hot-path indexes: GIN on tag arrays + (owner_id, updated_at DESC) composites

Revision ID: 0022
Revises: 0021
Create Date: 2026-05-24 00:00:00

The recipes/notes list views are the two most common reads in the app.
Both filter on `tags` (ARRAY(String)) via SQLAlchemy's `Recipe.tags.any(...)`
/ `Note.tags.any(...)` — without a GIN index that's a sequential scan
across every row owned by the user. With ~hundreds of notes/recipes per
household it's measurable; with thousands it's painful.

Both also sort `ORDER BY updated_at DESC` per owner. Postgres can use a
multi-column btree to satisfy `WHERE owner_id = ? ORDER BY updated_at DESC`
without an in-memory sort, which is the actual win here.

Same story for notifications — the bell dropdown does
`WHERE user_id = ? ORDER BY created_at DESC LIMIT N`.

All five indexes use IF NOT EXISTS so re-running the migration after a
partial failure is safe.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_recipes_tags_gin "
        "ON recipes USING GIN (tags)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notes_tags_gin "
        "ON notes USING GIN (tags)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_recipes_owner_updated "
        "ON recipes (owner_id, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notes_owner_updated "
        "ON notes (owner_id, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notifications_user_created "
        "ON notifications (user_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notifications_user_created")
    op.execute("DROP INDEX IF EXISTS ix_notes_owner_updated")
    op.execute("DROP INDEX IF EXISTS ix_recipes_owner_updated")
    op.execute("DROP INDEX IF EXISTS ix_notes_tags_gin")
    op.execute("DROP INDEX IF EXISTS ix_recipes_tags_gin")
