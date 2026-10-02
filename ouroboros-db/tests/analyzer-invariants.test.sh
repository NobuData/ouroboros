#!/usr/bin/env sh
#
# analyzer-invariants.test.sh — tests for BU.4's (#509) Build Analyzer probes and the two scripts
# that prove them: tests/verify-analyzer-invariants.sh, which plants bad rows under the invariants,
# and tests/verify-analyzer-rediscovery.sh, which runs the change-point analyzer over the seeded
# corpus.
#
# All three need a seeded PostgreSQL to *run*, so what they do to one is asserted where one exists:
# the `ci/db` steps that run them. What is asserted here is everything that can be decided without
# a daemon, a network or the engine's environment:
#
#   * what each script decides before it connects — the arguments it accepts, the ones it refuses,
#     and its refusal to go on with no password (or, for the rediscovery, no uv);
#   * that the pieces agree. Every marker the verifier requires is an invariant name
#     lib/analyzer-invariants.sql actually asserts; every rule it drops or disables is one a
#     migration creates; every seed id it plants against is one the seed writes; the fragment is
#     reached by its suite and both scripts by CI. A plant aimed at a renamed rule or a moved seed
#     id fails on its own statement, which the marker then reports as a mismatch — but only in
#     CI, so it is caught here first.
#
# Usage:
#   ouroboros-db/tests/analyzer-invariants.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests          # the module's suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")

. "$REPO_ROOT/scripts/lib/checks.sh"

VERIFIER="$TEST_DIR/verify-analyzer-invariants.sh"
REDISCOVERY="$TEST_DIR/verify-analyzer-rediscovery.sh"
FRAGMENT="$TEST_DIR/lib/analyzer-invariants.sql"
STANDALONE="$TEST_DIR/analyzer-invariants.sql"
CORPUS="$TEST_DIR/lib/analyzer-corpus.sql"
REDISCOVER="$TEST_DIR/lib/rediscover.py"
SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_metrics_analyzer.sql"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# run_script SCRIPT [ARG...] — run a verifier with no password in the environment, leaving its
# combined output in $out and its exit status in $status. PGPASSWORD is unset rather than blanked,
# so nothing here can reach a database whatever the machine is running.
run_script() {
  script=$1
  shift
  out=$(env -u PGPASSWORD "$script" "$@" 2>&1)
  status=$?
}

for script in "$VERIFIER" "$REDISCOVERY"; do
  name=$(basename -- "$script")
  printf '\n%s — usage and refusals\n' "$name"

  check_executable "$script" "$name is executable"

  run_script "$script" --help
  check_equals 0 "$status" '--help exits zero'
  check_matches "$out" 'PGPASSWORD' '--help says which credential it needs'
  check_matches "$out" 'seeded database' '--help says which database it needs'

  run_script "$script" --no-such-flag
  check_equals 2 "$status" 'an unknown argument exits 2'
  check_matches "$out" 'unknown argument' 'and says which argument it did not know'

  run_script "$script" --runner bogus
  check_equals 2 "$status" 'an unknown runner exits 2'
  check_matches "$out" 'auto, psql or docker' 'and names the runners there are'

  run_script "$script" --runner
  check_equals 2 "$status" '--runner with no value exits 2'

  run_script "$script"
  check_equals 2 "$status" 'no PGPASSWORD exits 2'
  check_matches "$out" 'PGPASSWORD' 'and names the variable that would fix it'
done

run_script "$VERIFIER" --help
check_matches "$out" 'red-then-green' 'the verifier says it is the probe criterion'
run_script "$REDISCOVERY" --help
check_matches "$out" 'rediscovers' 'the rediscovery script says what it proves'

# Without uv the analyzer cannot run, and the script says so rather than failing later. PATH holds
# only the few tools it needs to get that far.
mkdir "$work/bin"
for tool in sh awk dirname; do
  ln -s "$(command -v "$tool")" "$work/bin/$tool"
done
out=$(PGPASSWORD=unused PATH="$work/bin" "$REDISCOVERY" 2>&1)
status=$?
check_equals 2 "$status" 'with no uv on PATH the rediscovery exits 2'
check_matches "$out" 'uv is not on PATH' 'and says what is missing'

printf '\nThe markers, the fragment, the migrations and the seed agree\n'

markers=$(awk "/^expect_red '/ { getline; sub(/^ *'/, \"\"); sub(/' \\\\\$/, \"\"); print }" "$VERIFIER")
marker_count=$(printf '%s\n' "$markers" | grep -c .)
check_equals 10 "$marker_count" 'the verifier plants ten bad rows'

printf '%s\n' "$markers" | while IFS= read -r marker; do
  if grep -qF -- "'$marker" "$FRAGMENT"; then
    pass "the fragment asserts [$marker]"
  else
    fail "the fragment asserts [$marker] (no assertion message opens with it)"
  fi
done

# #509's probe list — vocabularies, lifecycle, evidence, confidence, write-once predictions,
# verdict and factor reproducibility, no LLM cost, derived identity — each a stored-row assertion
# and each planted against.
for invariant in \
  analysis_findings_type_known \
  analysis_suggestions_kind_known \
  analysis_suggestions_lifecycle \
  analysis_findings_evidence_resolves \
  analysis_confidence_bounded \
  suggestion_measurements_prediction_frozen \
  suggestion_measurements_verdict_computed \
  analyzer_calibration_derived \
  analysis_runs_no_llm_cost \
  analysis_suggestions_identity_derived
do
  check_contains "$FRAGMENT" "'$invariant: " "the fragment names the $invariant invariant"
  check_contains "$VERIFIER" "'$invariant: " "and the verifier plants a row that violates it"
done

for dropped in $(grep -oE 'drop constraint [a-z_]+' "$VERIFIER" | awk '{ print $3 }' | sort -u); do
  if grep -rqE "constraint $dropped\b" "$MODULE_DIR/migrations"; then
    pass "a migration creates $dropped, which the verifier drops"
  else
    fail "a migration creates $dropped, which the verifier drops (no migration names it)"
  fi
done
for disabled in $(grep -oE 'disable trigger [a-z_]+' "$VERIFIER" | awk '{ print $3 }' | sort -u); do
  if grep -rqE "create (constraint )?trigger $disabled\b" "$MODULE_DIR/migrations"; then
    pass "a migration creates the trigger $disabled, which the verifier disables"
  else
    fail "a migration creates the trigger $disabled, which the verifier disables (no migration names it)"
  fi
done

for id in $(grep -oE "^[A-Z_]+=5eed[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}$" "$VERIFIER" | cut -d= -f2); do
  prefix=${id%%-*}
  suffix=$(printf '%s' "${id##*-}" | sed 's/^0*//')
  if grep -qE "'$prefix-0000-4000-8000-" "$SEED" && grep -qE "\b$suffix\b|'$id'" "$SEED"; then
    pass "the seed writes $id, which a plant rewrites"
  else
    fail "the seed writes $id, which a plant rewrites (no $prefix… row ending $suffix in the seed)"
  fi
done

printf '\nThe suites, the comparator and CI\n'

check_contains "$STANDALONE" 'ir lib/analyzer-invariants\.sql' \
  'the standalone suite includes the fragment rather than a copy of it'
check_contains "$STANDALONE" 'ir lib/assert\.sql' \
  'and brings the assertion helpers with it, since it owns the session'

if grep -qE '^(begin|commit|rollback);' "$FRAGMENT"; then
  fail 'the fragment leaves transaction control to the suite that includes it'
else
  pass 'the fragment leaves transaction control to the suite that includes it'
fi
for file in "$FRAGMENT" "$CORPUS"; do
  if grep -qiE '^[[:space:]]*(insert|update|delete|alter|drop|create table)' "$file"; then
    fail "$(basename -- "$file") writes nothing"
  else
    pass "$(basename -- "$file") writes nothing"
  fi
done

# The rediscovery runs the engine's own analyzer, and compares every field a stored finding has.
check_contains "$REDISCOVER" 'from ouroboros_engine\.analysis\.changepoint import ChangePointAnalyzer' \
  'the comparator runs the engine'"'"'s change-point analyzer, not a copy of it'
for field in data evidence_refs confidence confidence_basis subject_key; do
  check_contains "$REDISCOVER" "\"$field\"" "and compares each finding's $field"
done
check_contains "$REDISCOVER" 'tampered' 'and proves the comparison can fail'
check_contains "$REDISCOVERY" 'uv run --quiet --project "\$ROOT/ouroboros-engine" --locked' \
  'it runs under ouroboros-engine'"'"'s locked environment'
if command -v python3 >/dev/null 2>&1; then
  if python3 -m py_compile "$REDISCOVER" 2>/dev/null; then
    pass 'the comparator compiles'
  else
    fail 'the comparator compiles'
  fi
fi

check_contains "$WORKFLOW" '/tests/analyzer-invariants\.sql' \
  'ci/db asserts the analyzer invariants against the seeded database'
check_contains "$WORKFLOW" 'OURO_DB_NAME="\$SEED_DB_NAME" ouroboros-db/tests/verify-analyzer-invariants\.sh' \
  'and plants bad rows into that same seeded database'
check_contains "$WORKFLOW" 'OURO_DB_NAME="\$SEED_DB_NAME" ouroboros-db/tests/verify-analyzer-rediscovery\.sh' \
  'and runs the change-point analyzer over its corpus'
check_contains "$WORKFLOW" '"ouroboros-engine/src/ouroboros_engine/analysis/\*\*"' \
  'and runs again when the analyzer it rediscovers with changes'

check_summary
