# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# The server uses native optional packages, but never installs Electron's binary.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build \
    && node scripts/build-server.mjs \
    && node scripts/smoke-server.mjs

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    LH_DATA_DIR=/data/state \
    LH_AUTH_FILE=/data/auth/auth.json \
    LH_SOURCES_DIR=/data/sources \
    CHROME_PATH=/usr/bin/chromium
# Demo checks launch Chromium only when needed. PDF/SVG rendering stays native.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/state /data/auth /data/sources \
    && chmod 700 /data/auth \
    && chown -R node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
