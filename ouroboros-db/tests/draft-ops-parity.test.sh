#!/usr/bin/env sh
#
# draft-ops-parity.test.sh — tests for ci/db's draft-operation parity check (#556, CC.2): the verb
# scripts/draft-ops-parity.mjs, the operation schema it compiles, the query that feeds it, and the
# step that runs the two.
#
# What ci/db asserts is the answer for the operations a real seeded database stores. What is
# asserted here needs no database: the verb is run for real over the committed operation fixtures
# — green over the valid ones, red over each invalid one, and red over the valid ones once the DSL
# has been tightened underneath them. That last case is the ticket's "a future schema change to
# the DSL surfaces here as a failing parity test", kept as a standing assertion.
#
# Usage:
#   ouroboros-db/tests/draft-ops-parity.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests       # the module's suite
#
# It needs node and the workspace installed (`yarn install`).
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
SCRIPTS_DIR="$REPO_ROOT/scripts"

. "$SCRIPTS_DIR/lib/checks.sh"

CHECK="$MODULE_DIR/scripts/draft-ops-parity.mjs"
QUERY="$TEST_DIR/lib/draft-operations.sql"
MIGRATION="$MODULE_DIR/migrations/V110__draft_operations.sql"
DSL="$REPO_ROOT/schemas/workflow-dsl/v1.json"
OPERATIONS="$REPO_ROOT/schemas/workflow-dsl/operations-v1.json"
FIXTURES="$REPO_ROOT/schemas/workflow-dsl/operations/fixtures"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# run_check [ARG...] — run the verb, leaving its combined output in $out and status in $status.
run_check() {
  out=$(node "$CHECK" "$@" 2>&1)
  status=$?
}

# operations FILE FIXTURE... — write an operations file in the shape draft-operations.sql prints,
# one entry per fixture (a path under the operation fixtures), numbered in order.
operations() {
  operations_file=$1
  shift
  operations_separator=
  operations_seq=0
  {
    printf '['
    for operations_fixture in "$@"; do
      operations_seq=$((operations_seq + 1))
      printf '%s{"workflow": "fixture/draft", "base_version": null, "draft_rev": 1, "seq": %s, "op": ' \
        "$operations_separator" "$operations_seq"
      cat "$FIXTURES/$operations_fixture"
      printf '}'
      operations_separator=', '
    done
    printf ']\n'
  } >"$operations_file"
}

printf '\nouroboros-db — the draft-operation parity check\n\n'

printf 'The verb and its schema\n'

check_exists "$CHECK" 'scripts/draft-ops-parity.mjs exists'
check_executable "$CHECK" 'and is executable, like the module'"'"'s other scripts'
check_contains "$CHECK" '^#!/usr/bin/env node$' 'and says what runs it'
check_contains "$CHECK" 'new Ajv2020\(\{ allErrors: true, strict: true \}\)' \
  'it compiles with every error reported and strict mode on, as the drift check does'
check_contains "$CHECK" 'ajv\.addSchema\(dsl\)' 'with the DSL registered for the operation schema'"'"'s references'
check_exists "$OPERATIONS" 'schemas/workflow-dsl/operations-v1.json exists'
check_contains "$OPERATIONS" '"\$ref": "v1\.json#/\$defs/node"' \
  'and takes its node from the DSL rather than restating it'
check_contains "$OPERATIONS" '"\$ref": "v1\.json#/\$defs/edge"' 'and its edge'
check_contains "$OPERATIONS" '"\$ref": "v1\.json#/\$defs/trigger"' 'and its trigger'
check_absent "$OPERATIONS" '"const": "set_guard"' 'set_guard is not in the vocabulary while DSL v1 has no guard'

# The verb's vocabulary, the migration's CHECK and the fixtures name the same six kinds.
for kind in add_stage set_stage remove_stage add_edge remove_edge set_trigger; do
  check_contains "$OPERATIONS" "\"const\": \"$kind\"" "the schema knows $kind"
  check_contains "$MIGRATION" "'$kind'" "and so does V110's envelope CHECK"
done

if ! command -v node >/dev/null 2>&1; then
  fail 'node is available to run the check'
  check_summary
  exit 1
fi

printf '\nArgument handling\n'

run_check --help
check_equals 0 "$status" '--help succeeds'
check_matches "$out" 'draft-ops-parity\.mjs OPERATIONS\.json' 'and documents how ci/db calls it'

run_check
check_equals 2 "$status" 'no operations file is refused rather than assumed'

run_check --strict
check_equals 2 "$status" 'an unknown argument is refused'

run_check "$work/nowhere.json"
check_equals 2 "$status" 'an operations file that is not there is a check that could not run'

printf '{"op": {}}\n' >"$work/object.json"
run_check "$work/object.json"
check_equals 2 "$status" 'an operations file that is not an array is refused'

printf '[{"workflow": "a/b", "base_version": null, "draft_rev": 1, "seq": 1}]\n' >"$work/no-op.json"
run_check "$work/no-op.json"
check_equals 2 "$status" 'an entry with no op is a broken extraction, not an invalid operation'

printf '[]\n' >"$work/empty.json"
run_check "$work/empty.json"
check_equals 0 "$status" 'an empty log is green — nothing recorded is a true answer'
check_matches "$out" 'no draft operations are stored' 'and says so'

printf '\nVerdicts over the committed fixtures\n'

set --
for fixture in "$FIXTURES"/valid/*.json; do
  set -- "$@" "valid/$(basename "$fixture")"
done
valid_count=$#
operations "$work/valid.json" "$@"

run_check "$work/valid.json"
check_equals 0 "$status" 'every valid operation fixture validates against the DSL'
check_matches "$out" "all $valid_count stored draft operations validate" 'and the summary counts them'
check_matches "$out" 'ok +fixture/draft v0\.1 #1 ' 'each is named by workflow, revision, position and kind'

out=$(node "$CHECK" - <"$work/valid.json" 2>&1)
status=$?
check_equals 0 "$status" 'the operations can be piped in on stdin'

for fixture in "$FIXTURES"/invalid/*.json; do
  name=$(basename "$fixture")
  operations "$work/invalid.json" "valid/add-stage.json" "invalid/$name"
  run_check "$work/invalid.json"
  check_equals 1 "$status" "invalid/$name fails the parity check"
  check_matches "$out" 'FAIL +fixture/draft v0\.1 #2' 'and the failing operation is the one named'
  check_matches "$out" 'ok +fixture/draft v0\.1 #1 add_stage' 'while the valid one beside it passes'
done

# A DSL tightened under recorded history must turn it red: an infra stage that now requires a
# runner pool rejects the add_stage fixture, which names none.
node -e '
  const fs = require("fs");
  const dsl = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  dsl.$defs.infra_config.required = ["runner_pool"];
  fs.writeFileSync(process.argv[2], JSON.stringify(dsl));
' "$DSL" "$work/tightened.json"
operations "$work/history.json" valid/add-stage.json
run_check --dsl "$work/tightened.json" "$work/history.json"
check_equals 1 "$status" 'a DSL change that rejects recorded history fails the parity check'
check_matches "$out" 'no longer validate against the DSL' 'and says history and the DSL have drifted'

printf '\nThe query and the step\n'

check_exists "$QUERY" 'tests/lib/draft-operations.sql exists'
check_contains "$QUERY" 'from ouroboros\.draft_operations' 'and reads the stored operations'
check_contains "$QUERY" "'op', +o\\.op" 'and emits each op'
check_absent "$QUERY" '^ *(insert|update|delete)' 'and writes nothing'
check_contains "$WORKFLOW" 'tests/lib/draft-operations\.sql' 'ci/db runs the query against the seeded database'
check_contains "$WORKFLOW" 'ouroboros-db/scripts/draft-ops-parity\.mjs' 'and pipes it into the verb'
check_contains "$WORKFLOW" '"schemas/workflow-dsl/operations-v1\.json"' \
  'and runs when the operation schema changes'

check_summary
