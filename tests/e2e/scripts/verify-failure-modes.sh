#!/usr/bin/env sh
#
# verify-failure-modes.sh — the suite's second acceptance criterion, as a script.
#
# Issue #56 asks that "each leg fails meaningfully when its service is stopped
# (spot-verified)". A green suite does not answer that. A suite can be green because the
# system works or because it is asserting nothing, and the two are indistinguishable from
# the outside — the only way to tell them apart is to break the system on purpose and
# check that the right leg goes red for the right reason.
#
# So for each pair below this stops a service, runs the one leg that depends on it,
# requires that leg to **fail**, requires the output to name the failure rather than merely
# carry a non-zero status, and puts the service back.
#
#   service   leg                 what it proves
#   -------   -----------------   ----------------------------------------------------
#   engine    engine.spec.ts      the gateway is really calling the engine, not answering
#                                 from a cache or a constant
#   engine    health.spec.ts      readiness names its dependencies and liveness does not —
#                                 the whole of #29, invisible while everything is healthy
#   db        tenants.spec.ts     the API leg is reading a database rather than a fixture
#   ui        shell.spec.ts       the browser legs are served by the UI container
#   db        dashboard.spec.ts   the dashboard's figures come out of the read model rather
#                                 than out of the mockup (#88) — registered, not yet observed
#
# ## A pair whose leg is parked
#
# The dashboard leg needs a session and this suite cannot sign in against the compose stack
# (tests/e2e/README.md § "Signing in is parked"), so every test in it carries `test.fixme`
# and the run below exits zero having executed nothing. That is neither a pass nor a
# failure and this script says so rather than scoring it: a parked pair is reported with
# `--` and left out of the tally, because counting it either way would be a lie in one
# direction or the other.
#
# It is registered anyway, and deliberately. The alternative — leaving the pair out until
# the leg runs — is how a leg ships with no failure mode at all: the day somebody deletes
# the `test.fixme` lines, this script starts checking it without anybody having to remember
# that it should.
#
# `rest` is not in the table, and the reason is a property of the stack rather than an
# oversight: `ui` shares `rest`'s network namespace (see docker-compose.yml), so stopping
# `rest` strands the UI container in a namespace that no longer exists and the recovery is
# a restart of both. Stopping `db` exercises the same leg — the API answering from a real
# database — without leaving the stack in a state this script has to repair.
#
# It is slow by construction: every pair is a stop, a run that has to time out or refuse,
# and a wait for a healthcheck. It therefore runs on its own, after the suite, and is not
# part of the ten-minute budget.
#
# Usage:
#   scripts/verify-failure-modes.sh          # against a stack that is already up
#   scripts/verify-failure-modes.sh --up     # bring the stack up first
#
# Exit status:
#   0  every leg failed when its service was stopped
#   1  at least one leg passed with its service stopped — that leg is asserting nothing
#   2  the stack could not be brought up or restored

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
    *) printf 'verify-failure-modes.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# The repo's shared assertion harness — the same one every verify-* script reads and
# reports through, so a failure here looks like a failure anywhere else in the repository.
. "$ROOT/scripts/lib/checks.sh"

cd "$ROOT"

# Where the transcript of each attempt goes, so a failure can be read rather than guessed
# at. Removed on the way out unless something failed.
LOG_DIR=$(mktemp -d)

compose() {
  docker compose --profile full "$@"
}

# wait_healthy — block until every service reports healthy again, or give up.
wait_healthy() {
  if ! compose up --wait --wait-timeout 180 -d >/dev/null 2>&1; then
    printf '\nverify-failure-modes: the stack did not recover. What each service reported:\n\n' >&2
    compose ps >&2
    exit 2
  fi
}

restore() {
  printf '\n--- restoring the stack\n'
  wait_healthy
}
trap restore EXIT INT TERM

if [ "$BRING_UP" -eq 1 ]; then
  printf -- '--- bringing the stack up\n'
  wait_healthy
fi

# parked SPEC SERVICE — report a pair whose leg did not run, and score it as neither.
#
# A spec every one of whose tests carries `test.fixme` exits zero having executed nothing,
# which is indistinguishable from a green run by exit status alone and is the opposite of
# one in meaning. Reporting it as a pass would claim the leg was shown to fail; reporting it
# as a failure would turn the nightly job red for a decision somebody made on purpose and
# wrote down. So it is reported and not counted, in the words a reader of the log needs.
parked() {
  printf '  --    %s ran nothing with %s stopped: every test in it is parked, so this\n' "$1" "$2"
  printf '        pair asserts nothing yet. See tests/e2e/README.md § Signing in is parked.\n'
}

# expect_red SERVICE SPEC MARKER — stop SERVICE, run SPEC, require it to fail, require the
# output to match MARKER, then bring SERVICE back.
#
# MARKER is what makes this "meaningfully": a leg that fails with a timeout and no
# explanation is a leg somebody will mark flaky and retry. It is the text a person reading
# the CI log needs in order to know which layer broke, and it is an extended regular
# expression rather than a fixed string because two of the cases below can honestly present
# in more than one way.
expect_red() {
  service=$1
  spec=$2
  marker=$3
  log="$LOG_DIR/$service-$spec.log"

  printf '\n--- %s stopped → specs/%s must fail\n' "$service" "$spec"
  compose stop "$service" >/dev/null 2>&1

  status=0
  (cd "$E2E_DIR" && yarn playwright test "specs/$spec" --reporter=list) >"$log" 2>&1 || status=$?

  # A run that executed at least one test says so; a wholly parked spec never prints it.
  # Checked before the exit status is judged, because both cases exit zero and only this
  # tells them apart.
  if [ "$status" -eq 0 ] && ! grep -Eq '[0-9]+ passed' "$log"; then
    parked "specs/$spec" "$service"
    compose start "$service" >/dev/null 2>&1
    wait_healthy
    return 0
  fi

  if [ "$status" -eq 0 ]; then
    fail "specs/$spec fails with $service stopped (it passed — the leg asserts nothing)"
  else
    pass "specs/$spec fails with $service stopped"
  fi

  if grep -Eq "$marker" "$log"; then
    pass "specs/$spec says why: the output matches \"$marker\""
  else
    fail "specs/$spec says why (nothing matching \"$marker\" is in $log)"
  fi

  compose start "$service" >/dev/null 2>&1
  wait_healthy
}

printf '\nFailure modes — issue #56, acceptance criterion 2\n'

# The gateway leg. With the engine stopped, `ouroboros-rest` cannot serve the pass-through
# and answers the one code the contract gives it for every way the engine can fail — which
# is the text a reader needs, rather than the bare 502 it travels on.
expect_red engine engine.spec.ts "engine_unavailable"

# The probe leg. Readiness is allowed to say no because a dependency is missing, and must
# name which; liveness must not notice at all. This is the pair #29 exists for, and the
# 503 is readiness refusing while the container stays alive.
expect_red engine health.spec.ts "503"

# The API leg, against the layer underneath it. A tenant route with no database is the
# service itself failing, and its message is a constant by design — `internal_error` is
# the whole of what a caller is told, so it is what this looks for.
expect_red db tenants.spec.ts "internal_error"

# The browser legs — and the one case with more than one honest answer.
#
# Stopping `ui` does not close port 3000: the UI shares `rest`'s network namespace, so the
# port is published by the container that is still running (docker-compose.yml explains the
# arrangement at length). Docker's forwarder therefore *accepts* the connection and then
# has nothing to hand it to, which the browser sees as an empty response or a hung-up
# socket rather than as a refusal. On a daemon without the userland proxy it is a refusal
# after all — so the alternation is not hedging, it is two real behaviours of the same
# stopped container.
expect_red ui shell.spec.ts "ERR_EMPTY_RESPONSE|ERR_CONNECTION_REFUSED|ECONNREFUSED|socket hang up"

# The dashboard leg (#88), against the layer its every figure comes out of. `27 PRs merged`
# and `9h 40m of queued work` are aggregations over rows, so a dashboard that still drew them
# with the database stopped would be a page drawing the mockup — which is exactly the failure
# this leg was added to make impossible.
#
# `db` rather than `rest`, for the reason the tenants pair uses it: stopping `rest` strands
# the UI container in a network namespace that no longer exists. It also breaks the leg at
# its first step, which is honest — a session is a row, so with no database there is nobody
# to sign in as, and `support/session.ts` says so by name in its failure.
#
# **The marker is an alternation because this pair has never been observed**, and it cannot
# be until the leg runs: the sign-in refusal, an aggregate that answers `500`, and a guard
# that sends an unauthenticated request to `/login` are three honest ways for the same
# stopped container to present, and naming one of them would be a guess dressed up as a
# measurement. Whoever unparks the leg should watch this pair once and cut it down to what
# actually happened.
expect_red db dashboard.spec.ts "sign-in for .* answered|internal_error|answered 5[0-9][0-9]|/login"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
