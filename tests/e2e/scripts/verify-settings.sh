#!/usr/bin/env sh
#
# verify-settings.sh — prove each of the settings leg's nine legs can go red.
#
# Issue #496's acceptance criterion is that the e2e leg "passes from a cold compose stack and
# each of its nine legs fails meaningfully when its underlying layer is broken (verified by
# deliberately breaking each layer once)". A green leg cannot answer the second half on its own,
# for the reason verify-failure-modes.sh gives about services and verify-readability.sh about
# CSS: green-because-the-system-works and green-because-the-test-sees-nothing are
# indistinguishable from outside. So this script breaks each layer on purpose, runs the one
# test that should notice, and requires it to go red **naming what broke**.
#
# Seven of the nine are layers inside the service, and they are broken *beneath* it — a row
# written through psql, the fixture receiver told to refuse, the download rewritten on its way
# to the browser — at the moment the test has arranged its state
# (tests/e2e/support/settings-hub.ts § BREAKS). The other two are CSS, and reuse the plants
# verify-containment.sh and verify-readability.sh already prove (support/plants.ts).
#
#   leg  break (variable=value)                    what is broken                                  must say
#   ---  ----------------------------------------  ----------------------------------------------  ---------------------------
#   1    OURO_E2E_SETTINGS_BREAK=policy-gate       the repository's own rows keep boot/** protected  "the gate must flip"
#                                                  whatever the org policy publishes
#   2    OURO_E2E_SETTINGS_BREAK=capability        the capability is granted again beneath the box   "approval must be refused"
#   3    OURO_E2E_SETTINGS_BREAK=retention         the stored tiers are put back after the save      "the tier the next sweep reads"
#   4    OURO_E2E_SETTINGS_BREAK=webhook           the receiver answers 503                          "Ping succeeded"
#   5    OURO_E2E_SETTINGS_BREAK=audit-export      an event the view never showed is logged first    "matches the filtered view"
#   6    OURO_E2E_SETTINGS_BREAK=pause             the lifecycle row is set back to active           "the next stage must hold"
#   7    OURO_E2E_SETTINGS_BREAK=step-up           the session is left fresh                         "must demand a step-up"
#   8    OURO_E2E_PLANT=pane-overflow              a 3000px box in the pane                          "pane-level horizontal scroll"
#   9    OURO_E2E_PLANT=chrome-overlap             the pane pulled up under the header               the screenshot diff
#
# Every break is undone by the test it is aimed at — each restores what it wrote in its own
# `finally`, breakage included — which is what lets all nine run against one stack, one after
# another, and leave it as they found it. The clean run goes first so a leg that is red for a
# reason of its own is reported as that rather than scored as nine catches.
#
# What this cannot break, and where that was done: nothing here rebuilds an image, so a fault
# planted in the *code* of a layer — the guardrail's union, the capability guard, the freeze
# guard — is the service's own suites'. These nine are the state each layer reads, which is the
# half an end-to-end leg is for.
#
# Like its siblings it is not part of any budget: it reruns tests ten times and is run after the
# suite, on demand and in the nightly job. Legs 1 and 6 need uv, as the leg itself does.
#
# Usage:
#   scripts/verify-settings.sh          # against a stack that is already up
#   scripts/verify-settings.sh --up     # bring the stack up first
#
# Exit status:
#   0  the clean run green; all nine broken runs red, each naming its layer
#   1  a broken run passed, a named reason was missing, or the clean run failed
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
    -h | --help) sed -n '2,52p' "$0" | cut -c 3-; exit 0 ;;
    *) printf 'verify-settings.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# The repo's shared assertion harness, as every verify-* script reports through.
. "$ROOT/scripts/lib/checks.sh"

cd "$ROOT"

LOG_DIR=$(mktemp -d)

if [ "$BRING_UP" -eq 1 ]; then
  printf -- '--- bringing the stack up\n'
  # The same pair of files scripts/run.sh composes: the override is what lets the suite sign
  # in, and what puts the webhook receiver in the stack at all.
  if ! docker compose -f docker-compose.yml -f docker-compose.e2e.yml --profile full \
    up --wait --wait-timeout 300 -d >/dev/null 2>&1; then
    printf 'verify-settings: the stack did not come up\n' >&2
    exit 2
  fi
fi

# run_leg LOG [TITLE] — the settings leg, or the one test of it whose title matches.
#
# One grep per test, so a retitled test breaks this script loudly rather than leaving it
# verifying an empty selection.
run_leg() {
  log=$1
  title=${2:-}
  status=0
  if [ -n "$title" ]; then
    (cd "$E2E_DIR" && yarn playwright test specs/settings.spec.ts --grep "$title" --reporter=list) \
      >"$log" 2>&1 || status=$?
  else
    (cd "$E2E_DIR" && yarn playwright test specs/settings.spec.ts --reporter=list) \
      >"$log" 2>&1 || status=$?
  fi
  # An empty selection exits zero having proved nothing; saying so beats scoring it.
  if ! grep -Eq '[0-9]+ (passed|failed)' "$log"; then
    fail "the settings tests were selected and ran (nothing ran — see $log)"
    return 1
  fi
  return "$status"
}

# broken VARIABLE NAME TITLE MARKER — break one layer, run its test, require the named catch.
broken() {
  variable=$1
  name=$2
  title=$3
  marker=$4
  log="$LOG_DIR/$name.log"

  printf '\n--- %s=%s → "%s" must fail\n' "$variable" "$name" "$title"

  status=0
  if [ "$variable" = OURO_E2E_PLANT ]; then
    OURO_E2E_PLANT=$name run_leg "$log" "$title" || status=$?
  else
    OURO_E2E_SETTINGS_BREAK=$name run_leg "$log" "$title" || status=$?
  fi

  if [ "$status" -eq 0 ]; then
    fail "\"$title\" goes red with $name broken (it stayed green — the test sees nothing)"
    return 0
  fi
  pass "\"$title\" goes red with $name broken"

  if grep -Eq "$marker" "$log"; then
    pass "and it says why: the output matches \"$marker\""
  else
    fail "and it says why (nothing matching \"$marker\" is in $log)"
  fi
}

printf '\nSettings leg failure modes — issue #496\n'

printf '\n--- nothing broken → the leg must pass\n'
if run_leg "$LOG_DIR/clean.log"; then
  pass "the settings leg is green on the unbroken stack"
else
  fail "the settings leg is green on the unbroken stack (see $LOG_DIR/clean.log)"
fi

broken OURO_E2E_SETTINGS_BREAK policy-gate "policy: a rule published off" "the gate must flip"
broken OURO_E2E_SETTINGS_BREAK capability "capability: unticking Can approve loops" "approval must be refused"
broken OURO_E2E_SETTINGS_BREAK retention "retention: the tier the card saves" "the tier the next sweep reads"
broken OURO_E2E_SETTINGS_BREAK webhook "webhook: an endpoint made in the sheet" "Ping succeeded"
broken OURO_E2E_SETTINGS_BREAK audit-export "audit: the exported CSV" "matches the filtered view"
broken OURO_E2E_SETTINGS_BREAK pause "pause: a running stage finishes" "the next stage must hold"
broken OURO_E2E_SETTINGS_BREAK step-up "delete: typed name and step-up" "must demand a step-up"
broken OURO_E2E_PLANT pane-overflow "shell: fixed chrome under a pane scroll" "pane-level horizontal scroll"
broken OURO_E2E_PLANT chrome-overlap "parity: mockup 17's hub" "pixels \\(ratio|Screenshot comparison failed|are different"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
