#!/usr/bin/env sh
#
# reference-run.sh — one command from a clean checkout to a draft pull request (DL.2, #1326).
#
# It brings up a production-configured stack with no seed, makes a workspace the way a person
# would — through the REST API — and runs the loop once on one issue of a repository you name:
#
#   compose up (no seed) ─▶ owner + workspace ─▶ GitHub token · source · repository · sync
#   ─▶ provider key ─▶ routes ─▶ runner in pool-a ─▶ publish live-slice ─▶ dry-run on
#   ─▶ readiness ─▶ "cap: $2.00 — continue? [y/N]" ─▶ queue + confirm ─▶ wait ─▶ export
#
# and writes what happened to an export directory:
#
#   run.jsonl      the run's transcript, as GET /api/v1/runs/{id}/transcript.jsonl streams it
#   usage.csv      the run's metered model calls (token_usage rows)
#   farm-job.log   the build job's log
#   pr-url.txt     the draft pull request's URL
#   manifest.json  every component's version, the commit and tag, the aliases' concrete models
#
# Re-running at the same tag takes the same path. The model's output will differ between runs;
# the manifest says so.
#
# It spends money and pushes to a repository, so it refuses to guess either: --repo is required
# and never defaulted, and it prints the route's per-run cap and asks before it queues anything.
# Point it at your own copy of the sample repository (NobuData/ouroboros-sample, DL.1 #1320) —
# nobody but its owners can push to the original.
#
# --fixture runs the same path against the e2e stack's stand-ins — the recorded provider
# (provider-fixture), the git host (git-stub) and the tracker (tracker-stub) — with no key and
# no GitHub account. That recording was made on acme-robotics/helios-greeter#1, so --fixture
# needs exactly that repository and issue. CI runs it (.github/workflows/e2e.yml) so this script
# cannot rot between real runs.
#
# Throwaway stacks only. The owner is minted in the stack's own database (production REST has no
# password sign-in), signed with BETTER_AUTH_SECRET — the compose default unless you set one. It
# never prints, logs or stores a secret: each reaches curl through a file only this user can read.
#
# Environment (real runs):
#   OURO_REF_PROVIDER_KEY   required  an Anthropic API key (ANTHROPIC_API_KEY is read if unset)
#   GITHUB_TOKEN            required  a token that can push to --repo and open pull requests on it
#   BETTER_AUTH_SECRET      optional  the stack's session secret (compose's default otherwise)
#
# Usage:
#   scripts/reference-run.sh --repo OWNER/NAME --issue N         # a real run
#   scripts/reference-run.sh --fixture --repo acme-robotics/helios-greeter --issue 1 --yes
#
# Options:
#   --repo OWNER/NAME   the repository to run on (required)
#   --issue N           the issue's number in it (required)
#   --fixture           run against the e2e stand-ins instead of GitHub and Anthropic
#   --yes               do not ask before spending (CI)
#   --cap CENTS         the per-run cost cap the routes are given (default 200, i.e. $2.00)
#   --out DIR           where the export goes (default reference-run-<UTC stamp>/)
#   --timeout SECS      how long the run may take to open its pull request (default 1800)
#   --poll SECS         how often the run is read (default 10)
#   --keep              leave the stack up afterwards
#   --allow-dirty       run from a checkout with uncommitted changes (the manifest says so)
#
# Exit status:
#   0  the run opened its draft pull request; the export is written
#   1  the run stopped, or did not open one in time; the export is written and says so
#   2  a missing input, a refused request, or a stack that would not come up

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")

LL_NAME=reference-run
# shellcheck source=lib/live-loop.sh
. "$SCRIPT_DIR/lib/live-loop.sh"

REPO=''
ISSUE=''
FIXTURE=0
YES=0
KEEP=0
ALLOW_DIRTY=0
CAP=200
OUT=''
TIMEOUT=1800
POLL=10

# The slice the provider fixture's recording was made on (DI.5, #1314).
FIXTURE_REPO=acme-robotics/helios-greeter
FIXTURE_ISSUE=1
FIXTURE_PROVIDER_KEY=ouro-e2e-live-slice
FIXTURE_GITHUB_TOKEN=ghp_e2e288planningsandboxtoken0000000000
# The two aliases live-slice's stages route to, and the models behind them — the ones the
# recording answers for (R__dev_seed_live_slice.sql).
PLANNER_MODEL=claude-sonnet-4-5
CODER_MODEL=claude-sonnet-4-5-20250929
POOL=pool-a
WORKFLOW=live-slice

while [ $# -gt 0 ]; do
  case $1 in
    --repo) [ $# -ge 2 ] || die '--repo needs OWNER/NAME'; REPO=$2; shift 2 ;;
    --issue) [ $# -ge 2 ] || die '--issue needs a number'; ISSUE=$2; shift 2 ;;
    --fixture) FIXTURE=1; shift ;;
    --yes) YES=1; shift ;;
    --cap) [ $# -ge 2 ] || die '--cap needs a number of cents'; CAP=$2; shift 2 ;;
    --out) [ $# -ge 2 ] || die '--out needs a directory'; OUT=$2; shift 2 ;;
    --timeout) [ $# -ge 2 ] || die '--timeout needs a number of seconds'; TIMEOUT=$2; shift 2 ;;
    --poll) [ $# -ge 2 ] || die '--poll needs a number of seconds'; POLL=$2; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    -h | --help) sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

# --- what it was pointed at ---------------------------------------------------------------------
[ -n "$REPO" ] || die '--repo is required: name the repository to run on, as OWNER/NAME'
case $REPO in */*/* | /* | */ | *[!A-Za-z0-9._/-]*) die "--repo must be OWNER/NAME, not $REPO" ;; */*) ;; *) die "--repo must be OWNER/NAME, not $REPO" ;; esac
case $ISSUE in '' | *[!0-9]* | 0) die '--issue must be the issue number' ;; esac
case $CAP in '' | *[!0-9]* | 0) die '--cap must be a positive whole number of cents' ;; esac
case $TIMEOUT in '' | *[!0-9]*) die '--timeout must be a whole number of seconds' ;; esac
case $POLL in '' | *[!0-9]* | 0) die '--poll must be a positive whole number of seconds' ;; esac
OWNER=${REPO%/*}
NAME=${REPO#*/}

if [ "$FIXTURE" = 1 ]; then
  [ "$REPO" = "$FIXTURE_REPO" ] && [ "$ISSUE" = "$FIXTURE_ISSUE" ] ||
    die "--fixture replays a recording made on $FIXTURE_REPO#$FIXTURE_ISSUE; it cannot run $REPO#$ISSUE"
  PROVIDER_KEY=$FIXTURE_PROVIDER_KEY
  GH_TOKEN=$FIXTURE_GITHUB_TOKEN
else
  PROVIDER_KEY=${OURO_REF_PROVIDER_KEY:-${ANTHROPIC_API_KEY:-}}
  [ -n "$PROVIDER_KEY" ] || die 'set OURO_REF_PROVIDER_KEY (or ANTHROPIC_API_KEY) to an Anthropic API key'
  GH_TOKEN=${GITHUB_TOKEN:-}
  [ -n "$GH_TOKEN" ] || die "set GITHUB_TOKEN to a token that can push to $REPO"
fi
export PROVIDER_KEY GH_TOKEN

for tool in docker curl node git; do
  command -v "$tool" > /dev/null 2>&1 || die "$tool is required"
done
docker compose version > /dev/null 2>&1 || die 'docker compose (v2) is required'

# --- the checkout ---------------------------------------------------------------------------------
COMMIT=$(git -C "$ROOT" rev-parse HEAD)
TAG=$(git -C "$ROOT" describe --tags --exact-match 2> /dev/null || true)
DIRTY=false
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  [ "$ALLOW_DIRTY" = 1 ] || die 'the checkout has uncommitted changes; commit them, or pass --allow-dirty'
  DIRTY=true
fi
[ -n "$TAG" ] || say "HEAD ($COMMIT) carries no tag; the manifest records the commit"

work=$(mktemp -d)
chmod 700 "$work"
LL_WORK=$work
LL_URL=http://localhost:4000
LL_ORIGIN=http://localhost:3000

# --- the repository, before anything is spent (real runs) ----------------------------------------
if [ "$FIXTURE" = 0 ]; then
  (
    umask 077
    printf 'header = "authorization: Bearer %s"\n' "$GH_TOKEN" > "$work/gh.cfg"
  )
  gh_code=$(curl -sS -K "$work/gh.cfg" -o "$work/gh.json" -w '%{http_code}' \
    "https://api.github.com/repos/$REPO") || gh_code=000
  [ "$gh_code" = 200 ] || die "GitHub answered $gh_code for $REPO: is the name right, and can GITHUB_TOKEN see it?"
  [ "$(js 'd.permissions && d.permissions.push === true' "$work/gh.json")" = true ] ||
    die "GITHUB_TOKEN cannot push to $REPO; point --repo at a copy you can push to"
  rm -f "$work/gh.cfg"
fi

# --- the stack -------------------------------------------------------------------------------------
if [ "$FIXTURE" = 1 ]; then
  PROJECT=ouroboros-reference-fixture
  set -- -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.e2e.yml" \
    -f "$ROOT/docker-compose.e2e-unseeded.yml" -f "$ROOT/docker-compose.e2e-production.yml" \
    --profile full
else
  PROJECT=ouroboros-reference
  set -- -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.reference.yml" \
    --profile full --profile runner
fi
COMPOSE_ARGS="$*"

# compose ARGS... — this run's stack, and only it.
compose() {
  # shellcheck disable=SC2086 # the file list is a word list on purpose
  docker compose -p "$PROJECT" $COMPOSE_ARGS "$@"
}

# psql SQL — run SQL in the stack's database, answering bare values.
psql_q() {
  compose exec -T db psql -v ON_ERROR_STOP=1 -qtA -U "${OURO_DB_USER:-ouroboros}" \
    -d "${OURO_DB_NAME:-ouroboros}" -c "$1"
}

cleanup() {
  status=$?
  rm -rf "$work"
  if [ "$KEEP" = 0 ] && [ "${STACK_UP:-0}" = 1 ]; then
    say 'taking the stack down (pass --keep to leave it up)'
    compose down -v --remove-orphans > /dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 2' HUP INT TERM

if curl -fsS -o /dev/null http://localhost:4000/api/v1 2> /dev/null; then
  die 'something already answers on localhost:4000; stop that stack first'
fi

say "bringing up $PROJECT (this builds the images the first time)"
STACK_UP=1
compose up -d --build --wait > "$work/up.log" 2>&1 || {
  tail -n 40 "$work/up.log" >&2
  die 'the stack did not come up'
}

# --- 1. the owner — minted in the database, as the production e2e leg does ----------------------
SECRET=${BETTER_AUTH_SECRET:-dev-better-auth-secret-change-me}
export SECRET
node -e '
  const { createHmac, randomBytes, randomUUID } = require("crypto");
  const token = randomBytes(24).toString("base64url");
  const sig = createHmac("sha256", process.env.SECRET).update(token).digest("base64");
  process.stdout.write([randomUUID(), randomUUID(), token, encodeURIComponent(token + "." + sig)].join("\n"));
' > "$work/owner"
USER_ID=$(sed -n 1p "$work/owner")
SESSION_ID=$(sed -n 2p "$work/owner")
TOKEN=$(sed -n 3p "$work/owner")
psql_q "
  begin;
  insert into ouroboros.\"user\" (\"id\", \"name\", \"email\", \"emailVerified\", \"createdAt\", \"updatedAt\")
    values ('$USER_ID', 'Reference run', 'reference-run@example.invalid', true, now(), now());
  insert into ouroboros.session (\"id\", \"token\", \"userId\", \"expiresAt\", \"createdAt\", \"updatedAt\")
    values ('$SESSION_ID', '$TOKEN', '$USER_ID', now() + interval '6 hours', now(), now());
  commit;" > /dev/null
ll_auth_cookie "$(sed -n 4p "$work/owner")"
rm -f "$work/owner"
unset TOKEN
say 'minted the owner'

# --- 2. the workspace — BetterAuth's own create, so its hooks run ---------------------------------
printf '{"name":"Reference run","slug":"reference-run"}\n' > "$work/org.json"
api POST /api/auth/organization/create "$work/org.json"
expect_ok 'creating the workspace'
ORG_ID=$(js 'd.id' "$work/body")
printf '{"organizationId":"%s"}\n' "$ORG_ID" > "$work/active.json"
api POST /api/auth/organization/set-active "$work/active.json"
expect_ok 'making the workspace active'
say "created the workspace $ORG_ID"

# --- 3. GitHub: the token, the repository, the source, the sync ----------------------------------
json_body "$work/ghtoken.json" token=GH_TOKEN
api PUT /api/v1/settings/github-token "$work/ghtoken.json"
expect_ok "storing the workspace's GitHub token"
printf '{"login":"%s","enabled":true}\n' "$OWNER" > "$work/ghorg.json"
api POST "/api/v1/orgs/$ORG_ID/github-orgs" "$work/ghorg.json"
expect_ok "adding the account $OWNER"
printf '{"enabled":true}\n' > "$work/repo.json"
api PATCH "/api/v1/orgs/$ORG_ID/github-orgs/$OWNER/repos/$NAME" "$work/repo.json"
expect_ok "enabling $REPO"

LOGIN=$OWNER NAME=$NAME node -e '
  process.stdout.write(JSON.stringify({ kind: "github", displayName: "GitHub · " + process.env.LOGIN,
    config: { login: process.env.LOGIN, repos: [process.env.NAME], token: process.env.GH_TOKEN } }));
' > "$work/source.json"
chmod 600 "$work/source.json"
api POST /api/v1/sources "$work/source.json"
rm -f "$work/source.json" "$work/ghtoken.json"
expect_ok 'connecting the GitHub source'
SOURCE_ID=$(js 'd.id' "$work/body")
printf '{}\n' > "$work/empty.json"
api POST "/api/v1/sources/$SOURCE_ID/sync" "$work/empty.json"
expect_ok 'syncing the source'
say "connected $REPO"

# The backlog mirror, then the issue, sized: the queue pins only a sized issue.
api POST /api/v1/backlog/sync "$work/empty.json"
case $code in 2?? | 409) ;; *) expect_ok 'syncing the backlog' ;; esac
deadline=$(($(date +%s) + 300))
ISSUE_ID=''
asked=0
while :; do
  api GET "/api/v1/backlog?repo=$REPO&limit=100"
  if [ "$code" = 200 ]; then
    ISSUE_ID=$(js "(d.items.find((i) => i.number === $ISSUE) || {}).id" "$work/body")
    sizing=$(js "(d.items.find((i) => i.number === $ISSUE) || {}).sizingStatus" "$work/body")
    [ "$sizing" = sized ] && break
    if [ -n "$ISSUE_ID" ] && [ "$asked" = 0 ] && [ "$sizing" = unsized ]; then
      api POST "/api/v1/backlog/$ISSUE_ID/estimate" "$work/empty.json"
      asked=1
    fi
  fi
  [ "$(date +%s)" -lt "$deadline" ] || die "issue #$ISSUE of $REPO was not mirrored and sized within 5 minutes"
  sleep 5
done
say "issue #$ISSUE is mirrored and sized"

# --- 4. the provider key ---------------------------------------------------------------------------
if [ "$FIXTURE" = 1 ]; then
  # The recorded provider stands at an address only the database can name (the card has no
  # address field for Anthropic); the key is then stored through rotate, which checks it there.
  CONNECTION_ID=$(psql_q "
    insert into ouroboros.provider_connections (organization_id, kind, display_name, base_url, enabled)
      values ('$ORG_ID', 'anthropic', 'Anthropic · recorded fixture', 'http://provider-fixture:8080', true)
      returning id;" | head -n 1)
  json_body "$work/key.json" secret=PROVIDER_KEY
  api POST "/api/v1/providers/$CONNECTION_ID/rotate" "$work/key.json"
  rm -f "$work/key.json"
  expect_ok 'storing the provider key'
else
  node -e '
    process.stdout.write(JSON.stringify({ kind: "anthropic", displayName: "Anthropic",
      config: { apiKey: process.env.PROVIDER_KEY } }));
  ' > "$work/provider.json"
  chmod 600 "$work/provider.json"
  api POST /api/v1/providers "$work/provider.json"
  rm -f "$work/provider.json"
  expect_ok 'connecting Anthropic'
  CONNECTION_ID=$(js 'd.id' "$work/body")
fi
api POST "/api/v1/providers/$CONNECTION_ID/test" "$work/empty.json"
expect_ok 'testing the provider connection'
say 'connected the provider'

# --- 5. routes: the two task kinds, their aliases and routes, with the cap -----------------------
# A new workspace has no `plan` or `implement` task kind, and no route creates one.
psql_q "
  insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
    values ('$ORG_ID', 'plan', 'The live slice''s plan stage.', 1),
           ('$ORG_ID', 'implement', 'The live slice''s implement stage.', 2)
    on conflict do nothing;" > /dev/null
for pair in "slice-planner:$PLANNER_MODEL" "slice-coder:$CODER_MODEL"; do
  printf '{"alias":"%s","connectionId":"%s","modelId":"%s"}\n' "${pair%%:*}" "$CONNECTION_ID" "${pair#*:}" > "$work/alias.json"
  api POST /api/v1/registry/aliases "$work/alias.json"
  expect_ok "registering the alias ${pair%%:*}"
done
for pair in plan:slice-planner implement:slice-coder; do
  printf '{"hops":[{"alias":"%s"}],"allowLocalFallback":true,"floorHopIndex":null,"maxCostCentsPerRun":%s}\n' \
    "${pair#*:}" "$CAP" > "$work/route.json"
  api PUT "/api/v1/routing/routes/${pair%%:*}" "$work/route.json"
  expect_ok "routing ${pair%%:*}"
done
say 'routed plan and implement'

# --- 6. the build machine --------------------------------------------------------------------------
printf '{"name":"%s","executor":"shell"}\n' "$POOL" > "$work/pool.json"
api POST /api/v1/farm/pools "$work/pool.json"
expect_ok "creating the pool $POOL"
api GET "/api/v1/farm/enroll-command?pool=$POOL"
expect_ok 'reading the enroll command'
js 'd.command' "$work/body" > "$work/enroll.sh"
chmod 600 "$work/enroll.sh"
# The command carries a one-time enrolment token: pasted into the machine, never echoed.
compose exec -T runner sh -s < "$work/enroll.sh" > "$work/enroll.log" 2>&1 ||
  die 'the enroll command did not install a runner (its output is withheld: it names the token)'
rm -f "$work/enroll.sh"
deadline=$(($(date +%s) + 120))
until api GET /api/v1/farm && [ "$(js "d.runners.some((r) => r.pool === '$POOL' && r.status === 'online')" "$work/body")" = true ]; do
  [ "$(date +%s)" -lt "$deadline" ] || die "no runner came online in $POOL"
  sleep 3
done
say "a runner is online in $POOL"

# --- 7. the workflow, from the one copy of its definition ----------------------------------------
awk '/^ *\$live_slice_v1\$$/ { inside = 1; next } /\$live_slice_v1\$::jsonb/ { inside = 0 } inside' \
  "$ROOT/ouroboros-db/migrations/R__dev_seed_live_slice.sql" > "$work/definition.json"
js 'd.dsl_version' "$work/definition.json" > /dev/null || die 'could not read the live-slice definition'
node -e '
  const fs = require("fs");
  const definition = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(JSON.stringify({ name: "live-slice", slug: "live-slice", definition }));
' "$work/definition.json" > "$work/workflow.json"
api POST /api/v1/workflows "$work/workflow.json"
expect_ok 'creating the live-slice workflow'
WORKFLOW_ID=$(js 'd.id' "$work/body")
api POST "/api/v1/workflows/$WORKFLOW_ID/publish" "$work/empty.json"
expect_ok 'publishing live-slice'
say 'published live-slice'

# --- 8. dry-run on: the pull request opens as a draft and nothing merges --------------------------
printf '{"dryRun":true}\n' > "$work/dryrun.json"
api PATCH /api/v1/policies/dry-run "$work/dryrun.json"
expect_ok 'turning dry-run on'

# --- 9. readiness, and what it may spend ----------------------------------------------------------
api GET "/api/v1/loop/readiness?repository=$REPO&workflow=$WORKFLOW&issue=$ISSUE"
expect_ok 'reading the readiness preflight'
cp "$work/body" "$work/readiness.json"
if [ "$(js 'd.ready' "$work/readiness.json")" != true ]; then
  js 'd.checks.filter((c) => c.state !== "pass").map((c) => "  " + c.state + " · " + c.id + " — " + c.reason).join("\n")' \
    "$work/readiness.json" >&2
  printf '\n' >&2
  die 'the loop is not ready to start (above)'
fi
dollars=$(CAP=$CAP node -e 'process.stdout.write((Number(process.env.CAP) / 100).toFixed(2))')
say "ready. This run may spend up to \$$dollars (the route's per-run cap) and pushes to $REPO."
if [ "$YES" = 0 ]; then
  printf 'reference-run: cap: $%s — continue? [y/N] ' "$dollars" >&2
  answer=''
  read -r answer < /dev/tty || answer=''
  case $answer in y | Y | yes) ;; *) die 'stopped before anything was queued' ;; esac
fi

# --- 10. queue, confirm, wait ----------------------------------------------------------------------
ll_runs_of "$ISSUE" "$work/before.json"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
start_s=$(date +%s)
ll_queue_confirm "$ISSUE_ID" "$ISSUE" "$WORKFLOW"
ll_wait "$ISSUE" "$work/before.json" $((start_s + TIMEOUT)) "$POLL"
finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RUN=$ll_run
OUTCOME=$ll_outcome
say "outcome: $OUTCOME"

# --- 11. export — read with a service account's read-only token -----------------------------------
# Service accounts may read and not write (api.read), so everything above used the owner's
# session and the export below does not need it.
printf '{"name":"reference-run export","scopes":["api.read"]}\n' > "$work/svc.json"
api POST /api/v1/settings/service-accounts "$work/svc.json"
expect_ok 'minting a read-only service-account token for the export'
ll_auth_bearer "$(js 'd.token' "$work/body")"

[ -n "$OUT" ] || OUT="$ROOT/reference-run-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
ll_collect "$RUN"
: > "$OUT/run.jsonl"
: > "$OUT/farm-job.log"
: > "$OUT/pr-url.txt"
printf 'occurred_at,stage,attempt,alias,model,tokens_in,tokens_out,cost_cents\n' > "$OUT/usage.csv"
if [ -n "$RUN" ]; then
  curl -sS -K "$work/curl.cfg" -o "$OUT/run.jsonl" "$LL_URL/api/v1/runs/$RUN/transcript.jsonl" ||
    say 'the transcript could not be read'
  psql_q "copy (select occurred_at, stage, attempt, alias, model, tokens_in, tokens_out, cost_cents
                  from ouroboros.token_usage where run_id = '$RUN' order by occurred_at)
          to stdout with (format csv)" >> "$OUT/usage.csv"
  job=$(js '(d.timeline && d.timeline.stages || []).map((s) => s.build && s.build.jobId).filter(Boolean).pop()' \
    "$work/run.json")
  if [ -n "$job" ]; then
    after=0
    while :; do
      api GET "/api/v1/farm/jobs/$job/log?after=$after"
      [ "$code" = 200 ] || break
      js 'd.bytes' "$work/body" >> "$OUT/farm-job.log"
      next=$(js 'd.nextOffset' "$work/body")
      [ "$next" != "$after" ] && [ "$(js 'd.nextOffset < d.end' "$work/body")" = true ] || break
      after=$next
    done
  fi
  js '((d.items || [])[0] || {}).url || ""' "$work/pulls.json" > "$OUT/pr-url.txt"
fi

api GET /api/v1
REST_VERSION=$(js 'd.version' "$work/body" 2> /dev/null || true)
api GET /api/v1/engine/status
ENGINE_VERSION=$(js 'd.version' "$work/body" 2> /dev/null || true)
UI_VERSION=$(js 'd.version' "$ROOT/ouroboros-ui/package.json")
compose images --format json > "$work/images.json" 2> /dev/null || printf '[]\n' > "$work/images.json"

MODE=$([ "$FIXTURE" = 1 ] && printf fixture || printf real) REPO=$REPO ISSUE=$ISSUE RUN=$RUN \
  OUTCOME=$OUTCOME STARTED=$started FINISHED=$finished COMMIT=$COMMIT TAG=$TAG DIRTY=$DIRTY \
  REST_VERSION=$REST_VERSION ENGINE_VERSION=$ENGINE_VERSION UI_VERSION=$UI_VERSION CAP=$CAP \
  PLANNER_MODEL=$PLANNER_MODEL CODER_MODEL=$CODER_MODEL node -e '
    const fs = require("fs");
    const [runPath, imagesPath, prPath] = process.argv.slice(1);
    const env = process.env;
    const read = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
    const run = read(runPath, {});
    const images = [].concat(read(imagesPath, [])).flatMap((x) => (Array.isArray(x) ? x : [x]));
    const manifest = {
      mode: env.MODE,
      outcome: env.OUTCOME,
      repository: env.REPO,
      issue: Number(env.ISSUE),
      run: env.RUN || null,
      runModel: (run.run && run.run.model) || null,
      pullRequest: fs.readFileSync(prPath, "utf8").trim() || null,
      started: env.STARTED,
      finished: env.FINISHED,
      checkout: { commit: env.COMMIT, tag: env.TAG || null, dirty: env.DIRTY === "true" },
      components: {
        "ouroboros-rest": env.REST_VERSION || null,
        "ouroboros-engine": env.ENGINE_VERSION || null,
        "ouroboros-ui": env.UI_VERSION || null,
      },
      images: images.map((i) => ({ service: i.ContainerName || i.Service || null, repository: i.Repository || null, tag: i.Tag || null, id: i.ID || null })),
      routes: { plan: "slice-planner", implement: "slice-coder", capCentsPerRun: Number(env.CAP) },
      aliases: { "slice-planner": env.PLANNER_MODEL, "slice-coder": env.CODER_MODEL },
      note: "Re-running at the same tag takes the same path: the same stack, workspace, routes, workflow and issue. The model output differs from run to run, so the transcript, the diff and the pull request will not be identical.",
    };
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
  ' "$work/run.json" "$work/images.json" "$OUT/pr-url.txt" > "$OUT/manifest.json"

say "wrote ${OUT#"$ROOT"/}/"
[ "$OUTCOME" = pr_opened ]
