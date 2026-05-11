"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-11 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    user_role = sa.Enum("admin", "user", name="user_role")
    list_type = sa.Enum("SHOPPING", "PACKING", "CHECKLIST", "CUSTOM", name="list_type")
    coll_perm = sa.Enum("VIEW", "EDIT", name="collaborator_permission")

    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", user_role, nullable=False, server_default="user"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("email_verified", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "lists",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("type", list_type, nullable=False, server_default="CUSTOM"),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("color", sa.String(9), nullable=True),
        sa.Column("icon", sa.String(16), nullable=True),
        sa.Column("is_template", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("template_name", sa.String(255), nullable=True),
        sa.Column("share_token", sa.String(64), nullable=True, unique=True),
        sa.Column("share_enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_lists_owner_id", "lists", ["owner_id"])
    op.create_index("ix_lists_share_token", "lists", ["share_token"], unique=True)

    op.create_table(
        "list_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("list_id", sa.Integer, sa.ForeignKey("lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("is_checked", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("quantity", sa.Float, nullable=True),
        sa.Column("unit", sa.String(32), nullable=True),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_list_items_list_id", "list_items", ["list_id"])
    op.create_index("ix_list_items_position", "list_items", ["position"])

    op.create_table(
        "list_collaborators",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("list_id", sa.Integer, sa.ForeignKey("lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission", coll_perm, nullable=False, server_default="VIEW"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("list_id", "user_id", name="uq_list_user"),
    )
    op.create_index("ix_list_collaborators_list_id", "list_collaborators", ["list_id"])
    op.create_index("ix_list_collaborators_user_id", "list_collaborators", ["user_id"])

    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("list_id", sa.Integer, sa.ForeignKey("lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("remind_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("message", sa.String(500), nullable=True),
        sa.Column("sent", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_reminders_list_id", "reminders", ["list_id"])
    op.create_index("ix_reminders_user_id", "reminders", ["user_id"])
    op.create_index("ix_reminders_remind_at", "reminders", ["remind_at"])
    op.create_index("ix_reminders_sent", "reminders", ["sent"])

    op.create_table(
        "notes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        sa.Column("tags", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_notes_owner_id", "notes", ["owner_id"])

    op.create_table(
        "tags",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("color", sa.String(9), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_id", "name", name="uq_owner_tagname"),
    )
    op.create_index("ix_tags_owner_id", "tags", ["owner_id"])


def downgrade() -> None:
    op.drop_table("tags")
    op.drop_table("notes")
    op.drop_table("reminders")
    op.drop_table("list_collaborators")
    op.drop_table("list_items")
    op.drop_table("lists")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS collaborator_permission")
    op.execute("DROP TYPE IF EXISTS list_type")
    op.execute("DROP TYPE IF EXISTS user_role")
