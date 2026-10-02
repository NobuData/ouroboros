#!/usr/bin/env sh
#
# verify-analyzer-invariants.sh — issue #509's (BU.4) probe criterion, as a script.
#
# tests/analyzer-invariants.sql asserts that the analysis rows a database holds satisfy the
# invariants mockup 18's page trusts, and against R__dev_seed_workspace_metrics_analyzer.sql it is
# green. A green run proves nothing about whether it *would* go red: a file asserting nothing is
# exactly as green. #509's criterion is *"every probe is verified red-then-green"* — and that
# write-once predictions, lifecycle constraints, evidence resolvability and confidence bounds are
# the things a later migration could relax without any test noticing. So this removes each rule
# from the seeded database, writes the row the rule was there to stop, runs the suite over it, and
# requires it to **fail naming the invariant the plant violates**.
#
#   plant                                                     marker (the invariant it names)
#   --------------------------------------------------------  ----------------------------------------
#   the cache finding retyped cache_drift                     analysis_findings_type_known
#   the forge-02 card's kind set to process                   analysis_suggestions_kind_known
#   the applied test-suite split loses its audit event        analysis_suggestions_lifecycle
#   the cache finding cites a build that does not exist      analysis_findings_evidence_resolves
#   the cache finding scored 140                              analysis_confidence_bounded
#   the delivered prediction rewritten to −230 s              suggestion_measurements_prediction_frozen
#   the under-delivered verdict changed to over               suggestion_measurements_verdict_computed
#   the page's run billed $2.86                               analysis_runs_no_llm_cost
#   the cache model's factor typed as 0.70                    analyzer_calibration_derived
#   the forge-02 card given an identity nothing derives       analysis_suggestions_identity_derived
#
# The schema side of each rule lives in V080, V081 and V085, and constraints.sql asserts it there;
# this is the *data* side, which that file cannot reach — it clears every workspace before it
# starts, so a row planted under it is gone before any assertion reads it.
#
# **It needs the seeded database**, and says so rather than going red for the wrong reason: every
# plant names a row R__dev_seed_workspace_metrics_analyzer.sql writes. In `ci/db` that is the second
# database the job migrates with flyway.seed.toml; locally it is the compose stack's.
#
# It writes nothing that outlives a session. Each plant and the suite run in one transaction that
# is never committed: a detected plant aborts it, and an undetected one reaches the suite's own
# `rollback`. The dropped rules and disabled triggers come back the same way.
#
# Usage:
#   ouroboros-db/tests/verify-analyzer-invariants.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-analyzer-invariants.sh --runner docker
#   OURO_DB_NAME=ouroboros_seed ouroboros-db/tests/verify-analyzer-invariants.sh
#
# Where it connects is not an argument: run.sh already resolves that from ouroboros-db/.env, then
# ../.env, then its defaults, with the environment winning over all of them, and this asks it — as
# verify-constraint-probes.sh does. PGPASSWORD must be in the environment.
#
# Exit status:
#   0  the seeded database is green, and every plant turned it red naming its invariant
#   1  the seeded database is red, or a plant stayed green or went red naming something else
#   2  bad usage, no PGPASSWORD, no way to reach the database, or a database with no seed in it

set -eu

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$MODULE_DIR")

# The repo's shared assertion harness, so a failure here reads like a failure anywhere else.
. "$ROOT/scripts/lib/checks.sh"

# Pinned to the server's major version, as the ci/db steps that run the suites unmutated are.
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17-alpine}

runner=auto

# The page's run, and the seeded rows the plants rewrite.
SEED_RUN=5eed0065-0000-4000-8000-000000000002
CACHE_FINDING=5eed0066-0000-4000-8000-000000000141
APPLIED_SUGGESTION=5eed0067-0000-4000-8000-000000000001
QUEUE_SUGGESTION=5eed0067-0000-4000-8000-000000000013
DELIVERED_MEASUREMENT=5eed0069-0000-4000-8000-000000000001
UNDER_MEASUREMENT=5eed0069-0000-4000-8000-000000000002

die() {
  status=$1
  shift
  printf 'verify-analyzer-invariants: %s\n' "$*" >&2
  exit "$status"
}

while [ $# -gt 0 ]; do
  case $1 in
    --runner) [ $# -ge 2 ] || die 2 '--runner needs a value: auto, psql or docker'
              runner=$2; shift 2 ;;
    --runner=*) runner=${1#--runner=}; shift ;;
    # The header is the help text, printed to wherever the comment block ends.
    -h | --help) awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) die 2 "unknown argument: $1" ;;
  esac
done

case $runner in
  auto | psql | docker) ;;
  *) die 2 "--runner must be auto, psql or docker, not $runner" ;;
esac

[ -n "${PGPASSWORD:-}" ] || die 2 'PGPASSWORD is not set — see the header'

# ---------------------------------------------------------------------------
# Where to connect, asked of the script that already knows.
# ---------------------------------------------------------------------------
target=$(cd -- "$ROOT" && "$MODULE_DIR/run.sh" --print-target) ||
  die 2 'run.sh could not work out which database to use'

field() { printf '%s\n' "$target" | awk -v k="$1" '$1 == k { print $2 }'; }

DB_HOST=$(field host)
DB_PORT=$(field port)
DB_NAME=$(field name)
DB_USER=$(field user)

if [ "$runner" = auto ]; then
  if command -v psql >/dev/null 2>&1; then
    runner=psql
  elif command -v docker >/dev/null 2>&1; then
    runner=docker
  else
    die 2 'neither psql nor docker is available to talk to the database'
  fi
fi

# The suite is read by the client, so where it is depends on which client.
if [ "$runner" = docker ]; then
  SUITE=/tests/analyzer-invariants.sql
else
  SUITE="$TEST_DIR/analyzer-invariants.sql"
fi

# sql — run the SQL on stdin against the target database, printing whatever the server says.
# ON_ERROR_STOP turns the first violated assertion into a non-zero exit.
sql() {
  case $runner in
    psql)
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -
      ;;
    docker)
      docker run --rm -i --network=host \
        --env PGPASSWORD \
        --volume "$TEST_DIR:/tests:ro" \
        "$POSTGRES_IMAGE" \
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -
      ;;
  esac
}

printf '\nAnalyzer invariants — #509 red on planted data, against %s on %s:%s\n' \
  "$DB_NAME" "$DB_HOST" "$DB_PORT"

# ---------------------------------------------------------------------------
# The seed has to be there, or every plant fails on its own statement.
# ---------------------------------------------------------------------------
# Labelled rather than parsed out of psql's table layout, so the answer is one grep whatever the
# client's formatting defaults are.
seeded=$(printf "select 'seeded-run=' || count(*) from ouroboros.analysis_runs where id = '%s' and status = 'complete';\n" \
           "$SEED_RUN" | sql 2>&1) ||
  die 2 "could not query $DB_NAME: $seeded"
printf '%s\n' "$seeded" | grep -q 'seeded-run=1$' ||
  die 2 "$DB_NAME does not hold the Build Analyzer seed (#509) — migrate it with flyway.seed.toml"

LOG_DIR=$(mktemp -d)

# run_suite PLANT LOG — plant, then run analyzer-invariants.sql, in one session and one
# transaction, leaving the transcript in LOG. The suite's own `begin` is a no-op that warns; an
# abort or its closing `rollback` takes the plant back out. An empty PLANT is the control.
run_suite() {
  suite_status=0
  {
    printf 'begin;\n'
    printf '%s\n' "$1"
    printf '\\i %s\n' "$SUITE"
  } | sql >"$2" 2>&1 || suite_status=$?
  return "$suite_status"
}

# The control. A suite that is red before anything is planted would make every plant below look
# caught, so it has to be green first — which is also #509's *"green against its own seeds"*.
printf '\n--- nothing planted\n'
control_log="$LOG_DIR/control.log"
if run_suite '' "$control_log"; then
  pass 'analyzer-invariants.sql is green against the seeded database'
else
  fail "analyzer-invariants.sql is green against the seeded database (see $control_log)"
  printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
  exit 1
fi

# expect_red LABEL MARKER PLANT — the assertion this script exists to make.
#
# MARKER is the invariant's name and the opening of its stored-row assertion, matched as an
# extended regular expression against the transcript. Without it a plant that failed on its own
# statement — a seed id that moved, a rule renamed — would read as an invariant doing its job, and
# a plant caught only by the catalogue half would not prove the row half reads anything.
expect_red() {
  red_label=$1
  red_marker=$2
  red_log="$LOG_DIR/$(printf '%s' "$red_label" | tr -c 'a-zA-Z0-9' '-').log"

  printf '\n--- %s\n' "$red_label"

  red_status=0
  run_suite "$3" "$red_log" || red_status=$?

  if [ "$red_status" -eq 0 ]; then
    fail "analyzer-invariants.sql fails when $red_label (it passed — that invariant asserts nothing)"
    return 0
  fi
  pass "analyzer-invariants.sql fails when $red_label"

  if grep -Eq -- "FAILED: $red_marker" "$red_log"; then
    pass 'and names the invariant it violates'
  else
    fail "and names the invariant it violates (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# ---------------------------------------------------------------------------
# Rules the schema states — drop the rule (or switch off the trigger that is it), then write the
# row it refused.
# ---------------------------------------------------------------------------
expect_red 'the cache finding is retyped cache_drift' \
  'analysis_findings_type_known: every stored' \
  "alter table ouroboros.analysis_findings drop constraint analysis_findings_type_known;
   alter table ouroboros.analysis_findings disable trigger analysis_findings_write_guard;
   update ouroboros.analysis_findings set finding_type = 'cache_drift' where id = '$CACHE_FINDING';"

expect_red 'the forge-02 card'"'"'s kind is set to process' \
  'analysis_suggestions_kind_known: every stored' \
  "alter table ouroboros.analysis_suggestions drop constraint analysis_suggestions_kind_known;
   alter table ouroboros.analysis_suggestions drop constraint analysis_suggestions_identity_shape;
   alter table ouroboros.analysis_suggestions disable trigger analysis_suggestions_lifecycle_guard;
   update ouroboros.analysis_suggestions set kind = 'process' where id = '$QUEUE_SUGGESTION';"

expect_red 'the applied test-suite split loses its audit event' \
  'analysis_suggestions_lifecycle: every stored' \
  "alter table ouroboros.analysis_suggestions drop constraint analysis_suggestions_applied_has_event;
   alter table ouroboros.analysis_suggestions disable trigger analysis_suggestions_lifecycle_guard;
   update ouroboros.analysis_suggestions set applied_event_id = null where id = '$APPLIED_SUGGESTION';"

expect_red 'the cache finding cites a build that does not exist' \
  'analysis_findings_evidence_resolves: every stored' \
  "alter table ouroboros.analysis_findings disable trigger analysis_findings_write_guard;
   update ouroboros.analysis_findings
      set evidence_refs = evidence_refs
                          || '[{\"kind\": \"build\", \"id\": \"00000000-0000-4000-8000-000000000509\"}]'
    where id = '$CACHE_FINDING';"

expect_red 'the cache finding is scored 140' \
  'analysis_confidence_bounded: every stored' \
  "alter table ouroboros.analysis_findings drop constraint analysis_findings_confidence_range;
   alter table ouroboros.analysis_findings disable trigger analysis_findings_write_guard;
   update ouroboros.analysis_findings set confidence = 140 where id = '$CACHE_FINDING';"

expect_red 'the delivered prediction is rewritten after the fact' \
  'suggestion_measurements_prediction_frozen: every stored' \
  "alter table ouroboros.suggestion_measurements disable trigger suggestion_measurements_guard;
   update ouroboros.suggestion_measurements set predicted = jsonb_set(predicted, '{delta}', '-230')
    where id = '$DELIVERED_MEASUREMENT';"

expect_red 'the under-delivered verdict is changed to over' \
  'suggestion_measurements_verdict_computed: every stored' \
  "alter table ouroboros.suggestion_measurements drop constraint suggestion_measurements_verdict_computed;
   alter table ouroboros.suggestion_measurements disable trigger suggestion_measurements_guard;
   update ouroboros.suggestion_measurements set verdict = 'over' where id = '$UNDER_MEASUREMENT';"

expect_red 'the page'"'"'s run is billed $2.86' \
  'analysis_runs_no_llm_cost: no stored' \
  "alter table ouroboros.analysis_runs drop constraint analysis_runs_cost_needs_llm;
   update ouroboros.analysis_runs set llm_cost_cents = 286 where id = '$SEED_RUN';"

expect_red 'the cache model'"'"'s factor is typed as 0.70' \
  'analyzer_calibration_derived: every stored' \
  "alter table ouroboros.analyzer_calibration disable trigger analyzer_calibration_traces;
   update ouroboros.analyzer_calibration set factor = 0.70 where analyzer = 'cache_window';"

expect_red 'the forge-02 card is given an identity nothing derives' \
  'analysis_suggestions_identity_derived: every stored' \
  "alter table ouroboros.analysis_suggestions disable trigger analysis_suggestions_lifecycle_guard;
   alter table ouroboros.analysis_suggestions disable trigger analysis_suggestions_identity_holds;
   update ouroboros.analysis_suggestions set identity_key = 'build_process:' || repeat('0', 64)
    where id = '$QUEUE_SUGGESTION';"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
