"""Registration links: an admin-made link lets a group sign itself up.

Security shape: the link is the only gate on a public endpoint, so it is bounded by an
expiry and a use limit, and an admin can delete it at any time. The use is claimed with a
single atomic UPDATE (not read-then-write), in the same transaction as the new user, so a
failed sign-up never burns a use and parallel sign-ups never overshoot `max_uses`.
"""
import secrets
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.base import utcnow
from app.models.registration_link import RegistrationLink
from app.models.user import User, UserRole

INVALID_LINK = "Der Registrierungslink ist ungültig, abgelaufen oder aufgebraucht."
EMAIL_TAKEN = "Diese E-Mail-Adresse ist bereits registriert."


async def create_link(
    db: AsyncSession, created_by_id: int, *, expires_in_days: int, max_uses: int
) -> RegistrationLink:
    link = RegistrationLink(
        token=secrets.token_urlsafe(32),
        max_uses=max_uses,
        used_count=0,
        expires_at=utcnow() + timedelta(days=expires_in_days),
        created_by_id=created_by_id,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def list_links(db: AsyncSession) -> list[RegistrationLink]:
    result = await db.execute(
        select(RegistrationLink).order_by(RegistrationLink.created_at.desc())
    )
    return list(result.scalars().all())


async def delete_link(db: AsyncSession, link_id: int) -> bool:
    link = await db.get(RegistrationLink, link_id)
    if link is None:
        return False
    await db.delete(link)
    await db.commit()
    return True


async def is_link_usable(db: AsyncSession, token: str) -> bool:
    result = await db.execute(
        select(RegistrationLink.id).where(
            RegistrationLink.token == token,
            RegistrationLink.expires_at > utcnow(),
            RegistrationLink.used_count < RegistrationLink.max_uses,
        )
    )
    return result.first() is not None


async def register_with_link(
    db: AsyncSession, token: str, email: str, name: str, password: str
) -> User:
    """Create a normal user through a registration link. Raises ValueError (with a
    user-facing German message) when the link is unusable or the e-mail is taken."""
    email = email.lower()
    taken = await db.execute(select(User.id).where(User.email == email))
    if taken.first() is not None:
        raise ValueError(EMAIL_TAKEN)

    claimed = await db.execute(
        update(RegistrationLink)
        .where(
            RegistrationLink.token == token,
            RegistrationLink.expires_at > utcnow(),
            RegistrationLink.used_count < RegistrationLink.max_uses,
        )
        .values(used_count=RegistrationLink.used_count + 1)
        .returning(RegistrationLink.id)
    )
    if claimed.first() is None:
        await db.rollback()
        raise ValueError(INVALID_LINK)

    user = User(
        email=email,
        name=name,
        hashed_password=hash_password(password),
        role=UserRole.USER,
        is_active=True,
        # Nobody verified this address; nothing in the app gates on it.
        email_verified=False,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # Lost a race on the unique e-mail: the rollback also un-claims the use.
        await db.rollback()
        raise ValueError(EMAIL_TAKEN)
    await db.refresh(user)
    return user
