# Contributing to Lyst

Thanks for considering a contribution! Lyst is a small self-hosted project and
every issue, bug fix, and idea helps. This document covers the basics — for
the technical side of getting a dev environment running, see
[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## Filing an issue

Please use the issue templates — they collect the bits we need to reproduce a
problem or evaluate a feature without an extra round-trip.

- **Bug?** Open a [bug report](.github/ISSUE_TEMPLATE/bug_report.yml).
  Include your Lyst version (commit SHA or tag), how you're hosting it
  (Docker / bare metal / Proxmox LXC), and the relevant backend or browser
  console log lines.
- **Feature idea?** Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.yml).
  Lead with the *problem* you're trying to solve, not the solution — that
  often unlocks a simpler approach than the one you started from.
- **Security issue?** Please **do not** open a public issue. Email the
  maintainer (see the GitHub profile) or use GitHub's private vulnerability
  reporting on the repo.

Search existing issues first; duplicates get closed and that's discouraging
for everyone.

---

## Submitting a pull request

1. **Fork** the repo and create a branch off `main`.
   - Branch naming: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`,
     `chore/<short-name>`. Keeps the branch list tidy.
2. **Make focused commits.** One logical change per commit. The first line is
   imperative present tense and ≤ 72 chars (`Add recipe scaling`, not
   `Added recipe scaling.`). The body explains *why*, not *what* — the diff
   already shows the what.
3. **Run the lint + format checks** (see Code style below) and verify the
   project still builds:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
   ```
4. **Open the PR** against `main`. Fill in the
   [PR template](.github/PULL_REQUEST_TEMPLATE.md) — at minimum the
   *what*, the *why*, and how you tested it.
5. **Be patient and friendly** during review. Lyst is a side project; first
   responses can take a few days. If you don't hear back within two weeks,
   feel free to ping.

A few things that make PRs easier to merge:

- **Small.** A 200-line PR usually merges in a day; a 2 000-line PR rarely
  merges at all. If a change is unavoidably large, open a draft PR early so
  we can agree on direction before you finish.
- **Scoped.** No drive-by reformatting of unrelated code. If you spot
  something that needs cleanup, mention it in a separate issue.
- **Documented.** New env vars go in `.env.example` *and*
  `docs/CONFIGURATION.md`. New features get a one-line note in the README
  feature list.

---

## Code style

We use auto-formatters so style is one less thing to discuss in review.

**Python (backend):**

- Format + lint with [Ruff](https://docs.astral.sh/ruff/) using the project
  defaults: `ruff check . && ruff format .`
- Type-check with `mypy` if you touch typed code paths (the project is
  partially typed today; new code should be type-annotated).
- Async SQLAlchemy 2.0 style — no sync sessions in async paths.
- New endpoints go through the existing response wrapper
  (`{"data": …, "error": null}`) — see `app/core/responses.py`.

**TypeScript / React (frontend):**

- Format with [Prettier](https://prettier.io/) using the repo defaults
  (no overrides — keep it boring).
- ESLint where configured.
- Functional components with hooks; no class components.
- Tailwind utility classes over custom CSS unless you need a token that
  doesn't fit (then add it to `tailwind.config.ts`).

**Both:**

- New files get the same one-paragraph header docstring that the rest of the
  codebase uses — explain *why this module exists*, not what each function
  does.
- Comments explain *why*, not *what*. If a comment just paraphrases the
  next line of code, delete it.

---

## Releasing (maintainers)

1. Bump the version in `frontend/package.json` (and in any `__version__`
   constant if added).
2. Tag the commit `vX.Y.Z` and push the tag — the
   `docker-publish.yml` workflow builds and pushes
   `ghcr.io/<org>/lyst-backend:X.Y.Z` and `…lyst-frontend:X.Y.Z`, plus the
   `latest` tag.
3. Draft a GitHub release with a short changelog grouped into
   *Features / Fixes / Internal*.

---

## License

By contributing you agree that your contributions are licensed under
[AGPL-3.0](./LICENSE), the same license as the project.
