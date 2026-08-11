#!/usr/bin/env sh
#
# parse-json.test.sh — unit tests for scripts/lib/parse-json.awk.
#
# Each case feeds the parser a small document and asserts on all three of what it wrote
# to stdout, what it complained about on stderr, and its exit status. The accept cases
# pin the record contract verify-workspace.sh reads; the reject cases pin the malformed
# input the parser must refuse rather than half-read.
#
# The comment cases carry the most weight. turbo.json documents itself, and its prose
# names the same keys the checks assert on — `"cache": false` written in a paragraph
# would satisfy a naive grep exactly as well as the real setting does. Every one of those
# cases exists because a parser that strips comments badly is worse than one that does
# not strip them at all: it fails silently, in the direction of passing.
#
# Usage:
#   scripts/tests/parse-json.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
PARSER="$SCRIPTS_DIR/lib/parse-json.awk"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

TAB=$(printf '\t')

# run_parser CONTENT — parse CONTENT, leaving stdout in $out, stderr in $err and the
# exit status in $status.
run_parser() {
  printf '%s\n' "$1" > "$work/doc.json"
  out=$(awk -f "$PARSER" "$work/doc.json" 2>"$work/err")
  status=$?
  err=$(cat "$work/err")
}

# check_record CONTENT RECORD DESCRIPTION — assert CONTENT parses and emits RECORD, with
# the tabs written as \t in the caller for legibility.
check_record() {
  run_parser "$1"
  expected=$(printf '%s' "$2" | sed "s/\\\\t/$TAB/g")
  if [ "$status" -eq 0 ] && printf '%s\n' "$out" | grep -Fqx -- "$expected"; then
    pass "$3"
  else
    fail "$3 (status $status, stdout [$out], stderr [$err])"
  fi
}

# check_rejected CONTENT PATTERN DESCRIPTION — assert CONTENT is refused and the reason
# matches PATTERN.
check_rejected() {
  run_parser "$1"
  if [ "$status" -ne 0 ] && printf '%s\n' "$err" | grep -Eq -- "$2"; then
    pass "$3"
  else
    fail "$3 (status $status, stdout [$out], stderr [$err])"
  fi
}

printf '\nparse-json.awk\n\n'

# ---------------------------------------------------------------------------
# The record contract
# ---------------------------------------------------------------------------

printf 'Records\n'

check_record '{ "name": "ouroboros", "private": true }' \
  'root\tname\t"ouroboros"' 'a top-level string is recorded under root'
check_record '{ "name": "ouroboros", "private": true }' \
  'root\tprivate\ttrue' 'a top-level boolean keeps its literal form'
check_record '{ "engines": { "node": ">=24" } }' \
  'engines\tnode\t">=24"' 'a nested key is recorded under its parent'
check_record '{ "workspaces": ["a", "b"] }' \
  'root\tworkspaces\t["a", "b"]' 'an array value is recorded whole'

run_parser '{ "a": { "x": 1 }, "b": { "x": 2 } }'
check_equals "b${TAB}x${TAB}2" "$(printf '%s\n' "$out" | tail -n 1)" \
  'a nested key is attributed to the parent it is inside, not the one before it'

# Multi-line values are what turbo.json is made of; a check has to be able to match one
# with a single pattern.
check_record '{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**"]
    }
  }
}' 'tasks\tbuild\t{ "dependsOn": ["^build"], "outputs": [".next/**"] }' \
  'a multi-line value is flattened to one line'

# Only the two levels the repository's configuration uses. A third level would have no
# unambiguous name, so it contributes nothing rather than a misleading record.
run_parser '{ "a": { "b": { "c": 1 } } }'
check_equals '' "$(printf '%s\n' "$out" | awk -F"$TAB" '$1 == "b"')" \
  'a third level of nesting is not recorded'

# An object inside an array has no two-level name either, and its keys must not be
# mistaken for the array's siblings.
run_parser '{ "list": [ { "inner": 1 } ], "after": 2 }'
check_equals '' "$(printf '%s\n' "$out" | awk -F"$TAB" '$2 == "inner"')" \
  'a key inside an array is not recorded'
check_equals "root${TAB}after${TAB}2" "$(printf '%s\n' "$out" | awk -F"$TAB" '$2 == "after"')" \
  'the key after an array is still recorded'

# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

printf '\nComments\n'

check_record '{
  // "cache": false
  "cache": true
}' 'root\tcache\ttrue' 'a line comment contributes no record'

run_parser '{
  // "cache": false
  "cache": true
}'
check_equals 1 "$(printf '%s\n' "$out" | grep -c 'cache')" \
  'a key named only in a comment cannot satisfy a check about it'

check_record '{
  /* "cache": false */
  "cache": true
}' 'root\tcache\ttrue' 'a block comment contributes no record'

# The case that makes a line-oriented strip wrong: turbo.json opens with a URL, and the
# `//` in it is not a comment.
check_record '{ "$schema": "https://turborepo.com/schema.json", "tasks": {} }' \
  'root\t$schema\t"https://turborepo.com/schema.json"' \
  'a // inside a string is not treated as a comment'
check_record '{ "$schema": "https://turborepo.com/schema.json", "tasks": {} }' \
  'root\ttasks\t{}' 'the document after a URL is still parsed'

check_record '{ "path": "a/*b", "next": 1 }' 'root\tnext\t1' \
  'a /* inside a string does not open a comment'

check_record '{ "quote": "he said \"//\" here", "next": 1 }' 'root\tnext\t1' \
  'an escaped quote does not end the string it is inside'

# ---------------------------------------------------------------------------
# Malformed input
# ---------------------------------------------------------------------------

printf '\nRejects\n'

check_rejected '{ "name": "unterminated }' 'unterminated string' \
  'a string that never closes is refused'
check_rejected '{ "a": { "b": 1 }' 'unbalanced' 'a brace that never closes is refused'
check_rejected '{ "a": 1 } }' 'unbalanced' 'a brace too many is refused'
# Reported against the key rather than the document, because an array that never closes
# is found while its value is being read and naming the key is the more useful half.
check_rejected '{ "a": [1, 2 }' 'unterminated value for key a' \
  'a bracket that never closes is refused'

# ---------------------------------------------------------------------------
# The real files
# ---------------------------------------------------------------------------

printf '\nThis repository\n'
ROOT=$(dirname -- "$SCRIPTS_DIR")
for document in turbo.json package.json; do
  check_run "$document parses" sh -c "awk -f '$PARSER' '$ROOT/$document'"
done

# The one record verify-workspace.sh's most important check is built on, asserted here
# too so a parser change that loses it fails at the parser rather than three files away.
check_matches "$(awk -f "$PARSER" "$ROOT/turbo.json" | awk -F"$TAB" '$2 == "ouroboros-db#test"')" \
  'TURBO_ROOT' 'the db test cache boundary survives the parse'

check_summary
