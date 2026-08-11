#!/usr/bin/env sh
#
# scripts.test.sh — tests for the Flyway project scaffold: ouroboros-db/flyway.toml, its
# development overlay, and the ouroboros-db/scripts/ wrappers over run.sh.
#
# Two halves. The first runs the wrappers against a synthetic module with stubbed
# runners, so what Flyway would have been asked to do is observable without a database:
# that each wrapper fixes its own command and passes everything else through, and that
# `clean` gets past none of the three gates it is not supposed to. The second reads the
# committed configuration and asserts the properties the README calls non-negotiable —
# `clean` off, naming enforced, no credential in a tracked file.
#
# What is deliberately not here: whether Flyway agrees. That is what
# `docker compose up` and the live pass in #24 answer against a real PostgreSQL; a file
# read can only assert what this repository promises.
#
# Usage:
#   ouroboros-db/tests/scripts.test.sh      # this file alone
#   scripts/run-tests.sh ouroboros-db/tests # the module's suite
#   scripts/run-tests.sh                    # every suite in the repository
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
SCRIPTS_DIR="$REPO_ROOT/scripts"

. "$SCRIPTS_DIR/lib/checks.sh"
. "$TEST_DIR/lib/fixture.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

STUB_LOG="$work/stub.log"
export STUB_LOG

fixture_stubs "$work"

base="$work/base"
fixture_module "$base"
BIN="$base/ouroboros-db/scripts"
CONFIG="$MODULE_DIR/flyway.toml"
DEV_CONFIG="$MODULE_DIR/flyway.dev.toml"

# run_script NAME [ARG...] — run one wrapper from the fixture with both runners
# available and nothing on stdin, leaving its combined output in $out, its exit status
# in $status, and whatever reached a runner in $log. Exported OURO_DB_* variables are
# inherited, which is how a test points it at another database.
run_script() {
  script_name=$1
  shift
  : > "$STUB_LOG"
  out=$(PATH="$work/both" "$BIN/$script_name" "$@" </dev/null 2>&1)
  status=$?
  log=$(cat "$STUB_LOG")
}

# answer_clean_dev ANSWER [ARG...] — run clean-dev with ANSWER on stdin, which is what a
# developer typing the database name at the prompt amounts to.
answer_clean_dev() {
  script_answer=$1
  shift
  : > "$STUB_LOG"
  out=$(printf '%s\n' "$script_answer" | PATH="$work/both" "$BIN/clean-dev" "$@" 2>&1)
  status=$?
}

printf '\nouroboros-db — the Flyway project\n\n'

# ---------------------------------------------------------------------------
# The named commands
# ---------------------------------------------------------------------------

printf 'The named commands\n'

for name in migrate info validate clean-dev; do
  check_executable "$MODULE_DIR/scripts/$name" "scripts/$name is executable"
done

# There is no scripts/clean, on purpose: the only clean in this directory is the one
# that checks where it is pointed first.
if [ -e "$MODULE_DIR/scripts/clean" ]; then
  fail 'there is no scripts/clean to reach for by mistake'
else
  pass 'there is no scripts/clean to reach for by mistake'
fi

for name in migrate info validate; do
  run_script "$name" --dry-run
  check_equals 0 "$status" "scripts/$name exits zero on a dry run"
  check_matches "$out" " $name\$" "scripts/$name runs flyway $name"
  check_matches "$out" '\-url=jdbc:postgresql://localhost:5432/ouroboros ' \
    "scripts/$name resolves the target the same way run.sh does"
done

# The wrappers are a name for a command, not a second configuration layer: every flag
# run.sh understands has to survive the trip.
run_script info --dry-run --runner docker
check_matches "$out" '^docker run ' 'a wrapper passes --runner through'
check_matches "$out" ' info$' 'and still fixes its own command'

OURO_DB_HOST=db.example.test
export OURO_DB_HOST
run_script info --dry-run
check_matches "$out" '\-url=jdbc:postgresql://db.example.test:5432/' \
  'a wrapper reads the same OURO_DB_* variables'
unset OURO_DB_HOST

run_script migrate
check_equals 0 "$status" 'a real wrapper run exits zero when Flyway succeeds'
check_matches "$out" 'run\.sh: migrate on localhost:5432/ouroboros' \
  'and reports what it is doing'

STUB_EXIT=1 run_script migrate
check_equals 1 "$status" "Flyway's own failure is the wrapper's exit status"
unset STUB_EXIT

# ---------------------------------------------------------------------------
# clean is gated
# ---------------------------------------------------------------------------

printf '\nclean is gated\n'

# Gate 1 — the configuration every other command runs with refuses it. Nothing here can
# prove Flyway honours cleanDisabled (that is Flyway's own contract, exercised by
# `docker compose up` and #24); what it proves is that no command reaches for the
# overlay that switches it off unless it is clean-dev.
check_contains "$CONFIG" '^cleanDisabled = true$' 'flyway.toml disables clean'
for name in migrate info validate; do
  check_absent "$MODULE_DIR/scripts/$name" 'flyway\.dev\.toml' \
    "scripts/$name never loads the overlay"
  check_absent "$MODULE_DIR/scripts/$name" 'clean' "scripts/$name never runs clean"
done
# Anchored past any `#`: the compose file explains why it does not load this overlay,
# beside the seed overlay it does load (#23), and a mount or a -configFiles naming it
# still fails here.
check_absent "$REPO_ROOT/docker-compose.yml" '^[^#]*flyway\.dev\.toml' \
  'the compose stack never loads the overlay either'

# Gate 2 — clean-dev is the one thing that does load it, and it loads only that.
check_contains "$MODULE_DIR/scripts/clean-dev" 'DEV_CONFIG=flyway\.dev\.toml' \
  'clean-dev names the overlay'
check_contains "$DEV_CONFIG" '^cleanDisabled = false$' 'and the overlay is what enables clean'

answer_clean_dev ouroboros --dry-run
check_equals 0 "$status" 'clean-dev dry-runs without asking anything'
check_matches "$out" 'configFiles=[^ ]*/flyway\.toml,[^ ]*/flyway\.dev\.toml ' \
  'and layers the overlay over flyway.toml'
check_matches "$out" ' clean$' 'and the command it would run is clean'

missing="$work/no-overlay"
fixture_module "$missing"
rm -f "$missing/ouroboros-db/flyway.dev.toml"
out=$(PATH="$work/both" "$missing/ouroboros-db/scripts/clean-dev" --yes </dev/null 2>&1)
status=$?
check_equals 2 "$status" 'without the overlay there is no clean at all'
check_matches "$out" 'clean stays disabled' 'and the refusal says why'

# Gate 3a — a database that is not on this machine is refused before anything else.
OURO_DB_HOST=db.example.test
export OURO_DB_HOST

run_script clean-dev --yes
check_equals 2 "$status" 'a remote database is refused'
check_matches "$out" 'only runs against a' 'and the refusal says what it will accept'
check_equals '' "$log" 'and nothing was handed to Flyway'

run_script clean-dev --dry-run
check_equals 2 "$status" 'a remote database is refused even for a dry run'

for local_host in localhost 127.0.0.1 ::1 host.docker.internal; do
  OURO_DB_HOST=$local_host
  run_script clean-dev --yes --dry-run
  check_equals 0 "$status" "$local_host counts as a database on this machine"
done

unset OURO_DB_HOST

# Gate 3b — the name has to come back before anything is dropped.
run_script clean-dev
check_equals 2 "$status" 'an unanswered prompt drops nothing'
check_matches "$out" 'not confirmed' 'and says so'
check_matches "$out" 'DROPS every object' 'having said what it was about to do'

answer_clean_dev wrong-name
check_equals 2 "$status" 'the wrong name drops nothing'
check_matches "$out" 'not confirmed' 'and says so'

answer_clean_dev ouroboros
check_equals 0 "$status" 'the database name typed back is the confirmation'
check_matches "$out" 'run\.sh: clean on localhost:5432/ouroboros' 'and clean then runs'

run_script clean-dev --yes
check_equals 0 "$status" '--yes is the deliberate way past the prompt'
check_not_matches "$out" 'to confirm' 'and there is no prompt to answer'

run_script clean-dev -h
check_equals 0 "$status" '-h exits zero'
check_matches "$out" 'clean-dev --yes' 'and documents the flag that skips the prompt'

# ---------------------------------------------------------------------------
# The committed configuration
# ---------------------------------------------------------------------------

printf '\nThe committed configuration\n'

check_exists "$CONFIG" 'flyway.toml exists'
check_exists "$DEV_CONFIG" 'flyway.dev.toml exists'

# The settings the module README states as rules. They live here so the compose stack
# and run.sh cannot apply the same migrations under different ones.
check_contains "$CONFIG" '^locations = \["filesystem:migrations"\]$' \
  'flyway.toml finds the migrations relative to the project'
check_contains "$CONFIG" '^validateMigrationNaming = true$' \
  'flyway.toml rejects a misnamed migration'
check_contains "$CONFIG" '^createSchemas = true$' 'flyway.toml creates the schema it owns'
check_contains "$CONFIG" '^schemas = \["ouroboros"\]$' 'flyway.toml owns the ouroboros schema'
check_contains "$CONFIG" '^connectRetries = ' 'flyway.toml retries a database still starting'

# A connection belongs to a machine, not to a project; two of its three parts are also a
# credential. Anything of the sort here would be committed.
for secret in url user password; do
  check_absent "$CONFIG" "^$secret = " "flyway.toml carries no $secret"
  check_absent "$DEV_CONFIG" "^$secret = " "flyway.dev.toml carries no $secret"
done
check_absent "$CONFIG" '^cleanDisabled = false$' 'flyway.toml never enables clean'

# Flyway loads flyway.toml and flyway.user.toml from the project directory by itself. The
# first is committed; the second is where a local override — and a password — would land.
check_contains "$REPO_ROOT/.gitignore" '^flyway\.user\.toml$' \
  'a local flyway.user.toml stays out of git'

check_summary
