"""recipe_ingredients: add USDA to nutrition_source enum + usda_fdc_id

Revision ID: 0021
Revises: 0020
Create Date: 2026-05-20 21:00:00

USDA FoodData Central joins Open Food Facts as a nutrition source in
v1.4. Two schema touches:

  - Append "usda" to the `nutrition_source` Postgres enum. ALTER TYPE …
    ADD VALUE has to run outside a transaction (Postgres rule), so we
    detach the migration from the implicit txn for the upgrade step.
  - New column `usda_fdc_id` (varchar 32) parallel to `off_product_code`
    — set when nutrition_source == 'usda', NULL otherwise. Same purpose:
    lets a later "Werte aktualisieren" re-fetch the same food row.

Downgrade rebuilds the enum without 'usda' and nulls any rows that
were using it (very few — only ingredients filled after v1.4 shipped).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE … ADD VALUE can't run inside a transaction block on
    # Postgres < 12. COMMIT first, then add the new label.
    bind = op.get_bind()
    bind.execute(sa.text("COMMIT"))
    bind.execute(
        sa.text("ALTER TYPE nutrition_source ADD VALUE IF NOT EXISTS 'usda'")
    )
    # Re-open a transaction for the column addition. Alembic's framework
    # handles the wrapping after this point.
    op.add_column(
        "recipe_ingredients",
        sa.Column("usda_fdc_id", sa.String(32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("recipe_ingredients", "usda_fdc_id")
    # Rebuild the enum without 'usda'. Any rows still on 'usda' get
    # nulled out — they revert to "no source recorded", which is the
    # safe default since the underlying values stay intact.
    op.execute(
        "UPDATE recipe_ingredients SET nutrition_source = NULL "
        "WHERE nutrition_source::text = 'usda'"
    )
    op.execute("ALTER TYPE nutrition_source RENAME TO nutrition_source_old")
    op.execute(
        "CREATE TYPE nutrition_source AS ENUM ('off', 'ai', 'manual')"
    )
    op.execute(
        "ALTER TABLE recipe_ingredients "
        "ALTER COLUMN nutrition_source TYPE nutrition_source "
        "USING nutrition_source::text::nutrition_source"
    )
    op.execute("DROP TYPE nutrition_source_old")
