"""tasks layer — list_item assignee/due/reminder + task_items table

Revision ID: 0018
Revises: 0017
Create Date: 2026-05-15 22:00:00

Adds the columns that turn any list item into a task (assignee_id,
due_at, reminder_at, reminder_sent) and creates the task_items table
that powers per-task addressing inside a note's TipTap doc.

The data migration of existing note tasks (parse <li data-type=
"taskItem"> out of every note's content, insert a row, patch the
HTML with the new data-task-id attribute) is in
`scripts/migrate_note_tasks_to_rows.py` — runs once after this
schema migration is applied. Same shape as
scripts/migrate_notes_to_html.py from alembic 0016.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- ListItem: assignee/due/reminder columns ------------------------
    op.add_column(
        "list_items",
        sa.Column(
            "assignee_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_list_items_assignee_id", "list_items", ["assignee_id"], unique=False
    )
    op.add_column(
        "list_items",
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_list_items_due_at", "list_items", ["due_at"], unique=False
    )
    op.add_column(
        "list_items",
        sa.Column("reminder_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_list_items_reminder_at", "list_items", ["reminder_at"], unique=False
    )
    op.add_column(
        "list_items",
        sa.Column(
            "reminder_sent",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # ---- TaskItem: one row per <li data-type="taskItem"> in a note -------
    op.create_table(
        "task_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "note_id",
            sa.Integer,
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("text", sa.String(2000), nullable=False, server_default=""),
        sa.Column(
            "is_done",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "assignee_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminder_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reminder_sent",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_task_items_due_at", "task_items", ["due_at"], unique=False
    )
    op.create_index(
        "ix_task_items_reminder_at", "task_items", ["reminder_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_task_items_reminder_at", table_name="task_items")
    op.drop_index("ix_task_items_due_at", table_name="task_items")
    op.drop_table("task_items")
    op.drop_column("list_items", "reminder_sent")
    op.drop_index("ix_list_items_reminder_at", table_name="list_items")
    op.drop_column("list_items", "reminder_at")
    op.drop_index("ix_list_items_due_at", table_name="list_items")
    op.drop_column("list_items", "due_at")
    op.drop_index("ix_list_items_assignee_id", table_name="list_items")
    op.drop_column("list_items", "assignee_id")
