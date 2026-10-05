#!/usr/bin/env sh
#
# settings-invariants.test.sh — tests for BQ.5's (#484) settings invariants and the script that
# plants bad rows under them.
#
# Both need a seeded PostgreSQL to *run*, so what they do to one is asserted where one exists:
# the `ci/db` step that runs them. What is asserted here is everything that can be decided
# without a daemon or a network:
#
#   * what tests/verify-settings-invariants.sh decides before it connects — the arguments it
#     accepts, the ones it refuses, and its refusal to reach for a database with no password;
#   * that the pieces agree. Every marker the script requires is an invariant name
#     lib/settings-invariants.sql actually asserts; every rule it drops or disables is one a
#     migration creates; every seed id it plants against is one a seed writes; and the fragment
#     is reached by its suite and by CI. A plant aimed at a renamed rule or a moved seed id fails
#     on its own statement, which the marker then reports as a mismatch — but only in CI, so it
#     is caught here first.
#
# Usage:
#   ouroboros-db/tests/settings-invariants.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests          # the module's suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")

. "$REPO_ROOT/scripts/lib/checks.sh"

VERIFIER="$TEST_DIR/verify-settings-invariants.sh"
FRAGMENT="$TEST_DIR/lib/settings-invariants.sql"
STANDALONE="$TEST_DIR/settings-invariants.sql"
SETTINGS_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_settings.sql"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

# run_verifier [ARG...] — run the script with no password in the environment, leaving its
# combined output in $out and its exit status in $status. PGPASSWORD is unset rather than
# blanked, so nothing here can reach a database whatever the machine is running.
run_verifier() {
  out=$(env -u PGPASSWORD "$VERIFIER" "$@" 2>&1)
  status=$?
}

printf '\nverify-settings-invariants.sh — usage and refusals\n'

check_executable "$VERIFIER" 'verify-settings-invariants.sh is executable'

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
check_equals 14 "$marker_count" 'the verifier plants fourteen bad rows'

printf '%s\n' "$markers" | while IFS= read -r marker; do
  if grep -qF -- "'$marker" "$FRAGMENT"; then
    pass "the fragment asserts [$marker]"
  else
    fail "the fragment asserts [$marker] (no assertion message opens with it)"
  fi
done

# The invariant names #484's probe list covers, each opening an assertion and each planted
# against at least once.
for invariant in \
  org_policy_versions_immutable \
  org_policy_versions_envelope \
  org_policies_current_is_latest \
  member_capabilities_explicit \
  service_accounts_least_privilege \
  retention_policies_floor \
  retention_policies_ceiling \
  webhook_keys_sealed \
  service_tokens_hash_only \
  webhook_deliveries_family_subscribed \
  notification_routes_lock_derived \
  settings_audit_subjects_resolve
do
  check_contains "$FRAGMENT" "'$invariant: " "the fragment names the $invariant invariant"
  check_contains "$VERIFIER" "'$invariant: " "and the verifier plants a row that violates it"
done

# Every rule a plant drops, and every trigger it disables, is one a migration creates — a plant
# that removed a rule the schema no longer has would fail on its own statement.
for dropped in $(grep -oE 'drop constraint [a-z_]+' "$VERIFIER" | awk '{ print $3 }' | sort -u); do
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

# The seed ids and rows the plants aim at are ones the seeds write.
for seeded_id in 5eed0001-0000-4000-8000-000000000001 5eed0076-0000-4000-8000-000000000001 \
                 5eed0076-0000-4000-8000-000000000002 5eed0072-0000-4000-8000-000000000001; do
  if grep -qF -- "$seeded_id" "$VERIFIER"; then
    if [ "$seeded_id" = 5eed0001-0000-4000-8000-000000000001 ]; then
      pass 'the workspace the plants write into is the demo workspace R__dev_seed.sql writes'
    else
      check_contains "$SETTINGS_SEED" "'$seeded_id'" "the settings seed writes $seeded_id, which a plant aims at"
    fi
  else
    fail "the verifier aims at $seeded_id"
  fi
done
check_contains "$SETTINGS_SEED" "'loop_failures',   'pagerduty'" 'the settings seed registers the PagerDuty route a plant unlocks'
check_contains "$SETTINGS_SEED" "'audit', 400" 'and the 400-day audit tier a plant cuts'

printf '\nThe suite, and CI\n'

check_contains "$STANDALONE" 'ir lib/settings-invariants\.sql' \
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

check_contains "$WORKFLOW" '/tests/settings-invariants\.sql' \
  'ci/db asserts the settings invariants against the seeded database'
check_contains "$WORKFLOW" 'OURO_DB_NAME="\$SEED_DB_NAME" ouroboros-db/tests/verify-settings-invariants\.sh' \
  'and plants bad rows into that same seeded database'

check_summary
