import logging
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.limiter import limiter
from app.routers import (
    admin, auth, items, lists, me, meal_plans, note_folders, note_tasks, notes,
    notifications, plants, recipes, recipes_ai, recipes_import, recipes_nutrition,
    recipes_share, reminders, search, share, snapshots, tags, tasks, ws,
)
from app.services.ollama import prewarm_text
from app.services.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    logger.info("%s API starting", settings.APP_NAME)
    # Fire-and-forget: load the text model into RAM so the first user request
    # is instant. Wrapped in try because Ollama may be down during startup —
    # the service must still come up so the rest of the API works.
    try:
        await prewarm_text()
    except Exception as e:  # noqa: BLE001 — never fail startup because of warmup
        logger.warning("Ollama pre-warm errored: %s", e)
    try:
        yield
    finally:
        stop_scheduler()
        logger.info("%s API shutting down", settings.APP_NAME)


app = FastAPI(title=f"{settings.APP_NAME} API", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Client-Id"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"data": None, "error": "Internal server error"},
    )


@app.get("/api/health")
async def health():
    return {"data": {"status": "ok", "app": settings.APP_NAME}, "error": None}


# Serve user-uploaded files (recipe images today; can host more later) from
# /static/. The directory is bind-mounted in docker-compose so files survive
# container rebuilds. URL stored in DB looks like /static/recipes/123/uuid.jpg.
UPLOADS_DIR = pathlib.Path("/app/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(UPLOADS_DIR)), name="static")


PREFIX = "/api"
app.include_router(auth.router, prefix=PREFIX)
app.include_router(me.router, prefix=PREFIX)
app.include_router(admin.router, prefix=PREFIX)
app.include_router(lists.router, prefix=PREFIX)
app.include_router(items.router, prefix=PREFIX)
app.include_router(share.router, prefix=PREFIX)
app.include_router(reminders.router, prefix=PREFIX)
app.include_router(notes.router, prefix=PREFIX)
app.include_router(note_folders.router, prefix=PREFIX)
app.include_router(note_tasks.router, prefix=PREFIX)
app.include_router(tasks.router, prefix=PREFIX)
app.include_router(notifications.router, prefix=PREFIX)
app.include_router(tags.router, prefix=PREFIX)
app.include_router(recipes.router, prefix=PREFIX)
app.include_router(recipes_ai.router, prefix=PREFIX)
app.include_router(recipes_import.router, prefix=PREFIX)
app.include_router(recipes_nutrition.router, prefix=PREFIX)
app.include_router(recipes_share.router, prefix=PREFIX)
app.include_router(meal_plans.router, prefix=PREFIX)
app.include_router(plants.router, prefix=PREFIX)
app.include_router(snapshots.router, prefix=PREFIX)
app.include_router(search.router, prefix=PREFIX)
# WebSocket router is intentionally NOT prefixed with /api so the
# spec-compliant URL `ws://.../ws/lists/{id}` works.
app.include_router(ws.router)
