"""clear shopping categories from packing-list items

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-15 18:00:00

Before this fix, the auto-categorizer always wrote shopping categories
(Obst & Gemüse, Milchprodukte, …) regardless of list type. Existing
PACKING-list items therefore carry meaningless shopping categories that
will never match a PACKING grouping header.

The cleanest recovery is to NULL out `category` + `category_locked` on
those rows so the user can re-trigger categorization (which now uses
the correct PACKING prompt) — or just leave them uncategorized.

Strictly scoped:
  - only `list_items` rows whose parent list is PACKING
  - only rows whose current category is one of the SHOPPING categories

We don't touch SHOPPING-list items (those are correctly categorized),
CHECKLIST items (those are set by the AI generator and should stay), or
items with a manually-locked category on SHOPPING lists.

The downgrade is a no-op — we can't reconstruct the (wrong) labels.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Keep this list in sync with backend.app.services.category_service.CATEGORIES_SHOPPING.
# Hardcoded inline rather than imported because alembic migrations should
# describe the schema state at this revision, not chase service code.
SHOPPING_CATEGORIES = [
    "Obst & Gemüse",
    "Milchprodukte",
    "Tiefkühl",
    "Backwaren",
    "Fleisch & Fisch",
    "Getränke",
    "Trockenwaren",
    "Süßes",
    "Hygiene",
    "Sonstiges",
]


def upgrade() -> None:
    array_literal = "ARRAY[" + ", ".join(f"'{c}'" for c in SHOPPING_CATEGORIES) + "]"
    op.execute(
        f"""
        UPDATE list_items
           SET category = NULL,
               category_locked = false
         WHERE category = ANY({array_literal})
           AND list_id IN (
               SELECT id FROM lists WHERE type = 'PACKING'
           )
        """
    )


def downgrade() -> None:
    # Lossy migration — we discarded the (wrong) categories on purpose.
    pass
