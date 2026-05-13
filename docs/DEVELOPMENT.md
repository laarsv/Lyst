# Development setup

This guide walks through running Lyst locally for development. For the
production install path use [INSTALLATION.md](./INSTALLATION.md) instead.

There are two supported workflows:

- **Containerised** — backend, frontend, and Postgres all in Docker via
  `docker-compose.dev.yml`. One command, no Python or Node on the host.
- **Hybrid** (recommended) — Postgres + backend in Docker, frontend on
  the host with `npm run dev`. The fastest edit-loop for UI work.

---

## Quick start (containerised)

```bash
git clone https://github.com/<owner>/Lyst.git
cd Lyst
cp .env.example .env
# Edit .env: at minimum set POSTGRES_PASSWORD, SECRET_KEY, INITIAL_ADMIN_PASSWORD.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

What this gives you:

- **Backend** at <http://localhost:8000>, auto-reloading on file changes
  (uvicorn `--reload --reload-dir app --reload-dir alembic`).
- **Frontend** at <http://localhost:5173>, vite dev server with HMR.
- **Postgres** on `127.0.0.1:5432` for direct DB tooling
  (DataGrip / DBeaver / `psql -h 127.0.0.1`).

Edit a `.py` or `.tsx` file, save, see the change in the browser within a
second.

---

## Hybrid workflow (recommended for UI work)

vite's dev server runs faster on the host than inside Docker, especially
for HMR latency. Spin up only the backend + db in compose, run the
frontend natively.

```bash
# 1. Start backend + Postgres (and skip the dev frontend container)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up backend db

# 2. In a second terminal: frontend on the host
cd frontend
npm install
npm run dev
```

The vite proxy in `frontend/vite.config.ts` already forwards `/api/*` to
`http://localhost:8000`, which is where the dev compose exposes the
backend on the host.

---

## Bare-metal backend (no Docker)

Useful for stepping through Python code with a debugger.

### Prerequisites

- Python **3.12** (project pins to it via Dockerfile).
- A running Postgres 14+ — easiest path: `docker compose up -d db` from
  the repo root, which exposes Postgres on `127.0.0.1:5432`.

### Steps

```bash
cd backend
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Point at the dockerised db (or your own Postgres)
export DATABASE_URL='postgresql+asyncpg://lyst:<your-password>@localhost:5432/lyst'
export SECRET_KEY='dev-only-not-for-prod'
export INITIAL_ADMIN_PASSWORD='ChangeMe123!'

alembic upgrade head           # apply migrations
python -m app.seed             # create the initial admin (idempotent)

uvicorn app.main:app --reload --port 8000
```

Then in another terminal:

```bash
cd frontend
npm install
npm run dev
```

---

## Database operations

### Apply migrations manually

```bash
docker compose exec backend alembic upgrade head
```

### Create a new migration after a model change

Alembic autogenerate runs against a live DB:

```bash
docker compose exec backend alembic revision --autogenerate -m "Add foo to bar"
```

Review the generated file under `backend/alembic/versions/` — autogenerate
catches column add/drop reliably but **misses things like enum value
adds, check constraints, and index renames**. Hand-edit when needed.

### Roll back one revision

```bash
docker compose exec backend alembic downgrade -1
```

### Wipe and reseed (development only)

```bash
docker compose down -v        # deletes the lyst-db-data volume
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

The backend's CMD seeds the initial admin user on every cold start.

---

## Tests

The project doesn't ship a test suite yet. Contributing one is high on
the wish-list — start with:

- `backend/`: `pytest` + `httpx.AsyncClient` for endpoint tests, fixture
  for an in-memory or per-test Postgres.
- `frontend/`: Vitest for unit logic (`utils/parseItemInput.ts` is a
  natural starting point), Playwright for end-to-end happy-path coverage.

If you add tests in a PR, plumb them into the GitHub Actions workflow at
`.github/workflows/` so they actually run on every change.

---

## Code style

We use auto-formatters so style is one less review nit.

### Python

```bash
pip install ruff
ruff check backend
ruff format backend
```

Ruff's defaults are fine; no project-specific config so far. If/when we
add `pyproject.toml` rules, document them here.

### TypeScript / React

```bash
cd frontend
npx prettier --write .
```

ESLint is configured indirectly through Vite's React plugin — `npm run
build` (which runs `tsc -b` first) will fail loudly on type errors.

### Conventions

- New files start with a one-paragraph header docstring explaining *why
  this module exists*. See any file under `backend/app/services/` for the
  shape.
- Comments explain *why*, not *what*. If the comment paraphrases the next
  line, delete it.
- Async SQLAlchemy 2.0 in the backend; no sync sessions in async paths.
- New env vars must land in **both** `.env.example` and
  [CONFIGURATION.md](./CONFIGURATION.md) in the same PR.

More in [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Project layout

```
backend/
  app/
    core/           settings, database, dependencies, response wrapper
    models/         SQLAlchemy ORM
    schemas/        Pydantic models for request/response
    routers/        FastAPI APIRouters — one per resource
    services/       business logic, db queries, ws manager
    email/          Resend wrapper + HTML templates
    main.py         FastAPI app, lifespan, scheduler
  alembic/          migrations
  Dockerfile
  requirements.txt

frontend/
  src/
    api/            axios client + endpoint definitions
    components/     reusable React components
    hooks/          custom hooks (useMediaQuery, useNoteEditingState, …)
    lib/            misc helpers (date formatting, wikilinks, …)
    pages/          route-level components
    store/          Zustand stores
    offline/        Dexie offline queue
    utils/          pure helpers (parseItemInput, units, …)
  Dockerfile
  vite.config.ts
  nginx.conf

docs/               this folder
docker-compose.yml      production stack
docker-compose.dev.yml  dev override (bind mounts, reload, vite)
.env.example            annotated env template
```

---

## Useful one-liners

| Goal | Command |
|---|---|
| Tail backend logs | `docker compose logs -f backend` |
| Open a psql shell | `docker compose exec db psql -U lyst -d lyst` |
| Reset everything | `docker compose down -v && docker compose -f docker-compose.yml -f docker-compose.dev.yml up` |
| Run a one-off Python script in the backend env | `docker compose exec backend python -m <module>` |
| Re-seed the initial admin | `docker compose exec backend python -m app.seed` |
| Inspect Ollama from backend POV | `docker compose exec backend python -c "import httpx,os; print(httpx.get(os.environ['OLLAMA_BASE_URL']+'/api/tags').json())"` |
