#!/bin/sh
#
# smoke-image.sh — run the documentation image and probe what it serves (DD.3, #1208).
#
# A green build can still produce an image that serves nothing: an nginx config that does not
# load, a root that points at an empty directory, a page that answers 403. So `ci/docs` builds
# the image, loads it into the runner's daemon without pushing it, and runs this against it
# before `publish/docs` may publish anything.
#
# Usage:
#   scripts/smoke-image.sh IMAGE [PORT]     # e.g. scripts/smoke-image.sh ouroboros-docs:smoke
#
# It starts IMAGE on 127.0.0.1:PORT (default 18080), waits for /healthz, then checks:
#
#   GET /healthz                   200, body "ok"
#   GET / /user-guide /administration /cli
#                                  200, HTML carrying the footer's copyright line
#   GET /cli/runner/enroll         200 — a page three levels down
#   GET <a path that is no page>   404, with Docusaurus' "Page Not Found" page
#   GET <the page's main script>   Cache-Control: … immutable
#
# The container is removed whatever happens. Exit status: 0 every check passed, 1 a check
# failed or the container never answered (its log is printed), 2 usage error or no docker/curl.

set -u

# The footer's copyright line, as site.constants.ts writes it. tests/smoke-image.test.ts holds
# the two equal, so this cannot quietly check for a line the site no longer prints.
COPYRIGHT='Copyright © 2025-2026 NobuData LLC'

# say MESSAGE — one line of progress.
say() {
  printf '%s\n' "$*"
}

# usage_error MESSAGE — stop with exit status 2.
usage_error() {
  printf 'smoke-image: %s\n' "$*" >&2
  exit 2
}

[ $# -ge 1 ] && [ $# -le 2 ] || usage_error 'usage: scripts/smoke-image.sh IMAGE [PORT]'
case $1 in -*) usage_error 'usage: scripts/smoke-image.sh IMAGE [PORT]' ;; esac
IMAGE=$1
PORT=${2:-18080}
case $PORT in '' | *[!0-9]*) usage_error "PORT must be a number, not: $PORT" ;; esac
command -v docker >/dev/null 2>&1 || usage_error 'docker is not on PATH'
command -v curl >/dev/null 2>&1 || usage_error 'curl is not on PATH'

BASE="http://127.0.0.1:$PORT"
NAME="ouroboros-docs-smoke-$$"
WORK=$(mktemp -d)
failures=0

# cleanup — remove the container and the scratch directory, on any exit.
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# check DESCRIPTION CONDITION... — record one check: pass when the command succeeds.
check() {
  description=$1
  shift
  if "$@"; then
    say "  ok    $description"
  else
    say "  FAIL  $description"
    failures=$((failures + 1))
  fi
}

# fetch PATH — GET PATH, leaving the status in $WORK/status, the headers in $WORK/headers and
# the body in $WORK/body.
fetch() {
  curl -s -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' "$BASE$1" >"$WORK/status" ||
    printf '000' >"$WORK/status"
}

# status_is CODE — whether the last fetch answered CODE.
status_is() {
  [ "$(cat "$WORK/status")" = "$1" ]
}

# body_has TEXT — whether the last fetch's body contains TEXT, literally.
body_has() {
  grep -qF -- "$1" "$WORK/body"
}

# header_has TEXT — whether the last fetch's headers contain TEXT, case-insensitively.
header_has() {
  grep -qiF -- "$1" "$WORK/headers"
}

say "smoke-image: starting $IMAGE on $BASE"
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" "$IMAGE" >/dev/null ||
  { printf 'smoke-image: could not start %s\n' "$IMAGE" >&2; exit 1; }

# Up to 30 s for nginx to answer: a config it refuses never answers at all.
ready=false
for _ in $(seq 1 30); do
  fetch /healthz
  if status_is 200; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then
  printf 'smoke-image: %s never answered /healthz with 200. Its log:\n' "$IMAGE" >&2
  docker logs "$NAME" >&2 2>&1 || true
  exit 1
fi

say 'smoke-image: probing'
fetch /healthz
check 'GET /healthz answers 200 ok' eval 'status_is 200 && body_has ok'

for path in / /user-guide /administration /cli; do
  fetch "$path"
  check "GET $path answers 200" status_is 200
  check "GET $path carries the copyright line" body_has "$COPYRIGHT"
done

fetch /cli/runner/enroll
check 'GET /cli/runner/enroll (a deep page) answers 200' eval 'status_is 200 && body_has "ouroboros-runner enroll"'

fetch /this-page-does-not-exist
check 'an unknown path answers 404' status_is 404
check "and shows Docusaurus' not-found page" body_has 'Page Not Found'

fetch /
script=$(grep -o '/assets/js/main\.[0-9a-f]*\.js' "$WORK/body" | head -n 1)
if [ -n "$script" ]; then
  fetch "$script"
  check "the page's main script ($script) is cached as immutable" \
    eval 'status_is 200 && header_has immutable'
else
  check 'the home page names its main script' false
fi

if [ "$failures" -gt 0 ]; then
  printf '\nsmoke-image: %s check(s) failed. The container log:\n' "$failures" >&2
  docker logs "$NAME" >&2 2>&1 || true
  exit 1
fi
say 'smoke-image: every check passed'
