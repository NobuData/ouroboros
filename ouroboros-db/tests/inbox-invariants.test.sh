#!/usr/bin/env sh
#
# inbox-invariants.test.sh — tests for BM.4's (#460) inbox invariants and the script that plants
# bad rows under them.
#
# Both need a seeded PostgreSQL to *run*, so what they do to one is asserted where one exists:
# the `ci/db` step that runs them. What is asserted here is everything that can be decided
# without a daemon or a network:
#
#   * what tests/verify-inbox-invariants.sh decides before it connects — the arguments it
#     accepts, the ones it refuses, and its refusal to reach for a database with no password;
#   * that the pieces agree. Every marker the script requires is an invariant name
#     lib/inbox-invariants.sql actually asserts; every rule it drops or disables is one a
#     migration creates; every seed id it plants against is one a seed writes; and the fragment
#     is reached by its suite and by CI. A plant aimed at a renamed rule or a moved seed id fails
#     on its own statement, which the marker then reports as a mismatch — but only in CI, so it
#     is caught here first.
#
# Usage:
#   ouroboros-db/tests/inbox-invariants.test.sh      # this file alone
#   scripts/run-tests.sh ouroboros-db/tests          # the module's suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")

. "$REPO_ROOT/scripts/lib/checks.sh"

VERIFIER="$TEST_DIR/verify-inbox-invariants.sh"
FRAGMENT="$TEST_DIR/lib/inbox-invariants.sql"
STANDALONE="$TEST_DIR/inbox-invariants.sql"
INBOX_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_triage_inbox.sql"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

# run_verifier [ARG...] — run the script with no password in the environment, leaving its
# combined output in $out and its exit status in $status. PGPASSWORD is unset rather than
# blanked, so nothing here can reach a database whatever the machine is running.
run_verifier() {
  out=$(env -u PGPASSWORD "$VERIFIER" "$@" 2>&1)
  status=$?
}

printf '\nverify-inbox-invariants.sh — usage and refusals\n'

check_executable "$VERIFIER" 'verify-inbox-invariants.sh is executable'

run_verifier --help
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'red/green criterion' '--help explains what the script is for'
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
check_equals 17 "$marker_count" 'the verifier plants seventeen bad rows'

printf '%s\n' "$markers" | while IFS= read -r marker; do
  if grep -qF -- "'$marker" "$FRAGMENT"; then
    pass "the fragment asserts [$marker]"
  else
    fail "the fragment asserts [$marker] (no assertion message opens with it)"
  fi
done

# The invariant names #460's probe list covers, each opening an assertion and each planted
# against at least once.
for invariant in \
  decision_vocabularies_seeded \
  decision_items_idempotent \
  decision_resolutions_one_per_item \
  action_tokens_hash_only \
  guardrail_exceptions_scoped \
  decision_metrics_oracle \
  inbox_refs_resolve \
  merge_card_matches_pr \
  allow_once_has_stop \
  pill_excludes_snoozed
do
  check_contains "$FRAGMENT" "'$invariant: " "the fragment names the $invariant invariant"
  check_contains "$VERIFIER" "'$invariant: " "and the verifier plants a row that violates it"
done

# Every rule a plant drops, and every trigger it disables, is one a migration creates — a plant
# that removed a rule the schema no longer has would fail on its own statement.
# A primary key's name is PostgreSQL's (<table>_pkey), so a migration states it as the table's
# `primary key` rather than by name.
for dropped in $(grep -oE 'drop constraint [a-z_]+' "$VERIFIER" | awk '{ print $3 }' | sort -u); do
  case $dropped in
    *_pkey)
      if grep -rqE "^create table ouroboros\.${dropped%_pkey} \(" "$MODULE_DIR/migrations" &&
         grep -rqE "primary key" "$MODULE_DIR/migrations"; then
        pass "a migration creates ${dropped%_pkey} with the primary key the verifier drops"
      else
        fail "a migration creates ${dropped%_pkey} with the primary key the verifier drops"
      fi
      continue ;;
  esac
  if grep -rqE "constraint $dropped\b" "$MODULE_DIR/migrations"; then
    pass "a migration creates $dropped, which the verifier drops"
  else
    fail "a migration creates $dropped, which the verifier drops (no migration names it)"
  fi
done
for disabled in $(grep -oE 'disable trigger [a-z_]+' "$VERIFIER" | awk '{ print $3 }' | sort -u); do
  if grep -rqE "create trigger $disabled\b" "$MODULE_DIR/migrations"; then
    pass "a migration creates the trigger $disabled, which the verifier disables"
  else
    fail "a migration creates the trigger $disabled, which the verifier disables (no migration names it)"
  fi
done

for dropped in $(grep -oE 'drop trigger [a-z_]+' "$VERIFIER" | awk '{ print $3 }' | sort -u); do
  if grep -rqE "create trigger $dropped\b" "$MODULE_DIR/migrations"; then
    pass "a migration creates the trigger $dropped, which the verifier drops"
  else
    fail "a migration creates the trigger $dropped, which the verifier drops (no migration names it)"
  fi
done

# The seed ids the plants aim at are ones the inbox seed writes.
for seeded_id in 5eed0082-0000-4000-8000-000000000002 5eed0082-0000-4000-8000-000000000101 \
                 5eed0082-0000-4000-8000-000000000102 5eed0082-0000-4000-8000-000000000201 \
                 5eed007c-0000-4000-8000-000000000504; do
  check_contains "$VERIFIER" "$seeded_id" "the verifier aims at $seeded_id"
done
check_contains "$INBOX_SEED" "'5eed0082-0000-4000-8000-000000000002'" 'the inbox seed writes the allow-once card a plant clears'
check_contains "$INBOX_SEED" "'5eed0082-0000-4000-8000-000000000201'" 'and the snoozed card a plant wakes'
check_contains "$INBOX_SEED" "'5eed007c-0000-4000-8000-000000000504'" 'and PR #504, whose diff stat a plant moves'
check_contains "$INBOX_SEED" "lpad\\(\\(100 \\+ seed\\.n\\)" 'and builds the week'"'"'s answers as 5eed0082…01nn, which two plants rewrite'
check_contains "$VERIFIER" 'SEED_ORG=5eed0001-0000-4000-8000-000000000001' \
  'the workspace the plants write into is the demo workspace R__dev_seed.sql writes'

printf '\nThe suite, and CI\n'

check_contains "$STANDALONE" 'ir lib/inbox-invariants\.sql' \
  'the standalone suite includes the fragment rather than a copy of it'
check_contains "$STANDALONE" 'ir lib/assert\.sql' \
  'and brings the assertion helpers with it, since it owns the session'

# Included into a transaction that is already open, a fragment with its own would end it early.
if grep -qE '^(begin|commit|rollback);' "$FRAGMENT"; then
  fail 'the fragment leaves transaction control to the suite that includes it'
else
  pass 'the fragment leaves transaction control to the suite that includes it'
fi

# The fragment is asked of a developer's database too, so its only writes are the probes it
# requires to be refused — each a quoted statement handed to must_reject or must_raise, never a
# statement of its own.
if grep -qiE '^[[:space:]]*(insert|update|delete|alter|drop|create table)' "$FRAGMENT"; then
  fail 'the fragment writes nothing outside a probe that must be refused'
else
  pass 'the fragment writes nothing outside a probe that must be refused'
fi

check_contains "$WORKFLOW" '/tests/inbox-invariants\.sql' \
  'ci/db asserts the inbox invariants against the seeded database'
check_contains "$WORKFLOW" 'OURO_DB_NAME="\$SEED_DB_NAME" ouroboros-db/tests/verify-inbox-invariants\.sh' \
  'and plants bad rows into that same seeded database'

check_summary
