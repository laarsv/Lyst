"""recipe_shares + recipe_book_shares (internal, app-to-app sharing)

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-16 09:00:00

Two tables that map "this recipe / this user's whole recipe book is
visible to that other Lyst user". Distinct from the public share-token
columns added in 0011 — those let anyone with a URL view the content;
these grants surface the recipe/book directly inside the recipient's
Lyst app.

Cascading deletes on both FKs: when the recipe (or owner) goes away,
the share rows go with it. When the recipient is deleted, their
incoming shares vanish — keeps the schema honest with no orphans.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recipe_shares",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "recipe_id",
            sa.Integer,
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
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
            "recipe_id",
            "shared_with_user_id",
            name="uq_recipe_shares_recipe_user",
        ),
    )
    op.create_index(
        "ix_recipe_shares_user", "recipe_shares", ["shared_with_user_id"]
    )

    op.create_table(
        "recipe_book_shares",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "owner_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
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
            "owner_id",
            "shared_with_user_id",
            name="uq_recipe_book_shares_owner_user",
        ),
        sa.CheckConstraint(
            "owner_id <> shared_with_user_id",
            name="ck_recipe_book_shares_no_self",
        ),
    )
    op.create_index(
        "ix_recipe_book_shares_user",
        "recipe_book_shares",
        ["shared_with_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_recipe_book_shares_user", table_name="recipe_book_shares")
    op.drop_table("recipe_book_shares")
    op.drop_index("ix_recipe_shares_user", table_name="recipe_shares")
    op.drop_table("recipe_shares")
