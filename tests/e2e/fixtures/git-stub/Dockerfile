# The e2e suite's git host (#991, AG.7) — where a build submitted to the compose stack's real
# runner clones from. See server.go for what it is and why.
#
# A real build checks out `job.offer.repository` before it runs its command, and the offer's URL
# is `OURO_GITHUB_CLONE_BASE_URL/<owner>/<name>.git`. On github.com that is the public internet,
# which a suite may not depend on and a sandbox stack cannot reach; so the e2e override points
# the clone base at this container, the way it points the GitHub API at `tracker-stub`.
#
# Two repositories, built **in the image** with fixed author and committer dates so that every
# build of this image produces the same commit — the sha the suite submits is read back from the
# server rather than hard-coded, but a stable one is what makes a kept stack and a fresh one agree:
#
#   acme-robotics/helios-bootloader.git   public  — an anonymous clone succeeds
#   acme-robotics/helios-console.git      PRIVATE — basic auth; the password is the suite's sandbox
#                                         GitHub token (tests/e2e/support/planning.ts), which the
#                                         build test stores as the fresh workspace's token
#
# The private one is the point: the leg proves the credential hand-over end to end — the ticket
# on the offer, the redemption through the gateway, one authenticated fetch — and that nothing
# anonymous can read it.
#
# The server is Go's `net/http/cgi` in front of `git http-backend`, which is how smart HTTP is
# served everywhere; stdlib only, so the build reaches no registry. `golang:1.24` is the floor the
# runner's `go.mod` declares; `alpine:3.20` is the runtime `runner-release` uses, plus `git`.
FROM golang:1.24-alpine AS build

WORKDIR /src

COPY server.go go.mod ./

RUN CGO_ENABLED=0 go build -o /git-stub .

FROM alpine:3.20

# `git` for `http-backend` and for building the fixtures; `git-daemon` carries `http-backend` on
# alpine, where it is split out of the main package.
RUN apk add --no-cache git git-daemon

WORKDIR /srv

COPY --from=build /git-stub /usr/local/bin/git-stub
COPY build-repos.sh ./

# Deterministic repositories, built once here. The script sets every date git records.
RUN sh ./build-repos.sh /srv/repos

# The image's own user rather than root. `http-backend` writes nothing: the suite only fetches.
RUN adduser -D -h /srv git && chown -R git:git /srv
USER git

EXPOSE 8080

CMD ["git-stub", "-root", "/srv/repos", "-listen", ":8080"]
