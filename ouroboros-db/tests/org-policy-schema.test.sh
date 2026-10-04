#!/usr/bin/env sh
#
# org-policy-schema.test.sh — tests for the org-policy document's committed JSON Schema and the
# ci/db check over it (#480, BQ.1): schemas/org-policy/v1.json, its golden fixtures, the verb
# scripts/org-policy-schema.mjs and the query that feeds it stored versions.
#
# What the database refuses — immutability, numbering, the envelope — is constraints.sql's.
# What is asserted here needs no database: that the schema expresses the mockup's five rules
# with their exact chip terms, refuses each malformation the ticket names, admits a `custom:*`
# rule without a schema change, carries money only as integer cents, and that the check goes red
# when the schema drifts in either direction. It runs in ci/db's module tooling step.
#
# Usage:
#   ouroboros-db/tests/org-policy-schema.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests        # the module's suite
#
# It needs node and the workspace installed (`yarn install`).
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")

. "$REPO_ROOT/scripts/lib/checks.sh"

CHECK="$MODULE_DIR/scripts/org-policy-schema.mjs"
QUERY="$TEST_DIR/lib/stored-policy-documents.sql"
MIGRATION="$MODULE_DIR/migrations/V092__org_policy_versions.sql"
SCHEMA="$REPO_ROOT/schemas/org-policy/v1.json"
FIXTURES="$REPO_ROOT/schemas/org-policy/fixtures"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

run_check() {
  out=$(node "$CHECK" "$@" 2>&1)
  status=$?
}

# node_check DESCRIPTION SCRIPT [ARG...] — a check whose verdict is a node script's exit status;
# the script prints why when it fails.
node_check() {
  node_check_description=$1
  shift
  if node_check_out=$(node -e "$@" 2>&1); then
    pass "$node_check_description"
  else
    fail "$node_check_description ($node_check_out)"
  fi
}

printf '\nouroboros-db — the org-policy document schema\n\n'

printf 'The verb\n'

check_exists "$CHECK" 'scripts/org-policy-schema.mjs exists'
check_executable "$CHECK" 'and is executable, like the module'"'"'s other scripts'
check_contains "$CHECK" '"schemas", "org-policy", "v1\.json"' \
  'it validates against the committed schema unless told otherwise'
check_contains "$CHECK" 'new Ajv2020\(\{ allErrors: true, strict: true \}\)' \
  'with the options the workflow DSL check uses: every error, strict mode'
check_contains "$CHECK" '"schemas", "workflow-dsl", "v1\.json"' \
  'and with the workflow DSL schema loaded, whose vocabulary it references'
check_contains "$SCHEMA" '"\$schema": "https://json-schema\.org/draft/2020-12/schema"' \
  'the schema declares JSON Schema 2020-12'
check_contains "$SCHEMA" 'workflow-dsl/v1\.json#/\$defs/effort' \
  'effort is the workflow DSL'"'"'s vocabulary, by reference (#133)'
check_contains "$SCHEMA" 'workflow-dsl/v1\.json#/\$defs/path_glob' \
  'and so is path_glob'

if ! command -v node >/dev/null 2>&1; then
  fail 'node is available to run the check'
  check_summary
  exit 1
fi

printf '\nArgument handling\n'

run_check --help
check_equals 0 "$status" '--help succeeds'
check_matches "$out" 'org-policy-schema\.mjs --fixtures' 'and documents the fixtures mode'
check_not_matches "$out" '^#!|^import ' 'and prints the header prose rather than the file'

run_check
check_equals 2 "$status" 'no mode is refused rather than assumed'

run_check --strict
check_equals 2 "$status" 'an unknown argument is refused'
check_matches "$out" 'unknown argument: --strict' 'and named'

run_check --schema
check_equals 2 "$status" '--schema with no path is refused'

run_check "$work/nowhere.json"
check_equals 2 "$status" 'a documents file that is not there is a check that could not run'

printf '{"organization": "a", "version": 1, "document": {}}\n' >"$work/object.json"
run_check "$work/object.json"
check_equals 2 "$status" 'a documents file that is not an array is refused'

printf '[{"organization": "a", "version": "7", "document": {}}]\n' >"$work/string-version.json"
run_check "$work/string-version.json"
check_equals 2 "$status" 'an entry whose version is not an integer is a broken extraction, not a verdict'
check_matches "$out" 'entry 0 is not' 'and the entry is named'

printf '{"type": "object", "colour": "red"}\n' >"$work/unknown-keyword.json"
run_check --schema "$work/unknown-keyword.json" --fixtures
check_equals 2 "$status" 'a schema strict mode refuses is a check that could not run'
check_matches "$out" 'the schema does not compile' 'and the schema is named as the problem'

mkdir -p "$work/only-valid/valid"
cp "$FIXTURES/valid/policy-v7.json" "$work/only-valid/valid/"
run_check --fixtures "$work/only-valid"
check_equals 2 "$status" 'a fixtures directory with no invalid case proves nothing and is refused'

printf '\nThe golden fixtures\n'

run_check --fixtures
check_equals 0 "$status" 'every valid fixture validates and every invalid one is refused'
check_matches "$out" 'all [0-9]+ verdicts as expected against schemas/org-policy/v1\.json' \
  'and the summary counts them and names the schema'

# The ticket's named malformations, each a fixture of its own so a refusal is about one thing.
for fixture in unknown-rule-id unknown-predicate float-cents string-cents negative-first-n-loops; do
  check_exists "$FIXTURES/invalid/$fixture.json" "the schema is held to refusing $fixture"
  check_matches "$out" "ok +invalid/$fixture " "and refuses it"
done
check_matches "$out" 'ok +invalid/unknown-rule-id .*"additionalProperty":"auto_approve"' \
  'an unknown rule id is refused by name'
check_matches "$out" 'ok +invalid/float-cents .*must be integer' 'non-integer cents are refused as not an integer'
check_matches "$out" 'ok +invalid/negative-first-n-loops .*must be >= 0' 'a negative first_n_loops is refused'

check_matches "$out" 'ok +valid/custom-rule$' 'a custom:* rule validates — the escape hatch needs no schema change'
check_contains "$SCHEMA" '"\^custom:\[a-z0-9\]' 'the escape hatch is a pattern, not a list'

printf '\nThe mockup'"'"'s five rules, with their exact chip terms\n'

node_check 'policy v7 round-trips: effort ≤ M · non-refactor, refactor OR effort ≥ L, the three globs, $2.50/run, $600/provider/month, first 10 loops' '
  const assert = require("assert");
  const doc = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const expected = {
    auto_merge:        { enabled: true, conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] } },
    human_review:      { enabled: true, conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] } },
    protected_paths:   { enabled: true, conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] } },
    spend_guard:       { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
    dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
  };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(doc)), expected);
' "$FIXTURES/valid/policy-v7.json"

node_check 'the migration header documents that same document, so the database and the schema describe one shape' '
  const fs = require("fs");
  const assert = require("assert");
  const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "--   {");
  const end = lines.findIndex((line, index) => index > start && line.trim() === "--   }");
  if (start < 0 || end < 0) throw new Error("no document block in the header");
  const text = lines.slice(start, end + 1).map((line) => line.replace(/^--\s*/, "")).join("\n");
  const fixture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  assert.deepStrictEqual(JSON.parse(text), fixture);
' "$MIGRATION" "$FIXTURES/valid/policy-v7.json"

printf '\nMoney is integer cents throughout\n'

check_absent "$MIGRATION" '^ *(add column +)?[a-z_]+ +(real|double precision|float[0-9]*|numeric|decimal|money)\b' \
  'no float, numeric or money column is declared by the migration (constraints.sql asks the catalogue too)'
check_absent "$MIGRATION" '_cents"?: *-?[0-9]+\.[0-9]' 'and no float literal carries cents in it'
node_check 'every *_cents in the schema is an integer' '
  const schema = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const found = [];
  const walk = (node, path) => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith("_cents")) found.push([path + "/" + key, value]);
      walk(value, path + "/" + key);
    }
  };
  walk(schema, "");
  if (found.length === 0) throw new Error("no _cents property found");
  for (const [where, value] of found) {
    if (value.$ref !== "#/$defs/cents") throw new Error(where + " does not use $defs/cents");
  }
  if (schema.$defs.cents.type !== "integer") throw new Error("$defs/cents is not an integer");
' "$SCHEMA"
node_check 'and every *_cents value in a valid fixture is an integer' '
  const fs = require("fs");
  const path = require("path");
  const dir = process.argv[1];
  const walk = (node, where) => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith("_cents") && !Number.isInteger(value)) throw new Error(where + "/" + key + " is " + value);
      walk(value, where + "/" + key);
    }
  };
  const texts = fs.readdirSync(dir).map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]);
  for (const [name, text] of texts) {
    if (/_cents"\s*:\s*-?\d+\.\d/.test(text)) throw new Error(name + " carries a float literal");
    walk(JSON.parse(text), name);
  }
' "$FIXTURES/valid"

printf '\nThe absorption mapping\n'

for source in '#382' '#358' '#380' '#237' '#194'; do
  check_contains "$MIGRATION" "\\($source|$source[ ,)]" "the migration documents what it absorbs from $source"
done
check_contains "$MIGRATION" 'Precedence: the stricter' 'and states the cap precedence rule'
check_contains "$MIGRATION" 'stricter override' 'and what the dry-run boolean becomes'

printf '\nDocuments mode\n'

node -e '
  const fs = require("fs");
  const v7 = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bad = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  fs.writeFileSync(process.argv[3], JSON.stringify([
    { organization: "acme-robotics", version: 6, document: v7 },
    { organization: "acme-robotics", version: 7, document: v7 },
  ]));
  fs.writeFileSync(process.argv[4], JSON.stringify([
    { organization: "acme-robotics", version: 6, document: v7 },
    { organization: "acme-robotics", version: 7, document: bad },
  ]));
' "$FIXTURES/valid/policy-v7.json" "$FIXTURES/invalid/float-cents.json" "$work/stored.json" "$work/stored-bad.json"

run_check "$work/stored.json"
check_equals 0 "$status" 'stored versions the schema accepts are green'
check_matches "$out" 'ok +acme-robotics policy v7$' 'each named the way the card tags it'

out=$(node "$CHECK" - <"$work/stored.json" 2>&1)
status=$?
check_equals 0 "$status" 'the documents can be piped in on stdin'

run_check "$work/stored-bad.json"
check_equals 1 "$status" 'a stored version the schema refuses turns the check red'
check_matches "$out" 'FAIL +acme-robotics policy v7' 'naming the version'
check_matches "$out" 'per_run_cap_cents must be integer' 'and why'
check_matches "$out" 'ok +acme-robotics policy v6$' 'without hiding the versions that still pass'

printf '[]\n' >"$work/empty.json"
run_check "$work/empty.json"
check_equals 0 "$status" 'no stored versions is green: versions are published by people, and the seed'"'"'s come with BQ.5'
check_matches "$out" 'no stored policy versions' 'and says there was nothing to check'

printf '\nRed on schema drift, in both directions\n'

node -e '
  const fs = require("fs");
  const schema = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  schema.required = [...schema.required, "owner"];
  schema.properties.owner = { type: "string" };
  fs.writeFileSync(process.argv[2], JSON.stringify(schema));
  const loose = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  loose.$defs.cents = { type: "number", minimum: 1 };
  fs.writeFileSync(process.argv[3], JSON.stringify(loose));
' "$SCHEMA" "$work/tightened.json" "$work/loosened.json"

run_check --schema "$work/tightened.json" --fixtures
check_equals 1 "$status" 'a schema tightened past the valid fixtures turns red'
check_matches "$out" 'FAIL +valid/policy-v7 — refused' 'naming the fixture it now refuses'

run_check --schema "$work/loosened.json" --fixtures
check_equals 1 "$status" 'a schema loosened to admit float cents turns red'
check_matches "$out" 'FAIL +invalid/float-cents — accepted' 'naming the fixture it now accepts'

printf '\nci/db\n'

check_contains "$QUERY" 'from ouroboros\.org_policy_versions' 'the query reads the stored versions'
check_contains "$QUERY" "'organization', +org\\.\"slug\"" 'naming each by its workspace slug'
check_contains "$WORKFLOW" 'org-policy-schema\.mjs' 'ci/db runs the check over the seeded database'
check_contains "$WORKFLOW" 'stored-policy-documents\.sql' 'fed by the query'
check_contains "$WORKFLOW" '"schemas/org-policy/\*\*"' 'and a schema or fixture change reaches ci/db'

check_summary
