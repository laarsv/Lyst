# Configuration reference

Every Lyst setting is configured via environment variables in `.env`.
The full annotated template lives in [`.env.example`](../.env.example) at
the repo root — this page is the lookup reference for "what does this
variable do, do I need to set it, what's the default?".

Variables are grouped the same way as in `.env.example`: **Database**,
**Auth**, **App URLs**, **Email**, **Ollama**, **Anthropic**.

> ⚠️ Required variables (no safe default) make `docker compose up` hard-
> fail at startup with a clear error rather than silently launching with
> a blank value. That's intentional.

---

## Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | no | `lyst` | Postgres role for the bundled `db` service. |
| `POSTGRES_PASSWORD` | **yes** | — | Strong random password. Compose refuses to start without it. |
| `POSTGRES_DB` | no | `lyst` | Database name. |
| `DATABASE_URL` | no | derived from the three vars above | Async SQLAlchemy connection string. Override only when pointing at an external Postgres. Format: `postgresql+asyncpg://USER:PASSWORD@HOST:5432/DBNAME`. |

---

## Auth

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | **yes** | — | Signs every JWT. Must be a long random string. Generate with `openssl rand -hex 32`. Rotating it logs everyone out. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | `15` | Lifetime of the in-memory access token. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | no | `7` | Lifetime of the httpOnly refresh-cookie. Sliding window — extended on every refresh. |
| `INITIAL_ADMIN_EMAIL` | no | `admin@lyst.local` | Email of the seed admin user. Created only if the database has no users. |
| `INITIAL_ADMIN_PASSWORD` | **yes** | — | Password of the seed admin user. Change it from the UI on first login. |
| `INITIAL_ADMIN_NAME` | no | `Admin` | Display name of the seed admin user. |

---

## App URLs

| Variable | Required | Default | Description |
|---|---|---|---|
| `FRONTEND_URL` | no | `http://localhost:8091` | Public URL the browser uses. Used in invite emails, password-reset links, and the QR-code share link — must match what users actually see. |
| `BACKEND_CORS_ORIGINS` | no | `http://localhost:8091,http://localhost:5173` | Comma-separated list of origins the API accepts. **Must include** `FRONTEND_URL`. No trailing slashes. |

---

## Email — Resend (optional)

If left blank, all email features degrade gracefully: invitation links and
password-reset links are printed to the backend log instead of sent. See
[EMAIL.md](./EMAIL.md) for how to set this up.

| Variable | Required | Default | Description |
|---|---|---|---|
| `RESEND_API_KEY` | no | empty (mail disabled) | Resend API key from <https://resend.com/api-keys>. |
| `RESEND_FROM_EMAIL` | no | empty | Verified sender, e.g. `Lyst <noreply@your-domain.app>`. The domain must be verified in your Resend dashboard. |

---

## AI — Ollama (optional, recommended)

Powers shopping-item categorisation, recipe URL/photo import, and the
"was kann ich kochen?" suggestions. With no Ollama reachable, those
features return a polite error; the rest of the app is unaffected. See
[OLLAMA.md](./OLLAMA.md).

| Variable | Required | Default | Description |
|---|---|---|---|
| `OLLAMA_BASE_URL` | no | `http://host.docker.internal:11434` | URL the backend uses to reach Ollama. Common values: `http://host.docker.internal:11434` (Ollama on same host, works thanks to compose's `extra_hosts`), `http://<lan-ip>:11434` (Ollama on a different machine), `http://ollama:11434` (Ollama as a sibling compose service). |
| `OLLAMA_TEXT_MODEL` | no | `llama3.1:8b` | Text-generation model for categorisation, URL recipe import, suggestions. Pull on the Ollama host first: `ollama pull llama3.1:8b`. The legacy var name `OLLAMA_MODEL` is still accepted as a fallback. |
| `OLLAMA_VISION_MODEL` | no | `llava:7b` | Vision-capable model for the photo recipe importer. Set empty to disable photo import. `ollama pull llava:7b` to install. |
| `OLLAMA_TEXT_KEEP_ALIVE` | no | `-1` | How long Ollama keeps the text model resident: `-1` = forever, `1h` / `30m` / `5s` = duration, `0` = unload immediately. Pinned forever by default since categorisation is hot-path. |
| `OLLAMA_VISION_KEEP_ALIVE` | no | `1h` | Same idea for the vision model. Defaults to one hour so RAM is freed when nobody's importing photos. |
| `OLLAMA_TIMEOUT_SECONDS` | no | `300` | Hard timeout for Ollama HTTP calls. Bump if your home server is very slow on cold model loads. |

---

## AI — Anthropic Claude (optional)

Cloud LLM as an alternative to Ollama for recipe import and suggestions.
Pay-per-token. Leave the API key empty to keep Claude disabled.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | no | empty (Claude disabled) | Get one at <https://console.anthropic.com/settings/keys>. |
| `ANTHROPIC_MODEL` | no | `claude-haiku-4-5` | Model id. Curated picker in the admin UI lists current options. |
| `ANTHROPIC_TIMEOUT_SECONDS` | no | `60` | Hard timeout for Anthropic API calls. |

---

## Nutrition lookup — Open Food Facts (optional, recommended)

When a user adds or imports a recipe ingredient, Lyst can look it up
in [Open Food Facts](https://world.openfoodfacts.org) to auto-fill the
per-100 g nutrition fields (calories, protein, carbs, fat, fiber,
sugar, salt). OFF is free, anonymous, requires no API key, and is
one of the few high-quality food databases that's safe to hit
without a contract — so it's enabled by default.

What the backend does on your behalf when this is on:

- Sends `GET https://world.openfoodfacts.org/cgi/search.pl?…` for each
  ingredient name on the **AI recipe importer** (URL / photo / HTML /
  PDF / free-text) and on every **manual "Nährwerte" sheet** click.
- Identifies itself with `User-Agent: Lyst/1.3 (https://github.com/laarsv/Lyst)`
  as OFF's fair-use policy asks.
- Caches each query for 7 days in the backend process and rate-limits
  outgoing calls to ~1/second so the upstream service isn't hammered.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NUTRITION_LOOKUP_ENABLED` | no | `true` | Set to `false` to skip every OFF call. The "Nährwerte" sheet then only offers the local Ollama estimate + manual entry. Already-stored nutrition values are unaffected — this only governs new lookups. |

Set `NUTRITION_LOOKUP_ENABLED=false` if you want to keep all recipe
data local (no external HTTP requests during recipe edits/imports).

---

## Common scenarios

### Plain self-hosted, single host

```ini
POSTGRES_PASSWORD=<openssl rand -hex 16>
SECRET_KEY=<openssl rand -hex 32>
INITIAL_ADMIN_EMAIL=admin@your-domain.app
INITIAL_ADMIN_PASSWORD=<a strong password>
FRONTEND_URL=https://lyst.your-domain.app
BACKEND_CORS_ORIGINS=https://lyst.your-domain.app
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=Lyst <noreply@your-domain.app>
```

### External Postgres (e.g. managed)

```ini
DATABASE_URL=postgresql+asyncpg://lyst:<password>@db.internal:5432/lyst
```

The bundled `db` service still starts but stays unused — comment out the
whole `db:` block and the `depends_on` of `backend` in
`docker-compose.yml` if you want to remove it entirely.

### Behind a reverse proxy on a different host

`FRONTEND_URL` and `BACKEND_CORS_ORIGINS` always point at the **public**
address users see, never at the internal Docker host:

```ini
FRONTEND_URL=https://lyst.example.com
BACKEND_CORS_ORIGINS=https://lyst.example.com
```

### Ollama on the same host (Linux)

Default works — `extra_hosts: host.docker.internal:host-gateway` in the
compose file makes the backend container reach the host's Ollama.

### Ollama on a sibling Docker host

```ini
OLLAMA_BASE_URL=http://192.168.1.42:11434
```

### Ollama as a sibling compose service

See [OLLAMA.md](./OLLAMA.md) for the commented compose snippet — set:

```ini
OLLAMA_BASE_URL=http://ollama:11434
```

### Air-gapped (no email, no AI)

Just leave the optional sections empty:

```ini
RESEND_API_KEY=
ANTHROPIC_API_KEY=
# OLLAMA_BASE_URL pointing at an unreachable host is fine — AI features
# return a clean error in the UI, nothing else breaks.
```
