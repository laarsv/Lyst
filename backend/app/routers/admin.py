from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as env_settings
from app.core.database import get_db
from app.core.dependencies import require_admin
from app.core.responses import ok
from app.email.sender import send_email
from app.email.templates import test_email
from app.models.user import User
from app.schemas.user import (
    AdminUserOut,
    UserCreate,
    UserCreateResponse,
    UserInvite,
    UserOut,
    UserUpdate,
)
from app.services.admin_service import (
    admin_reset_password,
    create_user,
    delete_user,
    generate_temp_password,
    invite_user,
    list_users,
    update_user,
)
from app.services.import_service import RecipeImportError, list_ollama_models
from app.services.settings_service import KEY_OLLAMA_MODEL, get_setting, set_setting

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users")
async def get_users(q: str | None = None, db: AsyncSession = Depends(get_db)):
    rows = await list_users(db, q)
    return ok(
        [
            AdminUserOut.model_validate(u).model_copy(update={"list_count": c}).model_dump(mode="json")
            for u, c in rows
        ]
    )


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def post_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    temp = payload.password or generate_temp_password()
    try:
        user = await create_user(db, payload.email, payload.name, temp, payload.role)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(
        UserCreateResponse(
            user=UserOut.model_validate(user), temp_password=temp
        ).model_dump(mode="json")
    )


@router.post("/users/invite", status_code=status.HTTP_201_CREATED)
async def post_invite(payload: UserInvite, db: AsyncSession = Depends(get_db)):
    try:
        user = await invite_user(db, payload.email, payload.name, payload.role)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(UserOut.model_validate(user).model_dump(mode="json"))


@router.patch("/users/{user_id}")
async def patch_user(user_id: int, payload: UserUpdate, db: AsyncSession = Depends(get_db)):
    try:
        user = await update_user(
            db,
            user_id,
            name=payload.name,
            email=payload.email,
            is_active=payload.is_active,
            role=payload.role,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok(UserOut.model_validate(user).model_dump(mode="json"))


@router.post("/users/{user_id}/reset-password")
async def post_reset(user_id: int, db: AsyncSession = Depends(get_db)):
    try:
        await admin_reset_password(db, user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok({"message": "Reset email sent"})


@router.delete("/users/{user_id}", status_code=status.HTTP_200_OK)
async def del_user(
    user_id: int,
    current: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if current.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself"
        )
    try:
        await delete_user(db, user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok({"message": "User deleted"})


# ---------- Ollama settings ----------

class OllamaModelSetting(BaseModel):
    model: str | None = Field(default=None, max_length=128)


@router.get("/ollama/models")
async def get_ollama_models(db: AsyncSession = Depends(get_db)):
    """List all Ollama models installed on the configured Ollama instance, plus
    the currently selected one (DB-backed override or env default)."""
    try:
        models = await list_ollama_models()
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    selected_override = await get_setting(db, KEY_OLLAMA_MODEL)
    return ok(
        {
            "models": models,
            "selected": selected_override or env_settings.OLLAMA_MODEL,
            "is_override": selected_override is not None,
            "env_default": env_settings.OLLAMA_MODEL,
            "ollama_base_url": env_settings.OLLAMA_BASE_URL,
        }
    )


@router.put("/ollama/model")
async def put_ollama_model(payload: OllamaModelSetting, db: AsyncSession = Depends(get_db)):
    """Set (or clear, with model=null) the Ollama model used by the importer.
    Setting null falls back to the env default."""
    value = payload.model.strip() if payload.model and payload.model.strip() else None
    await set_setting(db, KEY_OLLAMA_MODEL, value)
    return ok({"selected": value or env_settings.OLLAMA_MODEL, "is_override": value is not None})


# ---------- Mail test ----------

class TestEmailRequest(BaseModel):
    to: EmailStr | None = None  # default = current admin's own email


@router.post("/test-email")
async def post_test_email(
    payload: TestEmailRequest,
    current: User = Depends(require_admin),
):
    """Send a Resend test email — verifies API key, sender, and DNS in one shot."""
    if not env_settings.RESEND_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RESEND_API_KEY ist nicht gesetzt — siehe .env",
        )
    target = str(payload.to) if payload.to else current.email
    subject, html = test_email(current.name, target)
    sent = await send_email(target, subject, html)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Resend hat den Versand abgelehnt — Backend-Log prüfen",
        )
    return ok({"to": target, "message": "Test-E-Mail gesendet"})
