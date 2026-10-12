# syncai_frontend production image (Next.js 16, output: 'standalone').
# Build context is this repo's root. The intended way to build and run it is
# docker-compose.yaml (`docker compose build frontend-build`), which is where the
# image name and the build args below are wired up; a plain
# `docker build -t syncai-frontend .` works too.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# The robot's uplink is a few MB/s. npm's default 15 parallel sockets share it
# with the ~120 MB Next compiler tarballs, starve the small ones until they hit
# a TCP read timeout, and the build sits silent for minutes before failing
# with ETIMEDOUT; 4 sockets mostly finishes on the same link. Mostly: a
# timeout in the middle of a tarball's body is not one npm's own retries
# cover, so the whole command is retried. The cache mount is what makes that
# cheap — it keeps every tarball already fetched (outside the image), so a
# second attempt downloads only what the first one lost, and a lockfile
# change re-runs `npm ci` without fetching all ~900 MB again.
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
# NEXT_PUBLIC_* values are inlined into the client bundle at `next build`, not
# read at runtime, so they have to arrive here as build args: setting them on
# the running container does nothing. Both default to empty, which keeps the
# same-hostname fallback in lib/api/config.ts (backend on :3000 of whatever
# host the page was opened from) — the right answer whenever the console and
# the backend share a host.
ARG NEXT_PUBLIC_API_BASE=
ARG NEXT_PUBLIC_WS_BASE=
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NEXT_PUBLIC_WS_BASE=$NEXT_PUBLIC_WS_BASE
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# 3001, the same port package.json pins for `dev` and `start`: the standalone
# server ignores those scripts and reads PORT, and 3000 belongs to the backend
# on a shared host.
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
