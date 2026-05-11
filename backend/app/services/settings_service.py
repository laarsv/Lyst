"""DB-backed key/value settings, with .env defaults as fallback."""
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as env_settings
from app.models.app_setting import AppSetting

KEY_OLLAMA_MODEL = "ollama_model"
KEY_ANTHROPIC_MODEL = "anthropic_model"
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
    """Returns the admin-selected Ollama model, falling back to the env default."""
    return (await get_setting(db, KEY_OLLAMA_MODEL)) or env_settings.OLLAMA_MODEL


async def get_anthropic_model(db: AsyncSession) -> str:
    """Returns the admin-selected Anthropic model, falling back to the env default."""
    return (await get_setting(db, KEY_ANTHROPIC_MODEL)) or env_settings.ANTHROPIC_MODEL


async def get_llm_provider(db: AsyncSession) -> LlmProvider:
    """Returns the active LLM provider for the recipe importer."""
    raw = await get_setting(db, KEY_LLM_PROVIDER)
    if raw in ("ollama", "anthropic"):
        return raw  # type: ignore[return-value]
    return DEFAULT_PROVIDER
