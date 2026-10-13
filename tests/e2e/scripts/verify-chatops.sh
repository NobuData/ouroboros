#!/usr/bin/env sh
#
# verify-chatops.sh — prove each layer of the Chat Ops chain can turn its test red.
#
# Issue #545's acceptance criterion is that "each leg fails meaningfully when its layer is
# broken — verified by deliberately breaking publishing, the interactivity handler, the
# dispatcher and the timer in turn". A green chain cannot answer that on its own, for the reason
# verify-failure-modes.sh gives about services and verify-settings.sh about a hub's layers:
# green-because-the-chain-works and green-because-the-test-sees-nothing are indistinguishable
# from outside. So this script breaks each layer on purpose, runs the one test that should
# notice, and requires it to go red **naming what broke**.
#
# All four are broken *beneath* the service — a fixture told to refuse, a request signed with
# another secret, a row written through psql — at the moment the test has arranged its state
# (tests/e2e/support/chatops.ts § the breakages).
#
#   break (OURO_E2E_CHATOPS_BREAK=)  what is broken                                         must say
#   -------------------------------  -----------------------------------------------------  ------------------------------------
#   publishing                       Slack refuses every chat.postMessage                   "must be published to Slack channel"
#   interactivity                    the Allow once press is signed with another secret     "the interactivity handler must accept"
#   dispatcher                       the connection is marked failing while commands run    "command parity: the console result"
#   timer                            the short escalation window is withdrawn before the    "the escalation timer must fire"
#                                    question is filed
#
# Every break is undone by the leg itself — the test restores what it wrote in its own `finally`,
# and the leg's hooks reset the stub, drain what a refused publish left in the outbox and put the
# seeded connection back — which is what lets all four run against one stack, one after another,
# and leave it as they found it. The clean run goes first so a chain that is red for a reason of
# its own is reported as that rather than scored as four catches.
#
# What this cannot break, and where that was done: nothing here rebuilds an image, so a fault
# planted in the *code* of a layer — the dispatcher's settle, the signature guard, the grammar,
# the escalation pass — is the service's own suites' (BZ.6, #540). These four are the state and
# the wire each layer reads, which is the half an end-to-end leg is for.
#
# Like its siblings it is not part of any budget: it runs the chain once and reruns two of its
# tests four times, after the suite, on demand and in the nightly job. It needs uv, as the leg
# itself does.
#
# Usage:
#   scripts/verify-chatops.sh          # against a stack that is already up
#   scripts/verify-chatops.sh --up     # bring the stack up first
#
# Exit status:
#   0  the clean run green; all four broken runs red, each naming its layer
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
    -h | --help) sed -n '2,48p' "$0" | cut -c 3-; exit 0 ;;
    *) printf 'verify-chatops.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# The repo's shared assertion harness, as every verify-* script reports through.
. "$ROOT/scripts/lib/checks.sh"

cd "$ROOT"

LOG_DIR=$(mktemp -d)

if [ "$BRING_UP" -eq 1 ]; then
  printf -- '--- bringing the stack up\n'
  # The same pair of files scripts/run.sh composes: the override is what puts the Slack
  # stand-in in the stack and points the service at it.
  if ! docker compose -f docker-compose.yml -f docker-compose.e2e.yml --profile full \
    up --wait --wait-timeout 300 -d >/dev/null 2>&1; then
    printf 'verify-chatops: the stack did not come up\n' >&2
    exit 2
  fi
fi

# run_leg LOG [TITLE] — the chain, or the one test of it whose title matches.
#
# One grep per test, so a retitled test breaks this script loudly rather than leaving it
# verifying an empty selection.
run_leg() {
  log=$1
  title=${2:-}
  status=0
  if [ -n "$title" ]; then
    (cd "$E2E_DIR" && yarn playwright test specs/slack.spec.ts --grep "$title" --reporter=list) \
      >"$log" 2>&1 || status=$?
  else
    (cd "$E2E_DIR" && yarn playwright test specs/slack.spec.ts --reporter=list) \
      >"$log" 2>&1 || status=$?
  fi
  # An empty selection exits zero having proved nothing; saying so beats scoring it.
  if ! grep -Eq '[0-9]+ (passed|failed)' "$log"; then
    fail "the chatops tests were selected and ran (nothing ran — see $log)"
    return 1
  fi
  return "$status"
}

# broken NAME TITLE MARKER — break one layer, run its test, require the named catch.
broken() {
  name=$1
  title=$2
  marker=$3
  log="$LOG_DIR/$name.log"

  printf '\n--- OURO_E2E_CHATOPS_BREAK=%s → "%s" must fail\n' "$name" "$title"

  status=0
  OURO_E2E_CHATOPS_BREAK=$name run_leg "$log" "$title" || status=$?

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

printf '\nChat Ops chain failure modes — issue #545\n'

printf '\n--- nothing broken → the chain must pass\n'
if run_leg "$LOG_DIR/clean.log"; then
  pass "the chatops chain is green on the unbroken stack"
else
  fail "the chatops chain is green on the unbroken stack (see $LOG_DIR/clean.log)"
fi

broken publishing "publish, answer, resume" "must be published to Slack channel"
broken interactivity "publish, answer, resume" "the interactivity handler must accept"
broken dispatcher "publish, answer, resume" "command parity: the console result"
broken timer "route, escalate, dead-letter" "the escalation timer must fire"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
