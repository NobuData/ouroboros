# The e2e suite's recorded provider (#1314, DI.5) — see server.mjs for what it is and why.
#
# The runtime, two files and the recording. There is no `package.json`, no install step and
# no lockfile, because the server imports nothing but `node:http` and `node:fs`: a fixture
# whose build can fail on a registry outage is a fixture that fails the release gate for a
# reason that is not the product.
#
# `node:24-alpine` matches the engine the workspace pins (`engines.node` in every module's
# package.json), so the one thing this image *does* share with the rest of the stack is the
# runtime a reviewer would assume it shares.
FROM node:24-alpine

WORKDIR /srv

COPY server.mjs replay.mjs ./
COPY recordings ./recordings

# The image's own user, rather than root. Nothing here writes a file.
USER node

EXPOSE 8080

# `node` as PID 1 is what makes the SIGTERM handler in server.mjs the thing that receives
# compose's stop, so a deliberate stop takes a moment instead of Docker's ten-second timer.
CMD ["node", "server.mjs"]
