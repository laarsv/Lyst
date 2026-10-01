# =============================================================================
#  Lyst Picnic sidecar — optional, unofficial (see ../docker-compose.yml, profile "picnic")
# =============================================================================
FROM node:22-alpine

ENV NODE_ENV=production \
    PICNIC_DATA_DIR=/data \
    PORT=8081

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only the runtime files; spike.mjs and local secrets are excluded via .dockerignore.
COPY lib.mjs server.mjs login.mjs ./

# /data holds the Picnic session key. Created and owned by the non-root user so a
# fresh named volume inherits the right permissions.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
