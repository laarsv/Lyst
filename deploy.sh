#!/usr/bin/env bash
# =============================================================================
#  Lyst — homeserver deploy
# =============================================================================
#  Pulls the latest main, rebuilds the local images, and restarts the stack.
#  Idempotent and safe to re-run.
#
#  Usage:
#    ./deploy.sh                # standard deploy
#    ./deploy.sh --no-pull      # skip git pull (rebuild from current working tree)
#    ./deploy.sh --prune        # also docker image prune at the end
#    ./deploy.sh --yes          # don't ask for confirmation before recreating
#
#  The confirmation prompt is interactive-only: runs without a TTY (n8n / cron /
#  piped) proceed automatically and never block.
#
#  Designed for a Mini-PC / NAS where Lyst lives in this directory and is
#  invoked manually over SSH (or via cron / systemd-timer for auto-updates).
#  Bails early if the working tree is dirty so a local edit is never silently
#  overwritten by `git pull` — investigate first, then re-run.
# =============================================================================

set -euo pipefail

# --- script-dir so this works from cron / wherever ---------------------------
cd "$(dirname "$(readlink -f "$0")")"

# --- args --------------------------------------------------------------------
DO_PULL=1
DO_PRUNE=0
ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        --no-pull) DO_PULL=0 ;;
        --prune)   DO_PRUNE=1 ;;
        --yes|-y)  ASSUME_YES=1 ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 2
            ;;
    esac
done

# --- pretty output -----------------------------------------------------------
if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
    YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
    BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi
step()  { echo -e "\n${BOLD}▸ $*${RESET}"; }
info()  { echo -e "  ${DIM}$*${RESET}"; }
warn()  { echo -e "${YELLOW}⚠ $*${RESET}"; }
fail()  { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
done_() { echo -e "${GREEN}✓ $*${RESET}"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "docker not found in PATH"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin not available (install docker-compose-plugin or upgrade Docker)"

[[ -f docker-compose.yml ]] || fail "docker-compose.yml not in $(pwd) — wrong directory?"
[[ -f .env ]] || warn ".env missing — compose will fall back to defaults and fail on the required vars"

# --- git pull ----------------------------------------------------------------
if [[ "$DO_PULL" -eq 1 ]]; then
    step "Updating from origin/main"
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
        fail "not a git repository"
    fi
    if [[ -n "$(git status --porcelain)" ]]; then
        warn "Working tree is dirty — git status below:"
        git status --short
        fail "refusing to pull over local changes. Commit, stash, or revert first."
    fi

    git fetch --quiet origin
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    if [[ "$LOCAL" == "$REMOTE" ]]; then
        info "already up to date ($LOCAL)"
    else
        info "$(git log --oneline --no-decorate "$LOCAL..$REMOTE" | sed 's/^/  /')"
        git pull --ff-only origin main
        done_ "pulled $(git rev-parse --short HEAD)"
    fi
else
    step "Skipping git pull (--no-pull)"
fi

# --- confirmation gate -------------------------------------------------------
# Only prompt on an interactive terminal. Non-interactive runs (n8n / cron /
# piped) and --yes proceed automatically so an automated deploy never blocks
# waiting on a y/N that nobody can answer.
if [[ "$ASSUME_YES" -eq 0 && -t 0 ]]; then
    echo
    read -r -p "Rebuild + recreate containers now? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# --- build -------------------------------------------------------------------
# --pull also refreshes the base images (python:3.12-slim, postgres:16-alpine,
# nginx-unprivileged); without it we'd stick with whatever was cached locally.
step "Building images"
docker compose build --pull

# --- recreate ----------------------------------------------------------------
step "Restarting stack"
docker compose up -d --remove-orphans

# --- wait for backend healthcheck -------------------------------------------
# The backend container runs `alembic upgrade head && seed` before uvicorn
# binds, so cold starts after a migration can take 10–30 s. Probe the health
# endpoint exposed by the frontend's nginx proxy.
step "Waiting for backend to come up"
PORT="${LYST_HOST_PORT:-8091}"
for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
        done_ "backend healthy after ${i}s"
        break
    fi
    sleep 1
    if [[ "$i" -eq 30 ]]; then
        warn "backend didn't respond on port ${PORT} within 30 s — check 'docker compose logs backend'"
    fi
done

# --- prune (optional) --------------------------------------------------------
if [[ "$DO_PRUNE" -eq 1 ]]; then
    step "Pruning dangling images"
    docker image prune -f
fi

# --- summary -----------------------------------------------------------------
step "Stack state"
docker compose ps

echo
done_ "Deploy finished."
