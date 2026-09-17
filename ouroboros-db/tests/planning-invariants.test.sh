#!/usr/bin/env sh
#
# planning-invariants.test.sh — tests for AK.5's (#276) planning invariants and the script that
# plants bad rows under them.
#
# Both need a seeded PostgreSQL to *run*, so what they do to one is asserted where one exists:
# the `ci/db` step that runs them. What is asserted here is everything that can be decided
# without a daemon or a network:
#
#   * what tests/verify-planning-invariants.sh decides before it connects — the arguments it
#     accepts, the ones it refuses, and its refusal to reach for a database with no password;
#   * that the pieces agree. Every marker the script requires is an invariant name
#     lib/planning-invariants.sql actually asserts; every rule it drops is one a migration
#     creates; every seed id it plants against is one the planning seed writes; and the
#     fragment is reached by both of its suites and by CI. A plant aimed at a renamed rule or a
#     moved seed id fails on its own statement, which the marker then reports as a mismatch —
#     but only in CI, so it is caught here first.
#
# Usage:
#   ouroboros-db/tests/planning-invariants.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests          # the module's suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")

. "$REPO_ROOT/scripts/lib/checks.sh"

VERIFIER="$TEST_DIR/verify-planning-invariants.sh"
FRAGMENT="$TEST_DIR/lib/planning-invariants.sql"
CYCLES="$TEST_DIR/lib/dependency-cycles.sql"
STANDALONE="$TEST_DIR/planning-invariants.sql"
CONSTRAINTS="$TEST_DIR/constraints.sql"
SEED="$MODULE_DIR/migrations/R__dev_seed_ticket_planning.sql"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

# run_verifier [ARG...] — run the script with no password in the environment, leaving its
# combined output in $out and its exit status in $status. PGPASSWORD is unset rather than
# blanked, so nothing here can reach a database whatever the machine is running.
run_verifier() {
  out=$(env -u PGPASSWORD "$VERIFIER" "$@" 2>&1)
  status=$?
}

printf '\nverify-planning-invariants.sh — usage and refusals\n'

check_executable "$VERIFIER" 'verify-planning-invariants.sh is executable'

run_verifier --help
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'planted cycle' '--help explains what the script is for'
check_matches "$out" 'PGPASSWORD' '--help says which credential it needs'
check_matches "$out" 'seeded database' '--help says which database it needs'

run_verifier --no-such-flag
check_equals 2 "$status" 'an unknown argument exits 2'
check_matches "$out" 'unknown argument' 'and says which argument it did not know'

run_verifier --runner bogus
check_equals 2 "$status" 'an unknown runner exits 2'
check_matches "$out" 'auto, psql or docker' 'and names the runners there are'

run_verifier --runner
check_equals 2 "$status" '--runner with no value exits 2'

run_verifier
check_equals 2 "$status" 'no PGPASSWORD exits 2'
check_matches "$out" 'PGPASSWORD' 'and names the variable that would fix it'

printf '\nThe markers, the fragment and the migrations agree\n'

# Every marker names an invariant, and the failure it must match is the opening of that
# invariant's stored-row assertion — so each one has to be a message the fragment raises.
markers=$(awk "/^expect_red '/ { getline; sub(/^ *'/, \"\"); sub(/' \\\\\$/, \"\"); print }" "$VERIFIER")
marker_count=$(printf '%s\n' "$markers" | grep -c .)
check_equals 10 "$marker_count" 'the verifier plants ten bad rows'

printf '%s\n' "$markers" | while IFS= read -r marker; do
  if grep -qF -- "'$marker" "$FRAGMENT"; then
    pass "the fragment asserts [$marker]"
  else
    fail "the fragment asserts [$marker] (no assertion message opens with it)"
  fi
done

# The invariant names AK.5's scope lists, each opening a stored-row assertion.
for invariant in \
  dependency_graph_acyclic \
  ticket_dependencies_one_kind \
  ticket_drafts_push_state \
  planning_epics_months_ordered \
  planning_epics_months_paired \
  planning_epics_tint \
  planning_epics_status \
  ticket_drafts_batch_local_key_key
do
  check_contains "$FRAGMENT" "'$invariant: " "the fragment names the $invariant invariant"
  check_contains "$VERIFIER" "'$invariant: " "and the verifier plants a row that violates it"
done

# Every rule a plant drops is one a migration creates, and a plant that dropped a rule the
# schema no longer has would fail on its own statement.
for dropped in $(grep -oE 'drop constraint [a-z_]+' "$VERIFIER" | awk '{ print $3 }' | sort -u); do
  if grep -rqE "constraint $dropped\b" "$MODULE_DIR/migrations"; then
    pass "a migration creates $dropped, which the verifier drops"
  else
    fail "a migration creates $dropped, which the verifier drops (no migration names it)"
  fi
done

# Every seed id a plant names is one the planning seed writes. Each id is a table prefix and a
# suffix the seed computes, so what is checked is the prefix against the seed's id table and the
# suffix against the value it is computed from.
check_contains "$SEED" "5eed0021-0000-4000-8000-000000000001" 'the seeded batch id is the seed''s'
for prefix in 5eed001d 5eed001e 5eed001f 5eed0022; do
  check_contains "$VERIFIER" "$prefix-" "the verifier plants against $prefix rows"
  check_contains "$SEED" "'$prefix-0000-4000-8000-" "and the planning seed writes $prefix rows"
done
for number in 548 551; do
  check_contains "$SEED" "\\($number, " "the seed stores ticket #$number in its dependency graph"
done
check_contains "$SEED" "\\(1, 3\\)," 'the seed stores OTA-1 blocks OTA-3, the edge the endpoint plants rewrite'
check_contains "$SEED" "\\(3, 5\\)," 'and OTA-3 blocks OTA-5, which OTA-5 blocks OTA-1 closes into a cycle'

printf '\nBoth ways in, and CI\n'

check_contains "$CONSTRAINTS" 'ir lib/planning-invariants\.sql' \
  'constraints.sql includes the planning invariants as its AK.5 section'
check_contains "$STANDALONE" 'ir lib/planning-invariants\.sql' \
  'and the standalone suite includes the same file rather than a second copy'
check_contains "$STANDALONE" 'ir lib/assert\.sql' \
  'and brings the assertion helpers with it, since it owns the session'

# One walk, proven in V035's section and run by the fragment.
check_contains "$FRAGMENT" 'ir dependency-cycles\.sql' \
  'the fragment asks acyclicity with the shared walk'
check_contains "$CONSTRAINTS" 'ir lib/dependency-cycles\.sql' \
  'and V035''s section proves that same walk sees a planted cycle'
check_contains "$CYCLES" 'create or replace function pg_temp\.dependency_graph_has_cycle' \
  'the walk tolerates arriving twice in one session'
if grep -q 'create function pg_temp\.dependency_graph_has_cycle' "$CONSTRAINTS"; then
  fail 'constraints.sql carries no second copy of the walk'
else
  pass 'constraints.sql carries no second copy of the walk'
fi

# Included into a transaction that is already open, a fragment with its own would end it early.
for fragment in "$FRAGMENT" "$CYCLES"; do
  if grep -qE '^(begin|commit|rollback);' "$fragment"; then
    fail "$(basename -- "$fragment") leaves transaction control to whichever suite includes it"
  else
    pass "$(basename -- "$fragment") leaves transaction control to whichever suite includes it"
  fi
done

# The fragment is asked of a developer's database too, so it must only read.
if grep -qiE '^[[:space:]]*(insert|update|delete|alter|drop|create table)' "$FRAGMENT"; then
  fail 'the fragment writes nothing'
else
  pass 'the fragment writes nothing'
fi

check_contains "$WORKFLOW" '/tests/planning-invariants\.sql' \
  'ci/db asserts the planning invariants against the seeded database'
check_contains "$WORKFLOW" 'OURO_DB_NAME="\$SEED_DB_NAME" ouroboros-db/tests/verify-planning-invariants\.sh' \
  'and plants bad rows into that same seeded database'

check_summary
