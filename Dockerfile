# syntax=docker/dockerfile:1
FROM node:26-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# The server uses native optional packages, but never installs Electron's binary.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run plugins:setup \
    && NODE_ENV=test node --import tsx --test tests/pdf-native-render.test.ts tests/pdf-ops.test.ts tests/svg-native-render.test.ts \
    && npm run build \
    && node scripts/smoke-provider-runtime.mjs \
    && node scripts/build-server.mjs \
    && node scripts/build-provider-service.mjs \
    && node scripts/smoke-image-runtime.mjs --standalone .next/standalone \
    && npm run headless:build-check \
    && node scripts/smoke-server.mjs --isolated

FROM node:26-bookworm-slim AS runtime
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
COPY --from=build --chown=node:node /app/.next/headless-check/headless-image-check.mjs ./src/agent/subagents/headless-image-check.mjs
COPY --from=build --chown=node:node /app/scripts/smoke-shutdown-runtime.mjs ./scripts/smoke-shutdown-runtime.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD node -e "const headers=process.env.LH_PUBLIC_ORIGIN?{host:new URL(process.env.LH_PUBLIC_ORIGIN).host}:{};const request=require('node:http').get('http://127.0.0.1:'+process.env.PORT+'/api/health',{headers},response=>{response.resume();process.exitCode=response.statusCode===200?0:1});request.setTimeout(4000,()=>request.destroy());request.on('error',()=>{process.exitCode=1})"
CMD ["node", "server.js"]
