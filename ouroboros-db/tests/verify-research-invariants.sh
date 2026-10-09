#!/usr/bin/env sh
#
# verify-research-invariants.sh — issue #613's (CK.6) red/green criterion, as a script.
#
# tests/research-invariants.sql asserts the disciplines mockup 22's seeded Research page trusts —
# of the seeded rows, and of a write each discipline must refuse — and against the research seeds
# it is green. A green run proves nothing about whether it *would* go red, and #613 asks for each
# probe **verified red when its discipline is removed**. So this removes each rule from the seeded
# database (or plants the row it was there to stop), runs the suite over it, and requires it to
# **fail naming the invariant**.
#
#   plant                                              marker (the invariant the failure names)
#   -------------------------------------------------  ------------------------------------------
#   the finding-cited triggers are dropped             finding_cited
#   a seeded finding loses its citation                finding_cited
#   the matrix-cell-cited triggers are dropped         matrix_cell_cited
#   the watch status vocabulary grows a value          watch_vocabulary
#   the watch transition trigger is dropped            watch_transitions
#   bisected no longer requires a bisect result        watch_transitions
#   fixed_merged no longer requires a PR               watch_transitions
#   the doc-version immutability trigger is dropped    doc_version_immutable
#   an investigation number goes missing               investigation_seq_dense
#   the source-locator CHECK is dropped                source_locator_valid
#
# RS-### gaplessness *under concurrency* is tests/verify-investigation-seq.sh's, which ci/db runs
# beside this.
#
# **It needs the seeded database**, and says so rather than going red for the wrong reason. In
# `ci/db` that is the second database the job migrates with flyway.seed.toml.
#
#   PGPASSWORD=ouroboros ouroboros-db/tests/verify-research-invariants.sh [--runner auto|psql|docker]
#
# Every plant runs inside a transaction that is rolled back.

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

# The workspace every plant writes into, and the seeded rows the plants rewrite: the allow-once
# card, two of the week's answers (the policy one and the median one), the snoozed card and PR #504.
FIX_DRAFTED_ITEM=5eed0096-0000-4000-8000-000000000102
FIX_RUNNING_ITEM=5eed0096-0000-4000-8000-000000000101
RS118_CLAIM=5eed0093-0000-4000-8000-000000001182
RS110=5eed0091-0000-4000-8000-000000000110

die() {
  status=$1
  shift
  printf 'verify-research-invariants: %s\n' "$*" >&2
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
  SUITE=/tests/research-invariants.sql
else
  SUITE="$TEST_DIR/research-invariants.sql"
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

printf '\nResearch invariants — #613 red on planted data, against %s on %s:%s\n' \
  "$DB_NAME" "$DB_HOST" "$DB_PORT"

# ---------------------------------------------------------------------------
# The seed has to be there, or every plant fails on its own statement.
# ---------------------------------------------------------------------------
# Labelled rather than parsed out of psql's table layout, so the answer is one grep whatever the
# client's formatting defaults are. Sixteen is the inbox seed's decision items.
seeded=$(printf "select 'seeded-watch-items=' || count(*) from ouroboros.regression_watch_items where id::text like '5eed0096-%%';\n" | sql 2>&1) ||
  die 2 "could not query $DB_NAME: $seeded"
printf '%s\n' "$seeded" | grep -q 'seeded-watch-items=3$' ||
  die 2 "$DB_NAME does not hold the research seeds (#613) — migrate it with flyway.seed.toml"

LOG_DIR=$(mktemp -d)

# run_suite PLANT LOG — plant, then run research-invariants.sql, in one session and one
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
# caught, so it has to be green first — which is also #460's *"green"* half.
printf '\n--- nothing planted\n'
control_log="$LOG_DIR/control.log"
if run_suite '' "$control_log"; then
  pass 'research-invariants.sql is green against the seeded database'
else
  fail "research-invariants.sql is green against the seeded database (see $control_log)"
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
    fail "research-invariants.sql fails when $red_label (it passed — that invariant asserts nothing)"
    return 0
  fi
  pass "research-invariants.sql fails when $red_label"

  if grep -Eq -- "FAILED: $red_marker" "$red_log"; then
    pass 'and names the invariant it violates'
  else
    fail "and names the invariant it violates (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# ---------------------------------------------------------------------------
# Rules the schema states — drop or widen the rule, then write the row it refused.
# ---------------------------------------------------------------------------
expect_red 'the finding-cited triggers are dropped' \
  'finding_cited: a finding claim written without a citation' \
  "drop trigger brief_claims_finding_cited on ouroboros.brief_claims;
   drop trigger brief_claim_sources_finding_cited on ouroboros.brief_claim_sources;"

expect_red 'a seeded finding loses its citation' \
  'finding_cited: no seeded finding claim' \
  "alter table ouroboros.brief_claim_sources disable trigger user;
   delete from ouroboros.brief_claim_sources where claim_id = '$RS118_CLAIM';"

expect_red 'the matrix-cell-cited triggers are dropped' \
  'matrix_cell_cited: a cell moved off unknown' \
  "drop trigger matrix_cells_cited on ouroboros.matrix_cells;
   drop trigger matrix_cell_sources_cited on ouroboros.matrix_cell_sources;"

expect_red 'the watch status vocabulary grows a value' \
  'watch_vocabulary: a watch item' \
  "alter table ouroboros.regression_watch_items drop constraint regression_watch_items_status;
   alter table ouroboros.regression_watch_items add constraint regression_watch_items_status
     check (status in ('detected', 'bisecting', 'bisected', 'investigation_open', 'fix_drafted',
                       'fix_running', 'fixed_merged', 'dismissed', 'snoozed'));"

expect_red 'the watch transition trigger is dropped' \
  'watch_transitions: a fix still drafted cannot jump to merged' \
  "drop trigger regression_watch_items_transition on ouroboros.regression_watch_items;"

expect_red 'bisected no longer requires a bisect result' \
  'watch_transitions: bisected requires a bisect result' \
  "alter table ouroboros.regression_watch_items drop constraint regression_watch_items_bisected_has_result;"

expect_red 'fixed_merged no longer requires a PR' \
  'watch_transitions: fixed_merged requires a PR reference' \
  "alter table ouroboros.regression_watch_items drop constraint regression_watch_items_merged_has_pr;"

expect_red 'the doc-version immutability trigger is dropped' \
  'doc_version_immutable: a roadmap doc version is never edited' \
  "drop trigger roadmap_doc_versions_no_update on ouroboros.roadmap_doc_versions;"

expect_red 'an investigation number goes missing' \
  'investigation_seq_dense: every workspace' \
  "delete from ouroboros.investigations where id = '$RS110';"

expect_red 'the source-locator CHECK is dropped' \
  'source_locator_valid: a code source' \
  "alter table ouroboros.source_records drop constraint source_records_locator_valid;"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
