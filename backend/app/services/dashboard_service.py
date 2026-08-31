"""Aggregates the "Heute" overview in one round-trip.

Design rules for what belongs here (see also schemas/dashboard.py):
  * Only time-critical, actionable things — stuff the user would MISS.
    No counters ("42 recipes"), no "recently edited".
  * ONE deliberate exception: pinned lists. They are not time-critical, but
    they are not system-derived either — the user pinned them by hand and
    wants them on this screen. Everything else here stays automatic.
  * Every block is independent and may come back empty; the frontend hides
    empty blocks rather than rendering placeholders.

Day boundaries are UTC, matching the rest of the app (the /tasks aggregator
uses `now.date()` in UTC too). For CET/CEST "today" therefore rolls over at
01:00/02:00 local — after cooking hours, so it doesn't bite in practice.
"""
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.collaborator import ListCollaborator
from app.models.fitness import Workout, WorkoutSession
from app.models.list import List as ListModel
from app.models.list_item import ListItem
from app.models.list_pin import ListPin
from app.models.meal_plan import MealPlan, MealPlanEntry
from app.models.note import Note, NoteShare
from app.models.plant import Plant
from app.models.reminder import Reminder
from app.models.task_item import TaskItem
from app.services.meal_plan_service import monday_of
from app.services.plant_service import next_water_due

# How far ahead the reminder block looks. Short on purpose: this is a "today"
# screen, not an agenda.
REMINDER_HORIZON_HOURS = 24


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """Postgres gives us tz-aware values, but rows written before a column
    became timezone=True can be naive — normalise so comparisons never raise."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _end_of_today(now: datetime) -> datetime:
    return datetime.combine(now.date(), time.max, tzinfo=timezone.utc)


# ---------- blocks -----------------------------------------------------------

async def _open_session(db: AsyncSession, user_id: int) -> dict | None:
    """The single in-progress workout, if any. fitness_service enforces at most
    one open session per user, so `.first()` is the whole story."""
    session = (
        await db.execute(
            select(WorkoutSession)
            .options(selectinload(WorkoutSession.sets))
            .where(
                WorkoutSession.owner_id == user_id,
                WorkoutSession.finished_at.is_(None),
            )
            .order_by(WorkoutSession.started_at.desc())
        )
    ).scalars().first()
    if session is None:
        return None

    workout_name: str | None = None
    if session.workout_id is not None:
        workout_name = (
            await db.execute(
                select(Workout.name).where(Workout.id == session.workout_id)
            )
        ).scalar_one_or_none()

    return {
        "id": session.id,
        "workout_id": session.workout_id,
        "workout_name": workout_name,
        "started_at": _aware(session.started_at),
        "logged_sets": len(session.sets),
    }


async def _due_plants(db: AsyncSession, user_id: int, now: datetime) -> list[dict]:
    """Plants whose watering is due today or already overdue. Reuses
    plant_service.next_water_due so the rule stays in one place; plants
    without an interval or without a last-watered date have no due date and
    are skipped by that helper."""
    cutoff = _end_of_today(now)
    plants = (
        await db.execute(select(Plant).where(Plant.owner_id == user_id))
    ).scalars().all()

    out: list[dict] = []
    for p in plants:
        due = next_water_due(p)
        if due is None:
            continue
        due = _aware(due)
        if due > cutoff:
            continue
        out.append(
            {
                "id": p.id,
                "name": p.name,
                "image_url": p.image_url,
                "next_water_due": due,
                "days_overdue": max((now.date() - due.date()).days, 0),
            }
        )
    out.sort(key=lambda r: r["next_water_due"])
    return out


async def _due_tasks(db: AsyncSession, user_id: int, now: datetime) -> list[dict]:
    """Open tasks due today or overdue, from BOTH backing tables.

    Scope is deliberately narrower than the /tasks page: a task counts as
    "mine" when it is assigned to me, or when nobody is assigned and I own the
    parent. In a two-person household an unassigned item on my own list is
    mine; one explicitly assigned to my partner is not.

    NOTE: the "is this row a task at all" rule mirrors routers/tasks.py
    (`_is_task_li` / `_is_task_ti`). If that ever changes, change it here too.
    """
    cutoff = _end_of_today(now)

    owned_list_ids = set(
        (
            await db.execute(select(ListModel.id).where(ListModel.owner_id == user_id))
        ).scalars().all()
    )
    shared_list_ids = set(
        (
            await db.execute(
                select(ListCollaborator.list_id).where(
                    ListCollaborator.user_id == user_id
                )
            )
        ).scalars().all()
    )
    owned_note_ids = set(
        (
            await db.execute(select(Note.id).where(Note.owner_id == user_id))
        ).scalars().all()
    )
    shared_note_ids = set(
        (
            await db.execute(
                select(NoteShare.note_id).where(
                    NoteShare.shared_with_user_id == user_id
                )
            )
        ).scalars().all()
    )

    list_ids = owned_list_ids | shared_list_ids
    note_ids = owned_note_ids | shared_note_ids

    list_titles = {
        lid: title
        for lid, title in (
            await db.execute(
                select(ListModel.id, ListModel.title).where(
                    ListModel.id.in_(list_ids or {0})
                )
            )
        ).all()
    }
    note_titles = {
        nid: title
        for nid, title in (
            await db.execute(
                select(Note.id, Note.title).where(Note.id.in_(note_ids or {0}))
            )
        ).all()
    }

    out: list[dict] = []

    list_items = (
        await db.execute(
            select(ListItem).where(
                ListItem.list_id.in_(list_ids or {0}),
                ListItem.is_checked.is_(False),
                ListItem.due_at.isnot(None),
                ListItem.due_at <= cutoff,
            )
        )
    ).scalars().all()
    for it in list_items:
        mine = it.assignee_id == user_id or (
            it.assignee_id is None and it.list_id in owned_list_ids
        )
        if not mine:
            continue
        due = _aware(it.due_at)
        out.append(
            {
                "id": it.id,
                "source": "list",
                "text": it.text,
                "due_at": due,
                "is_overdue": due < now,
                "parent_id": it.list_id,
                "parent_title": list_titles.get(it.list_id, "Liste"),
            }
        )

    note_tasks = (
        await db.execute(
            select(TaskItem).where(
                TaskItem.note_id.in_(note_ids or {0}),
                TaskItem.is_done.is_(False),
                TaskItem.due_at.isnot(None),
                TaskItem.due_at <= cutoff,
            )
        )
    ).scalars().all()
    for t in note_tasks:
        mine = t.assignee_id == user_id or (
            t.assignee_id is None and t.note_id in owned_note_ids
        )
        if not mine:
            continue
        due = _aware(t.due_at)
        out.append(
            {
                "id": t.id,
                "source": "note",
                "text": t.text,
                "due_at": due,
                "is_overdue": due < now,
                "parent_id": t.note_id,
                "parent_title": note_titles.get(t.note_id) or "(ohne Titel)",
            }
        )

    # Overdue first, then by due date — the thing you're late on leads.
    out.sort(key=lambda r: (not r["is_overdue"], r["due_at"]))
    return out


async def _today_meals(db: AsyncSession, user_id: int, now: datetime) -> list[dict]:
    """Meal-plan entries for today. week_start is the Monday (see
    meal_plan_service.monday_of) and day_of_week is 0=Mon..6=Sun."""
    week_start = monday_of(now.date())
    plan = (
        await db.execute(
            select(MealPlan)
            .options(selectinload(MealPlan.entries).selectinload(MealPlanEntry.recipe))
            .where(MealPlan.owner_id == user_id, MealPlan.week_start == week_start)
        )
    ).scalar_one_or_none()
    if plan is None:
        return []

    today_idx = now.weekday()
    rows = [e for e in plan.entries if e.day_of_week == today_idx]
    rows.sort(key=lambda e: e.id)
    return [
        {
            "entry_id": e.id,
            "recipe_id": e.recipe_id,
            "recipe_title": e.recipe.title if e.recipe else "Rezept",
            "meal_type": e.meal_type.value
            if hasattr(e.meal_type, "value")
            else str(e.meal_type),
            "servings": e.servings,
            "image_url": e.recipe.image_url if e.recipe else None,
        }
        for e in rows
    ]


async def _upcoming_reminders(
    db: AsyncSession, user_id: int, now: datetime
) -> list[dict]:
    """Unsent list reminders firing within the next day."""
    horizon = now + timedelta(hours=REMINDER_HORIZON_HOURS)
    rows = (
        await db.execute(
            select(Reminder)
            .options(selectinload(Reminder.list))
            .where(
                Reminder.user_id == user_id,
                Reminder.sent.is_(False),
                Reminder.remind_at <= horizon,
            )
            .order_by(Reminder.remind_at)
        )
    ).scalars().all()
    return [
        {
            "id": r.id,
            "list_id": r.list_id,
            "list_title": r.list.title if r.list else "Liste",
            "remind_at": _aware(r.remind_at),
            "message": r.message,
        }
        for r in rows
    ]


# ---------- entry point ------------------------------------------------------

async def _pinned_lists(db: AsyncSession, user_id: int) -> list[dict]:
    """Lists the user pinned, oldest pin first.

    Re-checks visibility instead of trusting the pin: a pin outlives a
    revoked share (its FK hangs off the list, not the share row), and a list
    can be turned into a template later. Either way it drops off the board
    quietly rather than showing a list the user can no longer open.
    """
    item_count = func.count(ListItem.id).label("item_count")
    checked_count = func.coalesce(
        func.sum(case((ListItem.is_checked.is_(True), 1), else_=0)), 0
    ).label("checked_count")
    rows = await db.execute(
        select(ListModel, item_count, checked_count)
        .join(ListPin, ListPin.list_id == ListModel.id)
        .outerjoin(ListItem, ListItem.list_id == ListModel.id)
        .where(ListPin.user_id == user_id)
        .where(ListModel.is_template.is_(False))
        .where(
            or_(
                ListModel.owner_id == user_id,
                ListModel.id.in_(
                    select(ListCollaborator.list_id).where(
                        ListCollaborator.user_id == user_id
                    )
                ),
            )
        )
        .group_by(ListModel.id, ListPin.created_at)
        .order_by(ListPin.created_at)
    )
    return [
        {
            "id": lst.id,
            "title": lst.title,
            "color": lst.color,
            "icon": lst.icon,
            "item_count": total,
            "checked_count": checked,
        }
        for lst, total, checked in rows.all()
    ]


async def build_dashboard(db: AsyncSession, user_id: int) -> dict:
    now = _utcnow()
    return {
        "pinned_lists": await _pinned_lists(db, user_id),
        "open_session": await _open_session(db, user_id),
        "due_plants": await _due_plants(db, user_id, now),
        "due_tasks": await _due_tasks(db, user_id, now),
        "today_meals": await _today_meals(db, user_id, now),
        "upcoming_reminders": await _upcoming_reminders(db, user_id, now),
    }
