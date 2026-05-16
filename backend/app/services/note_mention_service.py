"""Mention pipeline for note content.

Flow when a note is saved:

  1. PATCH /notes/{id} hands the (new HTML, actor user) to
     `dispatch_new_mentions`.
  2. We extract every `<span data-mention="<id>">…</span>` from the
     new content and intersect with the set of users that have access
     to this note (owner + internal share recipients). Mentions of
     anyone outside that set are dropped silently — by spec, the
     mention CHIP still renders in the doc, it just doesn't trigger
     a notification.
  3. We diff against the `note_mentions` table to find users that have
     never been notified about this note before, insert one row per
     new mention, and fire an email per user via Resend.

The dedup keeps a re-save of an already-mentioned-once note from
spamming the recipient. If the user wants a fresh notification, they
delete and re-add the mention chip (deletion clears the row via the
cascading FK, next insert re-fires).

We deliberately do NOT roll back the note save when an email fails —
the content has already been committed by the caller and the user's
trust in the editor matters more than the email's at-most-once-not.
"""
from __future__ import annotations

import logging
import re

from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.email.sender import send_email
from app.email.templates import note_mention_email
from app.models.collaborator import CollaboratorPermission
from app.models.note import Note, NoteMention, NoteShare
from app.models.user import User

logger = logging.getLogger(__name__)


# Match `<span ... data-mention="<id>" ...>`. Tolerates attribute order
# and single/double quotes because we run AFTER bleach sanitisation,
# which normalises but doesn't guarantee a fixed attribute layout.
_MENTION_RE = re.compile(
    r'<span\b[^>]*\bdata-mention=["\'](?P<id>\d+)["\'][^>]*>',
    re.IGNORECASE,
)


def extract_mention_ids(html: str | None) -> set[int]:
    """Return the set of user IDs mentioned in the given HTML. Empty
    set for None / empty / unparseable input."""
    if not html:
        return set()
    return {int(m.group("id")) for m in _MENTION_RE.finditer(html)}


async def list_mentionable_users(
    db: AsyncSession, note: Note, q: str | None = None
) -> list[User]:
    """Users who can receive a mention on this note: owner + everyone
    in the note's internal share rows (any permission level — VIEW
    recipients can still BE mentioned, they just can't write the chip
    themselves). Excludes the owner from the list ONLY when they're
    the one asking (matches the @-popover UX: you don't mention
    yourself), but the caller filters that out — this function returns
    the full set so the permission check stays single-sourced.

    `q` filters by case-insensitive substring on name or email."""
    rows: list[User] = []

    # Owner
    owner_res = await db.execute(select(User).where(User.id == note.owner_id))
    owner = owner_res.scalar_one_or_none()
    if owner is not None:
        rows.append(owner)

    # Internal-share recipients
    share_res = await db.execute(
        select(User)
        .join(NoteShare, NoteShare.shared_with_user_id == User.id)
        .where(NoteShare.note_id == note.id)
    )
    rows.extend(share_res.scalars().all())

    if q:
        needle = q.lower().strip()
        rows = [
            u for u in rows
            if needle in u.name.lower() or needle in u.email.lower()
        ]

    # Dedup by id, preserve order (owner first).
    seen: set[int] = set()
    out: list[User] = []
    for u in rows:
        if u.id in seen:
            continue
        seen.add(u.id)
        out.append(u)
    return out


async def _user_ids_with_access(db: AsyncSession, note: Note) -> set[int]:
    """Set of user ids permitted to be mentioned: owner + shares.
    Computed in a single query for the dispatch path."""
    ids = {note.owner_id}
    res = await db.execute(
        select(NoteShare.shared_with_user_id).where(NoteShare.note_id == note.id)
    )
    ids.update(r for (r,) in res.all())
    return ids


def _note_deeplink(note_id: int) -> str:
    """Best-effort URL into the editor at this note. APP_URL is the
    canonical setting; we point at /notes?focus=<id>, the same query
    the existing search-modal deep-link uses."""
    base = (settings.APP_URL or "").rstrip("/")
    if not base:
        return f"/notes?focus={note_id}"
    return f"{base}/notes?focus={note_id}"


async def dispatch_new_mentions(
    db: AsyncSession,
    note: Note,
    actor: User,
    new_html: str,
) -> int:
    """Detect mentions that newly appear in `new_html`, filter by
    access permission, insert NoteMention rows for users we haven't
    notified before, and send each of those users an email. Returns
    the number of newly-notified users.

    Safe to call on every save: re-saves with the same set of mentions
    do nothing because the unique constraint blocks duplicate inserts.
    Caller is responsible for having already committed the note's new
    content — we operate on the post-commit DB state and only insert
    NoteMention rows here.

    Errors during email send are logged and swallowed: the user has
    already saved their note, so a Resend outage shouldn't crash
    PATCH /notes."""
    mentioned_ids = extract_mention_ids(new_html)
    if not mentioned_ids:
        return 0

    # Drop self-mentions — actor mentioning themselves doesn't need an
    # email. (The chip stays in the doc; we just don't notify.)
    mentioned_ids.discard(actor.id)
    if not mentioned_ids:
        return 0

    # Permission filter — silently drop anyone outside the access set.
    permitted = await _user_ids_with_access(db, note)
    candidates = mentioned_ids & permitted
    if not candidates:
        return 0

    # Diff against already-notified set for this note. The unique
    # constraint also enforces this server-side; this read lets us
    # skip the email cost for ids we already know are dupes.
    existing_res = await db.execute(
        select(NoteMention.mentioned_user_id).where(
            and_(
                NoteMention.note_id == note.id,
                NoteMention.mentioned_user_id.in_(candidates),
            )
        )
    )
    already_notified: set[int] = {r for (r,) in existing_res.all()}
    fresh_ids = candidates - already_notified
    if not fresh_ids:
        return 0

    # Resolve user rows for email + display.
    user_res = await db.execute(
        select(User).where(User.id.in_(fresh_ids))
    )
    users = list(user_res.scalars().all())

    # Insert dedup rows. ON CONFLICT DO NOTHING because a concurrent
    # save could have raced us between the SELECT above and now — we
    # don't want a transaction failure in that case.
    if users:
        stmt = pg_insert(NoteMention).values(
            [
                {"note_id": note.id, "mentioned_user_id": u.id}
                for u in users
            ]
        )
        stmt = stmt.on_conflict_do_nothing(
            constraint="uq_note_mentions_note_user"
        )
        await db.execute(stmt)
        await db.commit()

    # Fire one email + one in-app notification per newly-notified user.
    # In-app notification fires regardless of whether the email succeeds —
    # the bell entry is independent persistence, the email is a
    # best-effort outbound channel that we no longer rely on as the only
    # signal.
    from app.services.notification_service import notify_mention

    url = _note_deeplink(note.id)
    sent = 0
    for u in users:
        try:
            await notify_mention(
                db,
                recipient_id=u.id,
                actor_id=actor.id,
                actor_name=actor.name,
                note_id=note.id,
                note_title=note.title,
            )
        except Exception as e:  # pragma: no cover
            logger.warning(
                "Mention in-app notify failed: note=%s user=%s err=%s",
                note.id,
                u.id,
                e,
            )
        try:
            subject, html = note_mention_email(actor.name, note.title, url)
            ok = await send_email(u.email, subject, html)
            if ok:
                sent += 1
        except Exception as e:  # pragma: no cover - email is best-effort
            logger.warning(
                "Mention email failed: note=%s user=%s err=%s",
                note.id,
                u.id,
                e,
            )
    return sent
