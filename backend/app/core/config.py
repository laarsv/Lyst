from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    APP_NAME: str = "Lyst"
    DATABASE_URL: str = "postgresql+asyncpg://lyst:lyst@db:5432/lyst"
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    RESET_TOKEN_EXPIRE_HOURS: int = 1
    INVITE_TOKEN_EXPIRE_HOURS: int = 48

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "Lyst <noreply@lyst.app>"

    FRONTEND_URL: str = "http://localhost:5173"
    BACKEND_CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    INITIAL_ADMIN_EMAIL: str = "admin@lyst.local"
    INITIAL_ADMIN_PASSWORD: str = "ChangeMe123!"
    INITIAL_ADMIN_NAME: str = "Admin"

    OLLAMA_BASE_URL: str = "http://localhost:11434"
    # Text-generation model. New env var name is OLLAMA_TEXT_MODEL; the
    # legacy OLLAMA_MODEL is still accepted so existing .env files keep working.
    OLLAMA_TEXT_MODEL: str = Field(
        default="llama3.1:8b",
        validation_alias=AliasChoices("OLLAMA_TEXT_MODEL", "OLLAMA_MODEL"),
    )
    # Vision-capable model used by the photo importer (llava, llama3.2-vision,
    # qwen2.5-vl, …). Empty string disables the photo-import feature with a
    # clear 503 instead of a confusing model error.
    OLLAMA_VISION_MODEL: str = "llava:7b"
    # keep_alive controls how long Ollama keeps a model resident in (V)RAM after
    # a request. "-1" = forever, "1h"/"30m"/"5s" = duration, "0" = unload now.
    # Text model is hot-path (every shopping item is categorized) so we pin it
    # forever; vision is rare so 1h is plenty and frees RAM if unused.
    OLLAMA_TEXT_KEEP_ALIVE: str = "-1"
    OLLAMA_VISION_KEEP_ALIVE: str = "1h"
    # 7B models on CPU-only home servers can need 60–180s for the first call
    # (model load) and 30–90s for warm inference. 300s gives headroom for the
    # mini-PC case; bump via env if you have an even slower setup.
    OLLAMA_TIMEOUT_SECONDS: int = 300

    # Anthropic Claude API (alternative LLM provider for the recipe importer).
    # Empty key = provider not available; admin can still pick it but the call
    # will return a clear error.
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-haiku-4-5"
    ANTHROPIC_TIMEOUT_SECONDS: int = 60

    # Open Food Facts integration for ingredient nutrition lookup.
    # When false: the Nährwerte sheet skips the OFF call and only offers
    # the Ollama estimate + manual paths (also documented in CONFIGURATION.md).
    # Default on — OFF is free, anonymous, and one of the few high-quality
    # nutrition datasets we can hit without an API key.
    NUTRITION_LOOKUP_ENABLED: bool = True

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.BACKEND_CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
