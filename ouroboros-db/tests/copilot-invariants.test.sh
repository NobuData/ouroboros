#!/usr/bin/env sh
#
# copilot-invariants.test.sh — tests for tests/verify-copilot-invariants.sh and the probes it
# exercises (#558, CC.4).
#
# The verifier needs a seeded database, so what it does to one is asserted in `ci/db`. What is
# asserted here is everything decided before it connects — the arguments it accepts and refuses,
# its refusal to run without a password — and that the fragment, the standalone runner, the
# verifier, the seed and the workflow agree: every invariant the fragment names is one a plant
# violates, every row a plant aims at is one the seed writes, and ci/db runs both halves.
#
# Usage:
#   ouroboros-db/tests/copilot-invariants.test.sh
#   scripts/run-tests.sh ouroboros-db/tests
#
# Exit status: 0 all assertions passed / 1 at least one failed.
set -u
unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
. "$REPO_ROOT/scripts/lib/checks.sh"

VERIFIER="$TEST_DIR/verify-copilot-invariants.sh"
FRAGMENT="$TEST_DIR/lib/copilot-invariants.sql"
STANDALONE="$TEST_DIR/copilot-invariants.sql"
COPILOT_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_copilot.sql"
REPLAY_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_replay.sql"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

# run_verifier [ARG...] — run it with no password, leaving its output in $out and status in $status.
run_verifier() {
  status=0
  out=$(env -u PGPASSWORD sh "$VERIFIER" "$@" 2>&1) || status=$?
}

printf '\nverify-copilot-invariants.sh — usage and refusals\n'

check_executable "$VERIFIER" 'verify-copilot-invariants.sh is executable'

run_verifier --help
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'red/green criterion' '--help explains what the script is for'
check_matches "$out" 'PGPASSWORD' '--help says which credential it needs'
check_matches "$out" 'seeded database' '--help says which database it needs'

run_verifier --bogus
check_equals 2 "$status" 'an unknown argument exits 2'
check_matches "$out" 'unknown argument' 'and says which argument it did not know'

run_verifier --runner nope
check_equals 2 "$status" 'an unknown runner exits 2'
check_matches "$out" 'auto, psql or docker' 'and names the runners there are'

run_verifier
check_equals 2 "$status" 'no PGPASSWORD exits 2'
check_matches "$out" 'PGPASSWORD' 'and names the variable that would fix it'

printf '\nThe probes and the plants agree\n'

marker_count=$(grep -c '^expect_red ' "$VERIFIER")
check_equals 11 "$marker_count" 'the verifier plants eleven violations'

for invariant in \
  suggestion_vocabularies \
  confidence_has_basis \
  evidence_not_empty \
  proposed_ops_apply \
  replay_basis_real \
  refs_resolve \
  w7_unresolved; do
  check_contains "$FRAGMENT" "'$invariant: " "the fragment names the $invariant invariant"
  check_contains "$VERIFIER" "'$invariant: " "and the verifier plants a violation of it"
done

for seeded_id in \
  5eed0088-0000-4000-8000-000000000489 \
  5eed0089-0000-4000-8000-000000000001; do
  check_contains "$VERIFIER" "$seeded_id" "the verifier aims at $seeded_id"
  check_contains "$COPILOT_SEED" "'$seeded_id'" "and the copilot seed writes it"
done

# The suggestions are filed on the finished dry run, which the replay seed finishes (#561).
for seeded_id in \
  5eed008c-0000-4000-8000-000000000001 \
  5eed008c-0000-4000-8000-000000000002; do
  check_contains "$VERIFIER" "$seeded_id" "the verifier aims at $seeded_id"
  check_contains "$REPLAY_SEED" "'$seeded_id'" "and the replay seed writes it"
done

check_contains "$STANDALONE" 'ir lib/copilot-invariants\.sql' 'the standalone runner includes the fragment'
check_contains "$STANDALONE" 'ir lib/assert\.sql' 'and the assertion helpers'
check_contains "$STANDALONE" '^rollback;$' 'and rolls back whatever it touched'

printf '\nWhat runs it\n'

check_contains "$WORKFLOW" '/tests/copilot-invariants\.sql' \
  'ci/db asserts the copilot invariants against the seeded database'
check_contains "$WORKFLOW" 'OURO_DB_NAME="\$SEED_DB_NAME" ouroboros-db/tests/verify-copilot-invariants\.sh' \
  'and plants a violation of each, requiring red'

check_summary
