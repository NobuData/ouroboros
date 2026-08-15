#!/usr/bin/env sh
#
# run.sh — bring the compose stack up cold and run the smoke suite against it.
#
# The on-demand entry point, and the one CI uses. It exists so that "run the e2e suite"
# is one command with one definition rather than a paragraph of a README that a workflow
# then re-implements slightly differently.
#
# What it does, in order:
#
#   1. `docker compose -f docker-compose.yml -f docker-compose.e2e.yml --profile full up
#      --build --wait` — builds the three images from this checkout and blocks until every
#      service reports *healthy*. The second file is the e2e override (#647): it runs
#      `rest` non-production so the seeded password sign-in answers, and moves its bind
#      interface so the suite can reach it — its header says why that is safe here and
#      nowhere else. `--wait` is the load-bearing flag: it waits on the services' own
#      healthchecks, which is a stronger definition of ready than a port being open and an
#      incomparably better one than a sleep. Nothing in the suite retries, so this is
#      where the waiting belongs.
#   2. `playwright test` — the suite, under its own ten-minute budget.
#   3. `docker compose down` — unless --keep was passed.
#
# The stack is torn down but the volume is not: `down` rather than `down -v`, so a
# developer who ran this against their own database still has it afterwards. CI runs on a
# fresh runner and does not care.
#
# Usage:
#   scripts/run.sh                 # cold build, run, tear down
#   scripts/run.sh --keep          # leave the stack up afterwards (for debugging)
#   scripts/run.sh --no-build      # reuse the images already built
#   scripts/run.sh -- --grep @foo  # everything after -- goes to playwright
#
# Exit status:
#   0  the suite passed
#   1  the suite failed
#   2  the stack did not come up, or the arguments were wrong

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
E2E_DIR=$(dirname -- "$SCRIPT_DIR")
ROOT=$(cd -- "$E2E_DIR/../.." && pwd)

KEEP=0
BUILD=--build

while [ $# -gt 0 ]; do
  case $1 in
    --keep) KEEP=1; shift ;;
    --no-build) BUILD=''; shift ;;
    --) shift; break ;;
    -h | --help) sed -n '2,30p' "$0" | cut -c 3-; exit 0 ;;
    *) printf 'run.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

cd "$ROOT"

# The stack this suite runs against is the developer's, plus one override: the e2e file
# turns on the seeded password sign-in and moves rest's bind interface so the suite can
# reach it (#647 — the file's own header says why that is safe). Spelled as a function so
# every invocation below composes the same pair of files and none can quietly drop one.
compose() {
  docker compose -f docker-compose.yml -f docker-compose.e2e.yml "$@"
}

teardown() {
  if [ "$KEEP" -eq 0 ]; then
    printf '\n--- tearing the stack down (the volume is kept; use `docker compose down -v` to drop it)\n'
    compose --profile full down --remove-orphans >/dev/null 2>&1 || true
  else
    printf '\n--- leaving the stack up (--keep)\n'
  fi
}
trap teardown EXIT INT TERM

printf -- '--- bringing the stack up\n'
# shellcheck disable=SC2086 # BUILD is deliberately unquoted: it is a flag or nothing.
if ! compose --profile full up $BUILD --wait --wait-timeout 300 -d; then
  printf '\nrun.sh: the stack did not become healthy. What each service reported:\n\n' >&2
  compose --profile full ps >&2
  exit 2
fi

printf -- '\n--- the stack is healthy; running the suite\n\n'

cd "$E2E_DIR"

# Not `exec`: that would replace this shell and take the EXIT trap with it, so a failing
# suite would leave the stack running and a passing one would too. The status is carried
# out by hand instead, which is what makes the teardown unconditional.
status=0
yarn playwright test "$@" || status=$?

exit "$status"
