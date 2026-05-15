from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_client_id, require_user
from app.services.realtime_events import emit_note_event
from app.core.responses import ok
from app.models.collaborator import CollaboratorPermission
from app.models.note import Note, NoteContentFormat
from app.models.user import User
from app.services.note_html import html_to_snippet, sanitize_note_html
from app.services.share_state_service import note_internal_share_counts
from app.services.note_mention_service import (
    dispatch_new_mentions,
    list_mentionable_users,
)
from app.schemas.note import (
    NoteCreate,
    NoteOut,
    NoteUpdate,
    NoteVersionListItem,
    NoteVersionOut,
)
from app.services.note_share_service import (
    disable_share as _disable_note_share,
    enable_share as _enable_note_share,
    get_accessible_note,
    list_accessible_notes,
    list_internal_shares as _list_note_internal_shares,
    revoke_internal_share as _revoke_note_internal_share,
    share_note_with_email,
)
from app.services.note_version_service import (
    get_version,
    list_versions,
    maybe_save_version,
)

router = APIRouter(prefix="/notes", tags=["notes"])


def _out(
    n: Note,
    *,
    share_source: str | None = None,
    owner_name: str | None = None,
    share_permission: "CollaboratorPermission | None" = None,
    internal_share_count: int | None = None,
) -> dict:
    # Snippet is computed at serialise time rather than stored — the
    # cost (one bs4 parse per note in the response) is negligible
    # versus the migration risk of caching a stale snippet in the
    # row. For the notes overview that's typically <50 notes per
    # response; for the detail-page payload that's one note. Fine.
    #
    # share_state is owner-side only (None when the viewer is a
    # recipient — they shouldn't see how many other people the note
    # is shared with).
    from app.schemas.share import ShareState
    share_state = None
    if internal_share_count is not None:
        share_state = ShareState(
            internal_count=internal_share_count,
            public=bool(n.share_enabled),
        )
    return NoteOut.model_validate(n).model_copy(
        update={
            "share_source": share_source,
            "owner_name": owner_name,
            "share_permission": share_permission,
            "snippet": html_to_snippet(n.content or ""),
            "share_state": share_state,
        }
    ).model_dump(mode="json")


# ---------- Permission helpers (alembic 0014) ----------

async def _require_note_edit(
    db: AsyncSession, note_id: int, user_id: int
) -> tuple[Note, str | None, "CollaboratorPermission"]:
    """Owner OR EDIT recipient. Returns (note, share_source, perm).
    Raises 403 for VIEW recipients, 404 when there's no access at all."""
    try:
        note, src, perm = await get_accessible_note(db, note_id, user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if perm != CollaboratorPermission.EDIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Du hast keine Bearbeitungsrechte für diese Notiz.",
        )
    return note, src, perm


@router.get("")
async def get_notes(
    q: str | None = None,
    tag: str | None = None,
    folder_id: int | None = None,
    uncategorized: bool = False,
    archived: bool = False,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Notes list with sticky-pinned ordering.

    - `archived=true` shows ONLY archived notes (the archive view).
      Default is to hide archived entries from the main list.
    - `folder_id` filters by folder; `uncategorized=true` shortcuts
      to "no folder assigned" (folder_id IS NULL).
    - Pinned notes always come first regardless of updated_at.
    - Notes shared with the current user are mixed into the default
      view (no folder/uncategorized/archived filter active) — they
      ride the same pinned-first ordering. Folder/archived filters
      are owner-side only.
    """
    rows = await list_accessible_notes(
        db,
        user.id,
        q=q,
        tag=tag,
        folder_id=folder_id,
        uncategorized=uncategorized,
        archived=archived,
    )
    # share_state populated only for OWNED rows (the user can already
    # see who's a collaborator on someone else's note via the shared-
    # with banner). Single GROUP BY query keeps this O(1) per request.
    owned_ids = [n.id for n, src, _name, _perm in rows if src is None]
    share_counts = await note_internal_share_counts(db, owned_ids)
    return ok(
        [
            _out(
                n,
                share_source=src,
                owner_name=name,
                share_permission=perm,
                internal_share_count=(
                    share_counts.get(n.id, 0) if src is None else None
                ),
            )
            for n, src, name, perm in rows
        ]
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_note(
    payload: NoteCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    data = payload.model_dump()
    if data.get("folder_id") is not None:
        await _ensure_folder_owned(db, data["folder_id"], user.id)
    # Archived notes can't also be pinned (spec).
    if data.get("is_archived") and data.get("is_pinned"):
        data["is_pinned"] = False
    # New notes are always HTML (the TipTap editor is the only client
    # writing now). Run the same sanitiser as PATCH so a malicious
    # payload at creation time doesn't end up stored.
    if "content" in data and data["content"]:
        data["content"] = sanitize_note_html(data["content"])
    data["content_format"] = NoteContentFormat.HTML
    note = Note(owner_id=user.id, **data)
    db.add(note)
    await db.commit()
    await db.refresh(note)
    # Brand-new note — fan out a note.created so any other device of
    # the same user (post-share devices, etc.) updates its overview.
    # Audience is just the owner since shares haven't been added yet.
    await emit_note_event(
        db, note.id, "note.created", actor_id=user.id, client_id=client_id
    )
    # Brand-new note — no shares yet, so the explicit 0 keeps the
    # response shape identical to GET /notes/{id} (frontend can rely
    # on share_state being present on owner-side responses).
    return ok(_out(note, internal_share_count=0))


async def _ensure_folder_owned(db: AsyncSession, folder_id: int, owner_id: int) -> None:
    from app.models.note_folder import NoteFolder

    result = await db.execute(
        select(NoteFolder).where(NoteFolder.id == folder_id, NoteFolder.owner_id == owner_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ordner nicht gefunden")


@router.get("/search")
async def search_titles(
    q: str = "",
    limit: int = 10,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Title-only autocomplete for the [[…]] interlink dropdown.
    Excludes archived notes."""
    needle = q.strip()
    stmt = (
        select(Note.id, Note.title)
        .where(Note.owner_id == user.id, Note.is_archived.is_(False))
        .order_by(Note.is_pinned.desc(), Note.updated_at.desc())
        .limit(min(max(1, limit), 50))
    )
    if needle:
        stmt = stmt.where(func.lower(Note.title).like(f"%{needle.lower()}%"))
    result = await db.execute(stmt)
    return ok([{"id": i, "title": t} for i, t in result.all()])


@router.get("/{note_id}/backlinks")
async def get_backlinks(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Notes whose content references this note. Matches both the
    legacy markdown wikilink syntax `[[Title]]` (pre-migration rows)
    and TipTap's HTML form `data-wikilink="Title"` (post-migration)
    so backlinks work continuously across the editor switchover."""
    target = await db.execute(
        select(Note).where(Note.id == note_id, Note.owner_id == user.id)
    )
    note = target.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    # PostgreSQL ILIKE with the literal title. We escape the SQL wildcard
    # chars `_` and `%` so a title that happens to contain them doesn't
    # widen the search. The HTML pattern also escapes `"` defensively
    # (a title like `5" record` becomes `5&quot; record` after sanitise).
    safe_title = note.title.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    md_pattern = f"%[[{safe_title}]]%"
    # data-wikilink attribute survives bleach as-is for ASCII titles;
    # special chars get HTML-escaped by markdown_to_html, so we look up
    # both the raw and the escaped form. The double-escaped form covers
    # titles containing `"`, `<`, `>`, `&`.
    html_safe = (
        safe_title.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    html_pattern = f'%data-wikilink="{html_safe}"%'
    result = await db.execute(
        select(Note.id, Note.title)
        .where(Note.owner_id == user.id, Note.id != note.id, Note.is_archived.is_(False))
        .where(
            or_(
                Note.content.ilike(md_pattern, escape="\\"),
                Note.content.ilike(html_pattern, escape="\\"),
            )
        )
        .order_by(Note.updated_at.desc())
    )
    return ok([{"id": i, "title": t} for i, t in result.all()])


@router.get("/{note_id}")
async def get_note(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Owners see their note; recipients (notes shared with them) get the
    same payload with share_source/owner_name set so the UI can render in
    read-only mode."""
    try:
        note, share_source, perm = await get_accessible_note(db, note_id, user.id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    owner_name = None
    if share_source is not None:
        owner = await db.execute(select(User.name).where(User.id == note.owner_id))
        owner_name = owner.scalar_one_or_none()
    # share_state is owner-side only — single-note count is cheap.
    share_count: int | None = None
    if share_source is None:
        counts = await note_internal_share_counts(db, [note.id])
        share_count = counts.get(note.id, 0)
    return ok(
        _out(
            note,
            share_source=share_source,
            owner_name=owner_name,
            share_permission=perm,
            internal_share_count=share_count,
        )
    )


@router.patch("/{note_id}")
async def patch_note(
    note_id: int,
    payload: NoteUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    note, share_source, perm = await _require_note_edit(db, note_id, user.id)
    patch = payload.model_dump(exclude_unset=True)

    # Owner-only fields: folder, pin, archive. Recipients can edit content
    # but can't reorganise the owner's notes — silently drop those fields
    # from the patch rather than 403'ing the whole save.
    if share_source is not None:
        for owner_only in ("folder_id", "is_pinned", "is_archived"):
            patch.pop(owner_only, None)

    if "folder_id" in patch and patch["folder_id"] is not None:
        await _ensure_folder_owned(db, patch["folder_id"], user.id)
    # Spec: an archived note cannot be pinned. Apply both directions:
    # archiving auto-unpins; pinning an archived note is a no-op.
    if patch.get("is_archived") is True:
        patch["is_pinned"] = False
    elif patch.get("is_pinned") is True and (patch.get("is_archived") or note.is_archived):
        patch["is_pinned"] = False

    # Run TipTap-emitted HTML through bleach before anything else so we
    # never compare a stripped value against the pre-strip user input
    # when deciding whether to version. The sanitiser is idempotent, so
    # if the migration script already passed the markdown through it
    # this is a no-op.
    if "content" in patch and patch["content"] is not None:
        patch["content"] = sanitize_note_html(patch["content"])
        # A user editing in TipTap is necessarily producing HTML; flip
        # the format flag so a partially-migrated row doesn't get
        # re-converted by a future script run.
        patch["content_format"] = NoteContentFormat.HTML

    # If title or content is changing, snapshot the *current* state as a
    # version first (debounced server-side to 60 s, see service). Metadata-
    # only patches (folder, pin, archive) don't trigger versioning.
    title_changing = "title" in patch and patch["title"] is not None and patch["title"] != note.title
    content_changing = "content" in patch and patch["content"] is not None and patch["content"] != note.content
    if title_changing or content_changing:
        await maybe_save_version(db, note)

    for k, v in patch.items():
        setattr(note, k, v)
    await db.commit()
    await db.refresh(note)
    # Mention pipeline — only on content changes. Runs after the commit
    # so the note row visible to the recipient (who may click the email
    # link immediately) already has the new HTML. Email failures are
    # logged inside the service and never bubble up.
    if content_changing:
        try:
            await dispatch_new_mentions(db, note, user, note.content)
        except Exception as e:  # pragma: no cover - mention dispatch is best-effort
            import logging
            logging.getLogger(__name__).warning(
                "dispatch_new_mentions failed for note=%s: %s", note.id, e
            )
    owner_name = None
    if share_source is not None:
        owner = await db.execute(select(User.name).where(User.id == note.owner_id))
        owner_name = owner.scalar_one_or_none()
    share_count: int | None = None
    if share_source is None:
        counts = await note_internal_share_counts(db, [note.id])
        share_count = counts.get(note.id, 0)

    # Fan out a note.updated event to every device of every user with
    # access to this note. The payload includes the title + a hint
    # about what changed so a currently-open editor can decide
    # whether to soft-merge or show the "Neu laden?" banner; bigger
    # diffs (full content rewrite) are signalled via
    # `content_changed=true` without sending the whole body — the
    # receiving editor refetches if it doesn't have local edits.
    await emit_note_event(
        db,
        note.id,
        "note.updated",
        actor_id=user.id,
        client_id=client_id,
        payload={
            "title": note.title,
            "title_changed": title_changing,
            "content_changed": content_changing,
            "updated_at": note.updated_at.isoformat()
            if note.updated_at is not None
            else None,
        },
    )

    return ok(
        _out(
            note,
            share_source=share_source,
            owner_name=owner_name,
            share_permission=perm,
            internal_share_count=share_count,
        )
    )


@router.get("/{note_id}/mentionable_users")
async def get_mentionable_users(
    note_id: int,
    q: str | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Users the current viewer can @-mention in this note: owner +
    everyone in its internal-share rows, minus the current user. Used
    by the editor's @-popover to populate the "Personen" section
    alongside note titles ("Notizen").

    Permission gate: the caller must already have access to the note
    (otherwise the share row that lets them edit doesn't exist).
    """
    try:
        note, _src, _perm = await get_accessible_note(db, note_id, user.id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    users = await list_mentionable_users(db, note, q=q)
    # Drop the current user from the list — no point @-mentioning yourself.
    return ok(
        [
            {"id": u.id, "name": u.name, "email": u.email}
            for u in users
            if u.id != user.id
        ]
    )


# ---------- Version history ----------

def _version_list_item(v) -> dict:
    flat = (v.content or "").replace("\n", " ").strip()
    return NoteVersionListItem(
        id=v.id,
        note_id=v.note_id,
        title=v.title,
        preview=flat[:100],
        created_at=v.created_at,
    ).model_dump(mode="json")


@router.get("/{note_id}/versions")
async def get_versions(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = (
        await db.execute(select(Note).where(Note.id == note_id, Note.owner_id == user.id))
    ).scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    versions = await list_versions(db, note_id)
    return ok([_version_list_item(v) for v in versions])


@router.get("/{note_id}/versions/{version_id}")
async def get_version_full(
    note_id: int,
    version_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = (
        await db.execute(select(Note).where(Note.id == note_id, Note.owner_id == user.id))
    ).scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    v = await get_version(db, note_id, version_id)
    if not v:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    return ok(NoteVersionOut.model_validate(v).model_dump(mode="json"))


@router.post("/{note_id}/versions/{version_id}/restore", status_code=status.HTTP_200_OK)
async def restore_version(
    note_id: int,
    version_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = (
        await db.execute(select(Note).where(Note.id == note_id, Note.owner_id == user.id))
    ).scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    v = await get_version(db, note_id, version_id)
    if not v:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    # Always snapshot the current state before restoring so the user can
    # always undo the restore by picking the freshly-saved version.
    await maybe_save_version(db, note, force=True)
    note.title = v.title
    note.content = v.content
    await db.commit()
    await db.refresh(note)
    return ok(_out(note))


@router.delete("/{note_id}")
async def del_note(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.owner_id == user.id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    # Snapshot the audience BEFORE the delete — once the row is gone
    # the share join table cascade-deletes too, so the audience lookup
    # would return only the owner.
    from app.services.realtime_events import emit_note_deleted, note_audience

    audience = await note_audience(db, note.id)
    await db.delete(note)
    await db.commit()
    # Fan out to the snapshotted audience. The receiving frontend
    # invalidates the notes overview and, if the user is currently on
    # this note's detail page, navigates away with a toast.
    await emit_note_deleted(
        audience, note_id, actor_id=user.id, client_id=client_id
    )
    return ok({"message": "Deleted"})


# ---------- Inline image upload (TipTap toolbar Image button) ----------
#
# Mirrors POST /recipes/{id}/image — files land under /app/uploads/notes/{id}
# and are served back via the /static/ mount. The frontend embeds the
# returned URL in an <img src> tag and the next save persists it. Multiple
# images per note are fine (unlike recipes where image_url is single).

import pathlib as _pathlib
import uuid as _uuid

_NOTE_IMAGE_ALLOWED = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
_UPLOADS_BASE = _pathlib.Path("/app/uploads")


@router.post("/{note_id}/images", status_code=status.HTTP_200_OK)
async def post_note_image(
    note_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload an inline image for the TipTap editor. EDIT permission
    required (owner or EDIT recipient). Returns `{ "url": "/static/…" }`
    which the editor's Image extension renders as `<img src=…>`. We do
    NOT mutate the note here — the editor inserts the img tag itself
    and the next autosave persists the new content."""
    await _require_note_edit(db, note_id, user.id)

    if file.content_type not in _NOTE_IMAGE_ALLOWED:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Nur JPG, PNG, WebP und GIF werden unterstützt",
        )

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _NOTE_IMAGE_MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Maximale Bildgröße: 10 MB",
            )
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leere Datei")

    ext = _NOTE_IMAGE_ALLOWED[file.content_type]
    fname = f"{_uuid.uuid4().hex}{ext}"
    target_dir = _UPLOADS_BASE / "notes" / str(note_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / fname).write_bytes(data)

    return ok({"url": f"/static/notes/{note_id}/{fname}"})


# =============================================================================
#  AI assist endpoints (Features 6, 7, 8)
# =============================================================================
#
# All AI calls go through the centralised app/services/ollama.py so model,
# keep_alive, and timeout stay consistent with the rest of the app.

from pydantic import ValidationError as _ValidationError

from app.services.ollama import OllamaError, call_text, call_text_json


async def _load_owned_note(db: AsyncSession, note_id: int, owner_id: int) -> Note:
    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.owner_id == owner_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return note


async def _load_editable_note(db: AsyncSession, note_id: int, user_id: int) -> Note:
    """Owner OR EDIT recipient — covers AI endpoints which generate content
    that the user typically applies in-place."""
    note, _, _ = await _require_note_edit(db, note_id, user_id)
    return note


def _truncate_for_prompt(text: str, max_chars: int = 4000) -> str:
    """LLM context is finite — long notes get clipped at a sensible boundary
    (sentence-ish). Truncated marker tells the model not to hallucinate
    "the rest"."""
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    last_break = max(cut.rfind(". "), cut.rfind("\n"))
    if last_break > max_chars - 500:
        cut = cut[: last_break + 1]
    return cut + "\n\n[…gekürzt für KI-Kontext…]"


# ---------- Feature 6: Summarize ----------

_AI_SUMMARIZE_SYSTEM = (
    "Du fasst Notizen zusammen. Gib eine knappe Zusammenfassung in 2 bis 4 "
    "Sätzen auf Deutsch zurück. Keine Aufzählung, kein Markdown, kein "
    "einleitender Text wie 'Zusammenfassung:'. Nur die Sätze selbst."
)


@router.post("/{note_id}/ai/summarize")
async def post_ai_summarize(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = await _load_editable_note(db, note_id, user.id)
    if not (note.content or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Notiz ist leer — nichts zum Zusammenfassen.",
        )
    user_prompt = (
        f"Titel: {note.title or '(ohne Titel)'}\n\n"
        f"Inhalt:\n{_truncate_for_prompt(note.content)}"
    )
    try:
        # json_mode=False — we want plain prose, not JSON.
        raw = await call_text(
            user_prompt, system=_AI_SUMMARIZE_SYSTEM, temperature=0.3,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    summary = (raw or "").strip()
    if not summary:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Leere KI-Antwort",
        )
    return ok({"summary": summary})


# ---------- Feature 7: Auto-suggest title ----------

_AI_TITLE_SYSTEM = (
    "Du schlägst einen knappen, aussagekräftigen Titel (max. 60 Zeichen) "
    "für eine Notiz vor. Antworte AUSSCHLIESSLICH mit dem Titel selbst — "
    "kein Markdown, keine Anführungszeichen, kein einleitender Text. "
    "Auf Deutsch."
)


@router.post("/{note_id}/ai/title")
async def post_ai_title(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = await _load_editable_note(db, note_id, user.id)
    if not (note.content or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Notiz ist leer — kein Titel ableitbar.",
        )
    user_prompt = f"Notiz-Inhalt:\n{_truncate_for_prompt(note.content, 2000)}"
    try:
        raw = await call_text(
            user_prompt, system=_AI_TITLE_SYSTEM, temperature=0.4, max_tokens=60,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    # Defensive cleanup — strip surrounding quotes/whitespace, clamp length.
    title = (raw or "").strip().strip('"\'').splitlines()[0].strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Leere KI-Antwort",
        )
    if len(title) > 200:
        title = title[:200]
    return ok({"title": title})


# ---------- Feature 8: Auto-tag (notes) ----------

_AI_NOTE_TAGS_SYSTEM = (
    "Du schlägst 2 bis 5 Tags für eine Notiz vor. Antworte AUSSCHLIESSLICH "
    "mit einem JSON-Array aus kurzen, kleingeschriebenen Wörtern (ohne #), "
    "auf Deutsch, ohne Markdown. Beispiel: [\"reise\", \"checkliste\", \"sommer\"]."
)


@router.post("/{note_id}/ai/tags")
async def post_ai_note_tags(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = await _load_editable_note(db, note_id, user.id)
    body = (note.content or "").strip()
    if not (note.title.strip() or body):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Notiz ist leer — keine Tags ableitbar.",
        )
    user_prompt = (
        f"Titel: {note.title or '(ohne)'}\n\n"
        f"Inhalt:\n{_truncate_for_prompt(body, 2000)}\n\n"
        f"Aktuelle Tags: {', '.join(note.tags or []) or '(keine)'}"
    )
    try:
        parsed = await call_text_json(
            user_prompt, system=_AI_NOTE_TAGS_SYSTEM, temperature=0.3,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="KI-Antwort hat unerwartetes Format",
        )
    existing = {t.lower() for t in (note.tags or [])}
    out: list[str] = []
    seen: set[str] = set()
    for entry in parsed:
        if not isinstance(entry, str):
            continue
        clean = entry.strip().lstrip('#').lower()
        if not clean or clean in existing or clean in seen:
            continue
        if len(clean) > 32:
            clean = clean[:32]
        seen.add(clean)
        out.append(clean)
        if len(out) >= 5:
            break
    return ok({"tags": out})


# =============================================================================
#  Sharing — public link + email/internal (alembic 0013)
# =============================================================================
#
# PRIVACY: the email-lookup is done EXCLUSIVELY in
# note_share_service._user_by_email, on POST submit only, exact case-
# insensitive match. There is no autocomplete, no /users/search, no
# probe endpoint.

from app.email.sender import send_email
from app.email.templates import note_share_email
from app.schemas.note import (
    NoteInternalShareOut,
    NoteShareByEmailRequest,
    NoteShareByEmailResponse,
    NoteShareUpdateRequest,
)
from app.schemas.share import ShareEnableResponse
from app.services.note_share_service import (
    leave_internal_share as _leave_note_internal_share,
    update_internal_share_permission as _update_note_internal_share_permission,
)


async def _load_owned_note_for_share(db: AsyncSession, note_id: int, user_id: int) -> Note:
    """Owner-only fetch — share management is owner-side. Recipients of an
    internal share have READ access to the note itself but no power over
    its share state."""
    res = await db.execute(
        select(Note).where(Note.id == note_id, Note.owner_id == user_id)
    )
    note = res.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return note


@router.post("/{note_id}/share/enable")
async def post_share_enable(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = await _load_owned_note_for_share(db, note_id, user.id)
    token, url, qr = await _enable_note_share(db, note)
    return ok(
        ShareEnableResponse(share_token=token, share_url=url, qr_code_png_base64=qr).model_dump()
    )


@router.post("/{note_id}/share/disable")
async def post_share_disable(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    note = await _load_owned_note_for_share(db, note_id, user.id)
    await _disable_note_share(db, note)
    return ok({"message": "Share disabled"})


@router.post("/{note_id}/share/email")
async def post_share_by_email(
    note_id: int,
    payload: NoteShareByEmailRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    note = await _load_owned_note_for_share(db, note_id, user.id)
    try:
        kind, name, recipient_id = await share_note_with_email(
            db, note, user, payload.email, payload.permission
        )
    except ValueError as e:
        if str(e) == "self-share":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Das ist deine eigene Adresse.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if kind == "external":
        # share_token is now guaranteed to exist (service ensures it).
        url = f"{settings.FRONTEND_URL}/share/note/{note.share_token}"
        subject, html = note_share_email(user.name, note.title, url)
        await send_email(payload.email, subject, html)
    elif kind == "internal" and recipient_id is not None:
        # Fan out a share.created to the new recipient's user-channel
        # so their notes overview gets invalidated and the new note
        # appears within a tick. The actor (us) is excluded by
        # exclude_client_id; we wouldn't reach our own channel since
        # the recipient is a different user anyway.
        from app.services.realtime_events import emit_share_event
        await emit_share_event(
            recipient_id=recipient_id,
            actor_id=user.id,
            resource_type="note",
            resource_id=note.id,
            event="share.created",
            client_id=client_id,
            payload={"actor_name": user.name, "title": note.title},
        )

    return ok(NoteShareByEmailResponse(type=kind, user_name=name).model_dump())


@router.get("/{note_id}/shares")
async def get_shares(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _load_owned_note_for_share(db, note_id, user.id)
    rows = await _list_note_internal_shares(db, note_id)
    return ok(
        [
            NoteInternalShareOut(
                user_id=u.id,
                name=u.name,
                email=u.email,
                permission=s.permission,
                created_at=s.created_at,
            ).model_dump(mode="json")
            for s, u in rows
        ]
    )


# Path-order note: /shares/me MUST be registered before /shares/{user_id:int}
# — FastAPI returns 422 (not "try the next route") when an int converter
# fails, so the literal-path route has to win.

@router.delete("/{note_id}/shares/me")
async def leave_note_share(
    note_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Recipient-initiated removal of their own NoteShare row. Idempotent
    — returns OK whether or not a row existed."""
    await _leave_note_internal_share(db, note_id, user.id)
    return ok({"message": "Left share"})


@router.patch("/{note_id}/shares/{user_id}")
async def patch_note_share(
    note_id: int,
    user_id: int,
    payload: NoteShareUpdateRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Owner-only: flip a recipient between VIEW and EDIT."""
    await _load_owned_note_for_share(db, note_id, user.id)
    updated = await _update_note_internal_share_permission(
        db, note_id, user_id, payload.permission
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Share not found"
        )
    return ok({"message": "Permission updated"})


@router.delete("/{note_id}/shares/{user_id}")
async def del_share(
    note_id: int,
    user_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await _load_owned_note_for_share(db, note_id, user.id)
    await _revoke_note_internal_share(db, note_id, user_id)
    return ok({"message": "Share revoked"})
