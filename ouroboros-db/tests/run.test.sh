#!/usr/bin/env sh
#
# run.test.sh — integration tests for ouroboros-db/run.sh.
#
# Both runners are replaced by stubs on PATH and the script is pointed at synthetic
# module trees, so every path — runner selection, parameter resolution, configuration,
# passthrough, preflight, failure — is exercised without Docker, without Flyway, without
# a database, and without reading the developer's own .env. Each stub records how it was
# called, which is how the tests assert on the command that would really have run.
#
# Usage:
#   ouroboros-db/tests/run.test.sh          # this file alone
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

TAB=$(printf '\t')
STUB_LOG="$work/stub.log"
export STUB_LOG

fixture_stubs "$work"

# run_db DIR [ARG...] — run the fixture's run.sh with both runners available, leaving
# combined output in $out, the exit status in $status and the stub's record in $log.
run_db() {
  run_root=$1
  shift
  : > "$STUB_LOG"
  out=$(PATH="$work/both" "$run_root/ouroboros-db/run.sh" "$@" 2>&1)
  status=$?
  log=$(cat "$STUB_LOG")
}

# run_db_on PATH_DIR DIR [ARG...] — the same, with a chosen PATH.
run_db_on() {
  path_dir=$1
  run_root=$2
  shift 2
  : > "$STUB_LOG"
  out=$(PATH="$work/$path_dir" "$run_root/ouroboros-db/run.sh" "$@" 2>&1)
  status=$?
  log=$(cat "$STUB_LOG")
}

# write_env DIR CONTENT — put a .env at the fixture's repo root.
write_env() {
  printf '%s\n' "$2" > "$1/.env"
}

# write_module_env DIR CONTENT — put a .env in the fixture's module directory.
write_module_env() {
  printf '%s\n' "$2" > "$1/ouroboros-db/.env"
}

# check_absent_in_text TEXT NEEDLE DESCRIPTION — assert NEEDLE appears nowhere in TEXT.
# Literal rather than a regex, because what it is used for is passwords.
check_absent_in_text() {
  if printf '%s\n' "$1" | grep -Fq -- "$2"; then
    fail "$3"
  else
    pass "$3"
  fi
}

printf '\nouroboros-db/run.sh\n\n'

base="$work/base"
fixture_module "$base"

# ---------------------------------------------------------------------------
# Choosing a runner
# ---------------------------------------------------------------------------

printf 'Choosing a runner\n'

run_db "$base" --dry-run
check_matches "$out" '^flyway ' 'a local Flyway is preferred when there is one'

run_db_on docker-only "$base" --dry-run
check_matches "$out" '^docker run ' 'the container is the fallback when there is not'

run_db "$base" --dry-run --runner docker
check_matches "$out" '^docker run ' '--runner docker forces the container'

run_db "$base" --dry-run --runner flyway
check_matches "$out" '^flyway ' '--runner flyway forces the local binary'

run_db "$base" --dry-run --runner=docker
check_matches "$out" '^docker run ' '--runner=value is accepted too'

run_db "$base" --dry-run --runner nonsense
check_equals 2 "$status" 'an unknown runner is refused'
check_matches "$out" 'expected auto, flyway or docker' 'and the message says what is valid'

run_db "$base" --dry-run --runner
check_equals 2 "$status" '--runner without a value is refused'

run_db_on docker-only "$base" --runner flyway
check_equals 2 "$status" 'asking for a Flyway that is not installed is refused'
check_matches "$out" 'no flyway on PATH' 'and the message says which one is missing'

run_db_on neither "$base" --runner docker
check_equals 2 "$status" 'asking for a Docker that is not installed is refused'
check_matches "$out" 'no docker on PATH' 'and the message says which one is missing'

run_db_on neither "$base"
check_equals 2 "$status" 'with neither available, nothing is run'

# ---------------------------------------------------------------------------
# Reaching the database
# ---------------------------------------------------------------------------

printf '\nReaching the database\n'

run_db "$base" --dry-run
check_matches "$out" '\-url=jdbc:postgresql://localhost:5432/ouroboros ' \
  'it connects to localhost:5432 by default'

out=$(PATH="$work/both" OURO_DB_HOST=db.example.test OURO_DB_PORT=6543 \
  "$base/ouroboros-db/run.sh" --dry-run 2>&1)
check_matches "$out" '\-url=jdbc:postgresql://db.example.test:6543/ouroboros ' \
  'any host and port can be reached'

# A server on this machine is bound to loopback, which inside a container is the
# container. Host networking is the only thing that bridges that.
run_db "$base" --dry-run --runner docker
check_matches "$out" '^docker run --rm --network=host ' \
  'the container is given host networking for a local database'

out=$(PATH="$work/both" OURO_DB_HOST=127.0.0.1 \
  "$base/ouroboros-db/run.sh" --dry-run --runner docker 2>&1)
check_matches "$out" '\-\-network=host ' '127.0.0.1 counts as local too'

out=$(PATH="$work/both" OURO_DB_HOST=db.example.test \
  "$base/ouroboros-db/run.sh" --dry-run --runner docker 2>&1)
check_absent_in_text "$out" '--network=host' 'a remote database gets ordinary networking'

# ---------------------------------------------------------------------------
# The Flyway project
# ---------------------------------------------------------------------------

printf '\nThe Flyway project\n'

# Each runner is pointed at the project where it can actually see it, and flyway.toml
# resolves its own relative locations from there.
run_db "$base" --dry-run --runner docker
check_matches "$out" '/flyway\.toml:/flyway/project/flyway\.toml:ro ' \
  'the container mounts the configuration read-only'
check_matches "$out" '/migrations:/flyway/project/migrations:ro ' \
  'and the migrations read-only beside it'
check_matches "$out" '\-workingDirectory=/flyway/project ' 'and works from the mount'

run_db "$base" --dry-run --runner flyway
check_matches "$out" "\\-workingDirectory=$base/ouroboros-db " \
  'the local binary works from the module directory'

# The settings belong to flyway.toml. Repeating them here is what let the compose stack
# and this script drift apart before #19.
for repeated in -locations= -createSchemas -validateMigrationNaming -connectRetries; do
  run_db "$base" --dry-run
  check_absent_in_text "$out" "$repeated" "$repeated is left to flyway.toml"
done

# Only the module's own .env is left out of the container: it is the developer's, and a
# migrator has no use for it.
run_db "$base" --dry-run --runner docker
check_absent_in_text "$out" "$base/ouroboros-db:" 'the module is not mounted wholesale'

no_config="$work/no-config"
fixture_module "$no_config"
rm -f "$no_config/ouroboros-db/flyway.toml"
run_db "$no_config" --dry-run
check_equals 2 "$status" 'a module with no flyway.toml is not a Flyway project'
check_matches "$out" 'no flyway\.toml' 'and the refusal names the file'

# ---------------------------------------------------------------------------
# Layering a second configuration file
# ---------------------------------------------------------------------------

printf '\nLayering a second configuration file\n'

run_db "$base" --dry-run --config flyway.dev.toml --runner docker
check_matches "$out" '/flyway\.dev\.toml:/flyway/project/flyway\.dev\.toml:ro ' \
  'the overlay is mounted alongside the configuration'
check_matches "$out" '\-configFiles=/flyway/project/flyway\.toml,/flyway/project/flyway\.dev\.toml ' \
  'and both files are named, because -configFiles replaces the discovered one'

run_db "$base" --dry-run --config flyway.dev.toml --runner flyway
check_matches "$out" "\\-configFiles=$base/ouroboros-db/flyway\\.toml,$base/ouroboros-db/flyway\\.dev\\.toml " \
  'the local binary is given the same pair'

run_db "$base" --dry-run --config=flyway.dev.toml
check_matches "$out" 'flyway\.dev\.toml' '--config=value is accepted too'

run_db "$base" --dry-run
check_absent_in_text "$out" 'configFiles' 'no overlay means no -configFiles at all'

run_db "$base" --dry-run --config
check_equals 2 "$status" '--config without a value is refused'

run_db "$base" --dry-run --config nothing.toml
check_equals 2 "$status" 'a file that is not there is refused'

# The container only ever sees this module, so a --config that could name a path would
# be a way to feed Flyway a configuration from anywhere on the disk.
for escape in ../.env /etc/passwd ./flyway.dev.toml .env; do
  run_db "$base" --dry-run --config "$escape"
  check_equals 2 "$status" "--config $escape is refused"
done

# ---------------------------------------------------------------------------
# The Flyway command
# ---------------------------------------------------------------------------

printf '\nThe Flyway command\n'

run_db "$base" --dry-run
check_matches "$out" ' migrate$' 'migrate is the default command'

run_db "$base" --dry-run info
check_matches "$out" ' info$' 'an explicit command replaces migrate'

run_db "$base" --dry-run migrate -X --other
check_matches "$out" ' migrate -X --other$' 'further arguments reach Flyway in order'

run_db "$base" --dry-run -- info
check_matches "$out" ' info$' 'a -- separator is not passed on'

run_db "$base" --dry-run --runner docker info
check_matches "$out" ' info$' 'the runner flag is not passed on'

# The wrappers put their command last, so a Flyway flag can precede it.
run_db "$base" -X info
check_matches "$out" 'run\.sh: info on ' 'the command reported is the command, not a flag'

# ---------------------------------------------------------------------------
# Reporting the target
# ---------------------------------------------------------------------------

printf '\nReporting the target\n'

run_db "$base" --print-target
check_equals 0 "$status" '--print-target exits zero'
check_matches "$out" "^host${TAB}localhost\$" 'it reports the host'
check_matches "$out" "^port${TAB}5432\$" 'it reports the port'
check_matches "$out" "^name${TAB}ouroboros\$" 'it reports the database'
check_matches "$out" "^schema${TAB}ouroboros\$" 'it reports the schema'
check_matches "$out" "^runner${TAB}flyway\$" 'it reports the runner it would use'
check_equals '' "$log" 'and runs nothing at all'

write_module_env "$base" 'OURO_DB_PASSWORD=hunter2
OURO_DB_HOST=db.example.test'
run_db "$base" --print-target
check_matches "$out" "^host${TAB}db\.example\.test\$" 'it resolves .env exactly as a real run does'
check_absent_in_text "$out" 'hunter2' 'and never reports the password'
rm -f "$base/ouroboros-db/.env"

# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------

printf '\nParameter resolution\n'

rm -f "$base/.env" "$base/ouroboros-db/.env"
run_db "$base" --dry-run
check_matches "$out" '\-user=ouroboros ' 'the development default applies with no .env'
check_matches "$out" '\-schemas=ouroboros ' 'the default schema applies with no .env'

write_env "$base" 'OURO_DB_USER=from_root
OURO_DB_NAME=db_from_root
OURO_DB_SCHEMA=schema_from_root'
run_db "$base" --dry-run
check_matches "$out" '\-user=from_root ' 'the repo-root .env supplies parameters'
check_matches "$out" '/db_from_root ' 'including the database name'

# The module's own .env is the more specific of the two, so it wins.
write_module_env "$base" 'OURO_DB_USER=from_module'
run_db "$base" --dry-run
check_matches "$out" '\-user=from_module ' "the module's .env beats the repo-root one"
check_matches "$out" '\-schemas=schema_from_root ' \
  'and leaves what it does not set to the repo-root one'

out=$(PATH="$work/both" OURO_DB_USER=from_environment \
  "$base/ouroboros-db/run.sh" --dry-run 2>&1)
check_matches "$out" '\-user=from_environment ' 'the environment beats both files'

# A .env is a working copy, not the committed template, so it owes no one a comment.
rm -f "$base/.env"
write_module_env "$base" 'OURO_DB_USER=undocumented_is_fine'
run_db "$base" --dry-run
check_equals 0 "$status" 'a .env without prose comments is accepted'
check_matches "$out" '\-user=undocumented_is_fine ' 'its values are still read'

# ...but a .env that Compose would read differently must not be half-read.
write_module_env "$base" 'OURO_DB_USER="quoted"'
run_db "$base" --dry-run
check_equals 2 "$status" 'a .env Compose would read differently is refused'
check_matches "$out" 'is malformed' 'the refusal says which file is at fault'
check_matches "$out" 'quotes its value' 'the refusal says what is wrong with it'

write_module_env "$base" '# Everything commented out.'
run_db "$base" --dry-run
check_equals 0 "$status" 'a .env that declares nothing falls back to the defaults'
check_matches "$out" '\-user=ouroboros ' 'and the defaults are the documented ones'

rm -f "$base/.env" "$base/ouroboros-db/.env"

# ---------------------------------------------------------------------------
# Secret hygiene
# ---------------------------------------------------------------------------

printf '\nSecret hygiene\n'

write_module_env "$base" 'OURO_DB_PASSWORD=hunter2'

for chosen in flyway docker; do
  run_db "$base" --dry-run --runner "$chosen"
  check_matches "$out" '\-password=\*+' "the $chosen dry run redacts the password"
  check_absent_in_text "$out" 'hunter2' "the $chosen command never prints it"

  run_db "$base" --runner "$chosen"
  check_equals 0 "$status" "a real $chosen run exits zero when Flyway succeeds"
  check_matches "$log" '\-password=hunter2' "the real $chosen run is given the password"
  check_absent_in_text "$out" 'hunter2' "the $chosen progress line does not echo it"
done

run_db "$base" --runner flyway
check_matches "$out" 'run\.sh: migrate on localhost:5432/ouroboros' \
  'the progress line says what it is doing'
check_matches "$out" 'runner flyway' 'and which runner it chose'

rm -f "$base/ouroboros-db/.env"

# ---------------------------------------------------------------------------
# Preflight and failure
# ---------------------------------------------------------------------------

printf '\nPreflight and failure\n'

no_migrations="$work/no-migrations"
fixture_module "$no_migrations"
rm -f "$no_migrations"/ouroboros-db/migrations/*.sql
run_db "$no_migrations" --dry-run
check_equals 2 "$status" 'an empty migrations directory stops the run'
check_matches "$out" 'nothing to apply' 'and says there is nothing to apply'

no_dir="$work/no-dir"
fixture_module "$no_dir"
rm -rf "$no_dir/ouroboros-db/migrations"
run_db "$no_dir" --dry-run
check_equals 2 "$status" 'a missing migrations directory stops the run'

STUB_EXIT=1 run_db "$base"
check_equals 1 "$status" "Flyway's own failure is the script's exit status"
unset STUB_EXIT

# ---------------------------------------------------------------------------
# Invocation
# ---------------------------------------------------------------------------

printf '\nInvocation\n'

# The script resolves its own location, so where it is called from cannot matter.
out=$(cd / && PATH="$work/both" "$base/ouroboros-db/run.sh" --dry-run 2>&1)
check_matches "$out" "$base/ouroboros-db" 'it works when called from another directory'

out=$(PATH="$work/both" "$base/ouroboros-db/run.sh" --help 2>&1)
status=$?
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'run\.sh --runner docker' '--help shows the runner flag'
check_matches "$out" 'run\.sh --config FILE' '--help shows the configuration flag'
check_matches "$out" 'OURO_DB_HOST' '--help lists the parameters it reads'

# ---------------------------------------------------------------------------
# The committed module
# ---------------------------------------------------------------------------

printf '\nThe committed module\n'

check_executable "$MODULE_DIR/run.sh" 'ouroboros-db/run.sh is executable'
check_run 'ouroboros-db/.env.example parses' \
  awk -f "$SCRIPTS_DIR/lib/parse-env-example.awk" "$MODULE_DIR/.env.example"

# Every parameter run.sh reads has to be in the template a developer copies.
declared=$(awk -f "$SCRIPTS_DIR/lib/parse-env-example.awk" \
  "$MODULE_DIR/.env.example" | cut -f 1)
for name in OURO_DB_HOST OURO_DB_PORT OURO_DB_NAME OURO_DB_USER OURO_DB_PASSWORD \
  OURO_DB_SCHEMA; do
  check_matches "$declared" "^$name\$" "the module template declares $name"
  check_contains "$MODULE_DIR/run.sh" "$name" "run.sh reads $name"
done

# The two migration paths must not drift: whatever compose applies, this applies too.
# Since #19 that is one assertion rather than one per setting — both are pointed at the
# same project directory, and the settings live in the file they find there.
check_contains "$MODULE_DIR/run.sh" 'flyway/flyway:11' 'run.sh pins the Flyway 11 image'
check_contains "$REPO_ROOT/docker-compose.yml" 'flyway/flyway:11' \
  'docker-compose.yml pins the same image'
check_contains "$MODULE_DIR/run.sh" '\-workingDirectory=' 'run.sh reads the project config'
check_contains "$REPO_ROOT/docker-compose.yml" '\-workingDirectory=/flyway/project' \
  'docker-compose.yml reads the same project config'

check_summary
