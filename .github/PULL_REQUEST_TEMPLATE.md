<!--
  Thanks for the PR! Filling in the sections below makes review faster and
  reduces back-and-forth. Delete sections that don't apply.
  See CONTRIBUTING.md for branch naming, commit style, and code style notes.
-->

## What does this PR do?

<!--
  One short paragraph: what behaviour changes from the user's point of view?
  Avoid restating the diff line-by-line — focus on the intent.
-->


## Why?

<!--
  Briefly: the problem this solves, or the link to the discussion that led
  here. Skip this section if it's truly self-evident (rare).
-->


## Related issue

<!-- Use one of: Closes #123 / Fixes #123 / Refs #123. Delete if no issue. -->


## Screenshots / screencasts (UI changes)

<!--
  Drag screenshots straight into this textarea. For interactions, a short
  screen recording (gif/mp4) is gold. Skip for backend-only changes.
-->


## How was this tested?

<!--
  Concrete steps the reviewer can repeat. "Added a unit test" + "manually
  clicked through the flow on mobile Chrome" beats "tested it works".
  Mention any edge cases (offline mode, no Ollama, archived notes, etc.)
  that are easy to miss.
-->


## Checklist

- [ ] Branch name follows `feat/`, `fix/`, `docs/`, or `chore/` convention.
- [ ] Commits are focused and the messages explain *why*.
- [ ] Lint + format pass (Ruff for Python, Prettier for TS — see CONTRIBUTING.md).
- [ ] Project still builds: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`.
- [ ] Any new env vars are added to **both** `.env.example` and `docs/CONFIGURATION.md`.
- [ ] Any new feature has a one-line note in the README feature list.
- [ ] No accidental secrets, real email addresses, or personal hostnames in the diff.
- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md) and agree to license my contribution under AGPL-3.0.
