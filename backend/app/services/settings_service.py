"""DB-backed key/value settings, with .env defaults as fallback."""
import base64
import hashlib
import logging
from typing import Literal

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as env_settings
from app.models.app_setting import AppSetting

logger = logging.getLogger(__name__)

KEY_OLLAMA_MODEL = "ollama_model"
KEY_OLLAMA_VISION_MODEL = "ollama_vision_model"
KEY_ANTHROPIC_MODEL = "anthropic_model"
KEY_ANTHROPIC_API_KEY = "anthropic_api_key"  # stored Fernet-encrypted, never plaintext
KEY_LLM_PROVIDER = "llm_provider"  # "ollama" | "anthropic"

LlmProvider = Literal["ollama", "anthropic"]
DEFAULT_PROVIDER: LlmProvider = "ollama"


async def get_setting(db: AsyncSession, key: str) -> str | None:
    result = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else None


async def set_setting(db: AsyncSession, key: str, value: str | None) -> None:
    result = await db.execute(select(AppSetting).where(AppSetting.key == key))
    row = result.scalar_one_or_none()
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
    await db.commit()


async def get_ollama_model(db: AsyncSession) -> str:
    """Returns the admin-selected Ollama text model, falling back to the env default."""
    return (await get_setting(db, KEY_OLLAMA_MODEL)) or env_settings.OLLAMA_TEXT_MODEL


async def get_ollama_vision_model(db: AsyncSession) -> str:
    """Returns the admin-selected Ollama vision model (photo import), falling
    back to the env default."""
    return (await get_setting(db, KEY_OLLAMA_VISION_MODEL)) or env_settings.OLLAMA_VISION_MODEL


async def get_anthropic_model(db: AsyncSession) -> str:
    """Returns the admin-selected Anthropic model, falling back to the env default."""
    return (await get_setting(db, KEY_ANTHROPIC_MODEL)) or env_settings.ANTHROPIC_MODEL


def _fernet() -> Fernet:
    """Cipher for secrets kept in app_settings. Derived from SECRET_KEY with a
    purpose prefix, so a DB dump / backup alone does not reveal the API key.
    Rotating SECRET_KEY makes a stored key undecryptable — it is then treated as
    unset (falls back to .env) and has to be entered again."""
    digest = hashlib.sha256(f"lyst-app-settings:{env_settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


async def resolve_anthropic_api_key(
    db: AsyncSession,
) -> tuple[str, Literal["admin", "env"] | None]:
    """Returns (key, source): the admin-entered key wins over ANTHROPIC_API_KEY
    from .env. ("", None) when neither is set."""
    stored = await get_setting(db, KEY_ANTHROPIC_API_KEY)
    if stored:
        try:
            return _fernet().decrypt(stored.encode()).decode(), "admin"
        except InvalidToken:
            logger.warning(
                "Gespeicherter Anthropic-API-Key ist nicht entschlüsselbar "
                "(SECRET_KEY geändert?) — Fallback auf .env"
            )
    if env_settings.ANTHROPIC_API_KEY:
        return env_settings.ANTHROPIC_API_KEY, "env"
    return "", None


async def get_anthropic_api_key(db: AsyncSession) -> str:
    return (await resolve_anthropic_api_key(db))[0]


async def set_anthropic_api_key(db: AsyncSession, api_key: str | None) -> None:
    """Stores the key encrypted; None clears the override (back to .env)."""
    await set_setting(
        db, KEY_ANTHROPIC_API_KEY, _fernet().encrypt(api_key.encode()).decode() if api_key else None
    )


async def get_llm_provider(db: AsyncSession) -> LlmProvider:
    """Returns the active LLM provider for the recipe importer."""
    raw = await get_setting(db, KEY_LLM_PROVIDER)
    if raw in ("ollama", "anthropic"):
        return raw  # type: ignore[return-value]
    return DEFAULT_PROVIDER
