#!/usr/bin/env sh
#
# seed.test.sh — tests for the development seeds: migrations/R__dev_seed.sql,
# migrations/R__dev_seed_dashboard.sql, and the configuration that decides whether they do
# anything.
#
# The seeds are the migrations in this module that must behave differently in two places,
# so the properties worth testing are the ones that keep those two apart: that a
# production run resolves the guard to `false`, that only the development stack and a
# deliberate `--config` resolve it to `true`, and that every statement in either file is
# behind that guard and can be applied twice.
#
# There are two files because they answer different questions — R__dev_seed.sql (#23) is
# *who exists*, R__dev_seed_dashboard.sql (#68) is *what the loop has done* — and the
# structural rules below are asserted over both, in a loop, so that a third seed inherits
# them by being added to one list.
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
DASHBOARD_SEED="$MODULE_DIR/migrations/R__dev_seed_dashboard.sql"
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

# A seed with its commentary removed. Every assertion about what a migration *does* reads
# this rather than the file: the headers explain the guard, name the ids and state that no
# credential is seeded, so a grep for any of those over the whole file would be answered by
# the prose that promises them.
#
#   seed_body FILE OUT — write FILE's statements, without comment lines, to OUT.
seed_body() {
  grep -Ev '^[[:space:]]*--' "$1" > "$2" 2>/dev/null || :
}

BODY="$work/seed-body.sql"
DASHBOARD_BODY="$work/seed-body-dashboard.sql"
seed_body "$SEED" "$BODY"
seed_body "$DASHBOARD_SEED" "$DASHBOARD_BODY"

# count_lines PATTERN [FILE] — how many lines of a seed's SQL match an extended regex.
# Defaults to R__dev_seed.sql, which is what the assertions written before there was a
# second seed all mean.
count_lines() {
  grep -Ec -- "$1" "${2:-$BODY}" 2>/dev/null || true
}

printf '\nouroboros-db — the development seeds\n\n'

# ---------------------------------------------------------------------------
# The migrations
# ---------------------------------------------------------------------------

printf 'The migrations\n'

check_exists "$SEED" 'migrations/R__dev_seed.sql exists'
check_exists "$DASHBOARD_SEED" 'migrations/R__dev_seed_dashboard.sql exists'

# Repeatable, not versioned. A seed that grows with the product would otherwise become a
# chain of V### files that can never be re-run — README.md § Migration rules, rule 3.
for seed_file in "$SEED" "$DASHBOARD_SEED"; do
  check_matches "$(basename -- "$seed_file")" '^R__[a-z0-9_]+\.sql$' \
    "$(basename -- "$seed_file") is a repeatable migration, so it re-applies when it changes"
done

# **The order the two are applied in, which is a correctness property and not a style.**
#
# Flyway applies repeatable migrations after every versioned one, in the order of their
# *descriptions*. Every row the dashboard seed writes finds its parent by natural key — the
# organization by slug, a repository by name — so it has to run after the seed that creates
# them. `dev_seed` sorts before `dev_seed_dashboard`; `dashboard_dev_seed`, which is the
# name #68's diagram suggests, would sort before `dev_seed` instead, and on a database
# migrated from empty every join would find nothing, every insert would insert nothing, and
# a second `migrate` would not put it right — Flyway re-applies a repeatable migration only
# when its checksum changes. So the ordering is asserted here, where a rename fails the
# pull request rather than the dashboard.
base_description=$(basename -- "$SEED" .sql)
base_description=${base_description#R__}
dashboard_description=$(basename -- "$DASHBOARD_SEED" .sql)
dashboard_description=${dashboard_description#R__}

check_equals "$base_description" \
  "$(printf '%s\n%s\n' "$base_description" "$dashboard_description" | LC_ALL=C sort | head -n 1)" \
  'the dashboard seed sorts after the seed whose rows it hangs off, so Flyway applies it second'

# Every statement is guarded, and every statement can be applied twice. Counted rather
# than spot-checked: the failure this catches is a *new* statement added later without
# one of the two, which no fixed set of patterns would see.
#
# `on conflict` takes an optional arbiter because one statement needs it: `queue_items`
# carries a deferrable unique key, and PostgreSQL refuses a targetless `on conflict` on
# such a table outright. Naming the primary key is what that statement does instead, and it
# is still the "applied twice writes nothing" rule this check exists for.
for seed_file in "$SEED" "$DASHBOARD_SEED"; do
  name=$(basename -- "$seed_file")
  body=$BODY
  [ "$seed_file" = "$DASHBOARD_SEED" ] && body=$DASHBOARD_BODY

  inserts=$(count_lines '^insert into ouroboros\.' "$body")
  guards=$(count_lines '^ *(where|and) \$\{ouro_dev_seed\}$' "$body")
  conflicts=$(count_lines '^on conflict( \([a-z_]+\))? do nothing;$' "$body")

  check_matches "$inserts" '^[1-9][0-9]*$' "$name inserts something"
  check_equals "$inserts" "$guards" "every insert in $name is behind the \${ouro_dev_seed} guard"
  check_equals "$inserts" "$conflicts" "every insert in $name ends \`on conflict do nothing\`"

  # Deterministic ids are what let a test, a URL or a fixture name a seeded row. A
  # generated one would differ per machine and per reset.
  check_absent "$body" 'gen_random_uuid' "$name generates no ids"

  # The seed writes to the product's tables and to nothing else — not to Flyway's own
  # history, not to a table another module owns.
  check_equals "$inserts" "$(count_lines '^insert into ' "$body")" \
    "$name writes only into the ouroboros schema"
  check_absent "$body" 'flyway_schema_history' \
    "$name does not touch Flyway's history table"

  # A seed is where a credential is most tempting to put and least likely to be noticed.
  for secret in secret api_key; do
    check_absent "$body" "$secret" "$name writes no $secret"
  done
done

printf '\nR__dev_seed.sql — the workspaces\n'

check_contains "$BODY" '5eed0001-0000-4000-8000-000000000001' \
  'the demo organization has the documented id'

# Twenty-six rows, twenty-six ids, all of them recognisable on sight. Distinct ids are
# counted rather than occurrences: an id reused between two tables would still satisfy a
# total, and would give two different rows the same name in every log and URL that
# carries one. (The BetterAuth tables hold them as text; the shape is the same.)
seed_ids=$(grep -Eo "'5eed[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}'" "$BODY" | sort -u | wc -l)
check_equals 26 "$(printf '%s' "$seed_ids" | tr -d ' ')" \
  'the seed uses twenty-six distinct 5eed… ids, one per row it creates'

# The `account` table *can* hold the library's encrypted tokens, and this seed
# deliberately writes none of those columns (tests/seed.sql asserts the rows stay null);
# this asserts no statement here even names one, whatever the schema grows. It is this
# file's rule rather than every seed's: the dashboard seed writes `token_usage`, where
# "token" is a unit of work a model consumed and not a credential.
check_absent "$BODY" 'token' 'the seed writes no token'

# The one credential the seed *is* allowed to write (#709): the three password hashes
# behind the documented development password, and nothing that merely resembles one.
# Exactly three values in scrypt's `salt:key` shape — 32 hex chars, a colon, 128 — and
# every mention of the password column is one of those literals landing in it. The
# plaintext lives in documentation, never in a statement, so a database seeded from
# this file holds only what BetterAuth's verifier needs.
hashes=$(grep -Eoc "'[0-9a-f]{32}:[0-9a-f]{128}'" "$BODY" || true)
check_equals 3 "$(printf '%s' "$hashes" | tr -d ' ')" \
  'the seed writes exactly three password hashes, one per demo person'
check_absent "$BODY" 'ouroboros-dev-password' \
  'the development password appears in documentation, never in SQL'

# ---------------------------------------------------------------------------
# R__dev_seed_dashboard.sql — the dashboard read-model
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_dashboard.sql — the dashboard\n'

# Ids are computed rather than written out — there are seventy-seven of them and a list of
# seventy-seven literals is a list nobody proof-reads — so what this asserts is that every
# one is still built from a `5eed…` prefix and a value the file names. Three prefixes, one
# per table, which is what lets a run, a queue item and a usage event be told apart on
# sight in a log or a URL. `gen_random_uuid` is refused for both seeds by the loop above,
# which is the other half of the same property.
for prefix in '5eed0009' '5eed000a' '5eed000b'; do
  check_contains "$DASHBOARD_BODY" "'$prefix-0000-4000-8000-'" \
    "the dashboard seed builds its ids from the $prefix… prefix"
done

# Every row this seed writes belongs to one of the four tables the read-model is, and to
# no other. A seed that grew an insert into `organization` or `github_repos` would be
# writing the other seed's rows from the wrong file, and the two would then have to agree.
dashboard_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$DASHBOARD_BODY" |
  sed 's/^insert into ouroboros\.//' | sort -u | tr '\n' ' ')
check_equals 'queue_items runs token_usage workspace_settings ' "$dashboard_tables" \
  'the dashboard seed writes the four read-model tables and nothing else'

# The parents are found by natural key, never by naming an id a second time — which is
# what makes the seed converge on a database somebody has edited instead of failing on a
# foreign key. The organization is reached by slug in every statement.
check_absent "$DASHBOARD_BODY" '5eed0001-0000-4000-8000' \
  'the dashboard seed names no id from the other seed — it joins by slug and by name'

# Every window is relative to `now()`, which is the acceptance criterion "the today and
# 7-day math always holds": a literal timestamp would be correct on the day it was written
# and would fall out of the seven-day window the week after.
check_absent "$DASHBOARD_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the dashboard seed carries no literal date — every window is relative to now()'

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
check_contains "$README" 'R__dev_seed_dashboard\.sql' 'README.md documents the dashboard seed'
check_contains "$README" 'flyway\.seed\.toml' 'README.md documents the overlay that enables it'
check_contains "$README" 'acme-robotics' 'README.md names the demo tenant a developer will find'
check_contains "$README" 'tests/seed\.sql' 'README.md says how to assert the seeded content'

check_summary
