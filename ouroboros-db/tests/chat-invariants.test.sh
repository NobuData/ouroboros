#!/usr/bin/env sh
#
# chat-invariants.test.sh — what can be checked about #534's probe suite without a database.
#
# verify-chat-invariants.sh needs a seeded PostgreSQL, so `ci/db` is where it actually runs. This
# checks the parts that would otherwise only be found there: the script's usage and refusals, that
# every invariant the fragment names has a plant aimed at it and the other way round, that the
# plants aim at rows the seed really writes, and that `ci/db` runs both halves.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
. "$REPO_ROOT/scripts/lib/checks.sh"

VERIFIER="$TEST_DIR/verify-chat-invariants.sh"
FRAGMENT="$TEST_DIR/lib/chat-invariants.sql"
STANDALONE="$TEST_DIR/chat-invariants.sql"
CHAT_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_triage_slack.sql"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

# run_verifier [ARG...] — run it with no password, leaving its output in $out and status in $status.
run_verifier() {
  status=0
  out=$(env -u PGPASSWORD sh "$VERIFIER" "$@" 2>&1) || status=$?
}

printf '\nverify-chat-invariants.sh — usage and refusals\n'

check_executable "$VERIFIER" 'verify-chat-invariants.sh is executable'

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
check_equals 19 "$marker_count" 'the verifier plants nineteen violations'

# Every probe the issue lists, each named in the fragment and aimed at by a plant.
for invariant in \
  platform_status_vocabularies \
  message_command_vocabularies \
  single_active_connection \
  dedupe_digest_unique \
  link_unique_platform_user \
  link_unique_member \
  on_call_linked \
  refs_resolve \
  header_from_connection \
  token_sealed \
  resolved_card_fixture \
  links_seeded \
  command_invoker_recorded \
  stage_transitions_off; do
  check_contains "$FRAGMENT" "'$invariant: " "the fragment names the $invariant invariant"
  check_contains "$VERIFIER" "'$invariant: " "and the verifier plants a violation of it"
done

# The header table and the plants are the same list.
check_equals "$marker_count" "$(grep -Ec '^#   [a-z].* {2,}[a-z_]+$' "$VERIFIER")" \
  'the header lists one row per plant'

for seeded_id in \
  5eed009c-0000-4000-8000-000000000001 \
  5eed009c-0000-4000-8000-000000000101 \
  5eed009c-0000-4000-8000-000000000103 \
  5eed009c-0000-4000-8000-000000000303; do
  check_contains "$VERIFIER" "$seeded_id" "the verifier aims at $seeded_id"
  check_contains "$CHAT_SEED" "'$seeded_id'" "and the chat seed writes it"
done

# Two ids the seed composes from a prefix and a suffix: the loops channel and Ken's link.
check_contains "$VERIFIER" '5eed009c-0000-4000-8000-0000000000a1' 'the verifier aims at the loops channel'
check_contains "$CHAT_SEED" "'a1', 'C071LOOPS'" 'and the chat seed writes it'
check_contains "$VERIFIER" '5eed009c-0000-4000-8000-000000000301' 'the verifier aims at Ken'"'"'s link'
check_contains "$CHAT_SEED" "'01', 'U07KEN'" 'and the chat seed writes it'

check_contains "$STANDALONE" 'ir lib/chat-invariants\.sql' 'the standalone runner includes the fragment'
check_contains "$STANDALONE" 'ir lib/assert\.sql' 'and the assertion helpers'
check_contains "$STANDALONE" '^rollback;$' 'and rolls back whatever it touched'

printf '\nWhat runs it\n'

check_contains "$WORKFLOW" '/tests/chat-invariants\.sql' \
  'ci/db asserts the chat invariants against the seeded database'
check_contains "$WORKFLOW" 'OURO_DB_NAME="\$SEED_DB_NAME" ouroboros-db/tests/verify-chat-invariants\.sh' \
  'and plants a violation of each, requiring red'

check_summary
