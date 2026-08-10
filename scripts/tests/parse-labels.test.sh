#!/usr/bin/env sh
#
# parse-labels.test.sh — unit tests for scripts/lib/parse-labels.awk.
#
# Every accepted shape and every rejection path is exercised, because the parser is the
# only thing standing between a typo in .github/labels.yml and a wrong label set applied
# to the repository. The final case parses the repository's real label file, so the
# committed definitions can never drift out of the grammar.
#
# Usage:
#   scripts/tests/parse-labels.test.sh      # or scripts/run-tests.sh for the whole suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$SCRIPTS_DIR")
PARSER="$SCRIPTS_DIR/lib/parse-labels.awk"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

TAB=$(printf '\t')

# run_parser INPUT — parse INPUT, leaving stdout in $out, stderr in $err, status in $status.
run_parser() {
  printf '%s\n' "$1" > "$work/input.yml"
  out=$(awk -f "$PARSER" "$work/input.yml" 2> "$work/stderr")
  status=$?
  err=$(cat "$work/stderr")
}

# repeat TEXT COUNT — TEXT concatenated COUNT times, for building over-long values.
repeat() {
  i=0
  while [ "$i" -lt "$2" ]; do
    printf '%s' "$1"
    i=$((i + 1))
  done
}

printf '\nparse-labels.awk\n\n'

printf 'Accepted input\n'

run_parser '- name: "mvp"
  color: "3dd6f5"
  description: "Targeted for the v1 / MVP release"'
check_equals 0 "$status" 'a well-formed entry is accepted'
check_equals "mvp${TAB}3dd6f5${TAB}Targeted for the v1 / MVP release" "$out" 'the entry is emitted as name/color/description TSV'
check_equals '' "$err" 'a valid file produces no diagnostics'

run_parser '# a leading comment

- name: "ui"
  color: "1d76db"                   # module blue
  description: "ouroboros-ui (Next.js product UI)"

  # an indented comment between entries
- name: "db"
  color: "B60205"
  description: "ouroboros-db (PostgreSQL + Flyway)"'
check_equals 0 "$status" 'comments, blank lines and trailing comments are tolerated'
check_equals 2 "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" 'both entries are emitted'
check_matches "$out" "^ui${TAB}1d76db${TAB}" 'the first entry keeps its position'
check_matches "$out" "^db${TAB}B60205${TAB}" 'upper-case hex is preserved as written'

run_parser '- name: "tests"
  color: "0b7285"
  description: "Test Results (mockup 11) — flake truth, triage, classification & routing"'
check_equals 0 "$status" 'punctuation and non-ASCII in a description are accepted'

# 60 em-dashes: 60 characters, 180 bytes. A byte-counting awk must not read this as
# breaching GitHub's 100-character description limit.
run_parser "- name: \"multibyte\"
  color: \"0b6b4f\"
  description: \"$(repeat '—' 60)\""
check_equals 0 "$status" 'a 60-character multibyte description is measured in characters, not bytes'

printf '\nRejected input\n'

run_parser '- name: "mvp"
  description: "no color here"'
check_equals 1 "$status" 'an entry without a color is rejected'
check_matches "$err" 'no color' 'the diagnostic names the missing color'
check_equals '' "$out" 'a rejected file emits nothing'

run_parser '- name: "mvp"
  color: "3dd6f5"'
check_equals 1 "$status" 'an entry without a description is rejected'
check_matches "$err" 'no description' 'the diagnostic names the missing description'

run_parser '- name: "mvp"
  color: "3dd6f5"
  description: "first"
- name: "mvp"
  color: "6f42c1"
  description: "second"'
check_equals 1 "$status" 'a duplicate label name is rejected'
check_matches "$err" 'duplicates the entry on line 1' 'the diagnostic points at the first occurrence'

run_parser '- name: "mvp"
  color: "#3dd6f5"
  description: "hash-prefixed color"'
check_equals 1 "$status" 'a color with a leading # is rejected'
check_matches "$err" 'drop the leading #' 'the diagnostic explains how to fix the color'

run_parser '- name: "mvp"
  color: "3dd6f"
  description: "five hex digits"'
check_equals 1 "$status" 'a color that is not six digits is rejected'
check_matches "$err" 'six hex digits' 'the diagnostic states the expected color form'

run_parser '- name: "mvp"
  color: "3dd6fz"
  description: "not hex"'
check_equals 1 "$status" 'a color with a non-hex character is rejected'

run_parser '- name: mvp
  color: "3dd6f5"
  description: "unquoted name"'
check_equals 1 "$status" 'an unquoted value is rejected'
check_matches "$err" 'double quotes' 'the diagnostic asks for double quotes'

run_parser '- name: "mvp
  color: "3dd6f5"
  description: "unterminated"'
check_equals 1 "$status" 'an unterminated quoted value is rejected'

run_parser '- name: "mvp"
  color: "3dd6f5"
  description: "a "quoted" word"'
check_equals 1 "$status" 'a value containing a double quote is rejected'
check_matches "$err" 'unexpected text after the closing quote' 'the diagnostic explains the quoting rule'

run_parser "- name: \"toolong\"
  color: \"3dd6f5\"
  description: \"$(repeat 'x' 101)\""
check_equals 1 "$status" 'a description over 100 characters is rejected'
check_matches "$err" 'longer than 100 characters' 'the diagnostic states the description limit'

run_parser "- name: \"$(repeat 'y' 51)\"
  color: \"3dd6f5\"
  description: \"name too long\""
check_equals 1 "$status" 'a name over 50 characters is rejected'
check_matches "$err" 'longer than 50 characters' 'the diagnostic states the name limit'

run_parser '- name: "mvp"
  color: "3dd6f5"
  description: "fine"
  colour: "3dd6f5"'
check_equals 1 "$status" 'an unrecognised key is rejected'
check_matches "$err" 'unrecognised line' 'the diagnostic names the unrecognised line'

run_parser '  color: "3dd6f5"
- name: "mvp"
  description: "color before the entry"'
check_equals 1 "$status" 'a key before the first entry is rejected'
check_matches "$err" 'before any' 'the diagnostic explains the ordering'

run_parser '# nothing but a comment'
check_equals 1 "$status" 'a file with no entries is rejected'
check_matches "$err" 'no labels found' 'the diagnostic says the file is empty of labels'

printf '\nThe committed label definitions\n'

check_run 'the repository .github/labels.yml parses' awk -f "$PARSER" "$ROOT/.github/labels.yml"
emitted=$(awk -f "$PARSER" "$ROOT/.github/labels.yml" | wc -l | tr -d ' ')
declared=$(grep -Ec '^- name:' "$ROOT/.github/labels.yml")
check_equals "$declared" "$emitted" 'every declared label is emitted exactly once'

check_summary
