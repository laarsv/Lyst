"""fitness: exercises library, workouts, sessions, set logs

Revision ID: 0027
Revises: 0026
Create Date: 2026-06-03 10:00:00

Additive — one migration creates the whole Fitness module:
  - 3 enums (exercise_type, exercise_location, tracking_type), created inline
    with the exercises table (same pattern as recipe_category in 0002).
  - exercises (shared library; owner_id NULL = global seed)
  - workouts + workout_exercises (private templates)
  - workout_sessions + set_logs (private logged training)

exercise_id FKs use ON DELETE RESTRICT so a referenced exercise can't be
deleted out from under a workout/log (the service surfaces a clear 409).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    exercise_type = sa.Enum("AUFBAU", "DEHNEN", "PHYSIO", name="exercise_type")
    exercise_location = sa.Enum("STUDIO", "HOME", "BEIDES", name="exercise_location")
    tracking_type = sa.Enum("REPS", "WEIGHT_REPS", "TIME", name="tracking_type")

    op.create_table(
        "exercises",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("muscle_group", sa.String(64), nullable=False),
        sa.Column("type", exercise_type, nullable=False),
        sa.Column("location", exercise_location, nullable=False),
        sa.Column("tracking_type", tracking_type, nullable=False),
        sa.Column("instructions", sa.Text, nullable=True),
        sa.Column("image_url", sa.String(1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_exercises_owner_id", "exercises", ["owner_id"])
    op.create_index("ix_exercises_muscle_group", "exercises", ["muscle_group"])

    op.create_table(
        "workouts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_workouts_owner_id", "workouts", ["owner_id"])

    op.create_table(
        "workout_exercises",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("workout_id", sa.Integer, sa.ForeignKey("workouts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("exercise_id", sa.Integer, sa.ForeignKey("exercises.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("target_sets", sa.Integer, nullable=True),
        sa.Column("target_reps", sa.Integer, nullable=True),
        sa.Column("target_weight", sa.Float, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_workout_exercises_workout_id", "workout_exercises", ["workout_id"])
    op.create_index("ix_workout_exercises_exercise_id", "workout_exercises", ["exercise_id"])
    op.create_index("ix_workout_exercises_position", "workout_exercises", ["position"])

    op.create_table(
        "workout_sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workout_id", sa.Integer, sa.ForeignKey("workouts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_workout_sessions_owner_id", "workout_sessions", ["owner_id"])
    op.create_index("ix_workout_sessions_started_at", "workout_sessions", ["started_at"])

    op.create_table(
        "set_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("session_id", sa.Integer, sa.ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("exercise_id", sa.Integer, sa.ForeignKey("exercises.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("set_number", sa.Integer, nullable=False),
        sa.Column("reps_done", sa.Integer, nullable=True),
        sa.Column("weight_done", sa.Float, nullable=True),
        sa.Column("duration_done", sa.Integer, nullable=True),
        sa.Column("completed", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_set_logs_session_id", "set_logs", ["session_id"])
    op.create_index("ix_set_logs_exercise_id", "set_logs", ["exercise_id"])


def downgrade() -> None:
    op.drop_table("set_logs")
    op.drop_table("workout_sessions")
    op.drop_table("workout_exercises")
    op.drop_table("workouts")
    op.drop_table("exercises")
    op.execute("DROP TYPE IF EXISTS tracking_type")
    op.execute("DROP TYPE IF EXISTS exercise_location")
    op.execute("DROP TYPE IF EXISTS exercise_type")
