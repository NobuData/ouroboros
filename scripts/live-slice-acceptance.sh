#!/usr/bin/env sh
#
# live-slice-acceptance.sh — the live slice against a real provider, recorded as a dated report.
#
# The e2e leg (tests/e2e/specs/live-loop.spec.ts, DI.6 #1321) proves the path from an issue to a
# draft pull request against a recorded provider fixture. This is the same path with a real model:
# a person runs it with their own API key, against a deployment they run, on the sample repository
# (DL.1 #1320, NobuData/ouroboros-sample). It queues one issue, confirms it for a live run, waits
# for the run to open its draft pull request (or to stop), and writes what happened into
# docs/acceptance/live-slice-<date>.md: the duration, the model turns, the tokens, the cost and
# the pull request's URL. It is not run in CI — it spends money and pushes to a public repository.
#
# It talks to the REST service the way the UI does, with the person's own session. It never
# prints, logs or stores the session or the API key: both are read from the environment, handed
# to curl through a file only this user can read, and that file is removed on exit.
#
# Before running it:
#   1. The deployment allows live execution (OURO_LIVE_EXECUTION_ENABLED=true).
#   2. The workspace mirrors the sample repository, has a GitHub token that can push to it, a
#      published workflow on it, dry-run policy on, and a runner online in the workflow's pool.
#   3. That workspace is the active one in the browser the session cookie is copied from
#      (the `better-auth.session_token` cookie of the UI's origin).
#
# Environment:
#   OURO_ACCEPT_SESSION        required  the session cookie's value
#   OURO_ACCEPT_ISSUE_ID       required  the mirrored issue's id (the backlog's row)
#   OURO_ACCEPT_ISSUE_NUMBER   required  its number in the repository
#   OURO_ACCEPT_URL            optional  the REST service, default http://localhost:4000
#   OURO_ACCEPT_CONNECTION     optional  a provider connection id; with the key below, the key is
#   OURO_ACCEPT_PROVIDER_KEY   optional  stored on it through *rotate* before anything is queued
#
# Usage:
#   scripts/live-slice-acceptance.sh                 # run, write docs/acceptance/live-slice-<date>.md
#   scripts/live-slice-acceptance.sh --out DIR       # write the report elsewhere
#   scripts/live-slice-acceptance.sh --timeout SECS  # give the run longer than 1800 s
#   scripts/live-slice-acceptance.sh --poll SECS     # read the run every SECS (default 10)
#
# Exit status:
#   0  the run opened its draft pull request; the report is written
#   1  the run stopped, or did not open one in time; the report is written and says so
#   2  a missing input, a refused request, or a deployment that does not allow live runs

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")

OUT="$ROOT/docs/acceptance"
TEMPLATE="$ROOT/docs/acceptance/live-slice-report.template.md"
TIMEOUT=1800
POLL=10

say() { printf 'live-slice-acceptance: %s\n' "$*" >&2; }
die() { say "$*"; exit 2; }

while [ $# -gt 0 ]; do
  case $1 in
    --out)
      [ $# -ge 2 ] || die '--out needs a directory'
      OUT=$2
      shift 2
      ;;
    --timeout)
      [ $# -ge 2 ] || die '--timeout needs a number of seconds'
      TIMEOUT=$2
      shift 2
      ;;
    --poll)
      [ $# -ge 2 ] || die '--poll needs a number of seconds'
      POLL=$2
      shift 2
      ;;
    -h|--help)
      sed -n '2,/^$/s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    *)
      die "unknown argument: $1 (see --help)"
      ;;
  esac
done

case $TIMEOUT in ''|*[!0-9]*) die '--timeout must be a whole number of seconds' ;; esac
case $POLL in ''|*[!0-9]*|0) die '--poll must be a positive whole number of seconds' ;; esac

: "${OURO_ACCEPT_SESSION:?set OURO_ACCEPT_SESSION to the session cookie value}"
: "${OURO_ACCEPT_ISSUE_ID:?set OURO_ACCEPT_ISSUE_ID to the mirrored issue id}"
: "${OURO_ACCEPT_ISSUE_NUMBER:?set OURO_ACCEPT_ISSUE_NUMBER to the issue number}"
URL=${OURO_ACCEPT_URL:-http://localhost:4000}
CONNECTION=${OURO_ACCEPT_CONNECTION:-}
ISSUE_ID=$OURO_ACCEPT_ISSUE_ID
ISSUE_NUMBER=$OURO_ACCEPT_ISSUE_NUMBER

case $ISSUE_NUMBER in ''|*[!0-9]*) die 'OURO_ACCEPT_ISSUE_NUMBER must be a number' ;; esac
command -v curl > /dev/null 2>&1 || die 'curl is required'
command -v node > /dev/null 2>&1 || die 'node is required (it reads the JSON answers)'
[ -f "$TEMPLATE" ] || die "the report template is missing: $TEMPLATE"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# The session reaches curl through a config file only this user can read, never through argv.
(
  umask 077
  printf 'header = "cookie: better-auth.session_token=%s"\n' "$OURO_ACCEPT_SESSION" > "$work/curl.cfg"
)

# api METHOD PATH [BODY_FILE] — call the service; the answer lands in $work/body and its status
# code in $code. A body is sent from a file, so a secret in it never reaches argv.
api() {
  if [ $# -ge 3 ]; then
    code=$(curl -sS -K "$work/curl.cfg" -X "$1" -H 'content-type: application/json' \
      --data-binary "@$3" -o "$work/body" -w '%{http_code}' "$URL$2") || code=000
  else
    code=$(curl -sS -K "$work/curl.cfg" -X "$1" -o "$work/body" -w '%{http_code}' "$URL$2") ||
      code=000
  fi
}

# expect_ok WHAT — stop with the service's answer unless the last call succeeded.
expect_ok() {
  case $code in
    2??) ;;
    *) die "$1 answered $code: $(head -c 400 "$work/body" 2> /dev/null || true)" ;;
  esac
}

# js EXPRESSION FILE... — evaluate EXPRESSION with `d` bound to the first file's JSON and `f` to
# every file's, printing what it returns (strings bare, everything else as JSON).
js() {
  EXPR=$1
  export EXPR
  shift
  node -e '
    const fs = require("fs");
    const f = process.argv.slice(1).map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
    const d = f[0];
    const v = new Function("d", "f", "return (" + process.env.EXPR + ");")(d, f);
    if (v !== undefined && v !== null) process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
  ' "$@"
}

# slice_runs FILE — every run of the issue, active and terminal, as one JSON array in FILE.
slice_runs() {
  api GET '/api/v1/runs?status=active&limit=100'
  expect_ok 'listing active runs'
  cp "$work/body" "$work/active.json"
  api GET '/api/v1/runs?status=terminal&limit=100'
  expect_ok 'listing terminal runs'
  js "f[0].items.concat(f[1].items).filter((r) => r.issueNumber === $ISSUE_NUMBER)" \
    "$work/active.json" "$work/body" > "$1"
}

# --- the deployment allows live runs ------------------------------------------------------------
api GET /api/v1/loop/capabilities
expect_ok 'reading the loop capabilities'
[ "$(js 'd.deploymentEnabled' "$work/body")" = true ] ||
  die 'this deployment does not allow live runs (OURO_LIVE_EXECUTION_ENABLED is off)'

# --- the provider key, through rotate -----------------------------------------------------------
if [ -n "$CONNECTION" ] && [ -n "${OURO_ACCEPT_PROVIDER_KEY:-}" ]; then
  (
    umask 077
    SECRET=$OURO_ACCEPT_PROVIDER_KEY node -e \
      'process.stdout.write(JSON.stringify({ secret: process.env.SECRET }))' > "$work/key.json"
  )
  api POST "/api/v1/providers/$CONNECTION/rotate" "$work/key.json"
  rm -f "$work/key.json"
  expect_ok 'storing the provider key'
  say 'stored the provider key on the connection'
elif [ -n "$CONNECTION" ] || [ -n "${OURO_ACCEPT_PROVIDER_KEY:-}" ]; then
  die 'OURO_ACCEPT_CONNECTION and OURO_ACCEPT_PROVIDER_KEY go together'
fi

# --- queue and confirm --------------------------------------------------------------------------
slice_runs "$work/before.json"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
start_s=$(date +%s)

printf '{"issueIds":["%s"]}\n' "$ISSUE_ID" > "$work/queue.json"
api POST /api/v1/backlog/queue "$work/queue.json"
case $code in
  2??) say "queued issue #$ISSUE_NUMBER" ;;
  409) say "issue #$ISSUE_NUMBER was already queued" ;;
  *) expect_ok 'queueing the issue' ;;
esac

api GET '/api/v1/queue?limit=100'
expect_ok 'reading the queue'
item=$(js "(d.items.find((i) => i.issueNumber === $ISSUE_NUMBER) || {}).id" "$work/body")
[ -n "$item" ] || die "issue #$ISSUE_NUMBER is not in the queue"
if [ "$(js "d.items.find((i) => i.id === '$item').confirmedAt === null" "$work/body")" = true ]; then
  printf '{}\n' > "$work/empty.json"
  api POST "/api/v1/queue/$item/confirm" "$work/empty.json"
  expect_ok 'confirming the queue item for a live run'
  say 'confirmed the queue item for a live run'
fi

# --- wait for the run, then for its draft pull request ------------------------------------------
deadline=$((start_s + TIMEOUT))
run=''
status=''
said=''
while :; do
  if [ -z "$run" ]; then
    slice_runs "$work/now.json"
    run=$(js 'f[1].find((r) => !f[0].some((b) => b.id === r.id) && r.origin === "live")?.id' \
      "$work/before.json" "$work/now.json")
    if [ -n "$run" ]; then
      say "run $run opened"
    else
      api GET '/api/v1/queue?limit=100'
      expect_ok 'reading the queue'
      why=$(js "(d.items.find((i) => i.issueNumber === $ISSUE_NUMBER)?.waiting || {}).reason" \
        "$work/body")
      [ -z "$why" ] || [ "$why" = "$said" ] || say "the item waits: $why"
      said=$why
    fi
  fi
  if [ -n "$run" ]; then
    api GET "/api/v1/runs/$run"
    expect_ok 'reading the run'
    cp "$work/body" "$work/run.json"
    now=$(js 'd.run.status + (d.run.prNumber === null ? "" : "+pr")' "$work/run.json")
    [ "$now" = "$status" ] || say "run is $now"
    status=$now
    case $status in
      *+pr|merged) outcome=pr_opened; break ;;
      needs_human|failed|canceled) outcome=$status; break ;;
    esac
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    outcome=timed_out
    break
  fi
  sleep "$POLL"
done
finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)
elapsed=$(($(date +%s) - start_s))

# --- what the run cost, said and opened ---------------------------------------------------------
printf '{}\n' > "$work/pulls.json"
printf '[]\n' > "$work/events.json"
[ -f "$work/run.json" ] || printf '{}\n' > "$work/run.json"
if [ -n "$run" ]; then
  api GET "/api/v1/pull-requests?runId=$run"
  expect_ok "reading the run's pull request"
  cp "$work/body" "$work/pulls.json"
  after=0
  while :; do
    api GET "/api/v1/runs/$run/events?after=$after&limit=500"
    expect_ok "reading the run's transcript"
    js 'f[0].concat(f[1].entries)' "$work/events.json" "$work/body" > "$work/events.next"
    mv "$work/events.next" "$work/events.json"
    [ "$(js 'd.hasMore' "$work/body")" = true ] || break
    after=$(js 'd.nextAfter' "$work/body")
  done
fi

mkdir -p "$OUT"
day=$(date -u +%Y-%m-%d)
report="$OUT/live-slice-$day.md"
n=2
while [ -e "$report" ]; do
  report="$OUT/live-slice-$day-$n.md"
  n=$((n + 1))
done

STARTED=$started FINISHED=$finished ELAPSED=$elapsed OUTCOME=$outcome RUN_ID=$run \
  ISSUE_NUMBER=$ISSUE_NUMBER DAY=$day node -e '
    const fs = require("fs");
    const [template, runPath, eventsPath, pullsPath] = process.argv.slice(1);
    const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
    const env = process.env;
    const run = read(runPath);
    const events = read(eventsPath);
    const pull = (read(pullsPath).items || [])[0];
    const summary = run.run || {};
    const res = run.resources || {};
    const turns = events.filter((e) => e.actor === "model");
    const perStage = {};
    for (const t of turns) perStage[t.stageKey] = (perStage[t.stageKey] || 0) + 1;
    const models = [...new Set(turns.map((t) => t.modelId).filter(Boolean))];
    const cents = res.cost && res.cost.costCents !== null ? Number(res.cost.costCents) : null;
    const none = "—";
    const values = {
      date: env.DAY,
      outcome: {
        pr_opened: "✅ draft pull request opened",
        timed_out: "❌ timed out before a draft pull request",
      }[env.OUTCOME] || "❌ the run stopped: " + env.OUTCOME,
      started: env.STARTED,
      finished: env.FINISHED,
      duration: env.ELAPSED + " s",
      issue: "#" + env.ISSUE_NUMBER + (summary.issueTitle ? " — " + summary.issueTitle : ""),
      run_id: env.RUN_ID || none,
      run_status: summary.status || none,
      wall_clock: res.wallClock ? res.wallClock.elapsedSeconds + " s" : none,
      model_alias: summary.model || none,
      route: (res.cost && res.cost.routeTag) || none,
      models: models.length ? models.join(", ") : none,
      turns: String(turns.length),
      turns_by_stage: Object.keys(perStage).length
        ? Object.entries(perStage).map(([k, n]) => k + " " + n).join(" · ")
        : none,
      tokens_in: res.tokens ? String(res.tokens.tokensIn) : none,
      tokens_out: res.tokens ? String(res.tokens.tokensOut) : none,
      tokens: res.tokens ? String(res.tokens.used) : none,
      cost: cents === null ? "unpriced" : "$" + (cents / 100).toFixed(4),
      unpriced: res.cost ? String(res.cost.unpricedEvents) : none,
      build: res.farm && res.farm.jobNumber !== null
        ? "#" + res.farm.jobNumber + " " + res.farm.jobStatus + " on " + res.farm.runnerName
        : none,
      pr_url: pull ? pull.url : none,
      pr_draft: pull ? String(pull.draft) : none,
      pr_branch: pull ? pull.headBranch : none,
    };
    process.stdout.write(
      fs.readFileSync(template, "utf8").replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m)),
    );
  ' "$TEMPLATE" "$work/run.json" "$work/events.json" "$work/pulls.json" > "$report"

say "wrote ${report#"$ROOT"/}"
[ "$outcome" = pr_opened ]
