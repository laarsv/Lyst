from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_reset_token,
    hash_password,
    verify_password,
)
from app.email.sender import send_email
from app.email.templates import password_reset_email, welcome_email
from app.models.user import User


async def authenticate(db: AsyncSession, email: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.lower()))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    user.last_login = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return user


async def request_password_reset(db: AsyncSession, email: str) -> None:
    """Always returns success (no user enumeration). Sends email if user exists."""
    result = await db.execute(select(User).where(User.email == email.lower()))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return
    token = create_reset_token(str(user.id))
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    subject, html = password_reset_email(user.name, reset_url)
    await send_email(user.email, subject, html)


async def confirm_password_reset(db: AsyncSession, user_id: int, new_password: str) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise ValueError("User not found or inactive")
    user.hashed_password = hash_password(new_password)
    await db.commit()
    return user


async def accept_invite(
    db: AsyncSession, email: str, name: str, password: str
) -> User:
    result = await db.execute(select(User).where(User.email == email.lower()))
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("Invite invalid")
    user.name = name
    user.hashed_password = hash_password(password)
    user.email_verified = True
    user.is_active = True
    await db.commit()
    await db.refresh(user)
    subject, html = welcome_email(user.name, settings.FRONTEND_URL)
    await send_email(user.email, subject, html)
    return user
