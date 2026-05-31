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


def next_fertilize_due(plant: Plant) -> datetime | None:
    if not plant.fertilize or plant.fertilize_interval_days is None or plant.last_fertilized_at is None:
        return None
    return _aware(plant.last_fertilized_at) + timedelta(days=plant.fertilize_interval_days)


# ---------- CRUD ----------

async def list_plants(db: AsyncSession, owner_id: int, *, q: str | None = None) -> list[Plant]:
    stmt = select(Plant).where(Plant.owner_id == owner_id).order_by(Plant.name)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(func.lower(Plant.name).like(like), func.lower(Plant.species).like(like))
        )
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
    now = _utcnow()
    plant = Plant(
        owner_id=owner_id,
        last_watered_at=_aware(last_watered_at) or now,
        last_fertilized_at=_aware(last_fertilized_at),
        **fields,
    )
    # Fertilizing turned on but no start date given → start the cycle now so
    # the first reminder fires one interval out (parallels watering's default).
    if plant.fertilize and plant.last_fertilized_at is None:
        plant.last_fertilized_at = now
    db.add(plant)
    await db.commit()
    await db.refresh(plant)
    return plant


# Fields whose new value of None should still be written (i.e. "clear this").
_NULLABLE = {
    "species", "watering_interval_days", "watering_note", "fertilize_interval_days",
    "height_cm", "width_cm", "image_url", "notes",
}


async def update_plant(db: AsyncSession, plant: Plant, **fields) -> Plant:
    # Re-arm the per-cycle dedup when a schedule-driving field moves — same
    # idea as apply_task_fields() clearing reminder_sent when reminder_at
    # changes. A shorter/longer interval (or toggling fertilize) should let
    # the next cycle fire even if the previous one already did.
    if "watering_interval_days" in fields and fields["watering_interval_days"] != plant.watering_interval_days:
        plant.water_reminder_sent = False
    if "fertilize_interval_days" in fields and fields["fertilize_interval_days"] != plant.fertilize_interval_days:
        plant.fertilize_reminder_sent = False
    if "fertilize" in fields and fields["fertilize"] != plant.fertilize:
        plant.fertilize_reminder_sent = False

    for k, v in fields.items():
        if v is not None or k in _NULLABLE:
            setattr(plant, k, v)

    # Enabling fertilize on a plant that never had a start date → begin now.
    if plant.fertilize and plant.last_fertilized_at is None:
        plant.last_fertilized_at = _utcnow()

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
    plant.last_fertilized_at = _utcnow()
    plant.fertilize_reminder_sent = False
    await db.commit()
    await db.refresh(plant)
    return plant


# ---------- "Diese Woche fällig" overview ----------

async def due_this_week(db: AsyncSession, owner_id: int) -> dict[str, list[Plant]]:
    """Plants whose next water/fertilize moment is already overdue or falls
    within the next 7 days. Personal inventory → small N, so we fetch the
    owner's plants and reuse the computed-due helpers rather than encoding
    interval arithmetic in SQL."""
    horizon = _utcnow() + timedelta(days=7)
    result = await db.execute(select(Plant).where(Plant.owner_id == owner_id))
    plants = list(result.scalars().all())
    water = [p for p in plants if (d := next_water_due(p)) is not None and d <= horizon]
    fertilize = [p for p in plants if (d := next_fertilize_due(p)) is not None and d <= horizon]
    water.sort(key=lambda p: next_water_due(p))
    fertilize.sort(key=lambda p: next_fertilize_due(p))
    return {"water": water, "fertilize": fertilize}


# ---------- Scheduler support ----------

async def fetch_due_care(db: AsyncSession, now: datetime) -> tuple[list[Plant], list[Plant]]:
    """Return (due_water, due_fertilize) — plants whose reminder hasn't been
    sent for the current cycle and whose next-due moment has passed. The DB
    filter trims to plausible rows (interval set, not yet sent); the Python
    pass applies the same next_*_due logic the rest of the module uses."""
    water_candidates = (
        await db.execute(
            select(Plant).where(
                Plant.watering_interval_days.is_not(None),
                Plant.last_watered_at.is_not(None),
                Plant.water_reminder_sent.is_(False),
            )
        )
    ).scalars().all()
    due_water = [p for p in water_candidates if (d := next_water_due(p)) is not None and d <= now]

    fertilize_candidates = (
        await db.execute(
            select(Plant).where(
                Plant.fertilize.is_(True),
                Plant.fertilize_interval_days.is_not(None),
                Plant.last_fertilized_at.is_not(None),
                Plant.fertilize_reminder_sent.is_(False),
            )
        )
    ).scalars().all()
    due_fertilize = [p for p in fertilize_candidates if (d := next_fertilize_due(p)) is not None and d <= now]

    return due_water, due_fertilize


async def notify_plant_care(db: AsyncSession, plant: Plant, *, kind: str) -> None:
    """Send one care-reminder email to the plant's owner. `kind` is
    "water" or "fertilize". Caller has already flipped the matching
    *_reminder_sent flag and committed (mirrors the task-reminder path)."""
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
