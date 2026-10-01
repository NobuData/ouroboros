#!/usr/bin/env sh
#
# verify-insights-invariants.sh — issue #436's (BI.5) red/green criterion, as a script.
#
# tests/insights-invariants.sql asserts that the rollup rows a database holds satisfy the
# invariants the Insights read path trusts, and against R__dev_seed_workspace_metrics.sql it is
# green. A green run proves nothing about whether it *would* go red: a file asserting nothing is
# exactly as green. #436's acceptance criterion is *"every probe fails when its constraint is
# removed"*. So this removes each rule from the seeded database, writes the row the rule was there
# to stop, runs the suite over it, and requires it to **fail naming the invariant the plant
# violates**.
#
# Two of the probes have no constraint to remove, because no constraint can state them: a rate's
# value being its ratio, and a dimension being from its kind's vocabulary. Their plants are
# ordinary writes the schema accepts, which is exactly why they need probes.
#
#   plant                                              marker (the invariant the failure names)
#   -------------------------------------------------  ------------------------------------------
#   a second copy of today's tokens row                metric_daily_grain_key
#   today's merge-rate row loses its denominator       metric_daily_rate_components
#   today's merge-rate value typed as 92               metric_daily_value_is_ratio
#   a row for the unregistered tokens_by_stage         metric_daily_registered
#   today's cycle median nudged off its samples        metric_daily_shape_guard
#   a cost row given samples                           metric_daily_shape_guard
#   an infra_rig bar relabelled flaky_env              metric_daily_dimension_vocabulary
#   an effort rung relabelled xxl                      metric_daily_dimension_vocabulary
#   the #333 vote's cause set to flaky_env             intervention_events_cause_known
#   the #333 vote's signal set to vote:maybe           intervention_events_signals_known
#   a tokens row whose meta is an array                metric_daily_meta_object
#   today's tooltip cost formatted as "$18.60"         metric_daily_meta_shape
#
# The schema side of those rules is proven load-bearing by tests/verify-constraint-probes.sh;
# this is the *data* side, which that script cannot reach — constraints.sql clears every
# workspace before it starts, so a row planted under it is gone before any assertion reads it.
#
# **It needs the seeded database**, and says so rather than going red for the wrong reason: every
# plant names a row R__dev_seed_workspace_metrics.sql or R__dev_seed_workspace_interventions.sql
# writes. In `ci/db` that is the second database the job migrates with flyway.seed.toml; locally
# it is the compose stack's.
#
# It writes nothing that outlives a session. Each plant and the suite run in one transaction that
# is never committed: a detected plant aborts it, and an undetected one reaches the suite's own
# `rollback`. The dropped rules and disabled triggers come back the same way. What a developer's
# database does see is each `alter table` holding its table's lock for the length of one run —
# well under a second.
#
# Usage:
#   ouroboros-db/tests/verify-insights-invariants.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-insights-invariants.sh --runner docker
#   OURO_DB_NAME=ouroboros_seed ouroboros-db/tests/verify-insights-invariants.sh
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

# The workspace every plant writes into, and the seeded vote the taxonomy plants rewrite.
SEED_ORG=5eed0001-0000-4000-8000-000000000001
SEED_VOTE=5eed005c-0000-4000-8000-000000000333

die() {
  status=$1
  shift
  printf 'verify-insights-invariants: %s\n' "$*" >&2
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
  SUITE=/tests/insights-invariants.sql
else
  SUITE="$TEST_DIR/insights-invariants.sql"
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

printf '\nInsights invariants — #436 red on planted data, against %s on %s:%s\n' \
  "$DB_NAME" "$DB_HOST" "$DB_PORT"

# ---------------------------------------------------------------------------
# The seed has to be there, or every plant fails on its own statement.
# ---------------------------------------------------------------------------
# Labelled rather than parsed out of psql's table layout, so the answer is one grep whatever the
# client's formatting defaults are. Ninety is the insights seed's days of history.
seeded=$(printf "select 'seeded-days=' || count(distinct day) from ouroboros.metric_daily where organization_id = '%s';\n" \
           "$SEED_ORG" | sql 2>&1) ||
  die 2 "could not query $DB_NAME: $seeded"
printf '%s\n' "$seeded" | grep -q 'seeded-days=90$' ||
  die 2 "$DB_NAME does not hold the insights seed (#436) — migrate it with flyway.seed.toml"

LOG_DIR=$(mktemp -d)

# run_suite PLANT LOG — plant, then run insights-invariants.sql, in one session and one
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
# caught, so it has to be green first — which is also #436's *"green against its own seeds"*.
printf '\n--- nothing planted\n'
control_log="$LOG_DIR/control.log"
if run_suite '' "$control_log"; then
  pass 'insights-invariants.sql is green against the seeded database'
else
  fail "insights-invariants.sql is green against the seeded database (see $control_log)"
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
    fail "insights-invariants.sql fails when $red_label (it passed — that invariant asserts nothing)"
    return 0
  fi
  pass "insights-invariants.sql fails when $red_label"

  if grep -Eq -- "FAILED: $red_marker" "$red_log"; then
    pass 'and names the invariant it violates'
  else
    fail "and names the invariant it violates (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# The day every row plant aims at: today, in UTC, as the extractors bucket it.
TODAY="(now() at time zone 'UTC')::date"

# ---------------------------------------------------------------------------
# Rules the schema states — drop the rule, then write the row it refused.
# ---------------------------------------------------------------------------
expect_red 'today'"'"'s tokens row is stored twice' \
  'metric_daily_grain_key: no stored' \
  "alter table ouroboros.metric_daily drop constraint metric_daily_grain_key;
   insert into ouroboros.metric_daily (organization_id, repo_ref, metric_id, is_rate, dimension,
                                       day, value, meta)
     select organization_id, repo_ref, metric_id, is_rate, dimension, day, value, meta
       from ouroboros.metric_daily
      where organization_id = '$SEED_ORG' and metric_id = 'tokens' and day = $TODAY;"

expect_red 'today'"'"'s merge-rate row loses its denominator' \
  'metric_daily_rate_components: every stored rate row' \
  "alter table ouroboros.metric_daily drop constraint metric_daily_rate_components;
   update ouroboros.metric_daily set denominator = null
    where organization_id = '$SEED_ORG' and metric_id = 'merge_rate' and day = $TODAY;"

expect_red 'a row is stored for the unregistered tokens_by_stage' \
  'metric_daily_registered: every stored' \
  "alter table ouroboros.metric_daily drop constraint metric_daily_definition_fkey;
   insert into ouroboros.metric_daily (organization_id, repo_ref, metric_id, is_rate, day, value)
     values ('$SEED_ORG', 'acme-robotics/helios-firmware', 'tokens_by_stage', false, $TODAY,
             71000000);"

expect_red 'today'"'"'s cycle median is nudged off its samples' \
  'metric_daily_shape_guard: every stored' \
  "alter table ouroboros.metric_daily disable trigger metric_daily_shape_guard;
   update ouroboros.metric_daily set value = value + 1
    where organization_id = '$SEED_ORG' and metric_id = 'cycle_time' and day = $TODAY;"

expect_red 'a cost row is given samples' \
  'metric_daily_shape_guard: every stored' \
  "alter table ouroboros.metric_daily disable trigger metric_daily_shape_guard;
   update ouroboros.metric_daily set meta = '{\"samples\": [1860]}'
    where organization_id = '$SEED_ORG' and metric_id = 'cost_cents' and day = $TODAY;"

expect_red 'the #333 vote'"'"'s cause is set outside the taxonomy' \
  'intervention_events_cause_known: every stored' \
  "alter table ouroboros.intervention_events drop constraint intervention_events_cause_known;
   alter table ouroboros.intervention_events disable trigger intervention_events_apply_rules;
   update ouroboros.intervention_events set cause = 'flaky_env' where id = '$SEED_VOTE';"

expect_red 'the #333 vote'"'"'s signal is set outside the vocabulary' \
  'intervention_events_signals_known: every stored' \
  "alter table ouroboros.intervention_events drop constraint intervention_events_signals_known;
   alter table ouroboros.intervention_events disable trigger intervention_events_apply_rules;
   update ouroboros.intervention_events set signals = '{vote:maybe}' where id = '$SEED_VOTE';"

expect_red 'a tokens row'"'"'s meta is an array' \
  'metric_daily_meta_object: every stored' \
  "alter table ouroboros.metric_daily drop constraint metric_daily_meta_object;
   update ouroboros.metric_daily set meta = '[]'
    where organization_id = '$SEED_ORG' and metric_id = 'tokens' and day = $TODAY;"

# ---------------------------------------------------------------------------
# Rules no constraint can state — the schema accepts these writes, which is the point.
# ---------------------------------------------------------------------------
expect_red 'today'"'"'s merge-rate value is typed as 92' \
  'metric_daily_value_is_ratio: every stored' \
  "update ouroboros.metric_daily set value = 92
    where organization_id = '$SEED_ORG' and metric_id = 'merge_rate' and day = $TODAY;"

expect_red 'an infra_rig bar is relabelled flaky_env' \
  'metric_daily_dimension_vocabulary: every stored' \
  "update ouroboros.metric_daily set dimension = 'flaky_env'
    where id = (select min(id) from ouroboros.metric_daily
                 where organization_id = '$SEED_ORG' and metric_id = 'human_interventions'
                   and dimension = 'infra_rig');"

expect_red 'an effort rung is relabelled xxl' \
  'metric_daily_dimension_vocabulary: every stored' \
  "update ouroboros.metric_daily set dimension = 'xxl'
    where id = (select min(id) from ouroboros.metric_daily
                 where organization_id = '$SEED_ORG' and metric_id = 'completion_time_by_effort'
                   and dimension = 'xl');"

expect_red 'today'"'"'s tooltip cost is formatted as a string' \
  'metric_daily_meta_shape: the tooltip' \
  "update ouroboros.metric_daily set meta = jsonb_set(meta, '{cost_cents}', '\"\$18.60\"')
    where organization_id = '$SEED_ORG' and metric_id = 'merged_prs' and day = $TODAY;"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
