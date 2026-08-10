#!/usr/bin/env sh
#
# db-run.test.sh — integration tests for ouroboros-db/run.sh.
#
# Docker is replaced by a stub on PATH and the script is pointed at synthetic module
# trees, so every path — parameter resolution, passthrough, preflight, failure — is
# exercised without a daemon, without a database, and without reading the developer's
# own .env. The stub records the `docker run` it was asked to perform, which is how the
# tests assert on the command that would really have run.
#
# It lives here because scripts/run-tests.sh is the only runner the repository has
# today; it moves to the module's own suite when #19 lands ouroboros-db/tests/.
#
# Usage:
#   scripts/tests/db-run.test.sh   # or scripts/run-tests.sh for the whole suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$SCRIPTS_DIR")

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

mkdir -p "$work/bin"
DOCKER_STUB_LOG="$work/docker.log"
export DOCKER_STUB_LOG

# A stand-in for Docker. `network inspect` decides whether the stack looks up, and every
# other invocation is logged so the tests can assert on the arguments Flyway would get.
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env sh
set -u
if [ "${1:-}" = "network" ]; then
  [ "${DOCKER_STUB_NO_NETWORK:-}" = "1" ] && exit 1
  exit 0
fi
printf '%s\n' "$*" >> "$DOCKER_STUB_LOG"
exit "${DOCKER_STUB_EXIT:-0}"
STUB
chmod +x "$work/bin/docker"

# make_module DIR — a minimal tree run.sh can resolve itself inside: the script, the
# parser it shares with the rest of the repo, and something to apply.
make_module() {
  module_root=$1
  mkdir -p "$module_root/ouroboros-db/migrations" "$module_root/scripts/lib"
  cp "$REPO_ROOT/ouroboros-db/run.sh" "$module_root/ouroboros-db/run.sh"
  cp "$SCRIPTS_DIR/lib/parse-env-example.awk" "$module_root/scripts/lib/"
  printf 'select 1;\n' > "$module_root/ouroboros-db/migrations/V000__bootstrap.sql"
}

# run_db DIR [ARG...] — run the fixture's run.sh, leaving combined output in $out, the
# exit status in $status and the stub's record of the docker call in $log.
run_db() {
  run_root=$1
  shift
  : > "$DOCKER_STUB_LOG"
  out=$(PATH="$work/bin:$PATH" "$run_root/ouroboros-db/run.sh" "$@" 2>&1)
  status=$?
  log=$(cat "$DOCKER_STUB_LOG")
}

# write_env DIR CONTENT — put a .env at the fixture's repo root.
write_env() {
  printf '%s\n' "$2" > "$1/.env"
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

# A PATH holding everything run.sh calls out to except Docker, so "docker is missing"
# can be tested without also hiding the shell that would report it.
mkdir -p "$work/nodocker"
for tool in sh awk sed cut dirname; do
  ln -sf "$(command -v "$tool")" "$work/nodocker/$tool"
done

printf '\nouroboros-db/run.sh\n\n'

base="$work/base"
make_module "$base"

# ---------------------------------------------------------------------------
# The Flyway command
# ---------------------------------------------------------------------------

printf 'The Flyway command\n'

run_db "$base" --dry-run
check_equals 0 "$status" 'a dry run exits zero'
check_matches "$out" ' migrate$' 'migrate is the default command'
check_matches "$out" '^docker run --rm --network ouroboros_default ' \
  'the container joins the compose network'
check_matches "$out" '/migrations:/flyway/sql:ro' 'the migrations are mounted read-only'
check_matches "$out" 'flyway/flyway:11-alpine' 'the Flyway image matches the compose stack'
check_matches "$out" '\-url=jdbc:postgresql://db:5432/ouroboros' 'it connects as db:5432'
check_matches "$out" '\-validateMigrationNaming=true' 'misnamed migrations are rejected'
check_matches "$out" '\-createSchemas=true' 'the schema is created if absent'

run_db "$base" --dry-run info
check_matches "$out" ' info$' 'an explicit command replaces migrate'

run_db "$base" --dry-run migrate -X --other
check_matches "$out" ' migrate -X --other$' 'further arguments reach Flyway in order'

run_db "$base" --dry-run -- info
check_matches "$out" ' info$' 'a -- separator is not passed on'

# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------

printf '\nParameter resolution\n'

rm -f "$base/.env"
run_db "$base" --dry-run
check_matches "$out" '\-user=ouroboros ' 'the development default applies with no .env'
check_matches "$out" '\-schemas=ouroboros ' 'the default schema applies with no .env'

write_env "$base" 'OURO_DB_USER=from_env_file
OURO_DB_NAME=db_from_env_file
OURO_DB_SCHEMA=schema_from_env_file'
run_db "$base" --dry-run
check_matches "$out" '\-user=from_env_file ' '.env supplies the user'
check_matches "$out" '/db_from_env_file ' '.env supplies the database name'
check_matches "$out" '\-schemas=schema_from_env_file ' '.env supplies the schema'

out=$(PATH="$work/bin:$PATH" OURO_DB_USER=from_environment \
  "$base/ouroboros-db/run.sh" --dry-run 2>&1)
check_matches "$out" '\-user=from_environment ' 'the environment overrides .env'
check_matches "$out" '\-schemas=schema_from_env_file ' \
  'an override leaves the other parameters on .env'

# A .env is a working copy, not the committed template, so it owes no one a comment.
write_env "$base" 'OURO_DB_USER=undocumented_is_fine'
run_db "$base" --dry-run
check_equals 0 "$status" 'a .env without prose comments is accepted'
check_matches "$out" '\-user=undocumented_is_fine ' 'its values are still read'

# ...but a .env that Compose would read differently must not be half-read.
write_env "$base" 'OURO_DB_USER="quoted"'
run_db "$base" --dry-run
check_equals 2 "$status" 'a .env Compose would read differently is refused'
check_matches "$out" 'is malformed' 'the refusal says which file is at fault'
check_matches "$out" 'quotes its value' 'the refusal says what is wrong with it'

write_env "$base" '# Everything commented out.'
run_db "$base" --dry-run
check_equals 0 "$status" 'a .env that declares nothing falls back to the defaults'
check_matches "$out" '\-user=ouroboros ' 'and the defaults are the compose ones'

rm -f "$base/.env"

# ---------------------------------------------------------------------------
# Secret hygiene
# ---------------------------------------------------------------------------

printf '\nSecret hygiene\n'

write_env "$base" 'OURO_DB_PASSWORD=hunter2'
run_db "$base" --dry-run
check_matches "$out" '\-password=\*+ ' 'the dry run redacts the password'
check_absent_in_text "$out" 'hunter2' 'the password never reaches the printed command'

run_db "$base"
check_equals 0 "$status" 'a real run exits zero when Flyway succeeds'
check_matches "$log" '\-password=hunter2' 'the real container is given the real password'
check_absent_in_text "$out" 'hunter2' 'the progress line does not echo the password'
check_matches "$out" 'run\.sh: migrate on db:5432/ouroboros' 'the progress line says what it is doing'

rm -f "$base/.env"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

printf '\nPreflight\n'

no_migrations="$work/no-migrations"
make_module "$no_migrations"
rm -f "$no_migrations"/ouroboros-db/migrations/*.sql
run_db "$no_migrations" --dry-run
check_equals 2 "$status" 'an empty migrations directory stops the run'
check_matches "$out" 'nothing to apply' 'and says there is nothing to apply'

no_dir="$work/no-dir"
make_module "$no_dir"
rm -rf "$no_dir/ouroboros-db/migrations"
run_db "$no_dir" --dry-run
check_equals 2 "$status" 'a missing migrations directory stops the run'

DOCKER_STUB_NO_NETWORK=1 run_db "$base"
check_equals 1 "$status" 'a database that is not up stops the run'
check_matches "$out" "docker compose up -d db" 'and the message is the command that fixes it'
unset DOCKER_STUB_NO_NETWORK

DOCKER_STUB_EXIT=1 run_db "$base"
check_equals 1 "$status" "Flyway's own failure is the script's exit status"
unset DOCKER_STUB_EXIT

out=$(PATH="$work/nodocker" "$base/ouroboros-db/run.sh" 2>&1)
status=$?
check_equals 2 "$status" 'a missing docker stops a real run'
check_matches "$out" 'docker is not on PATH' 'and says so plainly'

# ...but a dry run is only text, so it must not need Docker at all.
out=$(PATH="$work/nodocker" "$base/ouroboros-db/run.sh" --dry-run 2>&1)
status=$?
check_equals 0 "$status" 'a dry run needs no Docker'
check_matches "$out" '^docker run ' 'and still prints the command'

# ---------------------------------------------------------------------------
# Environment and invocation
# ---------------------------------------------------------------------------

printf '\nEnvironment and invocation\n'

out=$(PATH="$work/bin:$PATH" COMPOSE_PROJECT_NAME=other \
  "$base/ouroboros-db/run.sh" --dry-run 2>&1)
check_matches "$out" '\-\-network other_default ' 'COMPOSE_PROJECT_NAME renames the network'

# The script resolves its own location, so where it is called from cannot matter.
out=$(cd / && PATH="$work/bin:$PATH" "$base/ouroboros-db/run.sh" --dry-run 2>&1)
check_matches "$out" '/migrations:/flyway/sql:ro' 'it works when called from another directory'

out=$(PATH="$work/bin:$PATH" "$base/ouroboros-db/run.sh" --help 2>&1)
status=$?
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'Usage:' '--help prints the usage'
check_matches "$out" 'OURO_DB_USER' '--help lists the parameters it reads'

# ---------------------------------------------------------------------------
# The committed script
# ---------------------------------------------------------------------------

printf '\nThe committed script\n'

check_executable "$REPO_ROOT/ouroboros-db/run.sh" 'ouroboros-db/run.sh is executable'
# The two migration paths must not drift: whatever compose applies, this applies too.
for setting in '\-createSchemas=true' '\-validateMigrationNaming=true' \
  '\-locations=filesystem:/flyway/sql' 'flyway/flyway:11'; do
  # The leading dash has to be escaped for the regex; it is noise in the report.
  label=$(printf '%s' "$setting" | tr -d '\\')
  check_contains "$REPO_ROOT/ouroboros-db/run.sh" "$setting" "run.sh carries $label"
  check_contains "$REPO_ROOT/docker-compose.yml" "$setting" \
    "docker-compose.yml carries the same $label"
done

check_summary
