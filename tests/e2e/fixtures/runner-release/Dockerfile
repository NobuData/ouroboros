# The compose stack's runner release (#262, AI.7) — `make release`, from this checkout, into the
# volume `ouroboros-rest` serves as `OURO_FARM_RELEASES_DIR`.
#
# `ouroboros-runner` ships a **binary**, not an image (`.github/workflows/runner.yml` says why),
# and a deployment serves that binary from its own origin: `GET /install.sh` and
# `GET /runner/<version>/<file>`. So for the enroll command copied off the Build Farm page to
# install anything, the stack needs a release directory — and it needs the one built from *this*
# checkout, or the e2e leg would certify last month's agent against today's control plane.
#
# The build context is `./ouroboros-runner` (see the compose file), and the recipe is the
# module's own, unmodified: three targets, the installer with its version filled in, and a
# SHA256SUMS over the four. The module has no dependencies (`go.mod`), so this build reaches no
# registry. `golang:1.24` is the floor `go.mod` declares and the version ci/runner pins.
FROM golang:1.24 AS build

WORKDIR /src

COPY . .

RUN make release

# One file system to copy from, and `cp`.
FROM alpine:3.20

COPY --from=build /src/dist /dist

# A one-shot: empty the volume, copy the release in, exit 0. Emptied first for the reason
# `make release` empties its own directory — a version left over from an earlier build would be
# served as if it belonged, and `rest` offers the *newest* directory it finds.
CMD ["sh", "-c", "rm -rf /releases/* && cp -a /dist/. /releases/ && ls -1 /releases"]
