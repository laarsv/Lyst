"""Seed script — runs on every container start. Idempotent.

Two independent seeders:
  - seed_admin:     creates the initial admin if no admin exists.
  - seed_exercises: upserts the global Fitness exercise library by name.

They MUST stay independent: seed_admin early-returns once an admin exists, so
exercise seeding cannot live behind that check (it would never run on existing
deployments).
"""
import asyncio
import logging

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.fitness import Exercise, ExerciseLocation, ExerciseType, TrackingType
from app.models.user import User, UserRole
from app.seed_data.exercises import EXERCISES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def seed_admin() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        if result.scalar_one_or_none():
            logger.info("Admin user already exists, skipping admin seed")
            return
        admin = User(
            email=settings.INITIAL_ADMIN_EMAIL.lower(),
            name=settings.INITIAL_ADMIN_NAME,
            hashed_password=hash_password(settings.INITIAL_ADMIN_PASSWORD),
            role=UserRole.ADMIN,
            is_active=True,
            email_verified=True,
        )
        db.add(admin)
        await db.commit()
        logger.info("Created admin user: %s", admin.email)


def _exercise_kwargs(item: dict) -> dict:
    """Map a seed dict → Exercise kwargs, coercing the enum string values."""
    return {
        "name": item["name"],
        "muscle_group": item["muscle_group"],
        "type": ExerciseType(item["type"]),
        "location": ExerciseLocation(item["location"]),
        "tracking_type": TrackingType(item["tracking_type"]),
        "instructions": item.get("instructions"),
        "image_url": item.get("image_url"),
    }


async def seed_exercises() -> None:
    """Upsert global exercises by name (owner_id NULL). Fields of existing
    globals are updated; names are never renamed (stable keys)."""
    if not EXERCISES:
        logger.info("No global exercises to seed")
        return
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(select(Exercise).where(Exercise.owner_id.is_(None)))
        ).scalars().all()
        by_name = {e.name: e for e in rows}
        created = updated = 0
        for item in EXERCISES:
            kwargs = _exercise_kwargs(item)
            existing = by_name.get(kwargs["name"])
            if existing is None:
                db.add(Exercise(owner_id=None, **kwargs))
                created += 1
            else:
                for k, v in kwargs.items():
                    if k != "name":
                        setattr(existing, k, v)
                updated += 1
        await db.commit()
        logger.info("Seeded global exercises: +%d new, %d updated", created, updated)


async def seed() -> None:
    await seed_admin()
    await seed_exercises()


if __name__ == "__main__":
    asyncio.run(seed())
