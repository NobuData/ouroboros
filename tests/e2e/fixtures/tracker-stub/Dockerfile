# The e2e suite's sandbox tracker (#288, AM.6) — see server.mjs for what it is and why.
#
# The runtime and one file, exactly as `provider-stub`'s image is, and for the same reason:
# the server imports nothing but `node:http`, so there is no `package.json`, no install step
# and no lockfile, and a fixture whose build can fail on a registry outage cannot fail the
# release gate for a reason that is not the product.
#
# `node:24-alpine` matches the engine every module pins in `engines.node`.
FROM node:24-alpine

WORKDIR /srv

COPY server.mjs ./

# The image's own user rather than root. Nothing here writes a file — the tracker's world is
# in memory and is meant to go away with the container.
USER node

EXPOSE 8080

# `node` as PID 1, so the SIGTERM handler in server.mjs receives compose's stop rather than
# Docker's ten-second kill timer doing it.
CMD ["node", "server.mjs"]
