# The e2e suite's provider stub (#233, AE.7) — see server.mjs for what it is and why.
#
# The runtime and one file. There is no `package.json`, no install step and no lockfile,
# because the server imports nothing but `node:http`: a fixture whose build can fail on a
# registry outage is a fixture that fails the release gate for a reason that is not the
# product.
#
# `node:24-alpine` matches the engine the workspace pins (`engines.node` in every module's
# package.json), so the one thing this image *does* share with the rest of the stack is the
# runtime a reviewer would assume it shares.
FROM node:24-alpine

WORKDIR /srv

COPY server.mjs ./

# The image's own user, rather than root. Nothing here writes a file, so this costs nothing
# and is the posture every other image in this repository takes.
USER node

EXPOSE 8080

# Not `npm start` and not a shell: `node` as PID 1 is what makes the SIGTERM handler in
# server.mjs the thing that receives compose's stop, which is what keeps the test-connection
# leg's stop under a second instead of under Docker's ten-second kill timer.
CMD ["node", "server.mjs"]
