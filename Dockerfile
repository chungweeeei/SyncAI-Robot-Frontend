# syncai_frontend production image (Next.js 16, output: 'standalone').
# Build it through docker-compose.yaml (`docker compose build frontend-build`);
# a plain `docker build -t syncai-frontend .` works too.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# On the robot's few-MB/s uplink, npm's default 15 sockets starve small
# tarballs behind the ~120 MB Next compiler until they time out; 4 mostly
# finishes. A mid-body timeout is not one npm retries, so the whole command
# is retried, and the cache mount makes a retry fetch only what was lost.
RUN --mount=type=cache,target=/root/.npm \
    for attempt in 1 2 3; do \
      npm ci --maxsockets=4 --fetch-retries=5 && exit 0; \
      echo "npm ci attempt $attempt failed, retrying from cache" >&2; \
    done; exit 1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Telemetry off for reproducible offline-friendly builds.
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined at `next build`, so they must be build args;
# setting them on the running container does nothing. Empty keeps the
# same-hostname fallback in lib/api/config.ts (backend on :3000).
ARG NEXT_PUBLIC_API_BASE=
ARG NEXT_PUBLIC_WS_BASE=
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NEXT_PUBLIC_WS_BASE=$NEXT_PUBLIC_WS_BASE
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# The standalone server reads PORT, not package.json's scripts; 3000 is the
# backend's.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001

# standalone output contains server.js + the traced node_modules subset;
# static assets and public/ are not traced and must be copied alongside.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER node
EXPOSE 3001
CMD ["node", "server.js"]
