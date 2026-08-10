#!/usr/bin/env sh
#
# parse-env-example.test.sh — unit tests for scripts/lib/parse-env-example.awk.
#
# Each case feeds the parser a small template and asserts on three things: what it wrote
# to stdout, what it complained about on stderr, and its exit status. The accept cases
# pin the TSV contract its callers read; the reject cases pin every rule the parser
# exists to enforce, because a parser that silently accepts a malformed template is
# worse than no parser — it reports a variable as declared when nothing will read it.
#
# Usage:
#   scripts/tests/parse-env-example.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
PARSER="$SCRIPTS_DIR/lib/parse-env-example.awk"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

TAB=$(printf '\t')

# run_parser CONTENT — parse CONTENT, leaving stdout in $out, stderr in $err and the
# exit status in $status.
run_parser() {
  printf '%s\n' "$1" > "$work/env"
  out=$(awk -f "$PARSER" "$work/env" 2>"$work/err")
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

printf '\nparse-env-example.awk\n\n'

# ---------------------------------------------------------------------------
# Accepted templates
# ---------------------------------------------------------------------------

printf 'Accepts\n'

run_parser '# What it is for.
OURO_DB_USER=ouroboros'
check_equals 0 "$status" 'a documented OURO_ variable is accepted'
check_equals "OURO_DB_USER${TAB}ouroboros" "$out" 'the entry is flattened to name TAB value'
check_equals '' "$err" 'a valid template is silent on stderr'

run_parser '# ---------------------------------------------------------------------------
# Database.
# ---------------------------------------------------------------------------

# The role.
OURO_DB_USER=ouroboros
# The database.
OURO_DB_NAME=ouroboros

# The listen port every container platform sets.
PORT=4000'
check_equals 0 "$status" 'section rules, blank lines and comments are ignored'
check_equals "OURO_DB_USER${TAB}ouroboros
OURO_DB_NAME${TAB}ouroboros
PORT${TAB}4000" "$out" 'entries are emitted in file order'

run_parser '# A URL keeps its colons, slashes and query string intact.
OURO_DATABASE_URL=postgresql://u:p@localhost:5432/db?sslmode=disable'
check_equals "OURO_DATABASE_URL${TAB}postgresql://u:p@localhost:5432/db?sslmode=disable" \
  "$out" 'only the first = splits the line, so a URL value survives'

run_parser '# A comment may hold a # of its own.
OURO_LOG_LEVEL=info'
check_equals 0 "$status" 'a # inside a comment is not mistaken for an entry'

for standard in PORT NODE_ENV HOSTNAME COMPOSE_PROJECT_NAME COMPOSE_FILE; do
  run_parser "# A platform standard, unprefixed by convention.
$standard=value"
  check_equals 0 "$status" "$standard is allowed without the OURO_ prefix"
done

# ---------------------------------------------------------------------------
# Rejected templates
# ---------------------------------------------------------------------------

printf '\nRejects\n'

check_rejected '# One.
OURO_DB_USER=a
# Two.
OURO_DB_USER=b' 'duplicate variable: OURO_DB_USER' 'a duplicate name is refused'

check_rejected '# Shell syntax.
export OURO_DB_USER=ouroboros' 'export' 'an export prefix is refused'

check_rejected '# Not upper snake case.
ouro_db_user=ouroboros' 'not upper snake case' 'a lower-case name is refused'

check_rejected '# Missing the prefix the conventions require.
DATABASE_URL=postgresql://localhost' 'needs the OURO_ prefix' \
  'an unprefixed non-standard name is refused'

check_rejected '# Nothing on the right of the sign.
OURO_DB_USER=' 'has no value' 'an empty value is refused'

check_rejected '# Quoted.
OURO_DB_USER="ouroboros"' 'quotes its value' 'a quoted value is refused'

check_rejected '# Spaced.
OURO_DB_USER = ouroboros' 'whitespace around' 'whitespace around = is refused'

check_rejected '# Trailing note.
OURO_DB_USER=ouroboros # the role' 'inline comment' 'a trailing inline comment is refused'

check_rejected 'OURO_DB_USER=ouroboros' 'undeclared in prose' 'an undocumented entry is refused'

check_rejected '# ---------------------------------------------------------------------------
OURO_DB_USER=ouroboros' 'undeclared in prose' \
  'a rule of dashes does not count as documentation'

check_rejected '# Documented, but the blank line closed the block.

OURO_DB_USER=ouroboros' 'undeclared in prose' \
  'a blank line closes the block it documented'

check_rejected '# A stray line.
OURO_DB_USER' 'not a NAME=VALUE assignment' 'a line without = is refused'

check_rejected '# Indented.
  OURO_DB_USER=ouroboros' 'leading whitespace' 'an indented entry is refused'

check_rejected '# Only comments here.' 'no variables found' 'a template with no variables is refused'

# A file with one bad entry emits nothing at all, so a caller cannot act on the half of
# it that happened to parse.
run_parser '# Good.
OURO_DB_USER=ouroboros
# Bad.
OURO_DB_NAME='
check_equals '' "$out" 'one invalid entry suppresses the whole output'
check_equals 1 "$status" 'one invalid entry fails the parse'

# ---------------------------------------------------------------------------
# The template this repository actually ships
# ---------------------------------------------------------------------------

printf '\nThe committed template\n'

REPO_ROOT=$(dirname -- "$SCRIPTS_DIR")
check_run '.env.example parses' awk -f "$PARSER" "$REPO_ROOT/.env.example"

check_summary
