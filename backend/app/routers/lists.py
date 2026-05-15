from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.models.list_item import ListItem
from app.models.user import User
from app.schemas.list import ListCreate, ListDuplicate, ListOut, ListUpdate
from app.services.list_service import (
    create_list,
    delete_list,
    duplicate_list,
    get_list_for_user,
    list_for_user,
    list_stats,
    reset_list,
    update_list,
)
from app.services.snapshot_service import save_snapshot
from app.services.ws_manager import manager as ws_manager

router = APIRouter(prefix="/lists", tags=["lists"])


def _list_out(lst, item_count: int, checked_count: int, is_owner: bool, permission: str | None) -> dict:
    return ListOut.model_validate(lst).model_copy(
        update={
            "item_count": item_count,
            "checked_count": checked_count,
            "is_owner": is_owner,
            "permission": permission,
        },
    ).model_dump(mode="json")


@router.get("")
async def get_lists(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_for_user(db, user.id, include_templates=False)
    return ok([_list_out(l, ic, cc, owner, perm) for l, ic, cc, owner, perm in rows])


@router.get("/templates")
async def get_templates(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_for_user(db, user.id, include_templates=True)
    return ok([_list_out(l, ic, cc, owner, perm) for l, ic, cc, owner, perm in rows])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_list(
    payload: ListCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    lst = await create_list(db, user.id, **payload.model_dump())
    return ok(_list_out(lst, 0, 0, True, None))


@router.get("/{list_id}")
async def get_list(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, perm = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    total, checked = await list_stats(db, list_id)
    return ok(_list_out(lst, total, checked, is_owner, perm))


@router.patch("/{list_id}")
async def patch_list(
    list_id: int,
    payload: ListUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, perm = await get_list_for_user(db, list_id, user.id, require_edit=True)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    lst = await update_list(db, lst, **payload.model_dump(exclude_unset=True))
    total, checked = await list_stats(db, list_id)
    return ok(_list_out(lst, total, checked, is_owner, perm))


@router.delete("/{list_id}")
async def del_list(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, is_owner, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    if not is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner can delete")
    await delete_list(db, lst)
    return ok({"message": "Deleted"})


@router.post("/{list_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def post_duplicate(
    list_id: int,
    payload: ListDuplicate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        src, _, _ = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    new = await duplicate_list(
        db,
        src,
        user.id,
        title=payload.title,
        as_template=payload.as_template,
        template_name=payload.template_name,
    )
    total, checked = await list_stats(db, new.id)
    return ok(_list_out(new, total, checked, True, None))


@router.post("/{list_id}/reset")
async def post_reset(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    try:
        lst, _, _ = await get_list_for_user(db, list_id, user.id, require_edit=True)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    # Snapshot the current state *before* unchecking, so the user can later
    # restore this session from "Verlauf".
    if lst.items:
        await save_snapshot(db, lst)
    await reset_list(db, lst)
    await ws_manager.broadcast(
        list_id, {"type": "list_reset", "payload": {}}, exclude_client_id=client_id
    )
    return ok({"message": "List reset"})


# ---------- Manual categorization ----------

@router.post("/{list_id}/categorize")
async def post_categorize(
    list_id: int,
    background: BackgroundTasks,
    force: bool = False,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Categorize all items on this list. By default skips items that already
    have a category and items the user manually locked. With `force=true`,
    re-categorizes everything (including locked items, since this only fires
    on explicit user action) and clears existing categories first so the
    progress UI on the frontend can observe each item flipping in turn.

    Runs as a background task and returns the count of items queued. The
    frontend listens to the existing `item_updated` WebSocket events to
    drive its progress counter."""
    try:
        lst, _, _ = await get_list_for_user(db, list_id, user.id, require_edit=True)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))

    # CHECKLIST / CUSTOM lists don't have a fixed category taxonomy — the
    # categorizer would no-op every item, so short-circuit before even
    # queueing the background task. The frontend hides the trigger button
    # on these types too, but this guard makes the API self-consistent if
    # called directly.
    from app.services.category_service import categories_for_type
    if categories_for_type(lst.type) is None:
        return ok({"queued": 0, "total": 0})

    items_q = await db.execute(select(ListItem).where(ListItem.list_id == list_id))
    all_items = list(items_q.scalars().all())

    if force:
        targets = all_items
        # Clear categories upfront so the UI shows them flipping back to
        # "pending" then to the new category as the worker progresses.
        for it in targets:
            it.category = None
            it.category_locked = False
        await db.commit()
        for it in targets:
            await ws_manager.broadcast(
                list_id,
                {"type": "item_updated", "payload": {
                    "id": it.id, "list_id": it.list_id, "text": it.text,
                    "is_checked": it.is_checked, "quantity": it.quantity,
                    "unit": it.unit, "position": it.position,
                    "category": None, "category_locked": False,
                    "created_at": it.created_at.isoformat(),
                    "updated_at": it.updated_at.isoformat(),
                }},
            )
    else:
        targets = [it for it in all_items if it.category is None and not it.category_locked]

    # Lazy-import to avoid a circular import at module load.
    from app.routers.items import _categorize_set_in_background
    if targets:
        background.add_task(
            _categorize_set_in_background,
            list_id,
            [it.id for it in targets],
            force,
            lst.type,
        )
    return ok({"queued": len(targets), "total": len(all_items)})


# =============================================================================
#  AI assist endpoints (Features 2 & 4)
# =============================================================================

from pydantic import BaseModel as _BaseModel, Field as _Field, ValidationError as _ValidationError

from app.models.list import List as ListModel, ListType
from app.services.ollama import OllamaError, call_text_json


# ---------- Feature 2: "Fehlt was?" ----------

_AI_MISSING_SYSTEM = (
    "Du bist Einkaufs- und Pack-Assistent. Auf Basis einer bestehenden Liste "
    "schlägst du häufig zusammen mit den vorhandenen Einträgen benötigte Dinge "
    "vor — keine Doppelungen mit bereits vorhandenen Einträgen. Antworte "
    "AUSSCHLIESSLICH mit einem JSON-Array aus Strings, max. 8 Vorschläge, "
    "auf Deutsch, ohne Markdown, ohne weiteren Text. "
    'Beispiel: ["Salz", "Pfeffer", "Olivenöl"].'
)


@router.post("/{list_id}/ai/missing-items")
async def post_ai_missing_items(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, _is_owner, _perm = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    items_text = "\n".join(f"- {i.text}" for i in lst.items) or "(leer)"
    type_label = {
        ListType.SHOPPING: "Einkaufsliste",
        ListType.PACKING: "Packliste",
        ListType.CHECKLIST: "Checkliste",
        ListType.CUSTOM: "Liste",
    }.get(lst.type, "Liste")

    user_prompt = (
        f"Listentyp: {type_label}\n"
        f"Titel: {lst.title}\n"
        f"Bisherige Einträge:\n{items_text}\n\n"
        f"Welche typisch dazugehörigen Dinge fehlen?"
    )
    try:
        parsed = await call_text_json(
            user_prompt, system=_AI_MISSING_SYSTEM, temperature=0.3,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="KI-Antwort hat unerwartetes Format",
        )

    # Filter strings only, drop empties, dedupe vs. existing items.
    existing_lower = {i.text.strip().lower() for i in lst.items}
    out: list[dict] = []
    seen: set[str] = set()
    for entry in parsed:
        if not isinstance(entry, str):
            continue
        text = entry.strip()
        if not text or text.lower() in existing_lower or text.lower() in seen:
            continue
        seen.add(text.lower())
        out.append({"text": text})
        if len(out) >= 8:
            break
    return ok(out)


# ---------- Feature 4: Generate list from goal ----------

class _AiGenerateListRequest(_BaseModel):
    type: ListType
    goal: str = _Field(min_length=1, max_length=500)


_AI_GENERATE_LIST_SYSTEM = (
    "Du bist Listen-Generator. Aufgabe: Gib zu einem Ziel eine sinnvolle, "
    "kompakte Liste zurück. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: "
    '{"title": "kurzer Titel", "items": [{"text": "Eintrag", "category": "string oder null"}]}. '
    "Auf Deutsch. Kein Markdown, kein Codeblock, kein zusätzlicher Text. "
    "Maximal 30 Einträge. Bei CHECKLIST-Typ darfst du Einträge thematisch "
    "in 3-6 Kategorien gruppieren (Feld category); bei anderen Typen lasse "
    "category auf null."
)


@router.post("/ai/generate")
async def post_ai_generate_list(
    payload: _AiGenerateListRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    type_label = {
        ListType.SHOPPING: "Einkaufsliste",
        ListType.PACKING: "Packliste",
        ListType.CHECKLIST: "Checkliste",
        ListType.CUSTOM: "Liste",
    }[payload.type]

    user_prompt = (
        f"Typ: {type_label}\n"
        f"Ziel: {payload.goal}\n\n"
        f"Generiere eine passende Liste."
    )
    try:
        parsed = await call_text_json(
            user_prompt,
            system=_AI_GENERATE_LIST_SYSTEM,
            temperature=0.4,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="KI-Antwort hat unerwartetes Format",
        )

    title = str(parsed.get("title") or payload.goal)[:200]
    raw_items = parsed.get("items", [])
    out_items: list[dict] = []
    seen: set[str] = set()
    if isinstance(raw_items, list):
        for entry in raw_items:
            if isinstance(entry, str):
                entry = {"text": entry, "category": None}
            if not isinstance(entry, dict):
                continue
            text = str(entry.get("text") or "").strip()
            if not text or text.lower() in seen:
                continue
            seen.add(text.lower())
            cat = entry.get("category")
            cat = str(cat).strip()[:64] if cat else None
            out_items.append({"text": text, "category": cat or None})
            if len(out_items) >= 30:
                break

    return ok({"title": title, "items": out_items})


# ---------- Feature 5: AI-assisted duplicate detection (fallback) ----------
#
# Frontend does Levenshtein-based grouping client-side first; this endpoint
# is the "AI prüfen" escape hatch for the user who wants a deeper semantic
# pass (e.g. "Tomatenmark" vs "Tomatenpaste"). Returns groups by id so the
# frontend can map back to the live items.

_AI_DUPLICATES_SYSTEM = (
    "Du analysierst eine Einkaufsliste auf vermutliche Doppelungen. "
    "Zwei Einträge sind nur dann eine Doppelung, wenn sie offensichtlich "
    "dasselbe Produkt meinen — auch in unterschiedlicher Schreibweise, "
    "Pluralform oder mit/ohne Mengenangabe. Antworte AUSSCHLIESSLICH mit "
    "einem JSON-Array — kein Markdown, kein Codeblock, kein einleitender "
    "Text. Schema: [{\"item_ids\": [<id1>, <id2>, ...]}]. Jede Gruppe "
    "enthält mindestens zwei IDs aus der vorgegebenen Liste. Lass Einträge "
    "weg, bei denen du dir nicht sicher bist."
)


@router.post("/{list_id}/ai/find-duplicates")
async def post_ai_find_duplicates(
    list_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        lst, _is_owner, _perm = await get_list_for_user(db, list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    if len(lst.items) < 2:
        return ok([])

    catalog = "\n".join(
        f"id={i.id}: {i.text}"
        + (f" ({i.quantity} {i.unit or ''})".rstrip() if i.quantity is not None else "")
        for i in lst.items
    )
    user_prompt = f"Einträge:\n{catalog}\n\nWelche Einträge sind Doppelungen?"
    try:
        parsed = await call_text_json(
            user_prompt, system=_AI_DUPLICATES_SYSTEM, temperature=0.2,
        )
    except OllamaError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="KI-Antwort hat unerwartetes Format",
        )

    valid_ids = {i.id for i in lst.items}
    out: list[dict] = []
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        ids = entry.get("item_ids", [])
        if not isinstance(ids, list):
            continue
        clean: list[int] = []
        seen: set[int] = set()
        for raw_id in ids:
            try:
                iid = int(raw_id)
            except (ValueError, TypeError):
                continue
            if iid in valid_ids and iid not in seen:
                clean.append(iid)
                seen.add(iid)
        if len(clean) >= 2:
            out.append({"item_ids": clean})
    return ok(out)
