"""Recipe + recipe-book sharing endpoints — extracted from recipes.py.

Public-link share (per recipe):
  POST   /recipes/{id}/share/enable
  POST   /recipes/{id}/share/disable

Public-link share (whole book):
  POST   /recipes/share-book/enable
  POST   /recipes/share-book/disable

Internal share by email (per recipe + whole book) — alembic 0012:
  POST   /recipes/{id}/share/email
  GET    /recipes/{id}/shares
  DELETE /recipes/{id}/shares/{user_id}
  POST   /recipes/share-book/email
  GET    /recipes/share-book/shares
  DELETE /recipes/share-book/shares/{user_id}

Permission updates + recipient-initiated leave (alembic 0014):
  DELETE /recipes/{id}/shares/me              ← must be registered
  PATCH  /recipes/{id}/shares/{user_id}          before /shares/{user_id:int}
  DELETE /recipes/share-book/shares/me/{owner_id}    same trick for book
  PATCH  /recipes/share-book/shares/{user_id}

PRIVACY: the email-lookup is done EXCLUSIVELY here, only on POST submit,
and only as an exact (case-insensitive) match. There is no autocomplete
endpoint, no partial-match, no "is this email registered?" probe.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_client_id, require_user
from app.core.responses import ok
from app.email.sender import send_email
from app.email.templates import recipe_book_share_email, recipe_share_email
from app.models.user import User
from app.schemas.recipe import (
    InternalShareOut,
    ShareByEmailRequest,
    ShareByEmailResponse,
    ShareUpdateRequest,
)
from app.schemas.share import ShareEnableResponse
from app.services.notification_service import notify_share_created
from app.services.realtime_events import emit_share_event
from app.services.recipe_service import (
    disable_book_share,
    disable_recipe_share,
    enable_book_share,
    enable_recipe_share,
    get_recipe,
    leave_book_internal_share,
    leave_recipe_internal_share,
    list_book_internal_shares,
    list_recipe_internal_shares,
    revoke_book_internal_share,
    revoke_recipe_internal_share,
    share_book_with_email,
    share_recipe_with_email,
    update_book_internal_share_permission,
    update_recipe_internal_share_permission,
)

router = APIRouter(prefix="/recipes", tags=["recipes"])


# =============================================================================
#  Public-link share — single recipe + recipe-book
# =============================================================================
#
# Same shape as ListsApi share endpoints. Only the owner can flip a recipe's
# share state; the public GET routes live below `share.py`'s router.

@router.post("/{recipe_id}/share/enable")
async def post_recipe_share_enable(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    token, url, qr = await enable_recipe_share(db, rec)
    return ok(
        ShareEnableResponse(share_token=token, share_url=url, qr_code_png_base64=qr).model_dump()
    )


@router.post("/{recipe_id}/share/disable")
async def post_recipe_share_disable(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await disable_recipe_share(db, rec)
    return ok({"message": "Share disabled"})


@router.post("/share-book/enable")
async def post_book_share_enable(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    token, url, qr = await enable_book_share(db, user)
    return ok(
        ShareEnableResponse(share_token=token, share_url=url, qr_code_png_base64=qr).model_dump()
    )


@router.post("/share-book/disable")
async def post_book_share_disable(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await disable_book_share(db, user)
    return ok({"message": "Book share disabled"})


# =============================================================================
#  Internal sharing by email — alembic 0012 (per-recipe + per-book)
# =============================================================================

# ---------- Single recipe ----------

@router.post("/{recipe_id}/share/email")
async def post_share_recipe_by_email(
    recipe_id: int,
    payload: ShareByEmailRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    try:
        kind, name, recipient_id = await share_recipe_with_email(
            db, rec, user, payload.email, payload.permission
        )
    except ValueError as e:
        if str(e) == "self-share":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Das ist deine eigene Adresse.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if kind == "external":
        # Send the public link via Resend. share_token is now guaranteed
        # to exist because the service ensures it.
        url = f"{settings.FRONTEND_URL}/share/recipe/{rec.share_token}"
        subject, html = recipe_share_email(user.name, rec.title, url)
        await send_email(payload.email, subject, html)
    elif kind == "internal" and recipient_id is not None:
        # Fan out share.created → the new recipient's user-WS channel.
        # Their recipes overview re-fetches and the just-shared recipe
        # appears; the dispatcher also fires a toast.
        await emit_share_event(
            recipient_id=recipient_id,
            actor_id=user.id,
            resource_type="recipe",
            resource_id=rec.id,
            event="share.created",
            client_id=client_id,
            payload={"actor_name": user.name, "title": rec.title},
        )
        # Persist a notification row so the recipient still sees the
        # share in their bell after a refresh / next session.
        await notify_share_created(
            db,
            recipient_id=recipient_id,
            actor_id=user.id,
            actor_name=user.name,
            resource_type="recipe",
            resource_id=rec.id,
            title=rec.title,
        )

    return ok(ShareByEmailResponse(type=kind, user_name=name).model_dump())


@router.get("/{recipe_id}/shares")
async def get_recipe_shares(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    rows = await list_recipe_internal_shares(db, recipe_id)
    return ok(
        [
            InternalShareOut(
                user_id=u.id,
                name=u.name,
                email=u.email,
                permission=s.permission,
                created_at=s.created_at,
            ).model_dump(mode="json")
            for s, u in rows
        ]
    )


@router.delete("/{recipe_id}/shares/{user_id}")
async def del_recipe_share(
    recipe_id: int,
    user_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await revoke_recipe_internal_share(db, recipe_id, user_id)
    return ok({"message": "Share revoked"})


# ---------- Whole recipe book ----------

@router.post("/share-book/email")
async def post_share_book_by_email(
    payload: ShareByEmailRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
    client_id: str | None = Depends(get_client_id),
):
    try:
        kind, name, recipient_id = await share_book_with_email(
            db, user, payload.email, payload.permission
        )
    except ValueError as e:
        if str(e) == "self-share":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Das ist deine eigene Adresse.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if kind == "external":
        url = f"{settings.FRONTEND_URL}/share/recipe-book/{user.recipe_book_share_token}"
        subject, html = recipe_book_share_email(user.name, url)
        await send_email(payload.email, subject, html)
    elif kind == "internal" and recipient_id is not None:
        # Share-book recipient gets a share.created targeting the
        # owner's user_id (resource_id) — the dispatcher's "share"
        # branch already invalidates recipes for the recipient.
        await emit_share_event(
            recipient_id=recipient_id,
            actor_id=user.id,
            resource_type="recipe",
            resource_id=user.id,  # whole-book share — owner id stands in
            event="share.created",
            client_id=client_id,
            payload={"actor_name": user.name, "title": "Rezeptbuch"},
        )
        await notify_share_created(
            db,
            recipient_id=recipient_id,
            actor_id=user.id,
            actor_name=user.name,
            resource_type="recipe",
            resource_id=user.id,
            title="Rezeptbuch",
        )

    return ok(ShareByEmailResponse(type=kind, user_name=name).model_dump())


@router.get("/share-book/shares")
async def get_book_shares(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_book_internal_shares(db, user.id)
    return ok(
        [
            InternalShareOut(
                user_id=u.id,
                name=u.name,
                email=u.email,
                permission=s.permission,
                created_at=s.created_at,
            ).model_dump(mode="json")
            for s, u in rows
        ]
    )


@router.delete("/share-book/shares/{user_id}")
async def del_book_share(
    user_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    await revoke_book_internal_share(db, user.id, user_id)
    return ok({"message": "Share revoked"})


# =============================================================================
#  Permission updates + recipient-initiated leave (alembic 0014)
# =============================================================================
#
# Path-order note: FastAPI returns 422 (not "try the next route") when an
# int path converter fails, so any literal-path route ("/shares/me") MUST
# be registered BEFORE "/shares/{user_id:int}". Same goes for the book
# variant.

@router.delete("/{recipe_id}/shares/me")
async def leave_recipe_share(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Recipient-initiated removal of their own RecipeShare row. Idempotent."""
    await leave_recipe_internal_share(db, recipe_id, user.id)
    return ok({"message": "Left share"})


@router.patch("/{recipe_id}/shares/{user_id}")
async def patch_recipe_share(
    recipe_id: int,
    user_id: int,
    payload: ShareUpdateRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    # Owner-only — recipients can't change anyone's permission, including
    # their own.
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    updated = await update_recipe_internal_share_permission(
        db, recipe_id, user_id, payload.permission
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Share not found"
        )
    return ok({"message": "Permission updated"})


@router.delete("/share-book/shares/me/{owner_id}")
async def leave_book_share(
    owner_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Recipient leaves a book share. Path includes the owner_id so the
    recipient identifies which sender's book to drop — RecipeBookShare's
    natural key is (owner_id, shared_with_user_id). Registered before the
    /shares/{user_id} route to avoid the int-converter-422 trap."""
    await leave_book_internal_share(db, owner_id, user.id)
    return ok({"message": "Left share"})


@router.patch("/share-book/shares/{user_id}")
async def patch_book_share(
    user_id: int,
    payload: ShareUpdateRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    updated = await update_book_internal_share_permission(
        db, user.id, user_id, payload.permission
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Share not found"
        )
    return ok({"message": "Permission updated"})
