"""plants: personal plant inventory + recurring care reminders

Revision ID: 0023
Revises: 0022
Create Date: 2026-05-31 12:00:00

Adds the Pflanzen module's single table. `plant_location` is created as
its own enum (create_type=False on the column so we own the DROP TYPE in
downgrade — same pattern as nutrition_source in 0020).

The watering/fertilizing recurrence rides on existing infra: there are no
next-due columns — "due" is computed as last_*_at + interval at query
time. The two `*_reminder_sent` booleans are the per-cycle dedup the
once-a-minute scheduler checks (mirrors reminders.sent /
list_items.reminder_sent); marking a plant watered/fertilised resets them.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # One enum object, used inline in create_table — the table creation emits
    # CREATE TYPE for us (same pattern as recipe_category in 0002). The
    # explicit .create()/create_type=False dance is only needed for add_column
    # (see 0020), not create_table.
    plant_location = sa.Enum(
        "SONNIG", "HALBSCHATTEN", "SCHATTEN", name="plant_location"
    )

    op.create_table(
        "plants",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("species", sa.String(255), nullable=True),
        sa.Column("location", plant_location, nullable=False, server_default="HALBSCHATTEN"),
        sa.Column("watering_interval_days", sa.Integer, nullable=True),
        sa.Column("watering_note", sa.Text, nullable=True),
        sa.Column("fertilize", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("fertilize_interval_days", sa.Integer, nullable=True),
        sa.Column("winterhardy", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("edible", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("height_cm", sa.Integer, nullable=True),
        sa.Column("width_cm", sa.Integer, nullable=True),
        sa.Column("image_url", sa.String(1024), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("last_watered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_fertilized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("water_reminder_sent", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("fertilize_reminder_sent", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_plants_owner_id", "plants", ["owner_id"])
    op.create_index("ix_plants_last_watered_at", "plants", ["last_watered_at"])
    op.create_index("ix_plants_last_fertilized_at", "plants", ["last_fertilized_at"])


def downgrade() -> None:
    op.drop_index("ix_plants_last_fertilized_at", table_name="plants")
    op.drop_index("ix_plants_last_watered_at", table_name="plants")
    op.drop_index("ix_plants_owner_id", table_name="plants")
    op.drop_table("plants")
    op.execute("DROP TYPE IF EXISTS plant_location")
