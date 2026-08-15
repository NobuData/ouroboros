#!/usr/bin/env sh
#
# verify-containment.sh — prove the shell leg's containment assertions can go red.
#
# Issue #647 asks that the e2e leg "fails when containment is broken — spot-verified by
# planting a viewport-fixed element and a pane-level horizontal overflow". A green
# containment run cannot answer that on its own, for the reason verify-failure-modes.sh
# gives about services: green-because-it-works and green-because-it-asserts-nothing are
# indistinguishable from outside. So this script breaks containment on purpose, twice,
# and requires the right assertion to catch each break by name.
#
# What it does, against a stack that is already up (or --up to bring one up):
#
#   1. Runs the containment tests clean and requires them GREEN — a leg that fails on a
#      healthy shell would "catch" the plants for the wrong reason.
#   2. Re-runs them with OURO_E2E_PLANT=viewport-fixed, which support/shell.ts turns into
#      a `position: fixed` bar injected before first paint, and requires the run RED with
#      "viewport-fixed element" in the output.
#   3. Re-runs them with OURO_E2E_PLANT=pane-overflow — a 3000px-wide element appended to
#      the pane with no wrapper — and requires the run RED with "pane-level horizontal
#      scroll" in the output.
#
# The plants live in support/shell.ts beside the assertions they defeat, so the two
# cannot drift apart without this script noticing: a rewritten assertion that no longer
# sees its plant fails step 2 or 3, and a plant that no longer breaks anything does too.
#
# Like its sibling it is not part of the ten-minute budget: it reruns one spec three
# times and is run after the suite, on demand and in the nightly job.
#
# Usage:
#   scripts/verify-containment.sh          # against a stack that is already up
#   scripts/verify-containment.sh --up     # bring the stack up first
#
# Exit status:
#   0  clean run green; both planted runs red, each naming its assertion
#   1  a planted run passed, or the clean run failed
#   2  the stack could not be brought up

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
E2E_DIR=$(dirname -- "$SCRIPT_DIR")
ROOT=$(cd -- "$E2E_DIR/../.." && pwd)

BRING_UP=0
while [ $# -gt 0 ]; do
  case $1 in
    --up) BRING_UP=1; shift ;;
    -h | --help) sed -n '2,40p' "$0" | cut -c 3-; exit 0 ;;
    *) printf 'verify-containment.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# The repo's shared assertion harness, as every verify-* script reports through.
. "$ROOT/scripts/lib/checks.sh"

cd "$ROOT"

LOG_DIR=$(mktemp -d)

if [ "$BRING_UP" -eq 1 ]; then
  printf -- '--- bringing the stack up\n'
  # The same pair of files scripts/run.sh composes — the override is what lets the suite
  # sign in at all, and the shell leg is signed in from its first line.
  if ! docker compose -f docker-compose.yml -f docker-compose.e2e.yml --profile full \
    up --wait --wait-timeout 300 -d >/dev/null 2>&1; then
    printf 'verify-containment: the stack did not come up\n' >&2
    exit 2
  fi
fi

# The containment tests only — the groups specs/shell-nav.spec.ts titles "containment on
# <route>". One grep, so a retitled group breaks this script loudly rather than leaving
# it verifying an empty selection.
run_containment() {
  log=$1
  status=0
  (cd "$E2E_DIR" && yarn playwright test specs/shell-nav.spec.ts \
    --grep "containment on" --reporter=list) >"$log" 2>&1 || status=$?
  # An empty selection exits zero having proved nothing; saying so beats scoring it.
  if ! grep -Eq '[0-9]+ (passed|failed)' "$log"; then
    fail "the containment tests were selected and ran (nothing ran — see $log)"
    return 1
  fi
  return "$status"
}

# plant NAME MARKER — break containment one way, and require the named catch.
plant() {
  name=$1
  marker=$2
  log="$LOG_DIR/plant-$name.log"

  printf '\n--- OURO_E2E_PLANT=%s → the containment tests must fail\n' "$name"

  status=0
  OURO_E2E_PLANT=$name run_containment "$log" || status=$?

  if [ "$status" -eq 0 ]; then
    fail "the leg goes red with a planted $name (it stayed green — the assertion sees nothing)"
    return 0
  fi
  pass "the leg goes red with a planted $name"

  if grep -q "$marker" "$log"; then
    pass "and it says why: the output matches \"$marker\""
  else
    fail "and it says why (nothing matching \"$marker\" is in $log)"
  fi
}

printf '\nContainment failure modes — issue #647, acceptance criterion 3\n'

printf '\n--- no plant → the containment tests must pass\n'
if run_containment "$LOG_DIR/clean.log"; then
  pass "the containment tests are green on the unbroken shell"
else
  fail "the containment tests are green on the unbroken shell (see $LOG_DIR/clean.log)"
fi

plant viewport-fixed "viewport-fixed element"
plant pane-overflow "pane-level horizontal scroll"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
