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
    # Refresh-token / "stay logged in" window. The refresh cookie is a SLIDING
    # session: refresh_token() re-issues it on every successful refresh, so an
    # actively-used session rolls this window forward instead of hitting a hard
    # wall N days after login. Only idle longer than this logs the user out.
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
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
    # Optional override for the plant-prefill call only. Empty → use
    # OLLAMA_TEXT_MODEL. Lets you point prefill at a schema-friendly model
    # (e.g. qwen3:8b) without changing the hot-path categorization model.
    OLLAMA_PLANT_MODEL: str = ""
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

    # USDA FoodData Central — primary source for raw cooking ingredients
    # (Foundation + SR Legacy datasets). OFF is brand/barcode-centric and
    # misses the "raw avocado" cases entirely; USDA fills that gap. Free
    # API key from https://fdc.nal.usda.gov/api-key-signup.html. Empty
    # string = USDA group silently skipped, OFF + KI + manual still work.
    FDC_API_KEY: str = ""

    # When the German term isn't in our static translation table AND USDA
    # found nothing with the raw term, optionally do a single Ollama call
    # to translate the German ingredient to English and retry USDA. OFF by
    # default because it adds real latency per miss; expanding the static
    # table in app/data/ingredient_translations.py is the preferred path.
    NUTRITION_TRANSLATE_FALLBACK: bool = False

    # --- Server-to-server integration (e.g. n8n Picnic .eml import) ---
    # X-API-Key for POST /api/recipes/import-eml. Empty = endpoint disabled
    # (503). NOT the user JWT — this is automation. Set LYST_INTEGRATION_API_KEY.
    INTEGRATION_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("LYST_INTEGRATION_API_KEY", "INTEGRATION_API_KEY"),
    )
    # Which user the API-imported recipes belong to (no logged-in user in an
    # API call). Set LYST_PICNIC_IMPORT_OWNER_EMAIL to an existing account.
    PICNIC_IMPORT_OWNER_EMAIL: str = Field(
        default="",
        validation_alias=AliasChoices(
            "LYST_PICNIC_IMPORT_OWNER_EMAIL", "PICNIC_IMPORT_OWNER_EMAIL"
        ),
    )

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.BACKEND_CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
