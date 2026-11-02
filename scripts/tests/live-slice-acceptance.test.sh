#!/usr/bin/env sh
#
# live-slice-acceptance.test.sh — integration tests for scripts/live-slice-acceptance.sh.
#
# The script drives a deployment through its REST API and turns what it read into a report. These
# tests put a stub `curl` first on PATH — a shell script that answers each route from canned JSON
# and logs what it was asked — so they cover the script's own decisions without a deployment: the
# order of the calls, that the session and the key never reach argv or the output, that a refused
# deployment stops before anything is queued, which outcome each run status means, and that the
# report carries the run's numbers.
#
# Usage:
#   scripts/tests/live-slice-acceptance.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
ACCEPT="$SCRIPTS_DIR/live-slice-acceptance.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
mkdir -p "$work/bin"

SESSION='session-value-that-must-not-leak'
KEY='sk-ant-api03-key-that-must-not-leak'
RUN='11111111-2222-4333-8444-555555555555'

# The stub curl. It records each call as "METHOD PATH" in $STUB_DIR/calls, every argument in
# $STUB_DIR/argv, the config file it was handed in $STUB_DIR/config, and answers from the files
# the test leaves in $STUB_DIR: deployment (true/false), status (the run's status), pr (the PR
# number or null). The terminal-runs listing shows the run from its second read on, so the
# script's "before" snapshot does not hold it.
cat > "$work/bin/curl" << 'STUB'
#!/usr/bin/env sh
method=GET out='' url='' data=''
while [ $# -gt 0 ]; do
  printf '%s\n' "$1" >> "$STUB_DIR/argv"
  case $1 in
    -X) method=$2; shift ;;
    -o) out=$2; shift ;;
    -K) cat "$2" >> "$STUB_DIR/config"; shift ;;
    --data-binary) data=${2#@}; shift ;;
    -H|-w) shift ;;
    http*) url=$1 ;;
  esac
  shift
done
path=${url#http://rest.test}
printf '%s %s\n' "$method" "$path" >> "$STUB_DIR/calls"
[ -z "$data" ] || cat "$data" >> "$STUB_DIR/bodies"
code=200
run=11111111-2222-4333-8444-555555555555
summary="{\"id\":\"$run\",\"issueNumber\":7,\"issueTitle\":\"greet: punctuation\",\"model\":\"claude-sonnet-5-5\",\"status\":\"$(cat "$STUB_DIR/status")\",\"prNumber\":$(cat "$STUB_DIR/pr"),\"origin\":\"live\"}"
case "$method $path" in
  'GET /api/v1/loop/capabilities') body="{\"deploymentEnabled\":$(cat "$STUB_DIR/deployment")}" ;;
  'POST /api/v1/providers/'*'/rotate') body='{}' ;;
  'POST /api/v1/backlog/queue') code=201; body='{"items":[],"estMinutes":3}' ;;
  'GET /api/v1/queue?limit=100') body='{"items":[{"id":"q1","issueNumber":7,"confirmedAt":null,"waiting":null}]}' ;;
  'POST /api/v1/queue/q1/confirm') body='{}' ;;
  'GET /api/v1/runs?status=active&limit=100') body='{"items":[]}' ;;
  'GET /api/v1/runs?status=terminal&limit=100')
    if [ -e "$STUB_DIR/listed" ]; then body="{\"items\":[$summary]}"; else body='{"items":[]}'; fi
    : > "$STUB_DIR/listed"
    ;;
  "GET /api/v1/runs/$run")
    body="{\"run\":$summary,\"resources\":{\"tokens\":{\"used\":5200,\"tokensIn\":4000,\"tokensOut\":1200},\"cost\":{\"costCents\":\"3.25\",\"unpricedEvents\":0,\"routeTag\":\"live-slice\"},\"farm\":{\"jobNumber\":4,\"jobStatus\":\"succeeded\",\"runnerName\":\"r1\"},\"wallClock\":{\"elapsedSeconds\":212}}}"
    ;;
  "GET /api/v1/pull-requests?runId=$run")
    body='{"items":[{"url":"https://github.com/NobuData/ouroboros-sample/pull/12","draft":true,"headBranch":"ouro/run-1-1"}]}'
    ;;
  "GET /api/v1/runs/$run/events?after=0&limit=500")
    body='{"entries":[{"actor":"model","stageKey":"plan","modelId":"claude-sonnet-5-5"},{"actor":"tool","stageKey":"implement"},{"actor":"model","stageKey":"implement","modelId":"claude-sonnet-5-5"},{"actor":"model","stageKey":"implement","modelId":"claude-sonnet-5-5"}],"hasMore":true,"nextAfter":4}'
    ;;
  "GET /api/v1/runs/$run/events?after=4&limit=500")
    body='{"entries":[{"actor":"gate","stageKey":"gate"}],"hasMore":false,"nextAfter":5}'
    ;;
  *) code=404; body='{"code":"not_found"}' ;;
esac
printf '%s' "$body" > "$out"
printf '%s' "$code"
STUB
chmod +x "$work/bin/curl"

# reset_stub DEPLOYMENT STATUS PR — fresh stub state for one run of the script.
reset_stub() {
  rm -rf "$work/stub" "$work/out"
  mkdir -p "$work/stub"
  printf '%s' "$1" > "$work/stub/deployment"
  printf '%s' "$2" > "$work/stub/status"
  printf '%s' "$3" > "$work/stub/pr"
}

# run_accept [ARG...] — run the script against the stub, leaving combined output in $out and the
# exit status in $status.
run_accept() {
  out=$(PATH="$work/bin:$PATH" STUB_DIR="$work/stub" OURO_ACCEPT_URL=http://rest.test \
    OURO_ACCEPT_SESSION=$SESSION OURO_ACCEPT_ISSUE_ID=issue-1 OURO_ACCEPT_ISSUE_NUMBER=7 \
    OURO_ACCEPT_CONNECTION=conn-1 OURO_ACCEPT_PROVIDER_KEY=$KEY \
    "$ACCEPT" --out "$work/out" --poll 1 --timeout 30 "$@" 2>&1)
  status=$?
}

printf 'live-slice-acceptance.sh\n'

# --- a run that opens its draft pull request ------------------------------------------------------
reset_stub true review 12
run_accept
check_equals 0 "$status" 'a run that opens its draft pull request exits zero'
report=$(ls "$work/out"/live-slice-*.md 2> /dev/null | head -n 1)
check_exists "${report:-$work/out/none}" 'the dated report is written'
check_matches "$(cat "$work/stub/calls")" 'POST /api/v1/providers/conn-1/rotate' \
  'the key is stored through rotate'
check_equals 'GET /api/v1/loop/capabilities' "$(head -n 1 "$work/stub/calls")" \
  'the deployment is asked first'
check_matches "$(tr '\n' ' ' < "$work/stub/calls")" \
  'rotate .*backlog/queue .*queue/q1/confirm .*runs/11111111' \
  'it rotates, queues, confirms, then reads the run'
check_contains "$work/stub/config" "$SESSION" 'the session reaches curl through its config file'
check_not_matches "$(cat "$work/stub/argv")" "$SESSION" 'the session never reaches argv'
check_not_matches "$(cat "$work/stub/argv")" "$KEY" 'the key never reaches argv'
check_contains "$work/stub/bodies" "$KEY" 'the key is sent in the rotate body'
check_not_matches "$out" "$SESSION|$KEY" 'neither secret is printed'
check_not_matches "$(cat "$report")" "$SESSION|$KEY" 'neither secret is in the report'
check_contains "$report" 'draft pull request opened' 'the report states the outcome'
check_contains "$report" 'https://github.com/NobuData/ouroboros-sample/pull/12' \
  'the report carries the pull request URL'
check_contains "$report" '\| Model turns \| 3 \(plan 1 · implement 2\) \|' \
  'turns are the model entries of every transcript page, by stage'
check_contains "$report" '\| Tokens \| 5200 \(4000 in, 1200 out\) \|' 'the report carries the tokens'
check_contains "$report" '\$0\.0325 \(0 unpriced events\)' 'the report carries the cost in dollars'
check_contains "$report" '`claude-sonnet-5-5`' 'the report carries the model alias'
check_contains "$report" '#4 succeeded on r1' 'the report carries the build'
check_not_matches "$(cat "$report")" '\{\{' 'every placeholder is filled'

# --- a second report the same day does not overwrite the first -------------------------------------
mkdir -p "$work/keep"
cp "$report" "$work/keep/first.md"
reset_stub true review 12
mkdir -p "$work/out"
cp "$work/keep/first.md" "$work/out/$(basename "$report")"
run_accept
check_equals 2 "$(ls "$work/out"/live-slice-*.md | wc -l | tr -d ' ')" \
  'a second run the same day writes a second report'

# --- a run that stops -----------------------------------------------------------------------------
reset_stub true failed null
run_accept
check_equals 1 "$status" 'a failed run exits one'
check_contains "$(ls "$work/out"/live-slice-*.md)" 'the run stopped: failed' \
  'the report says the run stopped'

# --- a run that never opens a pull request in time ------------------------------------------------
reset_stub true review null
run_accept --timeout 2
check_equals 1 "$status" 'a run with no pull request by the deadline exits one'
check_contains "$(ls "$work/out"/live-slice-*.md)" 'timed out' 'the report says it timed out'

# --- a deployment that does not allow live runs ---------------------------------------------------
reset_stub false review 12
run_accept
check_equals 2 "$status" 'a deployment with live execution off exits two'
check_matches "$out" 'does not allow live runs' 'it says why'
check_not_matches "$(cat "$work/stub/calls")" 'backlog/queue|rotate' 'nothing is stored or queued'

# --- inputs ---------------------------------------------------------------------------------------
reset_stub true review 12
out=$(PATH="$work/bin:$PATH" STUB_DIR="$work/stub" OURO_ACCEPT_ISSUE_ID=issue-1 \
  OURO_ACCEPT_ISSUE_NUMBER=7 "$ACCEPT" --out "$work/out" 2>&1)
status=$?
check_equals 2 "$status" 'a missing session exits two'
check_matches "$out" 'OURO_ACCEPT_SESSION' 'it names the missing variable'
check_missing "$work/stub/calls" 'and calls nothing'

out=$(PATH="$work/bin:$PATH" STUB_DIR="$work/stub" OURO_ACCEPT_SESSION=$SESSION \
  OURO_ACCEPT_ISSUE_ID=issue-1 OURO_ACCEPT_ISSUE_NUMBER=7 OURO_ACCEPT_CONNECTION=conn-1 \
  OURO_ACCEPT_URL=http://rest.test "$ACCEPT" --out "$work/out" 2>&1)
status=$?
check_equals 2 "$status" 'a connection without a key exits two'

out=$("$ACCEPT" --help 2>&1)
status=$?
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'Usage:' '--help prints the usage'
check_not_matches "$out" '^#' '--help strips the comment markers'

check_summary
