"""Note sharing — public token + internal user-to-user shares.

Mirrors the recipe sharing setup (see app/services/recipe_service.py for
the equivalent helpers): random hex token for the public URL, exact
case-insensitive email lookup for the internal grant. The email lookup
is the ONLY path in the API that maps email → user — keep it that way
so user enumeration stays infeasible.
"""
from __future__ import annotations

import base64
import io
import uuid

import qrcode
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.collaborator import CollaboratorPermission
from app.models.note import Note, NoteShare
from app.models.user import User


def _qr_base64(url: str) -> str:
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- Public sharing ----------

async def enable_share(db: AsyncSession, note: Note) -> tuple[str, str, str]:
    """Provision a share token (idempotent) and return token + URL + QR."""
    if not note.share_token:
        note.share_token = uuid.uuid4().hex
    note.share_enabled = True
    await db.commit()
    await db.refresh(note)
    share_url = f"{settings.FRONTEND_URL}/share/note/{note.share_token}"
    return note.share_token, share_url, _qr_base64(share_url)


async def disable_share(db: AsyncSession, note: Note) -> None:
    note.share_enabled = False
    note.share_token = None
    await db.commit()


async def get_public_note(db: AsyncSession, token: str) -> Note | None:
    res = await db.execute(
        select(Note).where(
            Note.share_token == token, Note.share_enabled.is_(True)
        )
    )
    return res.scalar_one_or_none()


# ---------- Recipient queries ----------

async def get_accessible_note(
    db: AsyncSession, note_id: int, user_id: int
) -> tuple[Note, str | None, CollaboratorPermission]:
    """Owner OR shared-with. Returns (note, share_source, permission).
    Owner -> (note, None, EDIT). Recipient -> (note, "individual", <row perm>).
    Raises ValueError when there's no access."""
    res = await db.execute(select(Note).where(Note.id == note_id))
    note = res.scalar_one_or_none()
    if not note:
        raise ValueError("Note not found")
    if note.owner_id == user_id:
        return note, None, CollaboratorPermission.EDIT
    rs = await db.execute(
        select(NoteShare).where(
            and_(
                NoteShare.note_id == note_id,
                NoteShare.shared_with_user_id == user_id,
            )
        )
    )
    share = rs.scalar_one_or_none()
    if share:
        return note, "individual", share.permission
    raise ValueError("Note not found")


async def list_accessible_notes(
    db: AsyncSession,
    user_id: int,
    *,
    q: str | None = None,
    tag: str | None = None,
    folder_id: int | None = None,
    uncategorized: bool = False,
    archived: bool = False,
) -> list[tuple[Note, str | None, str | None, CollaboratorPermission]]:
    """User's own notes + ones shared with them. Returns
    [(note, share_source, owner_name)] — share_source/owner_name are None
    for owned rows. Filters apply to owned notes only; shared notes always
    bypass folder/uncategorized/archived filters because the recipient
    can't reorganise the owner's notes."""
    # Owned notes — keep the existing filter semantics.
    own_stmt = select(Note).where(
        Note.owner_id == user_id,
        Note.is_archived.is_(archived),
    )
    if folder_id is not None:
        own_stmt = own_stmt.where(Note.folder_id == folder_id)
    elif uncategorized:
        own_stmt = own_stmt.where(Note.folder_id.is_(None))
    if q:
        like = f"%{q.lower()}%"
        own_stmt = own_stmt.where(
            or_(
                func.lower(Note.title).like(like),
                func.lower(Note.content).like(like),
                func.lower(func.array_to_string(Note.tags, " ")).like(like),
            )
        )
    if tag:
        own_stmt = own_stmt.where(Note.tags.any(tag))
    own_stmt = own_stmt.order_by(Note.is_pinned.desc(), Note.updated_at.desc())
    own_res = await db.execute(own_stmt)
    own = [
        (n, None, None, CollaboratorPermission.EDIT)
        for n in own_res.scalars().all()
    ]

    # Shared notes — recipients only see non-archived ones, and only when
    # no folder/uncategorized filter is active (those are owner-side
    # concepts). When a tag filter is active, apply it server-side too.
    if archived or folder_id is not None or uncategorized:
        return own

    share_rows_res = await db.execute(
        select(NoteShare.note_id, NoteShare.permission).where(
            NoteShare.shared_with_user_id == user_id
        )
    )
    perm_by_note: dict[int, CollaboratorPermission] = {
        nid: perm for nid, perm in share_rows_res.all()
    }
    if not perm_by_note:
        return own

    shared_stmt = select(Note).where(
        Note.id.in_(list(perm_by_note.keys())), Note.is_archived.is_(False)
    )
    if q:
        like = f"%{q.lower()}%"
        shared_stmt = shared_stmt.where(
            or_(
                func.lower(Note.title).like(like),
                func.lower(Note.content).like(like),
                func.lower(func.array_to_string(Note.tags, " ")).like(like),
            )
        )
    if tag:
        shared_stmt = shared_stmt.where(Note.tags.any(tag))
    shared_res = await db.execute(shared_stmt)
    shared_notes = list(shared_res.scalars().all())

    # Resolve owner names in one query.
    owner_ids = {n.owner_id for n in shared_notes}
    name_by_id: dict[int, str] = {}
    if owner_ids:
        names_res = await db.execute(
            select(User.id, User.name).where(User.id.in_(owner_ids))
        )
        name_by_id = {uid: name for uid, name in names_res.all()}

    rows = own + [
        (
            n,
            "individual",
            name_by_id.get(n.owner_id),
            perm_by_note[n.id],
        )
        for n in shared_notes
    ]
    rows.sort(key=lambda t: (not t[0].is_pinned, -t[0].updated_at.timestamp()))
    return rows


# ---------- Email-based share ----------

async def _user_by_email(db: AsyncSession, email: str) -> User | None:
    """Exact, case-insensitive lookup. The whole point of this helper is
    to be the ONLY path mapping email → user — keep partial-match queries
    out of the API to prevent enumeration."""
    res = await db.execute(
        select(User).where(func.lower(User.email) == email.strip().lower())
    )
    return res.scalar_one_or_none()


async def share_note_with_email(
    db: AsyncSession,
    note: Note,
    owner: User,
    email: str,
    permission: CollaboratorPermission = CollaboratorPermission.VIEW,
) -> tuple[str, str | None, int | None]:
    """Returns (kind, user_name, user_id). user_id is set on the
    'internal' path so the caller can fan out a share.created event
    to the new recipient via the user-channel WebSocket; None for
    the 'external' (email-to-non-Lyst-user) path.

    External case ensures share_token exists so the caller can email
    the public link. If a share already exists for this (note, user),
    this call updates the permission rather than erroring — matches
    the "no-op idempotent" behaviour the UI assumes."""
    target_email = email.strip().lower()
    if target_email == owner.email.lower():
        raise ValueError("self-share")

    target = await _user_by_email(db, target_email)
    if target is None:
        if not note.share_token:
            await enable_share(db, note)
        return "external", None, None

    existing = await db.execute(
        select(NoteShare).where(
            and_(
                NoteShare.note_id == note.id,
                NoteShare.shared_with_user_id == target.id,
            )
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        if row.permission != permission:
            row.permission = permission
            await db.commit()
    else:
        db.add(
            NoteShare(
                note_id=note.id,
                shared_with_user_id=target.id,
                permission=permission,
            )
        )
        try:
            await db.commit()
        except IntegrityError:
            # Race with a concurrent insert — treat as already shared.
            await db.rollback()
    return "internal", target.name, target.id


async def update_internal_share_permission(
    db: AsyncSession,
    note_id: int,
    user_id: int,
    permission: CollaboratorPermission,
) -> bool:
    """Returns True when a row was updated; False when no share exists."""
    res = await db.execute(
        select(NoteShare).where(
            and_(
                NoteShare.note_id == note_id,
                NoteShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if not row:
        return False
    row.permission = permission
    await db.commit()
    return True


async def list_internal_shares(
    db: AsyncSession, note_id: int
) -> list[tuple[NoteShare, User]]:
    res = await db.execute(
        select(NoteShare, User)
        .join(User, NoteShare.shared_with_user_id == User.id)
        .where(NoteShare.note_id == note_id)
        .order_by(NoteShare.created_at)
    )
    return [(s, u) for s, u in res.all()]


async def _clear_user_task_assignments(
    db: AsyncSession, note_id: int, user_id: int
) -> None:
    """Cascade helper: NULL out assignee_id on every TaskItem in this
    note that's currently assigned to the departing user. Run from
    both the revoke and the leave-share paths so behaviour matches
    regardless of who initiated the removal."""
    from sqlalchemy import update
    from app.models.task_item import TaskItem

    await db.execute(
        update(TaskItem)
        .where(TaskItem.note_id == note_id, TaskItem.assignee_id == user_id)
        .values(assignee_id=None)
    )


async def revoke_internal_share(
    db: AsyncSession, note_id: int, user_id: int
) -> None:
    res = await db.execute(
        select(NoteShare).where(
            and_(
                NoteShare.note_id == note_id,
                NoteShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if row:
        await db.delete(row)
        await _clear_user_task_assignments(db, note_id, user_id)
        await db.commit()


async def leave_internal_share(
    db: AsyncSession, note_id: int, user_id: int
) -> bool:
    """Recipient-initiated removal — same effect as revoke but reachable
    by the recipient themselves. Returns True when a row was actually
    removed (lets the caller distinguish 'wasn't shared' from 'left')."""
    res = await db.execute(
        select(NoteShare).where(
            and_(
                NoteShare.note_id == note_id,
                NoteShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if not row:
        return False
    await db.delete(row)
    await _clear_user_task_assignments(db, note_id, user_id)
    await db.commit()
    return True
