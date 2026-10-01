"""Server-to-server integration endpoints (e.g. n8n) — X-API-Key auth, NOT JWT.

Only the Picnic .eml import is exposed here; no other recipe mutation is
reachable with the integration key. The recipe owner is resolved from
PICNIC_IMPORT_OWNER_EMAIL since there's no logged-in user. The parse → dedup →
create → image → nutrition path is the SAME shared core as the frontend upload
(picnic_import_service), so there is no duplicated logic.
"""
from __future__ import annotations

import hmac
import logging
import re
import time
from collections import deque

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.list import CategorizationMode, List as ListModel, ListType
from app.models.user import User
from app.schemas.recipe import EmlImportResult
from app.services.item_service import bulk_create_items
from app.services.picnic_import_service import import_one_eml
from app.services.realtime_events import emit_list_item_event
from app.services.ws_manager import manager as ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recipes", tags=["integration"])
list_router = APIRouter(prefix="/integration", tags=["integration"])

_MAX_EML_BYTES = 10 * 1024 * 1024

# Light in-memory rate limit — this is low-volume server-to-server traffic.
# A single shared window across the endpoint is plenty (one configured key).
_RATE_WINDOW_S = 60.0
_RATE_MAX = 30
_calls: deque[float] = deque()


def _require_integration_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    # Rate-limit first so a flood of bad-key attempts is also throttled.
    now = time.monotonic()
    while _calls and now - _calls[0] > _RATE_WINDOW_S:
        _calls.popleft()
    if len(_calls) >= _RATE_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded"
        )
    _calls.append(now)

    configured = settings.INTEGRATION_API_KEY
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Integration API not configured (set LYST_INTEGRATION_API_KEY)",
        )
    if not x_api_key or not hmac.compare_digest(x_api_key, configured):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing X-API-Key"
        )


async def _resolve_owner(db: AsyncSession) -> User:
    email = settings.PICNIC_IMPORT_OWNER_EMAIL.strip().lower()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LYST_PICNIC_IMPORT_OWNER_EMAIL not configured",
        )
    res = await db.execute(select(User).where(func.lower(User.email) == email))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Configured import owner '{email}' not found",
        )
    return user


async def _read_eml(request: Request) -> bytes:
    """Raw body (Content-Type: message/rfc822) OR a multipart 'file' field."""
    ct = (request.headers.get("content-type") or "").lower()
    if ct.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if isinstance(upload, UploadFile):
            return await upload.read()
        return b""
    return await request.body()


@router.post("/import-eml", dependencies=[Depends(_require_integration_key)])
async def post_import_eml(
    request: Request,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> EmlImportResult:
    """Import a single Picnic recipe .eml via API (n8n). Returns a bare
    {status, recipe_id?, title?, message} — status is created / duplicate /
    unrecognized. Same parser/image/dedup/nutrition path as the upload."""
    raw = await _read_eml(request)
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leere .eml")
    if len(raw) > _MAX_EML_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Datei zu groß (max 10 MB)"
        )
    owner = await _resolve_owner(db)
    outcome = await import_one_eml(db, owner_id=owner.id, raw=raw, force=False)
    if outcome.status == "created" and outcome.recipe_id:
        from app.routers.recipes import _bulk_fill_nutrition

        background.add_task(_bulk_fill_nutrition, [outcome.recipe_id], owner.id)
    return EmlImportResult(
        status=outcome.status,
        recipe_id=outcome.recipe_id,
        title=outcome.title,
        message=outcome.message,
    )


class VoiceItemsIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    list: str | None = Field(default=None, max_length=255)


class VoiceItemsOut(BaseModel):
    list_title: str
    added: list[str]


# Dictation like "Milch und Eier, Butter" -> three items.
_SPLIT_RE = re.compile(r"\s*(?:,|;|\n|\bund\b)\s*", re.IGNORECASE)


@list_router.post("/list-items", dependencies=[Depends(_require_integration_key)])
async def post_list_items(
    payload: VoiceItemsIn,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> VoiceItemsOut:
    """Add dictated items to one of the owner's lists (Siri / Home Assistant).
    `list` is matched by title (case-insensitive substring); omitted → the
    owner's first SHOPPING list. Items go through the same insert + realtime
    path as the normal add, so open clients update live."""
    from app.routers.items import _categorize_in_background, _item_out

    owner = await _resolve_owner(db)
    texts = [t.strip() for t in _SPLIT_RE.split(payload.text) if t.strip()]
    if not texts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kein Text erkannt")

    stmt = select(ListModel).where(
        ListModel.owner_id == owner.id, ListModel.is_template.is_(False)
    )
    wanted = (payload.list or "").strip()
    if wanted:
        stmt = stmt.where(ListModel.title.ilike(f"%{wanted}%"))
    else:
        stmt = stmt.where(ListModel.type == ListType.SHOPPING)
    target = (await db.execute(stmt.order_by(ListModel.id).limit(1))).scalar_one_or_none()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Liste '{wanted}' nicht gefunden" if wanted else "Keine Einkaufsliste gefunden",
        )

    items = await bulk_create_items(db, target.id, lines=texts)
    for it in items:
        out = _item_out(it)
        await ws_manager.broadcast(target.id, {"type": "item_created", "payload": out})
        await emit_list_item_event(
            db, target.id, it.id, "list.item.created", actor_id=owner.id, payload=out
        )
        if target.categorization_mode == CategorizationMode.AUTO:
            background.add_task(_categorize_in_background, target.id, it.id, target.type)
    return VoiceItemsOut(list_title=target.title, added=[it.text for it in items])
