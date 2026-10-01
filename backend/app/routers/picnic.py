"""Picnic integration: preview a list as Picnic products, then fill the Picnic cart.

Needs the optional picnic-sidecar (PICNIC_SIDECAR_TOKEN set). It only ever fills the cart —
there is no checkout. The preview is read-only; nothing reaches the cart until /cart is
called with explicit product choices.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.picnic import (
    PicnicCartIn,
    PicnicCartOut,
    PicnicMappingOut,
    PicnicPreviewIn,
    PicnicPreviewOut,
    PicnicStatusOut,
)
from app.services import picnic_service
from app.services.list_service import get_list_for_user
from app.services.picnic_service import (
    PicnicError,
    PicnicNotConfigured,
    PicnicNotConnected,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/picnic", tags=["picnic"])

# Every open item costs one Picnic search, so a runaway list must not fan out unbounded.
_MAX_PREVIEW_ITEMS = 60


def _http_error(exc: PicnicError) -> HTTPException:
    if isinstance(exc, PicnicNotConfigured):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Die Picnic-Anbindung ist nicht eingerichtet.",
        )
    if isinstance(exc, PicnicNotConnected):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Picnic ist nicht verbunden. Bitte im Sidecar neu anmelden.",
        )
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/status")
async def get_status(_user: User = Depends(require_user)):
    return ok(PicnicStatusOut(**await picnic_service.get_status()).model_dump())


@router.post("/preview")
async def post_preview(
    payload: PicnicPreviewIn,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Match the list's open items to Picnic products. Read-only; changes nothing."""
    if not picnic_service.is_configured():
        raise _http_error(PicnicNotConfigured())
    try:
        lst, _is_owner, _perm = await get_list_for_user(db, payload.list_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    open_items = sorted((it for it in lst.items if not it.is_checked), key=lambda it: it.position)
    truncated = len(open_items) > _MAX_PREVIEW_ITEMS
    try:
        items = await picnic_service.build_preview(db, open_items[:_MAX_PREVIEW_ITEMS])
    except PicnicError as e:
        raise _http_error(e) from e
    return ok(
        PicnicPreviewOut(list_id=lst.id, items=items, truncated=truncated).model_dump()
    )


@router.post("/cart")
async def post_cart(
    payload: PicnicCartIn,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Put the confirmed products into the Picnic cart; optionally remember the choices."""
    try:
        cart = await picnic_service.add_to_cart(
            [{"id": i.product_id, "count": i.count} for i in payload.items]
        )
    except PicnicError as e:
        raise _http_error(e) from e

    # The cart is already filled at this point, so a failure to remember a choice must
    # not turn the response into an error — it only means the next preview asks again.
    remembered = 0
    for item in payload.items:
        if not item.remember:
            continue
        try:
            await picnic_service.remember_mapping(
                db,
                term=item.term or "",
                product_id=item.product_id,
                product_name=item.product_name,
                user_id=user.id,
            )
            remembered += 1
        except Exception:
            await db.rollback()
            logger.exception("could not remember picnic mapping for %r", item.term)

    return ok(
        PicnicCartOut(added=len(payload.items), remembered=remembered, cart=cart).model_dump()
    )


@router.get("/mappings")
async def get_mappings(
    _user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await picnic_service.list_mappings(db)
    return ok([PicnicMappingOut.model_validate(m).model_dump(mode="json") for m in rows])


@router.delete("/mappings/{mapping_id}")
async def delete_mapping(
    mapping_id: int,
    _user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    if not await picnic_service.delete_mapping(db, mapping_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zuordnung nicht gefunden")
    return ok({"message": "Deleted"})
