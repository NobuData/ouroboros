#!/usr/bin/env sh
#
# workflow-dsl-drift.test.sh — tests for ci/db's schema drift check (#137, P.6): the verb
# scripts/workflow-dsl-drift.mjs, the query that feeds it, and the step that runs the two.
#
# What ci/db asserts is the answer for the real seeded rows, against a real PostgreSQL. What is
# asserted here is everything that needs no database, and that is most of the check, because
# the verb reads a JSON file rather than a connection. So it is run for real over the committed
# golden fixtures: green over the valid ones, red over an invalid one, and red over the valid
# ones once the schema has been tightened underneath them. That last case is the ticket's
# *"red on schema drift"*, kept as a standing assertion rather than spot-checked once.
#
# Usage:
#   ouroboros-db/tests/workflow-dsl-drift.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests         # the module's suite
#   scripts/run-tests.sh                            # every suite in the repository
#
# It needs node and the workspace installed (`yarn install`), which ci/db's tooling step has.
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
SCRIPTS_DIR="$REPO_ROOT/scripts"

. "$SCRIPTS_DIR/lib/checks.sh"

CHECK="$MODULE_DIR/scripts/workflow-dsl-drift.mjs"
QUERY="$TEST_DIR/lib/seeded-definitions.sql"
SEED="$MODULE_DIR/migrations/R__dev_seed_workflows.sql"
SCHEMA="$REPO_ROOT/schemas/workflow-dsl/v1.json"
FIXTURES="$REPO_ROOT/schemas/workflow-dsl/fixtures"
CONFORMANCE="$REPO_ROOT/ouroboros-rest/src/modules/workflows/dsl.conformance.spec.ts"
README="$MODULE_DIR/README.md"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# run_check [ARG...] — run the verb, leaving its combined output in $out and its exit status
# in $status.
run_check() {
  out=$(node "$CHECK" "$@" 2>&1)
  status=$?
}

# documents FILE ENTRY... — write a documents file in the shape seeded-definitions.sql prints.
#
# Each ENTRY is WORKFLOW:VERSION:FIXTURE — VERSION a number or `draft`, FIXTURE a path under
# schemas/workflow-dsl/fixtures. Every fixture is a JSON object already, so it is spliced into
# the array as it stands and no JSON tool is needed to build one.
documents() {
  documents_file=$1
  shift
  documents_separator=
  {
    printf '['
    for documents_entry in "$@"; do
      documents_workflow=${documents_entry%%:*}
      documents_rest=${documents_entry#*:}
      documents_version=${documents_rest%%:*}
      documents_fixture=${documents_rest#*:}
      [ "$documents_version" = draft ] && documents_version=null
      printf '%s{"workflow": "%s", "version": %s, "definition": ' \
        "$documents_separator" "$documents_workflow" "$documents_version"
      cat "$FIXTURES/$documents_fixture"
      printf '}'
      documents_separator=', '
    done
    printf ']\n'
  } >"$documents_file"
}

printf '\nouroboros-db — the workflow schema drift check\n\n'

# ---------------------------------------------------------------------------
# The verb
# ---------------------------------------------------------------------------

printf 'The verb\n'

check_exists "$CHECK" 'scripts/workflow-dsl-drift.mjs exists'
check_executable "$CHECK" 'and is executable, like the module'"'"'s other scripts'
check_contains "$CHECK" '^#!/usr/bin/env node$' 'and says what runs it'

# The committed schema by default, compiled the way ouroboros-rest's conformance suite compiles
# it. Two compilations of one schema under different options would be two answers to "is this
# document valid", and the drift check exists to have one.
check_contains "$CHECK" '"schemas", "workflow-dsl", "v1\.json"' \
  'it validates against the committed schema unless told otherwise'
check_contains "$CHECK" 'ajv/dist/2020' 'with ajv'"'"'s JSON Schema 2020-12 build'
check_contains "$SCHEMA" '"\$schema": "https://json-schema\.org/draft/2020-12/schema"' \
  'which is the dialect v1.json declares'
check_contains "$CHECK" 'new Ajv2020\(\{ allErrors: true, strict: true \}\)' \
  'every error reported, and strict mode on'
check_contains "$CONFORMANCE" 'new Ajv2020\(\{ allErrors: true, strict: true \}\)' \
  'which are the options ouroboros-rest'"'"'s conformance suite compiles the same schema with'

# Borrowed from the module that already depends on it rather than from whichever copy happens
# to be hoisted: ouroboros-db declares no dependencies of its own.
check_contains "$CHECK" '"ouroboros-rest", "package\.json"' \
  'it resolves ajv through ouroboros-rest'
check_contains "$REPO_ROOT/ouroboros-rest/package.json" '"ajv": ' \
  'and ouroboros-rest declares that dependency'

if ! command -v node >/dev/null 2>&1; then
  fail 'node is available to run the check'
  check_summary
  exit 1
fi

# ---------------------------------------------------------------------------
# Argument handling, and the inputs it refuses to guess about
# ---------------------------------------------------------------------------

printf '\nArgument handling\n'

run_check --help
check_equals 0 "$status" '--help succeeds'
check_matches "$out" 'workflow-dsl-drift\.mjs DOCUMENTS\.json' 'and documents how ci/db calls it'
check_not_matches "$out" '^#!|^import ' 'and prints the header prose rather than the file'

run_check
check_equals 2 "$status" 'no documents file is refused rather than assumed'
check_matches "$out" 'name the documents file' 'and says what is missing'

run_check --strict
check_equals 2 "$status" 'an unknown argument is refused'
check_matches "$out" 'unknown argument: --strict' 'and named'

run_check --schema
check_equals 2 "$status" '--schema with no path is refused'

printf '[]\n' >"$work/empty.json"
run_check "$work/empty.json" "$work/empty.json"
check_equals 2 "$status" 'two documents files at once are refused'

run_check "$work/nowhere.json"
check_equals 2 "$status" 'a documents file that is not there is a check that could not run'
check_matches "$out" 'could not read the documents file' 'and says which file it could not read'

printf 'not json\n' >"$work/prose.json"
run_check "$work/prose.json"
check_equals 2 "$status" 'a documents file that is not JSON could not be checked, rather than failed'
check_matches "$out" 'is not JSON' 'and says so'

printf '{"workflow": "a/b", "version": 1, "definition": {}}\n' >"$work/object.json"
run_check "$work/object.json"
check_equals 2 "$status" 'a documents file that is not an array is refused'
check_matches "$out" 'must be a JSON array' 'and says what shape it wants'

# A missing definition is a broken extraction rather than a drifted seed, so it is refused as
# "could not run": calling it invalid would describe the query, not the seed.
printf '[{"workflow": "a/b", "version": 1}]\n' >"$work/no-definition.json"
run_check "$work/no-definition.json"
check_equals 2 "$status" 'an entry with no definition is refused rather than reported invalid'
check_matches "$out" 'entry 0 is not' 'and the entry is named'

printf '[{"workflow": "a/b", "version": "14", "definition": {}}]\n' >"$work/string-version.json"
run_check "$work/string-version.json"
check_equals 2 "$status" 'and so is one whose version is neither an integer nor null'

# Strict mode is the point of compiling the schema at all: a keyword ajv does not know is a
# schema that is subtly not the document its author read, and it must not validate anything.
printf '{"type": "object", "colour": "red"}\n' >"$work/unknown-keyword.json"
run_check --schema "$work/unknown-keyword.json" "$work/empty.json"
check_equals 2 "$status" 'a schema strict mode refuses is a check that could not run'
check_matches "$out" 'the schema does not compile' 'and the schema is named as the problem'

# ---------------------------------------------------------------------------
# Verdicts over the committed fixtures
# ---------------------------------------------------------------------------

printf '\nVerdicts over the committed fixtures\n'

# Every valid golden document at v1, and standard-fix once more as a draft — the seed's own
# shape, since its draft carries v14's document. Globbed rather than listed, so a valid fixture
# added later is checked here without this file being edited.
set --
for fixture in "$FIXTURES"/valid/*.json; do
  fixture_name=$(basename "$fixture" .json)
  set -- "$@" "fixture/$fixture_name:1:valid/$fixture_name.json"
done
valid_count=$(($# + 1))
documents "$work/valid.json" "$@" 'fixture/standard-fix:draft:valid/standard-fix.json'

run_check "$work/valid.json"
check_equals 0 "$status" 'every valid fixture validates against the committed schema'
check_matches "$out" "all $valid_count seeded definitions validate against schemas/workflow-dsl/v1\\.json" \
  'and the summary counts them and names the schema'
check_matches "$out" 'ok +fixture/standard-fix v1$' 'each document is named by workflow and version'
check_matches "$out" 'ok +fixture/standard-fix draft$' 'and the unnumbered row is named as the draft'

out=$(node "$CHECK" - <"$work/valid.json" 2>&1)
status=$?
check_equals 0 "$status" 'the documents can be piped in on stdin'

# The committed standard-fix fixture is the seed's v14 written out, so the green case above is
# a statement about the canvas ci/db reads back too.
check_contains "$SEED" 'schemas/workflow-dsl/fixtures/valid/standard-fix\.json' \
  'the seed says its v14 canvas is that fixture'

documents "$work/invalid.json" \
  'fixture/minimal:1:valid/minimal.json' \
  'fixture/node-unknown-property:3:invalid/node-unknown-property.json'
run_check "$work/invalid.json"
check_equals 1 "$status" 'a document the schema refuses turns the check red'
check_matches "$out" 'FAIL +fixture/node-unknown-property v3$' 'and names the version that failed'
check_matches "$out" '/nodes/1 must NOT have additional properties \{"additionalProperty":"colour"\}' \
  'with the pointer, the reason and the property ajv found'
check_matches "$out" 'ok +fixture/minimal v1$' 'without hiding the documents that still pass'
check_matches "$out" '1 of 2 seeded definitions no longer validate' 'and counts what drifted'
check_matches "$out" 'R__dev_seed_workflows\.sql' 'and names the file the fix goes in'

run_check "$work/empty.json"
check_equals 1 "$status" 'no documents at all is red, because a drift check over nothing proves nothing'
check_matches "$out" 'flyway\.seed\.toml' 'and names the overlay that would have written them'

# ---------------------------------------------------------------------------
# Red on schema drift
# ---------------------------------------------------------------------------

printf '\nRed on schema drift\n'

# The ticket's acceptance criterion as a standing assertion. A copy of the schema is tightened —
# a required top-level property no document carries — and the same documents that were green a
# moment ago must now be red. That is exactly a schema change made without migrating the seeds.
node -e '
  const fs = require("fs");
  const schema = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  schema.required = [...schema.required, "owner"];
  schema.properties.owner = { type: "string" };
  fs.writeFileSync(process.argv[2], JSON.stringify(schema));
' "$SCHEMA" "$work/drifted-v1.json"

run_check --schema "$work/drifted-v1.json" "$work/valid.json"
check_equals 1 "$status" 'the same documents turn red when the schema tightens underneath them'
check_matches "$out" 'FAIL +fixture/standard-fix v1$' 'naming the documents the new rule refuses'
check_matches "$out" "must have required property 'owner'" 'and the rule that refuses them'

run_check "$work/valid.json"
check_equals 0 "$status" 'while the committed schema, untouched, still passes them'

# ---------------------------------------------------------------------------
# The query that feeds it
# ---------------------------------------------------------------------------

printf '\nThe query that feeds it\n'

check_exists "$QUERY" 'tests/lib/seeded-definitions.sql exists'

# Scoped to the rows the seed wrote, so a draft somebody made in the studio — an empty {} is a
# legal one — cannot fail a check about the seeds.
check_contains "$QUERY" "like '5eed001c-%'" 'it reads only the rows the workflows seed wrote'
check_contains "$SEED" "'5eed001c-0000-4000-8000-'" \
  'and that is the prefix the seed builds its version ids from'

# Nothing but the JSON may reach stdout, or the verb reads prose and refuses the file.
check_contains "$QUERY" '^\\set QUIET on$' 'it silences psql before formatting the output'
check_contains "$QUERY" '^\\pset format unaligned$' 'prints unaligned'
check_contains "$QUERY" '^\\pset tuples_only on$' 'and prints the value with no header or footer'

for key in workflow version definition; do
  check_contains "$QUERY" "'$key'" "it emits the $key key"
  check_contains "$CHECK" "entry\\.$key|\"$key\"" "and the verb reads the $key key"
done

check_absent "$QUERY" '^[[:space:]]*(insert|update|delete|begin|commit|rollback|create|alter|drop)\b' \
  'and it writes nothing, so it is safe against any database'

# ---------------------------------------------------------------------------
# What runs it
# ---------------------------------------------------------------------------

printf '\nWhat runs it\n'

drift_step=$(sed -n '/- name: Assert every seeded workflow definition/,/^      - name:/p' "$WORKFLOW")
check_matches "$drift_step" 'name: Assert every seeded workflow definition' \
  'ci/db has a step for the drift check'
check_matches "$drift_step" '-d "\$SEED_DB_NAME"' 'which reads the seeded database'
check_matches "$drift_step" '/tests/lib/seeded-definitions\.sql' 'through the committed query'
check_matches "$drift_step" 'ouroboros-db/scripts/workflow-dsl-drift\.mjs "\$RUNNER_TEMP/seeded-definitions\.json"' \
  'and hands what it read to the verb'

# After the seed exists. Before it, the query reads an empty database and the verb is — rightly
# — red for a reason that has nothing to do with drift.
seed_line=$(grep -n 'name: Assert what the seed put there' "$WORKFLOW" | head -n 1 | cut -d: -f1)
drift_line=$(grep -n 'name: Assert every seeded workflow definition' "$WORKFLOW" | head -n 1 | cut -d: -f1)
if [ -n "$seed_line" ] && [ -n "$drift_line" ] && [ "$drift_line" -gt "$seed_line" ]; then
  pass 'and it runs after the seed has been applied and asserted'
else
  fail 'and it runs after the seed has been applied and asserted (it does not)'
fi

# A schema-only change touches nothing under ouroboros-db/, and it is precisely the change this
# check exists for. Twice: pull_request and push carry separate filters.
schema_filters=$(grep -c '^      - "schemas/workflow-dsl/v1\.json"$' "$WORKFLOW" 2>/dev/null || true)
check_equals 2 "$(printf '%s' "$schema_filters" | tr -d ' ')" \
  'db.yml watches the DSL schema on both events, so a schema-only change runs the check'

# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------

printf '\nDocumentation\n'

check_contains "$README" 'workflow-dsl-drift\.mjs' 'README.md documents the verb'
check_contains "$README" 'seeded-definitions\.sql' 'and the query that feeds it'
check_contains "$REPO_ROOT/schemas/README.md" 'workflow-dsl-drift\.mjs' \
  'schemas/README.md lists it among the readers of v1.json'

check_summary
