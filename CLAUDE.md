# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project notes — Lyst

FastAPI + PostgreSQL/asyncpg + Alembic backend, React + TS + Vite + Tailwind frontend, Docker, Brevo for email. The app runs in Docker; there is no local venv — verify the backend by building `./backend` and running `import app.main` / `alembic` against a throwaway Postgres.

**Resource modules** follow a 4-file shape: `app/models/<x>.py`, `app/schemas/<x>.py`, `app/routers/<x>.py`, `app/services/<x>_service.py`. Register the router in `app/main.py` (`app.include_router(..., prefix="/api")`) and the model in `app/models/__init__.py` (so Alembic's metadata sees it). The **Recipes** module is the reference implementation; **Pflanzen/Plants** (`models/plant.py`, alembic `0023`) and **Fitness** (`models/fitness.py`, alembic `0027`) mirror it.

**Fitness module** (alembic `0027`; one additive migration, 3 enums + 5 tables): `exercises` (SHARED library — `owner_id NULL` = global seed readable by all; edit/delete only your own, seeds editable by nobody; list query does NOT filter by owner), `workouts` + `workout_exercises` and `workout_sessions` + `set_logs` (all strictly private per owner). `exercise_id` FKs are `ON DELETE RESTRICT` — `fitness_service.delete_exercise` surfaces a clear 409 when an exercise is still referenced. Routers split like recipes: `fitness_exercises` / `fitness_workouts` / `fitness_sessions`, all `prefix="/fitness"`. Rules baked into the service: a `tracking_type` (REPS / WEIGHT_REPS / TIME) decides which `set_log` fields are allowed (mismatches → 400; WEIGHT_REPS needs reps, weight optional); exactly **one open session** per user (`finished_at IS NULL`; `start_session` 409s otherwise — frontend uses `GET /fitness/sessions/open` to resume/discard); the last-values pre-fill and the per-exercise history pull **finished sessions only**. Seeds: `app/seed_data/exercises.py` (Python list of dicts) is upserted by name into the global library by `seed.py`'s `seed_exercises()`, which runs **independently of** the admin early-return (so it seeds on existing deployments too); global exercise names must stay stable. The progress chart is a dependency-free inline-SVG line (`components/fitness/HistorySparkline.tsx` — no chart lib); the rest timer is client-only.

**Enums:** Python `class X(str, enum.Enum)`; names == values unless a legacy DB value forces `values_callable`. In Alembic, **creating a table** uses the enum inline in `op.create_table` with no separate `.create()` (template: `0002`); **adding a column** needs an explicit `enum.create(checkfirst=True)` + `create_type=False` on the column (template: `0020`).

**Image uploads:** stored to `/app/uploads/<resource>/{id}/<uuid>.<ext>`, served via the `/static` StaticFiles mount, persisted as `image_url = "/static/..."`. No resize step (backend caps 10 MB/image). Reuse the recipe/plant uploader code verbatim. **Body-size limit:** the frontend nginx (`frontend/nginx.conf`) must allow uploads — it sets `client_max_body_size 50m` (the 1 MB default 413s any photo). If a self-hoster runs an external reverse proxy (NPM/Caddy/Traefik), that needs the same bump.

**Recipe photo import:** `POST /recipes/import-photo` (one image → direct vision-JSON) and `POST /recipes/import-photos` (up to 4 images → OCR each photo via `call_vision` to plain text, concatenate, then `import_recipe_from_text` merges them into ONE recipe — model-agnostic, works even with single-image vision models). The import modal's Foto tab routes 1 photo to the former, ≥2 to the latter. Quality depends heavily on the vision model — `llava:7b` is weak at OCR (German + screenshots) and hallucinates a generic recipe when it can't read the image; recommend a stronger model (`llama3.2-vision`, `minicpm-v`, `qwen2.5vl`). The photo/OCR prompts are image-framed (NOT the webpage-text `SYSTEM_PROMPT`) and explicitly forbid fabricating a recipe. The vision model is **admin-selectable** like the text model: `settings_service.get_ollama_vision_model(db)` (DB key `ollama_vision_model`, falls back to `OLLAMA_VISION_MODEL`), set via `PUT /admin/llm/ollama-vision-model`, and the photo importers take it. The admin picker filters to vision-capable models via `admin._is_vision_model` (a `/api/tags` `families` heuristic — `clip`/`mllama`/`*vl`/name markers); the currently-selected model is always kept visible. **Latency:** multi-photo runs N sequential vision calls + a text merge → minutes on CPU; nginx `/api/` `proxy_read_timeout` is **900s** so a slow run doesn't get cut off (504). A heavy model like `llama3.2-vision` (10.7B) on CPU easily exceeds 5 min for 2 photos — prefer a smaller one (`minicpm-v`, 7.6B).

**AI / Ollama:** all model calls go through `services/ollama.py` — never raw `httpx`. Use `call_text_json(prompt, system=…, timeout=…, format_schema=…, think=…)`: it sends `format:"json"` (or a JSON-schema `format` when `format_schema` is given), `extract_json`-strips fences AND stray `<think>…</think>` blocks, retries once, raises `OllamaError`. `format_schema`/`think` are optional (default `None`) and backward-compatible — pass `think=False` to silence a thinking model (qwen3) for one call only; don't change it globally. Local-only and env-driven (`OLLAMA_BASE_URL` defaults to `host.docker.internal:11434` in compose; `OLLAMA_TEXT_MODEL`; optional `OLLAMA_PLANT_MODEL` for prefill, empty → text model). An admin "LLM provider" switch (`ai_service`) can route to Anthropic — call `call_text_json` directly when a feature must stay Ollama-only. **Never trust model output:** validate/normalise server-side and never let a model call 500 a user flow. Example: plant prefill (`POST /api/plants/prefill`, `services/plant_prefill_service.py`) constrains output with a JSON schema (location pinned to the enum) yet still re-normalises server-side (synonym map, int clamping, dropped-unknown-keys) — schema guarantees structure, not correctness. 45s timeout; any failure → `ok=false` "manuell ausfüllen". Edibility is advisory-only (`edible_suggestion`/`edible_note`) and the real `edible` field is never produced/auto-set — the frontend prefill is non-blocking and only fills fields still at their default/empty value.

**Auth / session:** short-lived **access token (15 min, in-memory only** — `store/auth.ts` `partialize` deliberately drops it, so no token in localStorage) + long-lived **refresh token in an HttpOnly cookie** (`lyst_refresh`, `path="/api/auth"`, `SameSite=lax`, `Secure` iff `FRONTEND_URL` is https). The client refreshes silently on any `401` (`api/client.ts` interceptor) and on reload (`AuthBootstrap` gates render until the refresh resolves). The refresh is a **sliding session**: `auth.py` `refresh_token()` re-issues the cookie every time, so an active user rolls the `REFRESH_TOKEN_EXPIRE_DAYS` (30) window forward and only true inactivity logs them out. If a self-hoster gets logged out fast, it's almost always the cookie not surviving — `FRONTEND_URL` scheme ≠ actual access scheme (Secure-flag mismatch), cross-site frontend/API (`SameSite=lax` blocks it), or a `SECRET_KEY` that changes per deploy.

**Reminders are ONE-SHOT.** An in-process APScheduler tick (`services/scheduler.py`, every 1 min) sends due reminders and flips a `sent`/`reminder_sent` flag so nothing fires twice; re-arming means the user moved the trigger. There is no recurring-reminder engine. **Watering is the only interval reminder:** "next due" is computed (`last_watered_at + watering_interval_days`, never stored), `water_reminder_sent` dedups the tick, and `POST /plants/{id}/water` (mark_watered) resets the flag to arm the next cycle. NULL interval = tracked but no reminder. It's also the only thing in "Diese Woche fällig" (`due_this_week` → water only); `/plants/due` returns `{water: [...]}`.

**Everything else is month/season, calendar-based (months 1–12, nullable, AI-prefilled, shown as form dropdowns + the detail "Pflege auf einen Blick" grid).** Fertilizing has NO interval — it's **annual**: `fetch_due_fertilize_season` fires once when `fertilize_start_month` arrives (dedup `fertilize_reminder_year`, reset when the month changes); `fertilize_end_month` + `fertilize_in_season()` (wrap-around supported) drive the "in season now" display only. `last_fertilized_at` / `mark_fertilized` / `POST /plants/{id}/fertilize` are a **log only** ("Zuletzt gedüngt"), no reminder effect. `prune_month` is the same annual shape (`fetch_due_prune`, `prune_reminder_year`). `bloom_start/end_month` are display-only. All three annual reminders share `notify_plant_care(kind=...)` and fire from the one scheduler tick.

**Frontend data flow:** no react-query — pages own their state and use `useOverviewQuery`/`useResourceQuery` (network-first: mount + focus + cross-component `invalidateOverview('<key>')`). API calls live in `api/endpoints.ts` (axios `api` + `unwrap`), types in `types/index.ts`. Boolean inputs render as the `sr-only peer` toggle pattern; enum dropdowns map values → German labels in a small `lib/` helper.

**Free-form tags** (recipes + plants) are a `postgresql.ARRAY(String)` NOT-NULL `'{}'` column, filtered with `.any()` (the `q` search also matches tags); the list endpoint takes a `tag` query param. The frontend uses one shared `components/TagInput.tsx` (chips + datalist + curated group chips) with per-resource suggestion data (`data/recipeTags.ts`, `data/plantTags.ts`). Plants label the tag field **Bereich** (Garten/Wohnung/Balkon) and the light enum **Lichtverhältnisse** (the form label is NOT "Standort" — keep the two distinct).

**Header (`components/AppShell.tsx`):** sticky bar with a text-label content nav (collapsed behind a **nav-only** hamburger on mobile) and a right-side icon cluster — `SyncStatusBadge` (the single offline/sync signal; there is no "Live" indicator — the per-user WebSocket runs purely for cache invalidation), search, `NotificationBell`, and `AccountMenu`. Account actions (Konto / Nachtmodus dark-toggle / Abmelden) live ONLY in `AccountMenu` (an initials-avatar dropdown on desktop / `BottomSheet` on mobile, mirroring `NoteActionsMenu`) — never duplicate them in the content nav or hamburger. In particular "Konto" is intentionally NOT in `USER_LINKS` (that array drives both the desktop nav and the mobile hamburger); the `/settings` route stays and `AccountMenu`'s "Konto" row navigates to it. Dropdown menus follow the `NoteActionsMenu` pattern (`useMediaQuery` + `BottomSheet`); icons are lucide.

**Theming:** never hard-code hex — use the CSS-var-backed Tailwind tokens (`bg-page` warm paper, `bg-surface` white, `border-line`, `text-ink`/`text-muted`, `brand`/`brand-50`/`brand-700` **royal blue** (`#2947c9`), `danger`). The brand is a *dark* accent: `bg-brand` fills take **white** foreground, and `text-brand-700` sits on the light `bg-brand-50` tint. To re-theme the accent, edit only the `--color-brand*` vars in `index.css` (light + dark) plus the few hard-coded copies (`tailwind.config.js` `brand.600`, `email/templates.py` `_BRAND`, `index.html`/`store/theme.ts` theme-color). Per-list/note user colors (`list.color || '#…'`, `data/presets.ts`) are NOT the brand — leave them. They flip under `[data-theme="dark"]`, so token-based code is dark-mode-correct for free. Icons are **lucide-react** everywhere (no other icon set). Reuse the `.chip` pill (`bg-brand-50 text-brand-700`) and `.card`/`.btn-*` component classes. The Pflanzen detail/card design uses these tokens: ~18px cards (`rounded-[18px] border border-line bg-surface`, borders not shadows), a soft-mint care-status card (`bg-brand-50 border-brand-100`) whose text/icons go `text-brand-700` normally and `text-danger` when overdue (text on mint is dark mint, never white), soft-mint icon discs (`bg-brand-50 text-brand-700`), and white outline-pill action buttons (mint border + `text-brand-700`).

**Fonts:** self-hosted via `@fontsource` (no Google CDN — DSGVO). `fontFamily.sans` = **Inter** (`@fontsource/inter`, *static* package → family `Inter`) is the app default everywhere; imported in `src/main.tsx`. Three extra families exist ONLY for the cookbook look (below) and are used nowhere else: `fontFamily.display` = Playfair Display (`font-display`), `.hand` = Caveat (`font-hand`), `.cookmono` = JetBrains Mono (`font-cookmono`). The mono family is deliberately named **`cookmono`, NOT `mono`** — Tailwind's built-in `font-mono` (timers/textareas/code elsewhere) must keep the default stack.

**Cookbook ("MorphCook") look — scoped to EXACTLY two views.** Only the **Rezept-Detailseite** (`RecipeDetail` page root, classes `cookbook cookbook-detail`, `data-theme="light"` → **immer hell**) and the **Cook-Mode** (`CookMode` FullscreenShell root, classes `cookbook cookbook-cook`, `data-theme="dark"` → **immer dunkel**) get this look. All cookbook CSS lives in `src/styles/cookbook.css`, **strictly scoped under `.cookbook-detail` / `.cookbook-cook`** — NO global selectors (no `body`/`h1`/`*`/`.card`). Never add cookbook classes or the `display`/`hand`/`cookmono` fonts anywhere else (lists, notes, tasks, fitness, and the recipe-LIST `RecipeCard` stay the standard Inter+Mint design). The always-light/dark trick: `data-theme` on the wrapper re-scopes the CSS-var tokens to that subtree (`index.css` has a `:root, [data-theme="light"]` alias for exactly this), independent of the app theme. Elements: subtle paper-grain bg, Playfair-italic title, Caveat description, `.polaroid` tilted sections, `.cookbook-divider` dashed trenner; mint tokens preserved. The optional **Tipp** box (`.cookbook-tip`, rendered only when `recipe.tips` is set, after the Zutaten/Zubereitung grid and before Varianten) is a *quiet* mint card — no tilt, no handwriting for the body (readability first), only the "Tipp" label uses `font-display`.

**Recipe `tips` field** (alembic `0031`, Text nullable): a free-form cook's tip on `Recipe`, exposed on `RecipeCreate`/`RecipeUpdate`/`RecipeOut` only (NOT `RecipeBase`, so `RecipeSummary`/list payloads and public-share views stay lean). A `_blank_to_none` validator coerces `""`→NULL, and `"tips"` is in `update_recipe`'s clear-whitelist so PATCH can null it. The **Picnic .eml parser** extracts the mail's `Tipp` block into `tips` (`_TIP_MARKER` … up to `_DISCARD_MARKER`) — the `Wie findest du`/`guten Appetit` rating block (with its :( / :) rows and `click.picnic.de` links) is still discarded and never enters `tips` or the steps; steps still cut at the tip. Both import consumers (`recipes_import` upload + `integration` n8n) inherit this via the single `import_one_eml`→`create_recipe` call.
