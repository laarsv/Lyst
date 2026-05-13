# =============================================================================
#  Lyst frontend — multi-stage build
# =============================================================================
#  Stage 1 (build):   node compiles the SPA via `vite build`.
#  Stage 2 (runtime): nginx-unprivileged serves the static bundle on :8080
#                     as the unprivileged `nginx` user (UID 101).
# =============================================================================

# ---- Stage 1: build ----------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Copy lockfiles first so dependency layers cache across source-only changes.
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build


# ---- Stage 2: runtime --------------------------------------------------------
# nginx-unprivileged runs as UID 101 and listens on :8080 by default — no
# CAP_NET_BIND_SERVICE needed and no startup chowning.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# Static-bundle health check — nginx is up and serving the SPA shell.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1
