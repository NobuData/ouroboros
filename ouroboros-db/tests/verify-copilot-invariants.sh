#!/usr/bin/env sh
#
# verify-copilot-invariants.sh — issue #558's (CC.4) red/green criterion, as a script.
#
# tests/copilot-invariants.sql asserts that the copilot rows a database holds satisfy the
# invariants mockup 20's seeded page trusts, and against R__dev_seed_workspace_copilot.sql it is
# green. A green run proves nothing about whether it *would* go red, and #558 asks for every probe
# **verified red-then-green**. So this breaks each rule in the seeded database, or plants the row it
# was there to stop, runs the suite over it, and requires it to **fail naming the invariant**.
#
#   plant                                              marker (the invariant the failure names)
#   -------------------------------------------------  ------------------------------------------
#   the source vocabulary grows a value                suggestion_vocabularies
#   the status vocabulary grows a value                suggestion_vocabularies
#   a confidence is stored without its basis           confidence_has_basis
#   the basis CHECK is dropped                          confidence_has_basis
#   a seeded suggestion's evidence is emptied          evidence_not_empty
#   a proposed operation no longer applies             proposed_ops_apply
#   the 81% suggestion's operations miss a reviewer    proposed_ops_apply
#   a replay pair is dropped from the basis            replay_basis_real
#   #489's twin drifts from the intake mirror          refs_resolve
#   skill:advisory-db quietly resolves                 w7_unresolved
#   the exploit-verify task kind quietly resolves      w7_unresolved
#
# **It needs the seeded database**, and says so rather than going red for the wrong reason. In
# `ci/db` that is the second database the job migrates with flyway.seed.toml.
#
#   PGPASSWORD=ouroboros ouroboros-db/tests/verify-copilot-invariants.sh [--runner auto|psql|docker]
#
# Every plant runs inside a transaction that is rolled back.
#
# Exit status: 0 green and every plant red / 1 an assertion failed / 2 could not run.

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
WHEN_SUGGESTION=5eed008c-0000-4000-8000-000000000001
REPLAY_SUGGESTION=5eed008c-0000-4000-8000-000000000002
DRY_RUN=5eed008b-0000-4000-8000-000000000001
TICKET_489=5eed0088-0000-4000-8000-000000000489
WORKFLOW=5eed0089-0000-4000-8000-000000000001

die() {
  status=$1
  shift
  printf 'verify-copilot-invariants: %s\n' "$*" >&2
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
  SUITE=/tests/copilot-invariants.sql
else
  SUITE="$TEST_DIR/copilot-invariants.sql"
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

printf '\nCopilot invariants — #558 red on planted data, against %s on %s:%s\n' \
  "$DB_NAME" "$DB_HOST" "$DB_PORT"

# ---------------------------------------------------------------------------
# The seed has to be there, or every plant fails on its own statement.
# ---------------------------------------------------------------------------
# Labelled rather than parsed out of psql's table layout, so the answer is one grep whatever the
# client's formatting defaults are. Sixteen is the inbox seed's decision items.
seeded=$(printf "select 'seeded-suggestions=' || count(*) from ouroboros.dry_run_suggestions where id::text like '5eed008c-%%';\n" | sql 2>&1) ||
  die 2 "could not query $DB_NAME: $seeded"
printf '%s\n' "$seeded" | grep -q 'seeded-suggestions=2$' ||
  die 2 "$DB_NAME does not hold the copilot seed (#558) — migrate it with flyway.seed.toml"

LOG_DIR=$(mktemp -d)

# run_suite PLANT LOG — plant, then run copilot-invariants.sql, in one session and one
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
  pass 'copilot-invariants.sql is green against the seeded database'
else
  fail "copilot-invariants.sql is green against the seeded database (see $control_log)"
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
    fail "copilot-invariants.sql fails when $red_label (it passed — that invariant asserts nothing)"
    return 0
  fi
  pass "copilot-invariants.sql fails when $red_label"

  if grep -Eq -- "FAILED: $red_marker" "$red_log"; then
    pass 'and names the invariant it violates'
  else
    fail "and names the invariant it violates (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# ---------------------------------------------------------------------------
# Rules the schema states — drop or widen the rule, then write the row it refused.
# ---------------------------------------------------------------------------
expect_red 'the source vocabulary grows a value' \
  'suggestion_vocabularies: a suggestion' \
  "alter table ouroboros.dry_run_suggestions drop constraint dry_run_suggestions_source;
   alter table ouroboros.dry_run_suggestions add constraint dry_run_suggestions_source
     check (source in ('rule', 'llm', 'heuristic'));"

expect_red 'the status vocabulary grows a value' \
  'suggestion_vocabularies: a suggestion' \
  "alter table ouroboros.dry_run_suggestions drop constraint dry_run_suggestions_status;
   alter table ouroboros.dry_run_suggestions add constraint dry_run_suggestions_status
     check (status in ('open', 'applied', 'ignored', 'snoozed'));"

expect_red 'a confidence is stored without its basis' \
  'confidence_has_basis: every' \
  "alter table ouroboros.dry_run_suggestions drop constraint dry_run_suggestions_confidence_basis;
   alter table ouroboros.dry_run_suggestions disable trigger dry_run_suggestions_transition;
   update ouroboros.dry_run_suggestions set confidence_basis = '{}' where id = '$WHEN_SUGGESTION';"

expect_red 'the basis CHECK is dropped' \
  'confidence_has_basis: every' \
  "alter table ouroboros.dry_run_suggestions drop constraint dry_run_suggestions_confidence_basis;"

expect_red 'a seeded suggestion'"'"'s evidence is emptied' \
  'evidence_not_empty: no seeded' \
  "alter table ouroboros.dry_run_suggestions disable trigger dry_run_suggestions_transition;
   update ouroboros.dry_run_suggestions set evidence = '{}' where id = '$WHEN_SUGGESTION';"

expect_red 'a proposed operation no longer applies' \
  'proposed_ops_apply: every seeded' \
  "alter table ouroboros.dry_run_suggestions disable trigger dry_run_suggestions_transition;
   update ouroboros.dry_run_suggestions
      set proposed_ops = '[{\"kind\": \"remove_stage\", \"params\": {\"id\": \"no-such-stage\"}}]'
    where id = '$WHEN_SUGGESTION';"

expect_red 'the 81% suggestion'"'"'s operations miss a reviewer' \
  'proposed_ops_apply: the 93%' \
  "alter table ouroboros.dry_run_suggestions disable trigger dry_run_suggestions_transition;
   update ouroboros.dry_run_suggestions set proposed_ops = jsonb_build_array(proposed_ops -> 0)
    where id = '$REPLAY_SUGGESTION';"

expect_red 'a replay pair is dropped from the basis' \
  'replay_basis_real: the reviewer-pair' \
  "delete from ouroboros.review_replay_pairs
    where id = (select id from ouroboros.review_replay_pairs where not agreed order by id limit 1);"

expect_red '#489'"'"'s twin drifts from the intake mirror' \
  'refs_resolve: the dry run' \
  "update ouroboros.tickets set title = title || ' (edited)' where id = '$TICKET_489';"

expect_red 'skill:advisory-db quietly resolves' \
  'w7_unresolved: the seeded draft' \
  "insert into ouroboros.skills (organization_id, slug, name, description, scope)
   select organization_id, 'advisory-db', 'advisory-db', 'planted', 'org'
     from ouroboros.workflows where id = '$WORKFLOW';"

expect_red 'the exploit-verify task kind quietly resolves' \
  'w7_unresolved: the seeded draft' \
  "insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
   select organization_id, 'exploit-verify', 'planted', 99
     from ouroboros.workflows where id = '$WORKFLOW';"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
