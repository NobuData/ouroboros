#!/usr/bin/env sh
#
# run-tests.sh — run the repository's shell test suites.
#
# The modules with a real toolchain own their own runner (`yarn test`, `uv run pytest`);
# this is the equivalent for everything written in POSIX shell — the repo-level tooling
# in scripts/, and the modules whose tooling is shell too, as ouroboros-db's is. It
# executes every *.test.sh in the directories it is given, prints each one's output, and
# fails if any of them do.
#
# Usage:
#   scripts/run-tests.sh                     # scripts/tests plus every ouroboros-*/tests
#   scripts/run-tests.sh ouroboros-db/tests  # only the suites in the named directories
#
# Exit status:
#   0  every test file passed
#   1  at least one test file failed, or there are no test files to run
#   2  a directory that was named does not exist

set -u

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")

if [ $# -eq 0 ]; then
  # Everywhere a suite is allowed to live. A module without a tests/ directory
  # contributes nothing rather than an error, which is what lets the modules that are
  # still a README stay quiet here.
  set -- "$SCRIPT_DIR/tests" "$ROOT"/ouroboros-*/tests
else
  # A named directory that is not there is a typo, not an empty suite: reporting "no
  # failures" for tests that were never found is the one outcome this must not produce.
  for tests_dir in "$@"; do
    [ -d "$tests_dir" ] || {
      printf 'run-tests: no such directory: %s\n' "$tests_dir" >&2
      exit 2
    }
  done
fi

total=0
failed=0

for tests_dir in "$@"; do
  [ -d "$tests_dir" ] || continue
  for test_file in "$tests_dir"/*.test.sh; do
    [ -f "$test_file" ] || continue
    total=$((total + 1))
    if ! "$test_file"; then
      failed=$((failed + 1))
      # Named by path: two suites may hold files with the same name.
      printf '  ---> %s FAILED\n\n' "${test_file#"$ROOT"/}"
    fi
  done
done

if [ "$total" -eq 0 ]; then
  printf 'run-tests: no test files found in %s\n' "$*" >&2
  exit 1
fi

printf '%s test file(s), %s failed\n\n' "$total" "$failed"

[ "$failed" -eq 0 ]
