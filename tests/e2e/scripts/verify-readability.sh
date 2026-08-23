#!/usr/bin/env sh
#
# verify-readability.sh — prove the 150% audit can go red.
#
# Issue #650's second acceptance criterion is that "a planted overflow fixture fails the
# audit". A green audit cannot answer that on its own, for the reason verify-failure-modes.sh
# gives about services and verify-containment.sh gives about containment:
# green-because-the-page-is-clean and green-because-the-probes-see-nothing are
# indistinguishable from outside. So this script breaks readability on purpose, four ways,
# and requires the right probe to catch each break by name.
#
# The four are the audit's four questions, one plant each (tests/e2e/support/plants.ts):
#
#   1. pane-overflow  — a 3000px box in the pane with no wrapper. The § 1.3 regression this
#                       whole issue is about: it fits at 100% and pushes the pane sideways
#                       at 150%, which is exactly what a review at 100% cannot see.
#   2. clipped-text   — a sidebar label squeezed narrower than its own words, with no
#                       tooltip. The failure a screenshot review reads as a sentence that
#                       ended.
#   3. chrome-overlap — the pane pulled up under the header. The shell frame's half of "no
#                       overlapping chrome".
#   4. stack-overlap  — the sticky bar dropped onto the subnav's edge. CP.4's half, and the
#                       one the issue names: a hard-coded offset is right at one font scale
#                       and wrong at the other four.
#
# 3 and 4 defeat the *same* probe in its two halves, and they are two runs because the frame
# check fails the test before the stack comparison is reached — one plant would leave the
# half #646's contract is about never shown to be catchable.
#
# The plants live beside the assertions' own module so the two cannot drift apart without
# this script noticing: a rewritten probe that no longer sees its plant fails the matching
# step, and a plant that no longer breaks anything does too.
#
# Like its two siblings it is not part of any budget: it reruns the audit five times and is
# run after the suite, on demand and in the nightly job.
#
# Usage:
#   scripts/verify-readability.sh          # against a stack that is already up
#   scripts/verify-readability.sh --up     # bring the stack up first
#
# Exit status:
#   0  clean run green; all four planted runs red, each naming its probe
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
    -h | --help) sed -n '2,44p' "$0" | cut -c 3-; exit 0 ;;
    *) printf 'verify-readability.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# The repo's shared assertion harness, as every verify-* script reports through.
. "$ROOT/scripts/lib/checks.sh"

cd "$ROOT"

LOG_DIR=$(mktemp -d)

if [ "$BRING_UP" -eq 1 ]; then
  printf -- '--- bringing the stack up\n'
  # The same pair of files scripts/run.sh composes — the override is what lets the suite
  # sign in at all, and every test in this leg is signed in from its first line.
  if ! docker compose -f docker-compose.yml -f docker-compose.e2e.yml --profile full \
    up --wait --wait-timeout 300 -d >/dev/null 2>&1; then
    printf 'verify-readability: the stack did not come up\n' >&2
    exit 2
  fi
fi

# The audit only — the groups specs/readability.spec.ts titles "the 150% audit on <route>".
# The matrix's screenshots are not rerun: a plant would change every pixel on the page, so
# they would go red for a reason that says nothing about whether the probes work.
#
# One grep, so a retitled group breaks this script loudly rather than leaving it verifying
# an empty selection.
run_audit() {
  log=$1
  status=0
  (cd "$E2E_DIR" && yarn playwright test --config playwright.readability.config.ts \
    --grep "the 150% audit on" --reporter=list) >"$log" 2>&1 || status=$?
  # An empty selection exits zero having proved nothing; saying so beats scoring it.
  if ! grep -Eq '[0-9]+ (passed|failed)' "$log"; then
    fail "the audit tests were selected and ran (nothing ran — see $log)"
    return 1
  fi
  return "$status"
}

# plant NAME MARKER — break readability one way, and require the named catch.
plant() {
  name=$1
  marker=$2
  log="$LOG_DIR/plant-$name.log"

  printf '\n--- OURO_E2E_PLANT=%s → the audit must fail\n' "$name"

  status=0
  OURO_E2E_PLANT=$name run_audit "$log" || status=$?

  if [ "$status" -eq 0 ]; then
    fail "the audit goes red with a planted $name (it stayed green — the probe sees nothing)"
    return 0
  fi
  pass "the audit goes red with a planted $name"

  if grep -q "$marker" "$log"; then
    pass "and it says why: the output matches \"$marker\""
  else
    fail "and it says why (nothing matching \"$marker\" is in $log)"
  fi
}

printf '\nReadability failure modes — issue #650, acceptance criterion 2\n'

printf '\n--- no plant → the audit must pass\n'
if run_audit "$LOG_DIR/clean.log"; then
  pass "the audit is green on the unbroken pages"
else
  fail "the audit is green on the unbroken pages (see $LOG_DIR/clean.log)"
fi

plant pane-overflow "pane-level horizontal scroll"
plant clipped-text "clipped text:"
plant chrome-overlap "into the content pane"
plant stack-overlap "the page subnav covers"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
