# ouroboros-docs — the documentation site's image (DD.1, roadmap decision D8).
#
# Multi-stage, as every module's (docs/CONVENTIONS.md § 5): deps → build → a static runtime
# that carries no Node at all. The build context is this directory alone:
#
#   docker build -t ouroboros-docs ouroboros-docs     # from the repository root
#
# Nothing outside it is read. The brand copies (scripts/sync-brand.mjs), the generated
# configuration reference and the screenshots are all committed, so `yarn build` finds the
# repository's sources absent, says so, and keeps the copies — no application stack, no
# ../docs/.

# ---------- deps ----------
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The site's canonical origin, written into its sitemap and canonical links. Unset, the
# config's default is used.
ARG DOCS_SITE_URL
ENV DOCS_SITE_URL=${DOCS_SITE_URL}
# The Content-Security-Policy hashes the theme script out of the pages just built, so it is
# written here, after the build, and fails the image if a page carries any other inline script.
RUN yarn build && node scripts/gen-csp.ts /app/csp.conf

# ---------- runtime ----------
# nginx-unprivileged runs as uid 101 and listens on 8080, so no capability or root is needed.
FROM nginxinc/nginx-unprivileged:1.30.5-alpine AS runtime

ARG VERSION=0.0.0
ARG REVISION=unknown
ARG SOURCE=https://github.com/NobuData/ouroboros
ARG CREATED=""
# Every label the base image sets about itself is restated, so none of nginx's describes this.
LABEL org.opencontainers.image.title="ouroboros-docs" \
      org.opencontainers.image.description="The Ouroboros documentation site" \
      org.opencontainers.image.vendor="NobuData LLC" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.url="${SOURCE}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-headers.conf /etc/nginx/ouroboros/headers.conf
COPY --from=build /app/csp.conf /etc/nginx/ouroboros/csp.conf
COPY --from=build /app/build /usr/share/nginx/html

# The base image already ends as this user; it is stated so the image says so itself.
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
