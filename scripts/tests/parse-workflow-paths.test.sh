#!/usr/bin/env sh
#
# parse-workflow-paths.test.sh — unit tests for scripts/lib/parse-workflow-paths.awk.
#
# Each case feeds the parser a small workflow and asserts on three things: what it wrote
# to stdout, what it complained about on stderr, and its exit status. The accept cases
# pin the TSV contract verify-ci.sh reads; the reject cases pin every rule the parser
# exists to enforce, because the failure this file guards against is silent — a filter
# the parser misreads makes a workflow look narrower than it is, and CI that never runs
# looks exactly like CI that never fails.
#
# Usage:
#   scripts/tests/parse-workflow-paths.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
PARSER="$SCRIPTS_DIR/lib/parse-workflow-paths.awk"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

TAB=$(printf '\t')

# run_parser CONTENT — parse CONTENT as wf.yml, leaving stdout in $out, stderr in $err
# and the exit status in $status. The parser is run from the temporary directory so the
# file column is the bare name the assertions can spell out.
run_parser() {
  printf '%s\n' "$1" > "$work/wf.yml"
  out=$(cd "$work" && awk -f "$PARSER" wf.yml 2>"$work/err")
  status=$?
  err=$(cat "$work/err")
}

# check_rejected CONTENT PATTERN DESCRIPTION — assert CONTENT is refused, that the
# reason matches PATTERN, and that nothing at all reached stdout.
check_rejected() {
  run_parser "$1"
  if [ "$status" -ne 0 ] && [ -z "$out" ] && printf '%s\n' "$err" | grep -Eq -- "$2"; then
    pass "$3"
  else
    fail "$3 (status $status, stdout [$out], stderr [$err])"
  fi
}

printf '\nparse-workflow-paths.awk\n\n'

# ---------------------------------------------------------------------------
# Accepted workflows
# ---------------------------------------------------------------------------

printf 'Accepts\n'

run_parser 'on:
  pull_request:
    branches: [main]
    paths:
      - "ouroboros-ui/**"

jobs:
  ci:
    name: ci/ui'
check_equals 0 "$status" 'a filtered pull_request is accepted'
check_equals "wf.yml${TAB}pull_request${TAB}ouroboros-ui/**" "$out" \
  'the filter is flattened to file TAB event TAB glob'
check_equals '' "$err" 'a valid workflow is silent on stderr'

run_parser 'on:
  pull_request:
    paths:
      - "a/**"
      - "b.yml"
  push:
    paths:
      - "a/**"
  workflow_dispatch:'
check_equals "wf.yml${TAB}pull_request${TAB}a/**
wf.yml${TAB}pull_request${TAB}b.yml
wf.yml${TAB}push${TAB}a/**" "$out" 'globs are emitted in file order, one record each'
check_equals 0 "$status" 'an event that cannot be path-filtered is passed over'

run_parser 'on:
  pull_request:
    branches: [main]
  push:
    paths:
      - "a/**"'
check_equals "wf.yml${TAB}pull_request${TAB}**
wf.yml${TAB}push${TAB}a/**" "$out" 'an event with no paths: is reported as ** — it matches everything'

run_parser '# A leading comment.
on:
  # About the event.
  pull_request:
    paths:
      - "a/**"   # about the glob

      - "b/**"'
check_equals "wf.yml${TAB}pull_request${TAB}a/**
wf.yml${TAB}pull_request${TAB}b/**" "$out" 'comments and blank lines are ignored'

run_parser 'on:
  push:
    branches:
      - main
      - release
    paths:
      - "a/**"'
check_equals "wf.yml${TAB}push${TAB}a/**" "$out" \
  'a block-style branches list is not mistaken for a path filter'

run_parser 'on:
  pull_request:
    paths:
      - "a/**"

jobs:
  ci:
    steps:
      - uses: actions/checkout@v4
      - name: Build'
check_equals "wf.yml${TAB}pull_request${TAB}a/**" "$out" \
  'steps below the on: block are not read as globs'

printf '%s\r\n' 'on:' '  pull_request:' '    paths:' '      - "a/**"' > "$work/wf.yml"
out=$(cd "$work" && awk -f "$PARSER" wf.yml 2>/dev/null)
check_equals "wf.yml${TAB}pull_request${TAB}a/**" "$out" 'a CRLF checkout parses the same'

printf 'on:\n  push:\n    paths:\n      - "a/**"\n' > "$work/one.yml"
printf 'on:\n  push:\n    paths:\n      - "b/**"\n' > "$work/two.yml"
out=$(cd "$work" && awk -f "$PARSER" one.yml two.yml 2>/dev/null)
check_equals "one.yml${TAB}push${TAB}a/**
two.yml${TAB}push${TAB}b/**" "$out" 'several files are kept apart by the file column'

# ---------------------------------------------------------------------------
# Refused workflows
# ---------------------------------------------------------------------------

printf '\nRefuses\n'

check_rejected 'jobs:
  ci:
    name: ci/ui' \
  'no top-level .on:. block' \
  'a workflow with no on: block is refused'

check_rejected 'on: push' \
  'must open a block mapping' \
  'a scalar on: is refused — it cannot carry a path filter'

check_rejected 'on: [push, pull_request]' \
  'must open a block mapping' \
  'a flow-style on: is refused'

check_rejected 'on:
  - push
  - pull_request' \
  'sequence of event names' \
  'a sequence of event names is refused'

check_rejected 'on:
  pull_request:
    paths-ignore:
      - "docs/**"' \
  'paths-ignore' \
  'paths-ignore: is refused — an exclusion is not the set of triggering paths'

check_rejected 'on:
  pull_request:
    paths: ["a/**"]' \
  'must be a block sequence' \
  'a flow-style paths: list is refused'

check_rejected 'on:
  pull_request:
    paths:
      - ouroboros-ui/**' \
  'expected a double-quoted glob' \
  'an unquoted glob is refused'

check_rejected 'on:
  pull_request:
    paths:
      - "ouroboros-ui/**' \
  'not closed' \
  'an unterminated glob is refused'

check_rejected 'on:
  pull_request:
    paths:
      - ""' \
  'empty glob' \
  'an empty glob is refused'

check_rejected 'on:
  pull_request:
    paths:
      - "a/**"
      - "a/**"' \
  'duplicate glob' \
  'the same glob twice is refused'

check_rejected 'on:
  pull_request:
    paths:
      - "a/**"
    paths:
      - "b/**"' \
  'declared twice' \
  'two paths: keys for one event are refused'

check_rejected 'on:
  pull_request:
    paths:
      - "a/**" trailing' \
  'unexpected text after the closing quote' \
  'text after the closing quote is refused'

check_rejected 'on:
	pull_request:' \
  'tab indentation' \
  'tab indentation is refused'

check_rejected 'on:
  Pull Request:
    paths:
      - "a/**"' \
  'expected an event name' \
  'something that is not an event name is refused'

check_rejected 'on:
    paths:
      - "a/**"' \
  'outside any event' \
  'a setting that belongs to no event is refused'

check_rejected 'on:
  workflow_dispatch:' \
  'no path-filterable events' \
  'a workflow nothing can trigger by path is refused'

# One bad file poisons the run, so a caller never acts on a partial routing table.
printf 'on:\n  push:\n    paths:\n      - "a/**"\n' > "$work/one.yml"
printf 'on:\n  push:\n    paths:\n      - b/**\n' > "$work/two.yml"
out=$(cd "$work" && awk -f "$PARSER" one.yml two.yml 2>/dev/null)
status=$?
check_equals 1 "$status" 'one unreadable file fails the whole run'
check_equals '' "$out" 'a failed run emits no records at all'

check_summary
