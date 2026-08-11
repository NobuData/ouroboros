#!/usr/bin/env sh
#
# seed.test.sh — tests for the development seed: migrations/R__dev_seed.sql and the
# configuration that decides whether it does anything.
#
# The seed is the one migration in this module that must behave differently in two
# places, so the properties worth testing are the ones that keep those two apart: that a
# production run resolves the guard to `false`, that only the development stack and a
# deliberate `--config` resolve it to `true`, and that every statement in the file is
# behind that guard and can be applied twice.
#
# All of it is a file read plus the stubbed runners tests/lib/fixture.sh provides, so
# this needs no database, no Docker and no network — the same contract as
# scripts.test.sh. What a real PostgreSQL then holds is tests/seed.sql, which is where
# the seed's *content* is asserted; nothing here can see a row.
#
# Usage:
#   ouroboros-db/tests/seed.test.sh         # this file alone
#   scripts/run-tests.sh ouroboros-db/tests # the module's suite
#   scripts/run-tests.sh                    # every suite in the repository
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
SCRIPTS_DIR="$REPO_ROOT/scripts"

. "$SCRIPTS_DIR/lib/checks.sh"
. "$TEST_DIR/lib/fixture.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

STUB_LOG="$work/stub.log"
export STUB_LOG

fixture_stubs "$work"

base="$work/base"
fixture_module "$base"
BIN="$base/ouroboros-db/scripts"

SEED="$MODULE_DIR/migrations/R__dev_seed.sql"
CONFIG="$MODULE_DIR/flyway.toml"
SEED_CONFIG="$MODULE_DIR/flyway.seed.toml"
DEV_CONFIG="$MODULE_DIR/flyway.dev.toml"
COMPOSE="$REPO_ROOT/docker-compose.yml"
PROJECT=/flyway/project

# run_script NAME [ARG...] — run one wrapper from the fixture with both runners
# available, leaving its combined output in $out and its exit status in $status.
run_script() {
  script_name=$1
  shift
  : > "$STUB_LOG"
  out=$(PATH="$work/both" "$BIN/$script_name" "$@" </dev/null 2>&1)
  status=$?
}

# The seed with its commentary removed. Every assertion about what the migration *does*
# reads this rather than the file: the header explains the guard, names the ids and
# states that no credential is seeded, so a grep for any of those over the whole file
# would be answered by the prose that promises them.
BODY="$work/seed-body.sql"
grep -Ev '^[[:space:]]*--' "$SEED" > "$BODY" 2>/dev/null || :

# count_lines PATTERN — how many lines of the seed's SQL match an extended regex.
count_lines() {
  grep -Ec -- "$1" "$BODY" 2>/dev/null || true
}

printf '\nouroboros-db — the development seed\n\n'

# ---------------------------------------------------------------------------
# The migration
# ---------------------------------------------------------------------------

printf 'The migration\n'

check_exists "$SEED" 'migrations/R__dev_seed.sql exists'

# Repeatable, not versioned. A seed that grows with the product would otherwise become a
# chain of V### files that can never be re-run — README.md § Migration rules, rule 3.
check_matches "$(basename -- "$SEED")" '^R__[a-z0-9_]+\.sql$' \
  'the seed is a repeatable migration, so it re-applies when it changes'

# Every statement is guarded, and every statement can be applied twice. Counted rather
# than spot-checked: the failure this catches is a *new* statement added later without
# one of the two, which no fixed set of patterns would see.
inserts=$(count_lines '^insert into ouroboros\.')
guards=$(count_lines '^ *(where|and) \$\{ouro_dev_seed\}$')
conflicts=$(count_lines '^on conflict do nothing;$')

check_matches "$inserts" '^[1-9][0-9]*$' 'the seed inserts something'
check_equals "$inserts" "$guards" 'every insert in the seed is behind the ${ouro_dev_seed} guard'
check_equals "$inserts" "$conflicts" 'every insert in the seed ends `on conflict do nothing`'

# Deterministic ids are what let a test, a URL or a fixture name a seeded row. A
# generated one would differ per machine and per reset.
check_absent "$BODY" 'gen_random_uuid' 'the seed generates no ids — every one is a literal'
check_contains "$BODY" '5eed0001-0000-4000-8000-000000000001' \
  'the demo tenant has the documented id'

# Ten rows, ten ids, all of them recognisable on sight. Distinct ids are counted rather
# than occurrences: an id reused between two tables would still satisfy a total, and
# would give two different rows the same name in every log and URL that carries one.
seed_ids=$(grep -Eo "'5eed[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}'" "$BODY" | sort -u | wc -l)
check_equals 10 "$(printf '%s' "$seed_ids" | tr -d ' ')" \
  'the seed uses ten distinct 5eed… uuids, one per row it creates'

# The seed writes to the tenancy tables and to nothing else — not to Flyway's own
# history, not to a table another module owns.
check_equals "$inserts" "$(count_lines '^insert into ')" \
  'the seed writes only into the ouroboros schema'
check_absent "$BODY" 'flyway_schema_history' \
  'the seed does not touch Flyway'"'"'s history table'

# A seed is where a credential is most tempting to put and least likely to be noticed.
# V002 stores none and tests/constraints.sql asserts the columns do not exist; this
# asserts no statement here tries to write one, whatever the schema later grows.
for secret in token secret password credential api_key; do
  check_absent "$BODY" "$secret" "the seed writes no $secret"
done

# ---------------------------------------------------------------------------
# The guard is off by default
# ---------------------------------------------------------------------------

printf '\nThe guard is off by default\n'

# The production position. flyway.toml is what scripts/migrate, CI, and any migration
# run against a database that is not a developer's own read.
check_contains "$CONFIG" '^\[flyway\.placeholders\]$' \
  'flyway.toml declares the placeholders section'
check_contains "$CONFIG" '^ouro_dev_seed = "false"$' \
  'flyway.toml resolves the seed guard to false, so a production run seeds nothing'
check_absent "$CONFIG" '^ouro_dev_seed = "true"$' 'and never to true'

# With substitution off the guard would reach PostgreSQL as literal text. Stated in
# flyway.toml rather than left to Flyway's default because this migration depends on it.
check_contains "$CONFIG" '^placeholderReplacement = true$' \
  'flyway.toml substitutes placeholders, which is what makes the guard a guard'

# The overlay is the only thing that turns it on, and it turns on nothing else — least of
# all `clean`, which is flyway.dev.toml's business and no part of seeding.
check_exists "$SEED_CONFIG" 'flyway.seed.toml exists'
check_contains "$SEED_CONFIG" '^ouro_dev_seed = "true"$' 'flyway.seed.toml is what enables the seed'
check_absent "$SEED_CONFIG" '^cleanDisabled' 'flyway.seed.toml does not touch cleanDisabled'
check_absent "$SEED_CONFIG" '^locations' 'flyway.seed.toml does not move the migrations'
for secret in url user password; do
  check_absent "$SEED_CONFIG" "^$secret = " "flyway.seed.toml carries no $secret"
done

# The two overlays stay separate: folding the seed into flyway.dev.toml would have given
# the compose stack a `clean` it must not have, and folding `clean` in here would have
# given it to anyone who wanted seed data.
check_absent "$DEV_CONFIG" 'ouro_dev_seed' 'flyway.dev.toml is not a way to get seed data'
check_absent "$SEED_CONFIG" '^cleanDisabled = false$' 'and clean-dev is not a side effect of seeding'

# ---------------------------------------------------------------------------
# Who turns it on
# ---------------------------------------------------------------------------

printf '\nWho turns it on\n'

# The development stack, which is a laptop by definition: it publishes a well-known
# password on loopback and its data is disposable.
check_contains "$COMPOSE" "^      - \\./ouroboros-db/flyway\\.seed\\.toml:$PROJECT/flyway\\.seed\\.toml:ro\$" \
  'the compose stack mounts the seed overlay, read-only'
check_contains "$COMPOSE" \
  "^      - -configFiles=$PROJECT/flyway\\.toml,$PROJECT/flyway\\.seed\\.toml\$" \
  'and names both files, because -configFiles replaces the auto-loaded one'

# …and nothing else does. A wrapper that quietly layered the overlay would make every
# database anyone migrates a development database.
for name in migrate info validate clean-dev; do
  check_absent "$MODULE_DIR/scripts/$name" 'flyway\.seed\.toml' \
    "scripts/$name never loads the seed overlay by itself"
done

run_script migrate --dry-run
check_equals 0 "$status" 'scripts/migrate dry-runs'
check_not_matches "$out" 'flyway\.(seed|dev)\.toml' \
  'and by default reaches for no overlay at all'

# The deliberate way in, for a database the stack does not own — a PostgreSQL installed
# on the machine, a scratch database. It is one flag and it has to be typed.
run_script migrate --config flyway.seed.toml --dry-run
check_equals 0 "$status" 'scripts/migrate --config flyway.seed.toml dry-runs'
check_matches "$out" 'configFiles=[^ ]*/flyway\.toml,[^ ]*/flyway\.seed\.toml ' \
  'and layers the seed overlay over flyway.toml'
check_matches "$out" ' migrate$' 'and still runs migrate'

# ---------------------------------------------------------------------------
# The documentation the seed is only usable through
# ---------------------------------------------------------------------------

printf '\nDocumentation\n'

README="$MODULE_DIR/README.md"
check_contains "$README" 'R__dev_seed\.sql' 'README.md documents the seed migration'
check_contains "$README" 'flyway\.seed\.toml' 'README.md documents the overlay that enables it'
check_contains "$README" 'acme-robotics' 'README.md names the demo tenant a developer will find'
check_contains "$README" 'tests/seed\.sql' 'README.md says how to assert the seeded content'

check_summary
