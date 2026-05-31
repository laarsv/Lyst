from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.email.sender import send_email
from app.email.templates import plant_care_reminder_email
from app.models.plant import Plant
from app.models.user import User


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """Treat naive timestamps as UTC — asyncpg returns tz-aware, but a
    value set in-process before a commit/refresh can still be naive."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


# ---------- Computed "next due" — the single source of truth ----------
#
# Used by serialization, the /due overview, AND the scheduler so "is it
# due" is defined in exactly one place. No next-due column is stored.

def next_water_due(plant: Plant) -> datetime | None:
    if plant.watering_interval_days is None or plant.last_watered_at is None:
        return None
    return _aware(plant.last_watered_at) + timedelta(days=plant.watering_interval_days)


def fertilize_in_season(plant: Plant, now: datetime) -> bool:
    """True when `now`'s month is inside the fertilize season. Used for the
    "in season now" display flag. No season set (either bound NULL) → False
    (nothing to be in). Supports wrap-around windows (e.g. Nov–Feb → start>end)."""
    s, e = plant.fertilize_start_month, plant.fertilize_end_month
    if s is None or e is None:
        return False
    m = now.month
    return s <= m <= e if s <= e else (m >= s or m <= e)


def prune_due(plant: Plant, now: datetime) -> bool:
    """True when the current month is the configured prune month."""
    return plant.prune_month is not None and plant.prune_month == now.month


# ---------- CRUD ----------

async def list_plants(
    db: AsyncSession,
    owner_id: int,
    *,
    q: str | None = None,
    tag: str | None = None,
) -> list[Plant]:
    """List the user's plants. `tag` filters to plants carrying that tag
    (exact array membership via .any()) — same mechanism as list_recipes."""
    stmt = select(Plant).where(Plant.owner_id == owner_id).order_by(Plant.name)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Plant.name).like(like),
                func.lower(Plant.species).like(like),
                Plant.tags.any(q.lower()),
            )
        )
    if tag:
        stmt = stmt.where(Plant.tags.any(tag))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_plant(db: AsyncSession, plant_id: int, owner_id: int) -> Plant:
    result = await db.execute(
        select(Plant).where(Plant.id == plant_id, Plant.owner_id == owner_id)
    )
    plant = result.scalar_one_or_none()
    if not plant:
        raise ValueError("Plant not found")
    return plant


async def create_plant(
    db: AsyncSession,
    owner_id: int,
    *,
    last_watered_at: datetime | None = None,
    last_fertilized_at: datetime | None = None,
    **fields,
) -> Plant:
    plant = Plant(
        owner_id=owner_id,
        last_watered_at=_aware(last_watered_at) or _utcnow(),
        # last_fertilized_at is a log only — leave NULL when not supplied
        # (fertilizing is season-driven, not a cycle that needs a start).
        last_fertilized_at=_aware(last_fertilized_at),
        **fields,
    )
    db.add(plant)
    await db.commit()
    await db.refresh(plant)
    return plant


# Fields whose new value of None should still be written (i.e. "clear this").
_NULLABLE = {
    "species", "watering_interval_days", "watering_note",
    "height_cm", "width_cm", "image_url", "notes",
    "fertilize_start_month", "fertilize_end_month", "prune_month",
    "bloom_start_month", "bloom_end_month",
}


async def update_plant(db: AsyncSession, plant: Plant, **fields) -> Plant:
    # Re-arm the per-cycle dedup when a schedule-driving field moves — same
    # idea as apply_task_fields() clearing reminder_sent when reminder_at
    # changes. A shorter/longer interval (or toggling fertilize) should let
    # the next cycle fire even if the previous one already did.
    if "watering_interval_days" in fields and fields["watering_interval_days"] != plant.watering_interval_days:
        plant.water_reminder_sent = False
    # Moving a season/prune month re-arms this year's annual reminder.
    if "fertilize_start_month" in fields and fields["fertilize_start_month"] != plant.fertilize_start_month:
        plant.fertilize_reminder_year = None
    if "prune_month" in fields and fields["prune_month"] != plant.prune_month:
        plant.prune_reminder_year = None

    for k, v in fields.items():
        if v is not None or k in _NULLABLE:
            setattr(plant, k, v)

    await db.commit()
    await db.refresh(plant)
    return plant


async def delete_plant(db: AsyncSession, plant: Plant) -> None:
    await db.delete(plant)
    await db.commit()


# ---------- Re-arm actions ("Gegossen" / "Gedüngt") ----------

async def mark_watered(db: AsyncSession, plant: Plant) -> Plant:
    plant.last_watered_at = _utcnow()
    plant.water_reminder_sent = False
    await db.commit()
    await db.refresh(plant)
    return plant


async def mark_fertilized(db: AsyncSession, plant: Plant) -> Plant:
    # Log only — fertilizing is season-driven, so this doesn't touch any
    # reminder state. Just records when the user last fertilised.
    plant.last_fertilized_at = _utcnow()
    await db.commit()
    await db.refresh(plant)
    return plant


# ---------- "Diese Woche fällig" overview ----------

async def due_this_week(db: AsyncSession, owner_id: int) -> list[Plant]:
    """Plants whose next watering is overdue or falls within the next 7 days,
    soonest first. Watering is the only interval-based, "this week"-shaped
    reminder — fertilizing and pruning are annual/seasonal and surface via the
    detail page, not this overview."""
    horizon = _utcnow() + timedelta(days=7)
    result = await db.execute(select(Plant).where(Plant.owner_id == owner_id))
    plants = list(result.scalars().all())
    water = [p for p in plants if (d := next_water_due(p)) is not None and d <= horizon]
    water.sort(key=lambda p: next_water_due(p))
    return water


# ---------- Scheduler support ----------

async def fetch_due_water(db: AsyncSession, now: datetime) -> list[Plant]:
    """Plants whose interval-based watering reminder is due and not yet sent
    this cycle. Re-arm is a user action (mark_watered clears the flag)."""
    candidates = (
        await db.execute(
            select(Plant).where(
                Plant.watering_interval_days.is_not(None),
                Plant.last_watered_at.is_not(None),
                Plant.water_reminder_sent.is_(False),
            )
        )
    ).scalars().all()
    return [p for p in candidates if (d := next_water_due(p)) is not None and d <= now]


async def fetch_due_fertilize_season(db: AsyncSession, now: datetime) -> list[Plant]:
    """Plants whose ANNUAL fertilize reminder is due: fertilizing is on, the
    current month matches `fertilize_start_month`, and we haven't already fired
    this calendar year. Mirrors fetch_due_prune."""
    rows = (
        await db.execute(
            select(Plant).where(
                Plant.fertilize.is_(True),
                Plant.fertilize_start_month.is_not(None),
            )
        )
    ).scalars().all()
    return [
        p for p in rows
        if p.fertilize_start_month == now.month and p.fertilize_reminder_year != now.year
    ]


async def fetch_due_prune(db: AsyncSession, now: datetime) -> list[Plant]:
    """Plants whose annual prune reminder is due: the current month matches
    `prune_month` and we haven't already fired this calendar year."""
    rows = (
        await db.execute(select(Plant).where(Plant.prune_month.is_not(None)))
    ).scalars().all()
    return [p for p in rows if p.prune_month == now.month and p.prune_reminder_year != now.year]


async def notify_plant_care(db: AsyncSession, plant: Plant, *, kind: str) -> None:
    """Send one care-reminder email to the plant's owner. `kind` is
    "water", "fertilize" or "prune". Caller has already flipped the matching
    dedup field and committed (mirrors the task-reminder path)."""
    owner = (
        await db.execute(select(User).where(User.id == plant.owner_id))
    ).scalar_one_or_none()
    if not owner or not owner.is_active:
        return
    app_url = f"{settings.FRONTEND_URL}/plants/{plant.id}"
    subject, html = plant_care_reminder_email(
        plant.name, kind, plant.watering_note if kind == "water" else None, app_url
    )
    await send_email(owner.email, subject, html)
