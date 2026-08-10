#!/usr/bin/env sh
#
# run-tests.sh — run the repository tooling's test suite.
#
# The modules each own their own test runner (`yarn test`, `uv run pytest`); this is the
# equivalent for the repo-level shell tooling in scripts/. It executes every
# scripts/tests/*.test.sh in turn, prints each one's output, and fails if any of them do.
#
# Usage:
#   scripts/run-tests.sh
#
# Exit status:
#   0  every test file passed
#   1  at least one test file failed (or there are no test files to run)

set -u

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
TESTS_DIR="$SCRIPT_DIR/tests"

total=0
failed=0

for test_file in "$TESTS_DIR"/*.test.sh; do
  [ -f "$test_file" ] || continue
  total=$((total + 1))
  if ! "$test_file"; then
    failed=$((failed + 1))
    printf '  ---> %s FAILED\n\n' "${test_file##*/}"
  fi
done

if [ "$total" -eq 0 ]; then
  printf 'run-tests: no test files found in %s\n' "$TESTS_DIR" >&2
  exit 1
fi

printf '%s test file(s), %s failed\n\n' "$total" "$failed"

[ "$failed" -eq 0 ]
