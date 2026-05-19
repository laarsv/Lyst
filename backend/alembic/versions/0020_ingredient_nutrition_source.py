"""recipe_ingredients: fiber/sugar/salt + nutrition_source enum + off_product_code

Revision ID: 0020
Revises: 0019
Create Date: 2026-05-19 19:30:00

Rounds out the per-100g nutrition columns (fiber, sugar, salt — only
calories/protein/carbs/fat existed before in 0005) and adds two
traceability columns:

  - nutrition_source: where the values came from (off / ai / manual).
    NULL means "no nutrition data yet" — kept distinct from manual so
    the auto-lookup flow can tell apart "never tried" from "user said
    these are the values".
  - off_product_code: the Open Food Facts barcode the row was filled
    from. Lets us re-fetch the same product later (e.g. when the user
    hits "Werte aktualisieren") and link back to the OFF page from the
    source badge tooltip.

Enum is created with create_type=False on the column so we own the
DROP TYPE in downgrade — same pattern as the existing
collaborator_permission enum.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


nutrition_source_enum = sa.Enum(
    "off", "ai", "manual", name="nutrition_source"
)


def upgrade() -> None:
    nutrition_source_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "recipe_ingredients",
        sa.Column("fiber_per_100g", sa.Float, nullable=True),
    )
    op.add_column(
        "recipe_ingredients",
        sa.Column("sugar_per_100g", sa.Float, nullable=True),
    )
    op.add_column(
        "recipe_ingredients",
        sa.Column("salt_per_100g", sa.Float, nullable=True),
    )
    op.add_column(
        "recipe_ingredients",
        sa.Column(
            "nutrition_source",
            sa.Enum(
                "off", "ai", "manual",
                name="nutrition_source",
                create_type=False,
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "recipe_ingredients",
        sa.Column("off_product_code", sa.String(32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("recipe_ingredients", "off_product_code")
    op.drop_column("recipe_ingredients", "nutrition_source")
    op.drop_column("recipe_ingredients", "salt_per_100g")
    op.drop_column("recipe_ingredients", "sugar_per_100g")
    op.drop_column("recipe_ingredients", "fiber_per_100g")
    nutrition_source_enum.drop(op.get_bind(), checkfirst=True)
