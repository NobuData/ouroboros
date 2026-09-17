#!/usr/bin/env sh
#
# verify-planning-invariants.sh — issue #276's (AK.5) red-on-bad-data criteria, as a script.
#
# tests/planning-invariants.sql asserts that the planning rows a database holds satisfy the
# invariants AL.3 (#279) and AL.4 (#280) rely on — and against AK.4's (#275) seed it is green. A
# green run proves nothing about whether it *would* go red: a file asserting nothing is exactly as
# green. The acceptance criteria say how to tell the two apart — *"red on a planted cycle"*, *"red
# on a reversed month range"*, *"red on a half-null date pair, a duplicate local key, and an
# out-of-vocabulary push state"*, and *"failures name the invariant, not just the SQL error"* — so
# this plants each of those into the seeded database, runs the suite over it, and requires it to
# **fail naming the invariant the plant violates**.
#
# A stored cycle needs no help to be planted: nothing in the schema refuses one, which is the whole
# reason the probe exists. Every other bad row does, because the schema refuses it — so each of
# those plants first drops the rule that would, then writes the row the rule was there to stop.
# That is the failure mode the stored-row half of the suite is for: a rule that went missing and a
# row that got in while it was gone.
#
#   plant                                        marker (the invariant the failure names)
#   ------------------------------------------   ------------------------------------------
#   #551 blocks #548, closing #548→#549→#551     dependency_graph_acyclic
#   OTA-5 blocks OTA-1, closing OTA-1→3→5        dependency_graph_acyclic
#   a blocker that is both a draft and a ticket  ticket_dependencies_one_kind
#   a blocked end that is neither                ticket_dependencies_one_kind
#   a draft whose push_state is 'queued'         ticket_drafts_push_state
#   lane 1's months swapped                      planning_epics_months_ordered
#   lane 1's end month cleared                   planning_epics_months_paired
#   lane 1 tinted 'purple'                       planning_epics_tint
#   lane 1 'archived'                            planning_epics_status
#   a second OTA-3 in the seeded batch           ticket_drafts_batch_local_key_key
#
# The rules those plants drop are proven load-bearing on the *schema* side by
# tests/verify-constraint-probes.sh; this is the *data* side, which that script cannot reach —
# constraints.sql clears every workspace before it starts, so a row planted under it is gone
# before any assertion reads it.
#
# **It needs the seeded database**, and says so rather than going red for the wrong reason: every
# plant names a seed id (`5eed…`) from R__dev_seed_ticket_planning.sql. In `ci/db` that is the
# second database the job migrates with flyway.seed.toml; locally it is the compose stack's.
#
# It writes nothing that outlives a session. Each plant and the suite run in one transaction that
# is never committed: a detected plant aborts it, and an undetected one reaches the suite's own
# `rollback`. The dropped rules come back the same way. What a developer's database does see is
# each `alter table` holding its table's lock for the length of one run — well under a second.
#
# Usage:
#   ouroboros-db/tests/verify-planning-invariants.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-planning-invariants.sh --runner docker
#   OURO_DB_NAME=ouroboros_seed ouroboros-db/tests/verify-planning-invariants.sh
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

# The seeded batch every draft plant names, and the count that proves the seed is there.
SEED_BATCH=5eed0021-0000-4000-8000-000000000001

die() {
  status=$1
  shift
  printf 'verify-planning-invariants: %s\n' "$*" >&2
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
  SUITE=/tests/planning-invariants.sql
else
  SUITE="$TEST_DIR/planning-invariants.sql"
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

printf '\nPlanning invariants — #276 red on planted data, against %s on %s:%s\n' \
  "$DB_NAME" "$DB_HOST" "$DB_PORT"

# ---------------------------------------------------------------------------
# The seed has to be there, or every plant fails on its own statement.
# ---------------------------------------------------------------------------
# Labelled rather than parsed out of psql's table layout, so the answer is one grep whatever the
# client's formatting defaults are. Six is the seeded batch's OTA-1…OTA-6.
seeded=$(printf "select 'seeded-drafts=' || count(*) from ouroboros.ticket_drafts where batch_id = '%s';\n" \
           "$SEED_BATCH" | sql 2>&1) ||
  die 2 "could not query $DB_NAME: $seeded"
printf '%s\n' "$seeded" | grep -q 'seeded-drafts=6$' ||
  die 2 "$DB_NAME does not hold the planning seed (#275) — migrate it with flyway.seed.toml"

LOG_DIR=$(mktemp -d)

# run_suite PLANT LOG — plant, then run planning-invariants.sql, in one session and one
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
# caught, so it has to be green first — which is also AK.5's *"green against the AK.4 seeds"*.
printf '\n--- nothing planted\n'
control_log="$LOG_DIR/control.log"
if run_suite '' "$control_log"; then
  pass 'planning-invariants.sql is green against the seeded database'
else
  fail "planning-invariants.sql is green against the seeded database (see $control_log)"
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
    fail "planning-invariants.sql fails when $red_label (it passed — that invariant asserts nothing)"
    return 0
  fi
  pass "planning-invariants.sql fails when $red_label"

  if grep -Eq -- "FAILED: $red_marker" "$red_log"; then
    pass 'and names the invariant it violates'
  else
    fail "and names the invariant it violates (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# ---------------------------------------------------------------------------
# Acyclicity — nothing to drop, so nothing is.
# ---------------------------------------------------------------------------
expect_red 'a cycle is planted among the seeded tickets' \
  'dependency_graph_acyclic: no stored dependency cycle' \
  "insert into ouroboros.ticket_dependencies (organization_id, blocker_ticket_id, blocked_ticket_id)
     select organization_id, id, '5eed001d-0000-4000-8000-000000000548'
       from ouroboros.tickets where id = '5eed001d-0000-4000-8000-000000000551';"

expect_red 'a cycle is planted among the seeded drafts' \
  'dependency_graph_acyclic: no stored dependency cycle' \
  "insert into ouroboros.ticket_dependencies (organization_id, blocker_draft_id, blocked_draft_id)
     select organization_id, '5eed0022-0000-4000-8000-000000000005',
            '5eed0022-0000-4000-8000-000000000001'
       from ouroboros.draft_batches where id = '$SEED_BATCH';"

# ---------------------------------------------------------------------------
# Every other invariant — drop the rule, then write the row it refused.
# ---------------------------------------------------------------------------
expect_red 'a seeded blocker is made both a draft and a ticket' \
  'ticket_dependencies_one_kind: every stored dependency endpoint' \
  "alter table ouroboros.ticket_dependencies drop constraint ticket_dependencies_blocker_one_kind;
   update ouroboros.ticket_dependencies
      set blocker_ticket_id = '5eed001d-0000-4000-8000-000000000548'
    where id = '5eed001e-0000-4000-8000-900001000003';"

expect_red 'a seeded blocked end is made neither' \
  'ticket_dependencies_one_kind: every stored dependency endpoint' \
  "alter table ouroboros.ticket_dependencies drop constraint ticket_dependencies_blocked_one_kind;
   update ouroboros.ticket_dependencies set blocked_draft_id = null
    where id = '5eed001e-0000-4000-8000-900001000003';"

# Both push-state checks, because the coherence rule's `else false` refuses a fourth word too.
expect_red 'a seeded draft is given an out-of-vocabulary push state' \
  'ticket_drafts_push_state: every stored draft is pending, pushed or failed' \
  "alter table ouroboros.ticket_drafts drop constraint ticket_drafts_push_state;
   alter table ouroboros.ticket_drafts drop constraint ticket_drafts_push_state_coherent;
   update ouroboros.ticket_drafts set push_state = 'queued'
    where id = '5eed0022-0000-4000-8000-000000000001';"

expect_red 'a seeded lane has its month range reversed' \
  'planning_epics_months_ordered: no stored lane ends before it starts' \
  "alter table ouroboros.planning_epics drop constraint planning_epics_months_ordered;
   update ouroboros.planning_epics set start_month = end_month, end_month = start_month
    where id = '5eed001f-0000-4000-8000-000000000001';"

expect_red 'a seeded lane loses half its month range' \
  'planning_epics_months_paired: no stored lane carries half a month range' \
  "alter table ouroboros.planning_epics drop constraint planning_epics_months_paired;
   update ouroboros.planning_epics set end_month = null
    where id = '5eed001f-0000-4000-8000-000000000001';"

expect_red 'a seeded lane is given a tint outside the mockup' \
  'planning_epics_tint: every stored lane uses one of' \
  "alter table ouroboros.planning_epics drop constraint planning_epics_tint;
   update ouroboros.planning_epics set tint = 'purple'
    where id = '5eed001f-0000-4000-8000-000000000001';"

expect_red 'a seeded lane is given a status outside the four' \
  'planning_epics_status: every stored lane has one of' \
  "alter table ouroboros.planning_epics drop constraint planning_epics_status;
   update ouroboros.planning_epics set status = 'archived'
    where id = '5eed001f-0000-4000-8000-000000000001';"

expect_red 'the seeded batch is given a second OTA-3' \
  'ticket_drafts_batch_local_key_key: no stored batch holds the same local key twice' \
  "alter table ouroboros.ticket_drafts drop constraint ticket_drafts_batch_local_key_key;
   insert into ouroboros.ticket_drafts (batch_id, local_key, title)
     values ('$SEED_BATCH', 'OTA-3', 'A second OTA-3');"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
