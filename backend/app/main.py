import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.limiter import limiter
from app.routers import admin, auth, items, lists, me, notes, reminders, share, tags
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
    allow_methods=["*"],
    allow_headers=["*"],
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


PREFIX = "/api"
app.include_router(auth.router, prefix=PREFIX)
app.include_router(me.router, prefix=PREFIX)
app.include_router(admin.router, prefix=PREFIX)
app.include_router(lists.router, prefix=PREFIX)
app.include_router(items.router, prefix=PREFIX)
app.include_router(share.router, prefix=PREFIX)
app.include_router(reminders.router, prefix=PREFIX)
app.include_router(notes.router, prefix=PREFIX)
app.include_router(tags.router, prefix=PREFIX)
