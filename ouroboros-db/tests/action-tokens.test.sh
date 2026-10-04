#!/usr/bin/env sh
#
# action-tokens.test.sh — the "token plaintext appears nowhere" grep for #459 (BM.3, V096).
#
# An action token is a bearer credential that arrives in an inbox, so the schema stores only its
# HMAC. constraints.sql asserts what the catalog holds (the column list, the writers' arguments,
# the state view); this file asserts what the migrations and seeds *say*, so a later migration that
# adds a plaintext column or a writer that takes the token itself goes red here without a database.
# It runs in ci/db's module tooling step (scripts/run-tests.sh ouroboros-db/tests).
#
# Usage:
#   ouroboros-db/tests/action-tokens.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests    # the module's suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")

. "$REPO_ROOT/scripts/lib/checks.sh"

MIGRATIONS="$MODULE_DIR/migrations"
V096="$MIGRATIONS/V096__guardrail_exceptions_action_tokens.sql"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# Every migration and seed, concatenated, so one grep covers what any of them writes.
cat "$MIGRATIONS"/*.sql > "$work/all.sql"

# The table's body in V096, from its create to its closing parenthesis.
sed -n '/^create table ouroboros.action_tokens (/,/^);/p' "$V096" > "$work/table.sql"

check_contains "$work/table.sql" '^  token_hash +text +not null' \
  'action_tokens stores the token as token_hash'
check_contains "$work/table.sql" "check \(token_hash ~ '\^\[0-9a-f\]\{64\}\\$'\)" \
  'and token_hash is held to 64 hex characters — an HMAC, never the token'
check_absent "$work/table.sql" '^  (token|token_value|raw_token|plain_token|token_plain(text)?|plaintext|secret[a-z_]*) +' \
  'action_tokens declares no column a plaintext token could be written to'
check_absent "$work/all.sql" 'alter table ouroboros\.action_tokens[[:space:]]+add' \
  'no migration adds a column to action_tokens after V096'
check_absent "$work/all.sql" 'p_token([[:space:]]|,|\))' \
  'no function in the schema takes the token itself as an argument (only p_token_hash)'
check_absent "$work/all.sql" 'insert into ouroboros\.action_tokens[^;]*\btoken\b[[:space:]]*[,)]' \
  'no migration or seed inserts a token column into action_tokens'

check_summary
