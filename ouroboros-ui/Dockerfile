# ouroboros-ui — production image (issue #47)
#
# Multi-stage per docs/CONVENTIONS.md § 5, following the pattern proven in
# ouroboros-web/Dockerfile: deps -> build -> a runtime that carries no toolchain, runs
# as a non-root user, and answers a HEALTHCHECK.
#
# **The build context is the repository root, not this directory.** This module is a
# Yarn workspace: the lockfile it installs from, the Yarn version it is pinned to and
# the nodeLinker setting all live at the root (docs/CONVENTIONS.md § 3), so a context of
# ouroboros-ui/ alone could not run an immutable install at all. Build it as:
#
#   docker build -f ouroboros-ui/Dockerfile -t ouroboros-ui .    # from the repo root
#
# which is also how the compose stack (#55) declares it. Because the context is the
# root, the ignore file beside this one is named Dockerfile.dockerignore — BuildKit
# reads <dockerfile>.dockerignore in preference to <context>/.dockerignore, which is
# what keeps this module's ignores in this module rather than in a root file that every
# other image would share.
#
# Node is 24-alpine, matching ouroboros-web and the `engines.node: >=24` the workspace
# root declares. The roadmap text for this issue says node:22-alpine; it predates #13,
# which moved the repo to Node 24, and an install under 22 would contradict the manifest.

# ---------- deps ----------
# Only the manifests and the lockfile, so this layer is rebuilt when dependencies
# change and reused when application code changes. Every workspace manifest has to be
# here: Yarn resolves the whole workspace set before it installs any of it, and
# --immutable fails if a missing one would have rewritten the lockfile. That is all four
# of them since #27 scaffolded ouroboros-rest, and __tests__/container.test.ts is what
# holds this list to the workspace roster the next time one is added.
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY ouroboros-db/package.json ./ouroboros-db/
COPY ouroboros-engine/package.json ./ouroboros-engine/
COPY ouroboros-rest/package.json ./ouroboros-rest/
COPY ouroboros-ui/package.json ./ouroboros-ui/
RUN yarn install --immutable

# ---------- build ----------
# `next build` with output: "standalone" (see next.config.ts) emits .next/standalone —
# server.js plus only the node_modules files the trace actually reached. Nothing here
# reads OURO_REST_URL: app/env.ts validates it in a function rather than at module
# scope, precisely so that a build machine does not need the address of a service it is
# not calling.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY package.json yarn.lock .yarnrc.yml ./
COPY ouroboros-db/package.json ./ouroboros-db/
COPY ouroboros-engine/package.json ./ouroboros-engine/
COPY ouroboros-rest/package.json ./ouroboros-rest/
COPY ouroboros-ui ./ouroboros-ui
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn workspace ouroboros-ui run build

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app

# PORT is the documented unprefixed exception (docs/CONVENTIONS.md § 4) and 3000 is this
# module's port in the map there; Next.js reads both it and HOSTNAME itself. HOSTNAME
# must be 0.0.0.0 — the standalone server binds localhost by default, which inside a
# container means nothing outside it can connect.
#
# OURO_REST_URL is deliberately *not* set here. It is the one variable this module reads
# (app/env.ts), it differs per environment, and the standalone server reads it from the
# process at request time — so it is supplied by `docker run -e` or by the compose
# service (#55), never baked into a layer. A default here would turn a missing value
# into a silent connection to the wrong host instead of an error naming the variable.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

# The standalone tree is rooted at the repository, not at this module
# (outputFileTracingRoot in next.config.ts), so it unpacks as ./node_modules and
# ./ouroboros-ui/server.js. static/ and public/ are copied in beside it because the
# standalone output deliberately omits both — they are the two directories a CDN would
# serve instead, and server.js picks them up from these paths when they are present.
COPY --from=build --chown=nextjs:nextjs /app/ouroboros-ui/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/ouroboros-ui/.next/static ./ouroboros-ui/.next/static
COPY --from=build --chown=nextjs:nextjs /app/ouroboros-ui/public ./ouroboros-ui/public

USER nextjs
EXPOSE 3000

# Liveness is `/`, the one route this module serves today. wget is BusyBox's, already in
# the base image — installing curl for this would add a package to a runtime whose whole
# point is carrying nothing it does not need. The shell form is what expands $PORT, so
# the check follows the port the container was actually given.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --quiet --output-document=/dev/null "http://127.0.0.1:${PORT}/" || exit 1

CMD ["node", "ouroboros-ui/server.js"]
