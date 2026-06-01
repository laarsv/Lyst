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
    MailDeliveryError,
    admin_reset_password,
    create_user,
    delete_user,
    generate_temp_password,
    invite_user,
    list_users,
    update_user,
)
from app.services.import_service import (
    ANTHROPIC_MODELS,
    RecipeImportError,
    list_ollama_models,
)
from app.services.ollama import OllamaError, list_loaded_models
from app.services.settings_service import (
    KEY_ANTHROPIC_MODEL,
    KEY_LLM_PROVIDER,
    KEY_OLLAMA_MODEL,
    KEY_OLLAMA_VISION_MODEL,
    get_llm_provider,
    get_setting,
    set_setting,
)


# Vision-capability heuristic from /api/tags `details.families` (+ name as a
# backstop). No reliable single flag exists in /api/tags, but vision models
# carry a projector family ("clip"), a known vision family ("mllama"), or a
# *-vl family. Good enough to filter the vision-model picker; the currently
# selected model is always kept visible regardless.
_VISION_FAMILY_MARKERS = {
    "clip", "mllama", "llava", "qwen2vl", "qwen25vl", "vit", "siglip",
    "bakllava", "moondream", "gemma3", "mistral3",
}


def _is_vision_model(m: dict) -> bool:
    det = m.get("details") or {}
    cand = {str(f).lower() for f in (det.get("families") or [])}
    cand.add(str(det.get("family") or "").lower())
    if cand & _VISION_FAMILY_MARKERS:
        return True
    if any("clip" in c or "vision" in c or c.endswith("vl") for c in cand if c):
        return True
    name = (m.get("name") or m.get("model") or "").lower()
    return any(k in name for k in ("llava", "vision", "minicpm-v", "bakllava", "moondream", "-vl"))

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
    except MailDeliveryError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))
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
    except MailDeliveryError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))
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


# ---------- LLM provider settings (Ollama / Anthropic) ----------

class ProviderSetting(BaseModel):
    provider: str = Field(pattern="^(ollama|anthropic)$")


class ModelSetting(BaseModel):
    model: str | None = Field(default=None, max_length=128)


@router.get("/llm")
async def get_llm_settings(db: AsyncSession = Depends(get_db)):
    """Unified LLM settings dump: active provider plus per-provider config.
    Ollama section may carry an `error` field if the Ollama server can't be
    reached — Anthropic part still works in that case."""
    provider = await get_llm_provider(db)

    # Ollama section
    ollama_models: list[dict] = []
    ollama_error: str | None = None
    try:
        ollama_models = await list_ollama_models()
    except RecipeImportError as e:
        ollama_error = e.message
    # Tag each model with a vision-capability flag so the frontend can filter
    # the vision-model picker.
    for m in ollama_models:
        m["vision"] = _is_vision_model(m)
    ollama_override = await get_setting(db, KEY_OLLAMA_MODEL)
    vision_override = await get_setting(db, KEY_OLLAMA_VISION_MODEL)

    # Anthropic section
    anthropic_override = await get_setting(db, KEY_ANTHROPIC_MODEL)

    return ok(
        {
            "provider": provider,
            "ollama": {
                "models": ollama_models,
                "selected": ollama_override or env_settings.OLLAMA_TEXT_MODEL,
                "is_override": ollama_override is not None,
                "env_default": env_settings.OLLAMA_TEXT_MODEL,
                "vision_selected": vision_override or env_settings.OLLAMA_VISION_MODEL,
                "vision_is_override": vision_override is not None,
                "vision_env_default": env_settings.OLLAMA_VISION_MODEL,
                "base_url": env_settings.OLLAMA_BASE_URL,
                "error": ollama_error,
            },
            "anthropic": {
                "models": ANTHROPIC_MODELS,
                "selected": anthropic_override or env_settings.ANTHROPIC_MODEL,
                "is_override": anthropic_override is not None,
                "env_default": env_settings.ANTHROPIC_MODEL,
                "has_api_key": bool(env_settings.ANTHROPIC_API_KEY),
            },
        }
    )


@router.put("/llm/provider")
async def put_llm_provider(payload: ProviderSetting, db: AsyncSession = Depends(get_db)):
    await set_setting(db, KEY_LLM_PROVIDER, payload.provider)
    return ok({"provider": payload.provider})


@router.put("/llm/ollama-model")
async def put_ollama_model(payload: ModelSetting, db: AsyncSession = Depends(get_db)):
    """Set (or clear, with model=null) the Ollama model used by the importer.
    Setting null falls back to the env default."""
    value = payload.model.strip() if payload.model and payload.model.strip() else None
    await set_setting(db, KEY_OLLAMA_MODEL, value)
    return ok({"selected": value or env_settings.OLLAMA_TEXT_MODEL, "is_override": value is not None})


@router.put("/llm/ollama-vision-model")
async def put_ollama_vision_model(payload: ModelSetting, db: AsyncSession = Depends(get_db)):
    """Set (or clear, with model=null) the Ollama vision model used by the photo
    importer. Setting null falls back to the env default."""
    value = payload.model.strip() if payload.model and payload.model.strip() else None
    await set_setting(db, KEY_OLLAMA_VISION_MODEL, value)
    return ok({
        "vision_selected": value or env_settings.OLLAMA_VISION_MODEL,
        "vision_is_override": value is not None,
    })


@router.put("/llm/anthropic-model")
async def put_anthropic_model(payload: ModelSetting, db: AsyncSession = Depends(get_db)):
    value = payload.model.strip() if payload.model and payload.model.strip() else None
    await set_setting(db, KEY_ANTHROPIC_MODEL, value)
    return ok({"selected": value or env_settings.ANTHROPIC_MODEL, "is_override": value is not None})


# ---------- Ollama runtime status (which models are loaded right now) ----------

@router.get("/ollama-status")
async def get_ollama_status():
    """Returns the configured text/vision models plus Ollama's /api/ps —
    the list of models currently held in memory. Powers the admin widget
    that shows whether keep_alive is doing its job."""
    payload: dict = {
        "base_url": env_settings.OLLAMA_BASE_URL,
        "configured": {
            "text_model": env_settings.OLLAMA_TEXT_MODEL,
            "vision_model": env_settings.OLLAMA_VISION_MODEL,
            "text_keep_alive": env_settings.OLLAMA_TEXT_KEEP_ALIVE,
            "vision_keep_alive": env_settings.OLLAMA_VISION_KEEP_ALIVE,
        },
        "loaded": [],
        "error": None,
    }
    try:
        payload["loaded"] = await list_loaded_models()
    except OllamaError as e:
        payload["error"] = e.message
    return ok(payload)


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
