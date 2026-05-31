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

FastAPI + PostgreSQL/asyncpg + Alembic backend, React + TS + Vite + Tailwind frontend, Docker, Resend for email. The app runs in Docker; there is no local venv — verify the backend by building `./backend` and running `import app.main` / `alembic` against a throwaway Postgres.

**Resource modules** follow a 4-file shape: `app/models/<x>.py`, `app/schemas/<x>.py`, `app/routers/<x>.py`, `app/services/<x>_service.py`. Register the router in `app/main.py` (`app.include_router(..., prefix="/api")`) and the model in `app/models/__init__.py` (so Alembic's metadata sees it). The **Recipes** module is the reference implementation; **Pflanzen/Plants** (`models/plant.py`, alembic `0023`) mirrors it.

**Enums:** Python `class X(str, enum.Enum)`; names == values unless a legacy DB value forces `values_callable`. In Alembic, **creating a table** uses the enum inline in `op.create_table` with no separate `.create()` (template: `0002`); **adding a column** needs an explicit `enum.create(checkfirst=True)` + `create_type=False` on the column (template: `0020`).

**Image uploads:** stored to `/app/uploads/<resource>/{id}/<uuid>.<ext>`, served via the `/static` StaticFiles mount, persisted as `image_url = "/static/..."`. No resize step. Reuse the recipe/plant uploader code verbatim.

**Reminders are ONE-SHOT.** An in-process APScheduler tick (`services/scheduler.py`, every 1 min) sends due reminders and flips a `sent`/`reminder_sent` flag so nothing fires twice; re-arming means the user moved the trigger. There is no recurring-reminder engine. **Plants get recurrence cheaply:** "next due" is computed (`last_*_at + interval_days`, never stored), a per-cycle `*_reminder_sent` boolean dedups the tick, and marking a plant watered/fertilised (`POST /plants/{id}/water` `/fertilize`) resets the flag to arm the next cycle. A NULL interval = tracked but no reminder.

**Frontend data flow:** no react-query — pages own their state and use `useOverviewQuery`/`useResourceQuery` (network-first: mount + focus + cross-component `invalidateOverview('<key>')`). API calls live in `api/endpoints.ts` (axios `api` + `unwrap`), types in `types/index.ts`. Boolean inputs render as the `sr-only peer` toggle pattern; enum dropdowns map values → German labels in a small `lib/` helper.

**Free-form tags** (recipes + plants) are a `postgresql.ARRAY(String)` NOT-NULL `'{}'` column, filtered with `.any()` (the `q` search also matches tags); the list endpoint takes a `tag` query param. The frontend uses one shared `components/TagInput.tsx` (chips + datalist + curated group chips) with per-resource suggestion data (`data/recipeTags.ts`, `data/plantTags.ts`). Plants label the tag field **Bereich** (Garten/Wohnung/Balkon) and the light enum **Lichtverhältnisse** (the form label is NOT "Standort" — keep the two distinct).

**Theming:** never hard-code hex — use the CSS-var-backed Tailwind tokens (`bg-page` warm paper, `bg-surface` white, `border-line`, `text-ink`/`text-muted`, `brand`/`brand-50`/`brand-700` mint, `danger`). They flip under `[data-theme="dark"]`, so token-based code is dark-mode-correct for free. Icons are **lucide-react** everywhere (no other icon set). Reuse the `.chip` pill (`bg-brand-50 text-brand-700`) and `.card`/`.btn-*` component classes. The Pflanzen detail/card design uses these tokens: ~18px cards (`rounded-[18px] border border-line bg-surface`, borders not shadows), a soft-mint care-status card (`bg-brand-50 border-brand-100`) whose text/icons go `text-brand-700` normally and `text-danger` when overdue (text on mint is dark mint, never white), soft-mint icon discs (`bg-brand-50 text-brand-700`), and white outline-pill action buttons (mint border + `text-brand-700`).
