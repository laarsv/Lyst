# Installation

This guide takes you from zero to a running, reverse-proxied, backed-up Lyst
instance. The fast path is a single `docker compose up -d` — everything below
that is to make it production-grade.

For the full env-var reference see [CONFIGURATION.md](./CONFIGURATION.md).
For AI features see [OLLAMA.md](./OLLAMA.md). For email see [EMAIL.md](./EMAIL.md).

---

## Prerequisites

- **Docker Engine ≥ 24** and the **Docker Compose v2** plugin
  (`docker compose ...`, not the old `docker-compose` binary).
  - macOS / Windows: Docker Desktop ships both.
  - Linux: install via your distro or the official docs at
    <https://docs.docker.com/engine/install/>.
- About **1 GB RAM free** for the bundled Postgres + backend + frontend
  (more if you run Ollama on the same box).
- **Outbound HTTPS** if you plan to use Resend for email.

That's it. No Python, no Node, no Postgres on the host — everything runs
inside containers.

---

## Step-by-step installation

### 1. Clone the repo

```bash
git clone https://github.com/<owner>/Lyst.git
cd Lyst
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Open `.env` and set at least:

| Variable                  | What to set                                                      |
|---------------------------|------------------------------------------------------------------|
| `POSTGRES_PASSWORD`       | A strong random password.                                         |
| `SECRET_KEY`              | A long random string. Generate one: `openssl rand -hex 32`.       |
| `INITIAL_ADMIN_EMAIL`     | The email address you'll log in with.                             |
| `INITIAL_ADMIN_PASSWORD`  | A strong password for the first login. Change it from the UI later. |
| `FRONTEND_URL`            | The URL users will see in the browser, e.g. `https://lyst.example.com`. |
| `BACKEND_CORS_ORIGINS`    | Comma-separated list — must include `FRONTEND_URL`.               |

Everything else is optional or has a sane default. Compose will hard-fail
on startup if a required value is missing, so you can't accidentally launch
with a blank `SECRET_KEY`.

### 3. Bring up the stack

```bash
docker compose up -d
```

The first run takes a few minutes (image build + database init + initial
admin seed). When the backend logs show `Lyst API starting`, you're up.

Verify:

```bash
curl -fsS http://localhost:8091/api/health
# {"data":{"status":"ok","app":"Lyst"},"error":null}
```

### 4. Log in

Open <http://localhost:8091> (or your `FRONTEND_URL`) and sign in with the
`INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` you set above.

**First thing to do:** change the admin password from `Konto → Passwort
ändern`. The seed-time values stop being load-bearing the moment any user
exists in the database.

---

## Reverse proxy (HTTPS)

Lyst's container serves plain HTTP on port 8091. Don't expose it directly
to the public internet — terminate TLS on a reverse proxy in front.

### Nginx Proxy Manager

In the NPM UI, add a new **Proxy Host**:

- *Domain Names:* `lyst.example.com`
- *Forward Hostname / IP:* the host running Lyst (e.g. `192.168.1.42`)
- *Forward Port:* `8091`
- *Block Common Exploits:* on
- *Websockets Support:* **on** ← required for the live-collaboration
  WebSocket (`/ws/lists/{id}`)
- *SSL → Request a new SSL Certificate* with Let's Encrypt
- *SSL → Force SSL:* on, *HTTP/2:* on

### Caddy

```caddy
lyst.example.com {
    reverse_proxy 192.168.1.42:8091
}
```

That's it — Caddy handles ACME, HTTPS, HTTP/2, and WebSocket upgrades
automatically.

### Traefik (docker-compose snippet)

If you already run Traefik in the same Docker network, add labels to the
`frontend` service in `docker-compose.yml`:

```yaml
frontend:
  # ... existing config ...
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.lyst.rule=Host(`lyst.example.com`)"
    - "traefik.http.routers.lyst.entrypoints=websecure"
    - "traefik.http.routers.lyst.tls.certresolver=letsencrypt"
    - "traefik.http.services.lyst.loadbalancer.server.port=8080"
  networks:
    - traefik
```

(Then drop the `ports:` mapping on `frontend` so only Traefik reaches it.)

### After enabling HTTPS

Update `.env`:

```
FRONTEND_URL=https://lyst.example.com
BACKEND_CORS_ORIGINS=https://lyst.example.com
```

…and restart: `docker compose up -d`. Otherwise email links and CORS
preflight will still point at `http://localhost`.

---

## Backups

Lyst keeps all state in two places:

1. The Postgres volume `lyst-db-data` (everything the user creates).
2. The `.env` file (secrets and admin credentials).

Back up both.

### Quick: pg_dump nightly

```bash
docker compose exec -T db \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
    > "lyst-$(date +%F).pgdump"
```

Wire this into cron and rotate to whatever backup target you already use
(restic, Borg, S3, Hetzner Storage Box…).

### Restoring

Bring up the stack, then:

```bash
docker compose exec -T db \
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
    < lyst-2026-05-12.pgdump
```

`--clean --if-exists` drops + recreates the existing tables before
restoring; safe to run against a freshly-seeded empty database.

### Volume-only backup (alternative)

If you'd rather snapshot the whole Postgres volume:

```bash
docker compose down
docker run --rm \
    -v lyst_lyst-db-data:/source:ro \
    -v "$PWD":/dest \
    alpine tar czf /dest/lyst-db-$(date +%F).tar.gz -C /source .
docker compose up -d
```

(Note the volume's full name is `<project>_lyst-db-data` — `lyst` if you're
in a directory named `Lyst`. Check with `docker volume ls`.)

---

## Updating to a new version

```bash
cd /path/to/Lyst
git fetch --tags
git checkout v1.2.3      # or `git pull` for latest main
docker compose pull       # if you use prebuilt ghcr.io images
docker compose up -d --build
```

Database migrations run automatically on backend startup
(`alembic upgrade head` is the first thing in the container's CMD).

**Always take a backup before updating across a major version** — Lyst is
small but migrations are one-way.

### One-off: notes Markdown → HTML migration (release ≥ 1.5)

When you update to the release that swaps the Markdown editor for the new
TipTap-based rich-text editor, an additional one-shot data migration is
required. Alembic adds the `notes.content_format` column automatically
on backend startup; the *content* conversion is a separate Python
script so it can be run during a maintenance window and stopped /
resumed without disturbing the schema.

**Before running it, back up the `notes` table.** The conversion is
one-way — once a row's HTML overwrites its Markdown, the original text
is gone:

```bash
# Pick whichever fits your setup; the dump file lets you restore a
# single misconverted note from a backup later if needed.
docker compose exec db pg_dump -t notes -F c -U lyst lyst \
  > notes-pre-html-migration.dump
```

Then run the migration:

```bash
# Default flags: batches of 100, no limit. Use --dry-run --verbose
# first on a copy of production to eyeball a handful of conversions.
docker compose exec backend python -m scripts.migrate_notes_to_html
```

Useful flags:

- `--dry-run --verbose --limit 10` — preview 10 conversions without writing.
- `--batch 50` — smaller commit batches on very large note tables.
- `--limit 500` — stop after N notes (e.g. resume after a pause).

The script is **idempotent**: it only touches rows where
`content_format = 'MARKDOWN'`, and flips them to `'HTML'` as it writes.
Re-running once it's finished is a no-op (0 converted).

If a single note got mangled in the conversion (say, an unusual
markdown construct that the converter mishandled), restore that one
row from the dump and re-run the script with no other flags — it'll
find the freshly-MARKDOWN row, retry, and leave the rest alone. The
`content_format` column stays for one release before being dropped so
this rollback window remains open.

### One-off: note tasks → task_items rows (release ≥ 1.6)

The tasks layer (alembic 0018) makes every TipTap task-list checkbox
inside a note individually addressable. Existing notes have those
checkboxes in their HTML content but no `data-task-id` attribute and
no row in the new `task_items` table — so the global Aufgaben view
and the per-task popover ignore them. A second one-shot script
backfills them:

```bash
# Optional: --dry-run --verbose --limit 5 to spot-check first.
docker compose exec backend python -m scripts.migrate_note_tasks_to_rows
```

What it does: for every note where `content_format = 'HTML'`, parses
the saved HTML, inserts a `task_items` row per task-item li that
doesn't already have a `data-task-id`, and stamps the new id back
into the HTML. Idempotent — a re-run skips anything already tagged.

You don't need to back up before this one: the script only ADDS
rows + attribute values, it never destroys existing content. If you
want to undo a single note's conversion you can just clear the
`data-task-id` attributes on its `<li>`s and run the script again.

---

## Troubleshooting

### `frontend` keeps restarting / 502 from the reverse proxy

Check `docker compose logs backend`. If you see `InvalidTextRepresentationError`
or migration errors, the Postgres volume is from an older incompatible
schema — restore from a recent backup or, on a throwaway dev box, wipe
the volume (`docker compose down -v`) and start fresh.

### "KI-Service nicht erreichbar" in the recipe importer

Lyst can't reach Ollama. Confirm `OLLAMA_BASE_URL` works from inside the
backend container:

```bash
docker compose exec backend python -c \
    "import httpx,os; print(httpx.get(os.environ['OLLAMA_BASE_URL']+'/api/tags').json())"
```

If that fails, see [OLLAMA.md](./OLLAMA.md).

### Email links still point to `http://localhost`

You forgot to update `FRONTEND_URL` after putting Lyst behind your reverse
proxy. Set it in `.env` and `docker compose up -d` — the change takes
effect on the next outbound mail.
