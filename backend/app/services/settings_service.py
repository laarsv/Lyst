"""DB-backed key/value settings, with .env defaults as fallback."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as env_settings
from app.models.app_setting import AppSetting

KEY_OLLAMA_MODEL = "ollama_model"


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
