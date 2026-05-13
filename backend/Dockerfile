# =============================================================================
#  Lyst backend — multi-stage build
# =============================================================================
#  Stage 1 (builder): pulls/builds wheels with full build tooling.
#  Stage 2 (runtime): slim image with only runtime libs, drops to a non-root
#                     user, runs uvicorn under tini for clean signals.
# =============================================================================

# ---- Stage 1: builder --------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# build-essential + libpq-dev cover any source builds (asyncpg / bcrypt /
# cryptography all ship wheels for amd64+arm64, but a fresh requirements bump
# may require compilation — keep the toolchain here, not in the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip wheel --wheel-dir /wheels -r requirements.txt


# ---- Stage 2: runtime --------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libpq5: asyncpg/psycopg runtime. tini: PID-1 reaper so SIGTERM reaches
# uvicorn cleanly during `docker compose down`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 app \
    && useradd  --system --uid 1000 --gid app --shell /usr/sbin/nologin --home /app app

WORKDIR /app

# Install dependencies from the pre-built wheels — no compiler needed in the
# final image, so the attack surface and image size stay small.
COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

# Application code. --chown so the non-root user can read everything,
# including alembic's migrations directory.
COPY --chown=app:app . .

USER app

EXPOSE 8000

# Health probe: hit /api/health using stdlib so no extra package is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3); sys.exit(0 if r.status==200 else 1)" \
    || exit 1

# tini → migrations → seed admin → uvicorn. Keeping the chain in CMD (not
# ENTRYPOINT) so users can override it via `docker compose run` for one-off
# admin tasks like `alembic downgrade -1`.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
