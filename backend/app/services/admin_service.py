import secrets
import string

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_invite_token,
    create_reset_token,
    hash_password,
)
from app.email.sender import send_email
from app.email.templates import invite_email, password_reset_email
from app.models.list import List as ListModel
from app.models.user import User, UserRole


def generate_temp_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def list_users(db: AsyncSession, q: str | None = None) -> list[tuple[User, int]]:
    stmt = (
        select(User, func.count(ListModel.id))
        .outerjoin(ListModel, ListModel.owner_id == User.id)
        .group_by(User.id)
        .order_by(User.created_at.desc())
    )
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where((func.lower(User.email).like(like)) | (func.lower(User.name).like(like)))
    result = await db.execute(stmt)
    return [(u, c) for u, c in result.all()]


async def create_user(
    db: AsyncSession, email: str, name: str, password: str, role: UserRole
) -> User:
    existing = await db.execute(select(User).where(User.email == email.lower()))
    if existing.scalar_one_or_none():
        raise ValueError("Email already registered")
    user = User(
        email=email.lower(),
        name=name,
        hashed_password=hash_password(password),
        role=role,
        is_active=True,
        email_verified=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class MailDeliveryError(RuntimeError):
    """Raised when an outbound transactional email could not be sent.
    Callers translate this to HTTP 502 so the admin sees a clear failure
    instead of a silently broken invite/reset."""


async def invite_user(db: AsyncSession, email: str, name: str, role: UserRole) -> User:
    existing = await db.execute(select(User).where(User.email == email.lower()))
    if existing.scalar_one_or_none():
        raise ValueError("Email already registered")
    # Pre-flight: refuse before touching the DB if mail can't physically go out.
    if not settings.BREVO_API_KEY:
        raise MailDeliveryError("BREVO_API_KEY ist nicht gesetzt — Einladung kann nicht versendet werden")

    # Stub user that will be activated when the invite is accepted. We commit
    # it *before* sending so the JWT can resolve to a user row when clicked,
    # but we roll it back if Brevo rejects the send — otherwise we'd leave a
    # dead inactive account that the admin thinks they invited.
    user = User(
        email=email.lower(),
        name=name,
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        role=role,
        is_active=False,
        email_verified=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_invite_token(email.lower())
    invite_url = f"{settings.FRONTEND_URL}/accept-invite?token={token}"
    subject, html = invite_email(name, invite_url)
    sent = await send_email(email, subject, html)
    if not sent:
        await db.delete(user)
        await db.commit()
        raise MailDeliveryError(
            "Brevo hat den Versand abgelehnt — Backend-Log prüfen. Einladung wurde nicht gespeichert."
        )
    return user


async def update_user(
    db: AsyncSession,
    user_id: int,
    *,
    name: str | None = None,
    email: str | None = None,
    is_active: bool | None = None,
    role: UserRole | None = None,
) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("User not found")
    if name is not None:
        user.name = name
    if email is not None:
        user.email = email.lower()
    if is_active is not None:
        user.is_active = is_active
    if role is not None:
        user.role = role
    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(db: AsyncSession, user_id: int) -> None:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("User not found")
    await db.delete(user)
    await db.commit()


async def admin_reset_password(db: AsyncSession, user_id: int) -> None:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("User not found")
    if not settings.BREVO_API_KEY:
        raise MailDeliveryError("BREVO_API_KEY ist nicht gesetzt — Reset-Mail kann nicht versendet werden")
    token = create_reset_token(str(user.id))
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    subject, html = password_reset_email(user.name, reset_url)
    sent = await send_email(user.email, subject, html)
    if not sent:
        raise MailDeliveryError("Brevo hat den Versand abgelehnt — Backend-Log prüfen")
