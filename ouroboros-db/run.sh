#!/usr/bin/env sh
#
# run.sh — apply this module's Flyway migrations to the development database.
#
# Reads the connection parameters from the repo-root .env (the copy of .env.example),
# falls back to the same development defaults the compose stack uses, and runs Flyway
# from its container, so no local Java is needed — docs/CONVENTIONS.md § 3.
#
# The database it targets is the one from the repo-root docker-compose.yml. That stack
# publishes PostgreSQL on the loopback interface only, which a container cannot reach,
# so Flyway is attached to the compose network and connects as db:5432 — the same route
# the compose migration pass takes. Start the database first:
#
#   docker compose up -d db      # from the repo root
#   ouroboros-db/run.sh          # apply what is pending
#
# `docker compose up` already migrates on the way up. This is for the times you do not
# want to cycle the whole stack: a migration you just wrote, an `info` to see where the
# schema stands, a `validate` before opening a pull request.
#
# Usage:
#   ouroboros-db/run.sh                    # migrate — apply pending migrations
#   ouroboros-db/run.sh info               # applied and pending versions
#   ouroboros-db/run.sh validate           # checksums and naming rules
#   ouroboros-db/run.sh migrate -X         # any further argument goes to Flyway
#   ouroboros-db/run.sh --dry-run          # print the command instead of running it
#
# Parameters, each resolved from the environment first, then .env, then the default:
#   OURO_DB_USER       ouroboros
#   OURO_DB_PASSWORD   ouroboros
#   OURO_DB_NAME       ouroboros
#   OURO_DB_SCHEMA     ouroboros
#
# OURO_DB_PORT is deliberately not read: it decides where the database is published on
# the host, and this connects on the compose network, where the port is always 5432.
#
# Exit status:
#   0  Flyway succeeded
#   1  Flyway failed, or the database is not up
#   2  bad usage, a malformed .env, or Docker missing

set -eu

unset CDPATH
MODULE_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$MODULE_DIR")

PARSER="$ROOT/scripts/lib/parse-env-example.awk"
ENV_FILE="$ROOT/.env"
MIGRATIONS="$MODULE_DIR/migrations"

# Kept in step with the flyway service in ../docker-compose.yml: same image, same
# network, same schema handling, so the two run the identical migration pass.
FLYWAY_IMAGE=flyway/flyway:11-alpine
NETWORK="${COMPOSE_PROJECT_NAME:-ouroboros}_default"
DB_HOST=db
DB_PORT=5432

TAB=$(printf '\t')
dry_run=0

# die STATUS MESSAGE... — report why nothing ran, and stop.
die() {
  status=$1
  shift
  printf 'run.sh: %s\n' "$*" >&2
  exit "$status"
}

# usage — the header comment above, minus its leading `# `.
usage() {
  sed -n '3,40p' "$0" | cut -c 3-
}

# ---------------------------------------------------------------------------
# Arguments — anything that is not ours belongs to Flyway
# ---------------------------------------------------------------------------

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run)
      dry_run=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

# Flyway's own default is to print its usage, which is not what "run it" should mean.
[ $# -gt 0 ] || set -- migrate

flyway_command=$1

# ---------------------------------------------------------------------------
# Parameters — the environment wins over .env, which wins over the defaults
# ---------------------------------------------------------------------------

env_pairs=''
if [ -f "$ENV_FILE" ]; then
  # The same parser that validates .env.example, relaxed for a working copy. A .env it
  # refuses is one Docker Compose would read differently, so stopping here is the point.
  env_pairs=$(awk -v template=0 -f "$PARSER" "$ENV_FILE") ||
    die 2 "$ENV_FILE is malformed — see the errors above"
fi

# env_value NAME — the value NAME carries in .env, or nothing. Looked up rather than
# eval'd into the shell, so a .env can never execute anything.
env_value() {
  [ -n "$env_pairs" ] || return 0
  printf '%s\n' "$env_pairs" | awk -F"$TAB" -v name="$1" '$1 == name { print $2; exit }'
}

# setting NAME DEFAULT — resolve one parameter from .env, or fall back to DEFAULT.
setting() {
  found=$(env_value "$1")
  printf '%s' "${found:-$2}"
}

db_user=${OURO_DB_USER:-$(setting OURO_DB_USER ouroboros)}
db_password=${OURO_DB_PASSWORD:-$(setting OURO_DB_PASSWORD ouroboros)}
db_name=${OURO_DB_NAME:-$(setting OURO_DB_NAME ouroboros)}
db_schema=${OURO_DB_SCHEMA:-$(setting OURO_DB_SCHEMA ouroboros)}

# ---------------------------------------------------------------------------
# Preflight — fail with the fix, not with a stack trace
# ---------------------------------------------------------------------------

[ -d "$MIGRATIONS" ] || die 2 "no migrations directory at $MIGRATIONS"

migrations_found=0
for candidate in "$MIGRATIONS"/*.sql; do
  if [ -f "$candidate" ]; then
    migrations_found=1
    break
  fi
done
[ "$migrations_found" -eq 1 ] ||
  die 2 "no .sql migrations in $MIGRATIONS — there is nothing to apply"

if [ "$dry_run" -eq 0 ]; then
  command -v docker >/dev/null 2>&1 ||
    die 2 'docker is not on PATH — Flyway runs from its container, so Docker is required'

  docker network inspect "$NETWORK" >/dev/null 2>&1 ||
    die 1 "no compose network $NETWORK — run 'docker compose up -d db' in $ROOT first"
fi

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

# The argument list, assembled once and used for both the dry run and the real one.
set -- \
  --rm \
  --network "$NETWORK" \
  --volume "$MIGRATIONS:/flyway/sql:ro" \
  "$FLYWAY_IMAGE" \
  -url="jdbc:postgresql://$DB_HOST:$DB_PORT/$db_name" \
  -user="$db_user" \
  -password="$db_password" \
  -schemas="$db_schema" \
  -createSchemas=true \
  -locations=filesystem:/flyway/sql \
  -validateMigrationNaming=true \
  -connectRetries=10 \
  -connectRetriesInterval=2 \
  "$@"

# The password reaches the container but is never printed: this output lands in CI logs
# and terminal scrollback, and a development password is still a password.
if [ "$dry_run" -eq 1 ]; then
  printf 'docker run'
  for argument in "$@"; do
    case $argument in
      -password=*) printf ' -password=*******' ;;
      *) printf ' %s' "$argument" ;;
    esac
  done
  printf '\n'
  exit 0
fi

printf 'run.sh: %s on %s:%s/%s as %s (schema %s)\n' \
  "$flyway_command" "$DB_HOST" "$DB_PORT" "$db_name" "$db_user" "$db_schema"

exec docker run "$@"
