#!/usr/bin/env sh
#
# render-env.test.sh — unit tests for scripts/lib/render-env.awk.
#
# Each case renders a small template against a small overrides table and asserts on three
# things: what reached stdout, what was complained about on stderr, and the exit status.
#
# Two properties carry most of the weight. The first is that everything the renderer was
# not asked to change survives byte for byte — the templates in this repo are mostly
# prose, and a `.env` that lost it is a file whose reader has to go back to git to find
# out what any of it means. The second is that an override the template does not declare
# is refused: that is the shape a renamed variable takes, and appending it instead would
# write a value nothing reads into a file that looks complete.
#
# Usage:
#   scripts/tests/render-env.test.sh   # or scripts/run-tests.sh for the whole suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
RENDERER="$SCRIPTS_DIR/lib/render-env.awk"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

TAB=$(printf '\t')

# run_render OVERRIDES TEMPLATE — render TEMPLATE against OVERRIDES, leaving stdout in
# $out, stderr in $err and the exit status in $status. Both arguments are file contents.
run_render() {
  printf '%s\n' "$1" > "$work/overrides.tsv"
  printf '%s\n' "$2" > "$work/template"
  out=$(awk -f "$RENDERER" "$work/overrides.tsv" "$work/template" 2>"$work/err")
  status=$?
  err=$(cat "$work/err")
}

# check_refused OVERRIDES TEMPLATE PATTERN DESCRIPTION — assert the render is refused,
# that the reason matches PATTERN, and that nothing at all reached stdout.
check_refused() {
  run_render "$1" "$2"
  if [ "$status" -ne 0 ] && [ -z "$out" ] && printf '%s\n' "$err" | grep -Eq -- "$3"; then
    pass "$4"
  else
    fail "$4 (status $status, stdout [$out], stderr [$err])"
  fi
}

printf '\nrender-env.awk\n\n'

# ---------------------------------------------------------------------------
# Substitution
# ---------------------------------------------------------------------------

printf 'Substitution\n'

run_render "OURO_DB_USER${TAB}rendered" '# What it is for.
OURO_DB_USER=ouroboros'
check_equals 0 "$status" 'an override of a declared variable is applied'
check_equals '# What it is for.
OURO_DB_USER=rendered' "$out" 'the value is replaced and the comment above it kept'
check_equals '' "$err" 'a clean render is silent on stderr'

run_render "OURO_DB_USER${TAB}rendered" '# Kept.
OURO_DB_USER=ouroboros

# Also kept.
OURO_DB_NAME=ouroboros'
check_equals '# Kept.
OURO_DB_USER=rendered

# Also kept.
OURO_DB_NAME=ouroboros' "$out" 'a variable nobody overrode is passed through untouched'

# The generated secrets are base64, so the characters a naive sed-based renderer would
# have to escape are exactly the ones that turn up in practice.
run_render "OURO_SESSION_SECRET${TAB}kJwu+un/Be0X+HQk=" 'OURO_SESSION_SECRET=dev-session-secret-change-me'
check_equals 'OURO_SESSION_SECRET=kJwu+un/Be0X+HQk=' "$out" 'a value carrying + / and = is written literally'

run_render "OURO_DB_USER${TAB}a&b\\1" 'OURO_DB_USER=ouroboros'
check_equals 'OURO_DB_USER=a&b\1' "$out" 'a value carrying & and a backreference is written literally'

run_render '' '# Nothing to do.
OURO_DB_USER=ouroboros'
check_equals 0 "$status" 'an empty overrides table is not an error'
check_equals '# Nothing to do.
OURO_DB_USER=ouroboros' "$out" 'and the template comes through whole, including its first line'

# ---------------------------------------------------------------------------
# What counts as a variable
# ---------------------------------------------------------------------------

printf '\nWhat counts as a variable\n'

run_render "OURO_DB_USER${TAB}rendered" '# Set OURO_DB_USER=ouroboros to change the role.
OURO_DB_USER=ouroboros'
check_equals '# Set OURO_DB_USER=ouroboros to change the role.
OURO_DB_USER=rendered' "$out" 'a comment that mentions an assignment stays a comment'

run_render "OURO_DB_USER${TAB}rendered" '  OURO_DB_USER=indented
OURO_DB_USER=ouroboros'
check_equals '  OURO_DB_USER=indented
OURO_DB_USER=rendered' "$out" 'an indented line is not an assignment, as the parser also has it'

run_render "OURO_DB_USER${TAB}rendered" 'export OURO_DB_USER=ouroboros
OURO_DB_USER=ouroboros'
check_matches "$out" '^export OURO_DB_USER=ouroboros$' 'an `export` prefix is not an assignment either'

# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------

printf '\nRefusals\n'

check_refused "OURO_MISSPELLED${TAB}value" 'OURO_DB_USER=ouroboros' \
  'OURO_MISSPELLED is not declared by' \
  'an override the template does not declare is refused, not appended'

check_refused "OURO_DB_USER${TAB}first
OURO_DB_USER${TAB}second" 'OURO_DB_USER=ouroboros' \
  'duplicate override: OURO_DB_USER' \
  'the same variable overridden twice is refused'

check_refused "OURO_DB_USER${TAB}" 'OURO_DB_USER=ouroboros' \
  'overrides with an empty value' \
  'an override with no value is refused: a copied file has to run as it is'

check_refused 'OURO_DB_USER=value' 'OURO_DB_USER=ouroboros' \
  'not a NAME<TAB>VALUE override' \
  'an overrides line with no tab is refused rather than half-read'

check_refused "ouro_db_user${TAB}value" 'OURO_DB_USER=ouroboros' \
  'override name is not upper snake case' \
  'a lower-case override name is refused'

check_refused "OURO_DB_USER${TAB}rendered" 'OURO_DB_USER=ouroboros
OURO_DB_USER=again' \
  'declared more than once' \
  'a template declaring the same variable twice is refused'

# A refusal has to leave nothing behind: the caller redirects stdout to the file it is
# about to install, and half a rendered template that stops at the bad line is the one
# outcome that would be worse than an error.
run_render "OURO_MISSPELLED${TAB}value" '# A long template.
OURO_DB_USER=ouroboros
OURO_DB_NAME=ouroboros'
check_equals '' "$out" 'a refused render writes nothing at all to stdout'

check_summary
