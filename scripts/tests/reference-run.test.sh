#!/usr/bin/env sh
#
# reference-run.test.sh — integration tests for scripts/reference-run.sh (DL.2, #1326).
#
# The script brings up a stack and drives it through its REST API. These tests put a stub `curl`
# and a stub `docker` first on PATH — shell scripts that answer from canned JSON and log what they
# were asked — so they cover the script's own decisions without Docker or a deployment: what it
# refuses before anything comes up, the order of the setup, that no secret reaches argv or the
# output, that it stops before queueing when the loop is not ready, and that the export is whole.
# The real path is exercised against the e2e stand-ins by `reference-run.sh --fixture` in CI.
#
# Usage:
#   scripts/tests/reference-run.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
REFERENCE="$SCRIPTS_DIR/reference-run.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
mkdir -p "$work/bin"

KEY='sk-ant-api03-reference-key-that-must-not-leak'
GHTOKEN='ghp_reference_token_that_must_not_leak_000000'
ENROLL='orb_enroll_token_that_must_not_leak'
SERVICE='orb_svc_token_that_must_not_leak'
RUN='11111111-2222-4333-8444-555555555555'
ISSUE_ID='22222222-3333-4444-8555-666666666666'

# The stub curl. Each call is logged as "METHOD URL-PATH" in $STUB_DIR/calls, its arguments in
# $STUB_DIR/argv, any config file in $STUB_DIR/config and any body in $STUB_DIR/bodies. The files
# $STUB_DIR/push (true/false) and $STUB_DIR/ready (true/false) steer the two answers the tests
# vary; the stack's own port answers only once the stub docker has brought it up.
cat > "$work/bin/curl" << 'STUB'
#!/usr/bin/env sh
method=GET out='' url='' data='' fail=0 write=0
while [ $# -gt 0 ]; do
  printf '%s\n' "$1" >> "$STUB_DIR/argv"
  case $1 in
    -X) method=$2; shift ;;
    -o) out=$2; shift ;;
    -K) cat "$2" >> "$STUB_DIR/config"; shift ;;
    --data-binary) data=${2#@}; shift ;;
    -w) write=1; shift ;;
    -H) shift ;;
    -fsS) fail=1 ;;
    http*) url=$1 ;;
  esac
  shift
done
path=${url#http://localhost:4000}
path=${path#https://api.github.com}
printf '%s %s\n' "$method" "$path" >> "$STUB_DIR/calls"
[ -z "$data" ] || { cat "$data" >> "$STUB_DIR/bodies"; printf '\n' >> "$STUB_DIR/bodies"; }
if [ "$fail" = 1 ] && [ ! -e "$STUB_DIR/up" ]; then exit 7; fi
code=200
run=11111111-2222-4333-8444-555555555555
summary="{\"id\":\"$run\",\"issueNumber\":3,\"issueTitle\":\"greet\",\"model\":\"slice-coder\",\"status\":\"review\",\"prNumber\":12,\"origin\":\"live\"}"
case "$method $path" in
  'GET /repos/me/sample') body="{\"full_name\":\"me/sample\",\"permissions\":{\"push\":$(cat "$STUB_DIR/push")}}" ;;
  'GET /api/v1') body='{"version":"0.43.6"}' ;;
  'POST /api/auth/organization/create') body='{"id":"org-1"}' ;;
  'POST /api/v1/sources') code=201; body='{"id":"src-1"}' ;;
  'POST /api/v1/backlog/sync') code=202; body='{}' ;;
  'GET /api/v1/backlog?repo=me/sample&limit=100')
    body='{"items":[{"id":"22222222-3333-4444-8555-666666666666","number":3,"sizingStatus":"sized"}]}' ;;
  'POST /api/v1/providers') code=201; body='{"id":"conn-1"}' ;;
  'GET /api/v1/farm/enroll-command?pool=pool-a')
    body='{"command":"curl -fsSL https://farm-gateway/install.sh | sh -s -- --token orb_enroll_token_that_must_not_leak"}' ;;
  'GET /api/v1/farm') body='{"runners":[{"pool":"pool-a","status":"online"}]}' ;;
  'POST /api/v1/workflows') code=201; body='{"id":"wf-1"}' ;;
  'GET /api/v1/loop/readiness?repository=me/sample&workflow=live-slice&issue=3')
    if [ "$(cat "$STUB_DIR/ready")" = true ]; then
      body='{"ready":true,"checks":[]}'
    else
      body='{"ready":false,"checks":[{"id":"runner","state":"fail","reason":"No runner is online in pool-a."}]}'
    fi ;;
  'GET /api/v1/runs?status=active&limit=100') body='{"items":[]}' ;;
  'GET /api/v1/runs?status=terminal&limit=100')
    if [ -e "$STUB_DIR/listed" ]; then body="{\"items\":[$summary]}"; else body='{"items":[]}'; fi
    : > "$STUB_DIR/listed" ;;
  'POST /api/v1/backlog/queue') code=201; body='{"items":[]}' ;;
  'GET /api/v1/queue?limit=100') body='{"items":[{"id":"q1","issueNumber":3,"confirmedAt":null,"waiting":null}]}' ;;
  "GET /api/v1/runs/$run")
    body="{\"run\":$summary,\"timeline\":{\"stages\":[{\"stageKey\":\"build\",\"build\":{\"jobId\":\"job-1\"}}]}}" ;;
  'POST /api/v1/settings/service-accounts') code=201; body='{"id":"svc-1","token":"orb_svc_token_that_must_not_leak"}' ;;
  "GET /api/v1/pull-requests?runId=$run") body='{"items":[{"url":"https://github.com/me/sample/pull/12","draft":true}]}' ;;
  "GET /api/v1/runs/$run/events?after=0&limit=500") body='{"entries":[{"actor":"model"}],"hasMore":false,"nextAfter":1}' ;;
  "GET /api/v1/runs/$run/transcript.jsonl") body='{"seq":1,"actor":"model"}' ;;
  'GET /api/v1/farm/jobs/job-1/log?after=0') body='{"bytes":"sh tests/check.sh\nok\n","nextOffset":20,"end":20}' ;;
  'GET /api/v1/engine/status') body='{"engine":"up","version":"0.7.50"}' ;;
  *) body='{}' ;;
esac
if [ -n "$out" ] && [ "$out" != /dev/null ]; then printf '%s' "$body" > "$out"; fi
[ "$write" = 0 ] || printf '%s' "$code"
STUB
chmod +x "$work/bin/curl"

# The stub docker. Compose calls are logged in $STUB_DIR/docker; `up` marks the stack up; psql
# answers a connection id to an insert … returning id and one CSV row to a copy; what is piped to
# the build machine is kept in $STUB_DIR/machine.
cat > "$work/bin/docker" << 'STUB'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "$STUB_DIR/docker"
case " $* " in
  *' compose version'*) exit 0 ;;
  *' up '*) : > "$STUB_DIR/up" ;;
  *' exec -T db '*)
    case "$*" in
      *'returning id'*) printf 'conn-1\n' ;;
      *'copy ('*) printf '2026-10-23 12:00:00+00,implement,1,slice-coder,claude-sonnet-4-5-20250929,4000,1200,3.25\n' ;;
    esac ;;
  *' exec -T runner '*) cat > "$STUB_DIR/machine" ;;
  *' images '*) printf '[]\n' ;;
esac
exit 0
STUB
chmod +x "$work/bin/docker"

# reset_stub PUSH READY — fresh stub state for one run of the script.
reset_stub() {
  rm -rf "$work/stub" "$work/out"
  mkdir -p "$work/stub"
  printf '%s' "$1" > "$work/stub/push"
  printf '%s' "$2" > "$work/stub/ready"
}

# run_reference [ARG...] — a real-mode run on me/sample#3 against the stubs; combined output in
# $out, exit status in $status.
run_reference() {
  out=$(PATH="$work/bin:$PATH" STUB_DIR="$work/stub" OURO_REF_PROVIDER_KEY=$KEY \
    GITHUB_TOKEN=$GHTOKEN "$REFERENCE" --repo me/sample --issue 3 --yes --allow-dirty \
    --out "$work/out" --poll 1 --timeout 30 "$@" 2>&1)
  status=$?
}

printf 'reference-run.sh\n'

# --- a run that opens its draft pull request ------------------------------------------------------
reset_stub true true
run_reference
calls=$(tr '\n' ' ' < "$work/stub/calls")
check_equals 0 "$status" 'a run that opens its draft pull request exits zero'
check_equals 'GET /repos/me/sample' "$(head -n 1 "$work/stub/calls")" \
  'GitHub is asked about the repository before anything else'
check_matches "$calls" \
  'organization/create .*settings/github-token .*api/v1/sources .*backlog/sync .*api/v1/providers .*registry/aliases .*routing/routes/plan .*farm/pools .*api/v1/workflows .*policies/dry-run .*loop/readiness.*backlog/queue .*queue/q1/confirm' \
  'it sets the workspace up in order, checks readiness, then queues and confirms'
check_contains "$work/stub/bodies" '"maxCostCentsPerRun":200' 'the routes carry the default cap'
check_contains "$work/stub/bodies" '"workflow":"live-slice"' 'the issue is queued under live-slice'
check_contains "$work/stub/docker" 'docker-compose.reference.yml' 'a real run uses the reference overlay'
check_contains "$work/stub/docker" 'ouroboros.task_kinds' 'the two task kinds are inserted'
check_contains "$work/stub/machine" "$ENROLL" 'the enroll command reaches the machine on stdin'
check_not_matches "$(cat "$work/stub/argv" "$work/stub/docker")" "$KEY|$GHTOKEN|$ENROLL|$SERVICE" \
  'no secret reaches argv'
check_not_matches "$out" "$KEY|$GHTOKEN|$ENROLL|$SERVICE" 'no secret is printed'
check_contains "$work/stub/config" "$SERVICE" 'the export reads with the service-account token'
check_contains "$work/stub/docker" ' down ' 'the stack is taken down afterwards'
for file in run.jsonl usage.csv farm-job.log pr-url.txt manifest.json; do
  check_exists "$work/out/$file" "the export holds $file"
done
check_contains "$work/out/pr-url.txt" 'https://github.com/me/sample/pull/12' 'pr-url.txt carries the URL'
check_contains "$work/out/farm-job.log" 'sh tests/check.sh' 'farm-job.log carries the job log'
check_contains "$work/out/usage.csv" 'claude-sonnet-4-5-20250929,4000,1200,3.25' 'usage.csv carries the metered rows'
check_contains "$work/out/run.jsonl" '"actor":"model"' 'run.jsonl carries the transcript'
check_contains "$work/out/manifest.json" '"ouroboros-rest": "0.43.6"' 'the manifest pins the REST version'
check_contains "$work/out/manifest.json" '"ouroboros-engine": "0.7.50"' 'the manifest pins the engine version'
check_contains "$work/out/manifest.json" '"slice-coder": "claude-sonnet-4-5-20250929"' \
  "the manifest names an alias's concrete model"
check_contains "$work/out/manifest.json" 'model output differs' 'the manifest says the output will differ'
check_not_matches "$(cat "$work/out"/*)" "$KEY|$GHTOKEN|$ENROLL|$SERVICE" 'no secret is in the export'

# --- --keep leaves the stack up -------------------------------------------------------------------
reset_stub true true
run_reference --keep
check_not_matches "$(cat "$work/stub/docker")" ' down ' '--keep leaves the stack up'

# --- a repository the token cannot push to --------------------------------------------------------
reset_stub false true
run_reference
check_equals 2 "$status" 'a repository the token cannot push to exits two'
check_matches "$out" 'cannot push to me/sample' 'it says why'
check_not_matches "$(cat "$work/stub/docker")" ' up ' 'and no stack comes up'

# --- a loop that is not ready ---------------------------------------------------------------------
reset_stub true false
run_reference
check_equals 2 "$status" 'a loop that is not ready exits two'
check_matches "$out" 'No runner is online in pool-a' 'it lists what blocks'
check_not_matches "$(cat "$work/stub/calls")" 'backlog/queue' 'and queues nothing'

# --- inputs ---------------------------------------------------------------------------------------
reset_stub true true
out=$(PATH="$work/bin:$PATH" STUB_DIR="$work/stub" OURO_REF_PROVIDER_KEY=$KEY GITHUB_TOKEN=$GHTOKEN \
  "$REFERENCE" --issue 3 2>&1)
status=$?
check_equals 2 "$status" 'no --repo exits two'
check_matches "$out" '--repo is required' 'it never defaults the repository'
check_missing "$work/stub/calls" 'and calls nothing'

out=$(PATH="$work/bin:$PATH" STUB_DIR="$work/stub" "$REFERENCE" --repo me/sample --issue 3 --fixture 2>&1)
status=$?
check_equals 2 "$status" '--fixture on another repository exits two'
check_matches "$out" 'recording made on acme-robotics/helios-greeter#1' 'it names the recorded slice'

out=$(PATH="$work/bin:$PATH" STUB_DIR="$work/stub" env -u ANTHROPIC_API_KEY -u OURO_REF_PROVIDER_KEY \
  GITHUB_TOKEN=$GHTOKEN "$REFERENCE" --repo me/sample --issue 3 2>&1)
status=$?
check_equals 2 "$status" 'a missing provider key exits two'

out=$("$REFERENCE" --help 2>&1)
status=$?
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'Usage:' '--help prints the usage'

check_summary
