"""Seed script — creates initial admin user if none exists. Idempotent."""
import asyncio
import logging

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        if result.scalar_one_or_none():
            logger.info("Admin user already exists, skipping seed")
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


if __name__ == "__main__":
    asyncio.run(seed())
