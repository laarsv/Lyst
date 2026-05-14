"""recipe + recipe-book sharing; migrate recipes.category → tags + drop column

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-15 10:00:00

Three things in one revision (they always ship together):

  1. recipes.share_token + share_enabled — single recipe sharing.
  2. users.recipe_book_share_token + recipe_book_share_enabled — share
     a user's whole recipe book.
  3. Migrate every recipe's RecipeCategory enum value into the existing
     `tags` array (German label), then drop the `category` column and
     the recipe_category enum type. OTHER is dropped silently — it
     means "uncategorised" so adding a tag would be noise.

The data move runs BEFORE the column drop. If a tag was already present
(e.g. user manually added "Frühstück") we don't duplicate it.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Mapping from the old enum to the German label we'll add as a tag.
# OTHER → no tag (it just meant "uncategorised").
CATEGORY_TO_TAG = {
    "BREAKFAST": "Frühstück",
    "LUNCH": "Mittagessen",
    "DINNER": "Abendessen",
    "SNACK": "Snack",
    "DESSERT": "Dessert",
    "DRINK": "Getränk",
}


def upgrade() -> None:
    # ----- 1. recipes share columns --------------------------------------
    op.add_column(
        "recipes",
        sa.Column("share_token", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "recipes",
        sa.Column(
            "share_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_recipes_share_token", "recipes", ["share_token"], unique=True
    )

    # ----- 2. users recipe-book share columns ----------------------------
    op.add_column(
        "users",
        sa.Column("recipe_book_share_token", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "recipe_book_share_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_users_recipe_book_share_token",
        "users",
        ["recipe_book_share_token"],
        unique=True,
    )

    # ----- 3. category → tag migration -----------------------------------
    # array_append idempotently extends `tags`; the WHERE clause skips
    # rows where the tag is already present so manual tags aren't doubled.
    bind = op.get_bind()
    for enum_value, tag in CATEGORY_TO_TAG.items():
        bind.execute(
            sa.text(
                "UPDATE recipes "
                "SET tags = array_append(tags, :tag) "
                "WHERE category::text = :cat "
                "AND NOT (:tag = ANY(tags))"
            ),
            {"cat": enum_value, "tag": tag},
        )

    # Now drop the column + the enum type itself.
    op.drop_column("recipes", "category")
    sa.Enum(name="recipe_category").drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    # Recreate the enum + column with a default of OTHER. Tag-based
    # categorisation isn't fully reversible — we don't try to map tags
    # back to enum values; old rows get OTHER, which is the safe default.
    cat = sa.Enum(
        "BREAKFAST", "LUNCH", "DINNER", "SNACK", "DESSERT", "DRINK", "OTHER",
        name="recipe_category",
    )
    cat.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "recipes",
        sa.Column("category", cat, nullable=False, server_default="OTHER"),
    )

    op.drop_index("ix_users_recipe_book_share_token", table_name="users")
    op.drop_column("users", "recipe_book_share_enabled")
    op.drop_column("users", "recipe_book_share_token")

    op.drop_index("ix_recipes_share_token", table_name="recipes")
    op.drop_column("recipes", "share_enabled")
    op.drop_column("recipes", "share_token")
