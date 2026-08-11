# ouroboros-rest — production image (issue #36)
#
# Multi-stage per docs/CONVENTIONS.md § 5, following the pattern proven in
# ouroboros-ui/Dockerfile: deps -> build -> a runtime that carries no toolchain, runs as
# a non-root user, and answers a HEALTHCHECK on this service's own liveness probe.
#
# **The build context is the repository root, not this directory.** This module is a
# Yarn workspace: the lockfile it installs from, the Yarn version it is pinned to and
# the nodeLinker setting all live at the root (docs/CONVENTIONS.md § 3), so a context of
# ouroboros-rest/ alone could not run an immutable install at all. Build it as:
#
#   docker build -f ouroboros-rest/Dockerfile -t ouroboros-rest .   # from the repo root
#
# which is also how the compose stack (#55) declares it. Because the context is the
# root, the ignore file beside this one is named Dockerfile.dockerignore — BuildKit
# reads <dockerfile>.dockerignore in preference to <context>/.dockerignore, which is
# what keeps this module's ignores in this module rather than in a root file that every
# other image would share.
#
# Node is 24-alpine, matching ouroboros-ui and ouroboros-web and the `engines.node: >=24`
# the workspace root declares. The roadmap text for this issue says node:22-alpine; it
# predates #13, which moved the repo to Node 24, and an install under 22 would contradict
# the manifest.
#
# Unlike ouroboros-ui there is no standalone output to lean on: `nest build` emits
# JavaScript and nothing else, so the runtime needs a real node_modules beside it. Which
# node_modules is the one decision this file makes that the UI image did not have to —
# see the deps stage.

# ---------- deps ----------
# Only the manifests and the lockfile, so this layer is rebuilt when dependencies change
# and reused when application code changes. Every workspace manifest has to be here: Yarn
# resolves the whole workspace set before it installs any of it, and --immutable fails if
# a missing one would have rewritten the lockfile. src/container.spec.ts is what holds
# this list to the workspace roster the next time one is added.
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY ouroboros-db/package.json ./ouroboros-db/
COPY ouroboros-engine/package.json ./ouroboros-engine/
COPY ouroboros-rest/package.json ./ouroboros-rest/
COPY ouroboros-ui/package.json ./ouroboros-ui/

# Two trees out of one lockfile, in that order, in one layer.
#
# `yarn workspaces focus --production ouroboros-rest` installs this workspace as if it
# were the only one in the project and omits every devDependency — the tree the runtime
# stage carries, and the reason that image holds no TypeScript compiler, no Jest and no
# Nest CLI. It is set aside at /production before the second install replaces it, because
# the *build* needs the full tree and a stage has only one node_modules.
#
# Doing it in this order rather than pruning after the build is what keeps both installs
# honest: they run against the same lockfile and the same Yarn cache, so the production
# packages are resolved and downloaded once, and the full install that follows is a link
# pass over what is already fetched. It also means neither tree is ever a subset produced
# by deleting directories out of the other, which is the version of this that quietly
# ships a package `focus` would have told you was missing.
#
# --immutable on the second install is the guard that matters: if `focus` had rewritten
# yarn.lock, this fails the build rather than producing an image whose dependencies are
# not the ones the repository committed.
#
# The `find` is the last third of the 300 MB budget. TypeScript declarations and source
# maps are read by a compiler and a debugger and by nothing else — no running process
# resolves either — and the dependency tree ships about 34 MB of them, most of it rxjs,
# kysely and zod. They are deleted from the production copy only: the build stage
# type-checks against the *full* tree, where removing a `.d.ts` would turn a dependency
# into `any` or fail the compile outright. Documentation and licence files are
# deliberately left alone; they are two megabytes and they are how a published image
# carries its attributions.
RUN yarn workspaces focus --production ouroboros-rest \
    && cp -R node_modules /production \
    && find /production -type f \( -name "*.d.ts" -o -name "*.d.cts" -o -name "*.d.mts" -o -name "*.map" \) -delete \
    && yarn install --immutable

# ---------- build ----------
# `nest build` reads tsconfig.build.json — the strict configuration `yarn typecheck` uses
# minus the specs and the fixtures, so what ships is type-checked exactly as the suite is
# but carries neither @nestjs/testing nor a development credential. It writes
# ouroboros-rest/dist, and nothing else.
#
# Nothing here reads a configuration variable: src/modules/config/configuration.ts
# validates the environment at boot rather than at module scope, precisely so a build
# machine does not need a database URL or a signing key to compile the service.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY package.json yarn.lock .yarnrc.yml ./
COPY ouroboros-db/package.json ./ouroboros-db/
COPY ouroboros-engine/package.json ./ouroboros-engine/
COPY ouroboros-ui/package.json ./ouroboros-ui/
COPY ouroboros-rest ./ouroboros-rest
RUN yarn workspace ouroboros-rest run build

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app

# NODE_ENV=production is load-bearing twice over, which is why it is set here rather than
# left to whoever runs the image. It is what makes `listenHost` bind 0.0.0.0
# (src/modules/config/configuration.ts) — a process bound to loopback inside a container
# is a process nothing outside it can reach — and it is what strips OURO_AUTH_DEV_USER
# out of the environment before the schema ever sees it, so an image started with a
# development .env is a service that ignores the bypass rather than one that trusts it.
#
# PORT is the documented unprefixed exception (docs/CONVENTIONS.md § 4) and 4000 is this
# module's port in the map there. It is also this service's default when unset, so the
# value is restated rather than introduced: what it buys is a HEALTHCHECK that can follow
# the port the container was actually given, which an unset variable would expand to
# nothing at all.
#
# No OURO_* variable is set anywhere in this image. Every one of them is either an
# address that differs per environment or a secret, the configuration module names each
# missing one at boot and exits 2, and a default baked into a layer would replace that
# line with a silent connection to the wrong host — or, for the three secrets, with a
# published image carrying a credential.
ENV NODE_ENV=production \
    PORT=4000

RUN addgroup -S nestjs && adduser -S nestjs -G nestjs

# The production tree from `deps`, and the compiled service. Both land at the paths the
# workspace layout puts them at — node_modules hoisted to /app, the module under
# /app/ouroboros-rest — because two files resolve their own siblings relative to
# __dirname and would not find them anywhere else: version.ts reads ../package.json for
# the version every response carries, and openapi/specification.ts reads ../../openapi.json
# for the document the application serves verbatim. Both are documented as requiring
# exactly this, and both fail at boot rather than on a request if it is not done.
#
# openapi.yaml is copied beside the JSON because it is the authoritative document and
# /api/openapi.yaml serves those bytes; the JSON is what the process parses.
COPY --from=deps --chown=nestjs:nestjs /production ./node_modules
COPY --from=build --chown=nestjs:nestjs /app/ouroboros-rest/dist ./ouroboros-rest/dist
COPY --from=build --chown=nestjs:nestjs /app/ouroboros-rest/package.json ./ouroboros-rest/package.json
COPY --from=build --chown=nestjs:nestjs /app/ouroboros-rest/openapi.json ./ouroboros-rest/openapi.json
COPY --from=build --chown=nestjs:nestjs /app/ouroboros-rest/openapi.yaml ./ouroboros-rest/openapi.yaml

USER nestjs
EXPOSE 4000

# Liveness, not readiness. /health/live is the probe that depends on nothing but the
# process (src/modules/health/health.controller.ts), and a Docker HEALTHCHECK is read by
# restart policies and by compose's `condition: service_healthy` — pointing it at
# /health/ready would restart a perfectly healthy container every time PostgreSQL was the
# thing that needed attention. Readiness is asked separately, over HTTP, by whatever is
# deciding whether to route traffic here.
#
# The path is /health/live rather than /api/v1/health/live: the probes sit at the origin
# root, outside the versioned prefix, so a healthcheck configured once keeps working when
# the API adds a version — see src/modules/health/health.paths.ts.
#
# wget is BusyBox's, already in the base image — installing curl for this would add a
# package to a runtime whose whole point is carrying nothing it does not need. The shell
# form is what expands $PORT, so the check follows the port the container was given.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD wget --quiet --output-document=/dev/null "http://127.0.0.1:${PORT}/health/live" || exit 1

CMD ["node", "ouroboros-rest/dist/main.js"]
