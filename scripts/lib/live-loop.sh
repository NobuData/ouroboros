# live-loop.sh — the live loop's REST helpers, shared by the scripts that drive it.
#
# Sourced, never run. One implementation of what both scripts/live-slice-acceptance.sh (DI.6,
# #1321) and scripts/reference-run.sh (DL.2, #1326) do against a deployment: call the API without
# a secret reaching argv, read the JSON answers, queue and confirm one issue for a live run, wait
# for its draft pull request, and collect what the run said and opened.
#
# Before sourcing, set:
#   LL_NAME   the calling script's name, for messages
#   LL_URL    the REST service, e.g. http://localhost:4000
#   LL_WORK   a private scratch directory (mode 700), removed by the caller
# and write the credential header into "$LL_WORK/curl.cfg" with ll_auth_cookie or ll_auth_bearer.
#
# Every function reports through say/die; die exits 2.

say() { printf '%s: %s\n' "$LL_NAME" "$*" >&2; }
die() { say "$*"; exit 2; }

# ll_auth_cookie VALUE [NAME] — authenticate as a person: the session cookie, through a config
# file only this user can read, never argv. NAME defaults to better-auth.session_token. Cookie
# requests that write also send an Origin, which BetterAuth requires (OURO_CORS_ORIGINS).
ll_auth_cookie() {
  (
    umask 077
    printf 'header = "cookie: %s=%s"\n' "${2:-better-auth.session_token}" "$1" > "$LL_WORK/curl.cfg"
    printf 'header = "origin: %s"\n' "${LL_ORIGIN:-http://localhost:3000}" >> "$LL_WORK/curl.cfg"
  )
}

# ll_auth_bearer TOKEN — authenticate as a service account (Authorization: Bearer).
ll_auth_bearer() {
  (
    umask 077
    printf 'header = "authorization: Bearer %s"\n' "$1" > "$LL_WORK/curl.cfg"
  )
}

# api METHOD PATH [BODY_FILE] — call the service; the answer lands in $LL_WORK/body and its status
# code in $code. A body is sent from a file, so a secret in it never reaches argv.
api() {
  if [ $# -ge 3 ]; then
    code=$(curl -sS -K "$LL_WORK/curl.cfg" -X "$1" -H 'content-type: application/json' \
      --data-binary "@$3" -o "$LL_WORK/body" -w '%{http_code}' "$LL_URL$2") || code=000
  else
    code=$(curl -sS -K "$LL_WORK/curl.cfg" -X "$1" -o "$LL_WORK/body" -w '%{http_code}' "$LL_URL$2") ||
      code=000
  fi
}

# expect_ok WHAT — stop with the service's answer unless the last call succeeded.
expect_ok() {
  case $code in
    2??) ;;
    *) die "$1 answered $code: $(head -c 400 "$LL_WORK/body" 2> /dev/null || true)" ;;
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

# json_body FILE KEY=ENVVAR... — write a JSON object to FILE whose KEY is the value of the named
# environment variable, so a secret goes from the environment to a private file, never argv.
json_body() {
  out=$1
  shift
  (
    umask 077
    node -e '
      const o = {};
      for (const pair of process.argv.slice(1)) {
        const [k, v] = pair.split("=");
        o[k] = process.env[v] ?? "";
      }
      process.stdout.write(JSON.stringify(o));
    ' "$@" > "$out"
  )
}

# ll_runs_of ISSUE_NUMBER FILE — every run of the issue, active and terminal, as a JSON array.
ll_runs_of() {
  api GET '/api/v1/runs?status=active&limit=100'
  expect_ok 'listing active runs'
  cp "$LL_WORK/body" "$LL_WORK/active.json"
  api GET '/api/v1/runs?status=terminal&limit=100'
  expect_ok 'listing terminal runs'
  js "f[0].items.concat(f[1].items).filter((r) => r.issueNumber === $1)" \
    "$LL_WORK/active.json" "$LL_WORK/body" > "$2"
}

# ll_queue_confirm ISSUE_ID ISSUE_NUMBER [WORKFLOW] — queue the issue (an issue already queued is
# fine) and confirm its queue item for a live run. Sets $ll_item to the queue item's id.
ll_queue_confirm() {
  if [ -n "${3:-}" ]; then
    printf '{"issueIds":["%s"],"workflow":"%s"}\n' "$1" "$3" > "$LL_WORK/queue.json"
  else
    printf '{"issueIds":["%s"]}\n' "$1" > "$LL_WORK/queue.json"
  fi
  api POST /api/v1/backlog/queue "$LL_WORK/queue.json"
  case $code in
    2??) say "queued issue #$2" ;;
    409) say "issue #$2 was already queued" ;;
    *) expect_ok 'queueing the issue' ;;
  esac

  api GET '/api/v1/queue?limit=100'
  expect_ok 'reading the queue'
  ll_item=$(js "(d.items.find((i) => i.issueNumber === $2) || {}).id" "$LL_WORK/body")
  [ -n "$ll_item" ] || die "issue #$2 is not in the queue"
  if [ "$(js "d.items.find((i) => i.id === '$ll_item').confirmedAt === null" "$LL_WORK/body")" = true ]; then
    printf '{}\n' > "$LL_WORK/empty.json"
    api POST "/api/v1/queue/$ll_item/confirm" "$LL_WORK/empty.json"
    expect_ok 'confirming the queue item for a live run'
    say 'confirmed the queue item for a live run'
  fi
}

# ll_wait ISSUE_NUMBER BEFORE_FILE DEADLINE POLL — wait for a new live run of the issue to open
# its draft pull request, or to stop. Sets $ll_run (the run id, or empty) and $ll_outcome
# (pr_opened, needs_human, failed, canceled or timed_out); the last run read is $LL_WORK/run.json.
ll_wait() {
  ll_run=''
  status=''
  said=''
  while :; do
    if [ -z "$ll_run" ]; then
      ll_runs_of "$1" "$LL_WORK/now.json"
      ll_run=$(js 'f[1].find((r) => !f[0].some((b) => b.id === r.id) && r.origin === "live")?.id' \
        "$2" "$LL_WORK/now.json")
      if [ -n "$ll_run" ]; then
        say "run $ll_run opened"
      else
        api GET '/api/v1/queue?limit=100'
        expect_ok 'reading the queue'
        why=$(js "(d.items.find((i) => i.issueNumber === $1)?.waiting || {}).reason" "$LL_WORK/body")
        [ -z "$why" ] || [ "$why" = "$said" ] || say "the item waits: $why"
        said=$why
      fi
    fi
    if [ -n "$ll_run" ]; then
      api GET "/api/v1/runs/$ll_run"
      expect_ok 'reading the run'
      cp "$LL_WORK/body" "$LL_WORK/run.json"
      now=$(js 'd.run.status + (d.run.prNumber === null ? "" : "+pr")' "$LL_WORK/run.json")
      [ "$now" = "$status" ] || say "run is $now"
      status=$now
      case $status in
        *+pr | merged) ll_outcome=pr_opened; return 0 ;;
        needs_human | failed | canceled) ll_outcome=$status; return 0 ;;
      esac
    fi
    if [ "$(date +%s)" -ge "$3" ]; then
      ll_outcome=timed_out
      return 0
    fi
    sleep "$4"
  done
}

# ll_collect RUN — the run's pull request into $LL_WORK/pulls.json and its whole transcript (every
# page of events) into $LL_WORK/events.json. Both are empty shapes when RUN is empty.
ll_collect() {
  printf '{}\n' > "$LL_WORK/pulls.json"
  printf '[]\n' > "$LL_WORK/events.json"
  [ -f "$LL_WORK/run.json" ] || printf '{}\n' > "$LL_WORK/run.json"
  [ -n "$1" ] || return 0

  api GET "/api/v1/pull-requests?runId=$1"
  expect_ok "reading the run's pull request"
  cp "$LL_WORK/body" "$LL_WORK/pulls.json"
  after=0
  while :; do
    api GET "/api/v1/runs/$1/events?after=$after&limit=500"
    expect_ok "reading the run's transcript"
    js 'f[0].concat(f[1].entries)' "$LL_WORK/events.json" "$LL_WORK/body" > "$LL_WORK/events.next"
    mv "$LL_WORK/events.next" "$LL_WORK/events.json"
    [ "$(js 'd.hasMore' "$LL_WORK/body")" = true ] || break
    after=$(js 'd.nextAfter' "$LL_WORK/body")
  done
}
