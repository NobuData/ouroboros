#!/usr/bin/env sh
#
# betterauth-schema.test.sh — tests for the BetterAuth drift check: the verb
# scripts/betterauth-schema.mjs, the snapshot it renders, and the CI wiring that runs it.
#
# The drift check exists because decision A3 makes Flyway the only migration authority,
# which means nothing but this notices when the library starts expecting a different
# schema (#710). What is testable without a database is the contract around it: that the
# snapshot is committed and marked generated, that the check reads the installed library
# rather than a downloaded copy of a different version, that its failure messages name the
# fix, and that ci/db runs both halves and is triggered by the files either half depends
# on.
#
# Whether the check gives the right *answer* is what ci/db asserts by running it against a
# real PostgreSQL — the same division as seed.test.sh and seed.sql. Only the three
# argument-handling paths that need neither a database nor a configuration are run here.
#
# Usage:
#   ouroboros-db/tests/betterauth-schema.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests        # the module's suite
#   scripts/run-tests.sh                           # every suite in the repository
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
SCRIPTS_DIR="$REPO_ROOT/scripts"

. "$SCRIPTS_DIR/lib/checks.sh"

CHECK="$MODULE_DIR/scripts/betterauth-schema.mjs"
SNAPSHOT="$MODULE_DIR/betterauth-schema.sql"
README="$MODULE_DIR/README.md"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

printf '\nouroboros-db — the BetterAuth drift check\n\n'

# ---------------------------------------------------------------------------
# The verb
# ---------------------------------------------------------------------------

printf 'The verb\n'

check_exists "$CHECK" 'scripts/betterauth-schema.mjs exists'
check_executable "$CHECK" 'and is executable, like the module'"'"'s other scripts'
check_contains "$CHECK" '^#!/usr/bin/env node$' 'and says what runs it'

# The three modes, each of which has to keep its name: the README documents them, ci/db
# runs two of them, and the failure messages tell a developer to type the third.
for mode in check write applied; do
  check_contains "$CHECK" "\"--$mode\"" "the check accepts --$mode"
done

# It reads the schema and never applies it. `getMigrations` is BetterAuth's planner; the
# runner beside it is what decision A3 forbids, and naming it here would be the one place
# nobody would look.
check_contains "$CHECK" 'getMigrations' 'the check reads the library'"'"'s own schema planner'
check_absent "$CHECK" 'runMigrations|\.migrate\(' \
  'and never applies what it plans — Flyway owns every statement that reaches a database'

# The whole reason this is a script rather than one line of `npx`: a downloaded CLI brings
# its own copy of better-auth, so the core tables would be checked against a version the
# service does not run — and "bump the version, watch it turn red" would stop being true.
check_contains "$CHECK" 'import\("better-auth/db/migration"\)' \
  'it plans with the installed better-auth, so a version bump is what it reports'
check_absent "$CHECK" 'execFile|spawn|exec\(' \
  'and shells out to nothing, so no second copy of the library can answer for the first'

# A check whose failure does not say what to do next is a check people learn to re-run.
check_contains "$CHECK" 'Flyway owns every statement' \
  'the failure message says Flyway is where the fix goes'
check_contains "$CHECK" 'V###__' 'and names the migration to write'
check_contains "$CHECK" 'betterauth-schema\.mjs --write' 'and the verb that re-renders the snapshot'

# Pointing either mode at the other's database produces a confident wrong answer rather
# than an error, so both refuse it by name.
check_contains "$CHECK" 'describeWrongDatabase' \
  'it refuses a database that would answer the wrong question'

# The password never reaches the log. The connection string is the one value here that
# carries one, and only its host and database are ever printed.
check_contains "$CHECK" 'url\.host' 'it names the database it read by host and name'
check_absent "$CHECK" 'console\.(log|error)\(`?\$\{?options\.database\.options\.connectionString' \
  'and never prints the connection string, which carries the password'

# ---------------------------------------------------------------------------
# The snapshot
# ---------------------------------------------------------------------------

printf '\nThe snapshot\n'

check_exists "$SNAPSHOT" 'betterauth-schema.sql is committed, so drift is a reviewable diff'

# It lives beside the migrations and not among them. A file in migrations/ is a migration:
# Flyway would validate its name and then apply it, which is the one thing this file must
# never be — it is a description of what the library wants, in the library's own spelling,
# naming no schema.
check_missing "$MODULE_DIR/migrations/betterauth-schema.sql" \
  'and is not in migrations/, where Flyway would try to apply it'
check_contains "$SNAPSHOT" '^-- Generated\. Do not edit, and do not apply' \
  'and says on its first lines that it is generated and is not a migration'
check_contains "$SNAPSHOT" 'betterauth-schema\.mjs --write' 'and how to re-render it'

# The seven tables the library owns. Counted rather than spot-checked: a snapshot that
# lost one would still contain the others, and the missing one is exactly the table whose
# drift would then go unnoticed.
tables=$(grep -Ec '^create table ' "$SNAPSHOT" 2>/dev/null || true)
check_equals 7 "$(printf '%s' "$tables" | tr -d ' ')" \
  'it describes the seven tables BetterAuth and the organization plugin own'
for table in user session account verification organization member invitation; do
  check_contains "$SNAPSHOT" "^create table \"$table\" " "including \"$table\""
done

# Every index the library plans is asserted by name in tests/constraints.sql, because the
# planner cannot see a dropped index and so the drift check never reports one.
snapshot_indexes=$(grep -Eo '^create (unique )?index "[^"]+"' "$SNAPSHOT" 2>/dev/null |
  sed 's/.*"\(.*\)"/\1/' | sort -u)
missing_assertions=
for index in $snapshot_indexes; do
  grep -Fq "$index" "$TEST_DIR/constraints.sql" || missing_assertions="$missing_assertions $index"
done
check_equals '' "$missing_assertions" \
  'every index the snapshot lists is asserted by name in constraints.sql'

# A committed rendering is only useful if every machine renders it identically, so
# nothing specific to the machine that ran the verb may reach it. The columns named
# `password`, `accessToken` and `refreshToken` are of course here — this describes the
# table that holds them — and what must not be is a *value*: the connection string it was
# rendered through carries a password, and a filesystem path would differ per checkout.
check_absent "$SNAPSHOT" 'postgresql://|postgres://' \
  'the snapshot carries no connection string, which would carry a password with it'
check_absent "$SNAPSHOT" '/home/|/Users/|/tmp/' 'and no path from the machine that rendered it'
check_absent "$SNAPSHOT" '[0-9]{4}-[0-9]{2}-[0-9]{2}' \
  'and no timestamp, so re-rendering an unchanged schema is an empty diff'

# The schema is the connection's, never the file's. A qualified name here would be this
# repository's spelling rather than the library's, and the comparison would stop being
# with what the library actually asks for.
check_absent "$SNAPSHOT" 'ouroboros\.' 'and qualifies no table — the search_path decides that'

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------
#
# The three paths that answer before anything is loaded — no database, no configuration,
# no build. Everything past them is what ci/db exercises against a real PostgreSQL.

printf '\nArgument handling\n'

if command -v node >/dev/null 2>&1; then
  out=$(node "$CHECK" --help 2>&1)
  status=$?
  check_equals 0 "$status" '--help succeeds'
  check_matches "$out" 'ouroboros-db/scripts/betterauth-schema\.mjs --check' \
    'and documents the mode ci/db runs'
  check_not_matches "$out" '^#!' 'and prints prose rather than the file'

  out=$(node "$CHECK" 2>&1)
  status=$?
  check_equals 2 "$status" 'no argument is refused rather than assumed'

  out=$(node "$CHECK" --migrate 2>&1)
  status=$?
  check_equals 2 "$status" 'an unknown argument is refused'
  check_matches "$out" 'unknown argument' 'and says so'
else
  fail 'node is available to run the check'
fi

# ---------------------------------------------------------------------------
# What runs it
# ---------------------------------------------------------------------------

printf '\nWhat runs it\n'

check_contains "$WORKFLOW" 'betterauth-schema\.mjs --check' \
  'ci/db checks the snapshot against the installed library'
check_contains "$WORKFLOW" 'betterauth-schema\.mjs --applied' \
  'and checks the applied schema against it too'

# Both halves need the service's build, because the configuration that decides the schema
# is TypeScript and this reads the built copy.
check_contains "$WORKFLOW" 'workspace ouroboros-rest build' \
  'and builds ouroboros-rest first, which is where the auth configuration lives'

# The check compares two things that live in different modules, so a change to either has
# to run it. Without these filters a better-auth bump — which touches no file under
# ouroboros-db/ — would merge without ci/db ever running.
# Twice each: pull_request and push carry separate filters, and one that is right on the
# first and missing from the second lets a broken main through.
auth_filters=$(grep -c '^      - "ouroboros-rest/src/auth/\*\*"$' "$WORKFLOW" 2>/dev/null || true)
check_equals 2 "$(printf '%s' "$auth_filters" | tr -d ' ')" \
  'db.yml watches the auth configuration on both events'
manifest_filters=$(grep -c '^      - "ouroboros-rest/package\.json"$' "$WORKFLOW" 2>/dev/null || true)
check_equals 2 "$(printf '%s' "$manifest_filters" | tr -d ' ')" \
  'db.yml watches the manifest that pins better-auth, on both events'

# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------

printf '\nDocumentation\n'

check_contains "$README" 'betterauth-schema\.sql' 'README.md documents the snapshot'
check_contains "$README" 'betterauth-schema\.mjs' 'README.md documents the verb that renders it'
check_contains "$README" 'drift' 'README.md says what the check is for'

check_summary
