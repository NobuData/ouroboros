#!/usr/bin/env sh
#
# run.sh — apply this module's Flyway migrations to a running PostgreSQL.
#
# Any PostgreSQL will do: the one the repo-root compose stack starts, a server installed
# on this machine, or one across the network. It connects by host and port like any
# other client, so nothing has to be containerised for this to work.
#
#   ouroboros-db/run.sh                    # migrate — apply what is pending
#   ouroboros-db/run.sh info               # applied and pending versions
#   ouroboros-db/run.sh validate           # checksums and naming rules
#   ouroboros-db/run.sh migrate -X         # any further argument goes to Flyway
#   ouroboros-db/run.sh --dry-run          # print the command instead of running it
#   ouroboros-db/run.sh --runner docker    # force a runner instead of choosing one
#
# Flyway itself comes from whichever is available, which you can override with
# --runner:
#
#   flyway   the `flyway` on PATH, if there is one — no Docker involved at all
#   docker   the pinned Flyway image, so no local Java is needed (conventions § 3)
#
# When the container runs against a server on this machine it is given host networking,
# because a database bound to loopback — which both the compose stack and a default
# PostgreSQL install are — is not otherwise reachable from inside a container.
#
# Parameters are read from ./.env, then ../.env, then these defaults, and anything
# already in the environment wins over all of them:
#
#   OURO_DB_HOST       localhost
#   OURO_DB_PORT       5432
#   OURO_DB_NAME       ouroboros
#   OURO_DB_USER       ouroboros
#   OURO_DB_PASSWORD   ouroboros
#   OURO_DB_SCHEMA     ouroboros
#
# Copy .env.example to .env to set them. See that file for what each one is.
#
# Exit status:
#   0  Flyway succeeded
#   1  Flyway failed
#   2  bad usage, a malformed .env, or no way to run Flyway

set -eu

unset CDPATH
MODULE_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$MODULE_DIR")

PARSER="$ROOT/scripts/lib/parse-env-example.awk"
MIGRATIONS="$MODULE_DIR/migrations"

# The module's own .env first, so a database belonging to this module can be configured
# without touching the settings the whole stack shares.
ENV_FILES="$MODULE_DIR/.env $ROOT/.env"

# Matches the flyway service in ../docker-compose.yml, so both apply the same migrations
# the same way.
FLYWAY_IMAGE=flyway/flyway:11-alpine

TAB=$(printf '\t')
dry_run=0
runner=auto

# die STATUS MESSAGE... — report why nothing ran, and stop.
die() {
  status=$1
  shift
  printf 'run.sh: %s\n' "$*" >&2
  exit "$status"
}

# usage — the header comment above, minus its leading `# `.
usage() {
  sed -n '3,43p' "$0" | cut -c 3-
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
    --runner)
      [ $# -ge 2 ] || die 2 '--runner needs a value: auto, flyway or docker'
      runner=$2
      shift 2
      ;;
    --runner=*)
      runner=${1#--runner=}
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

case $runner in
  auto | flyway | docker) ;;
  *) die 2 "unknown runner: $runner (expected auto, flyway or docker)" ;;
esac

# Flyway's own default is to print its usage, which is not what "run it" should mean.
[ $# -gt 0 ] || set -- migrate

flyway_command=$1

# ---------------------------------------------------------------------------
# Parameters — the environment wins over .env, which wins over the defaults
# ---------------------------------------------------------------------------

env_pairs=''
for env_file in $ENV_FILES; do
  [ -f "$env_file" ] || continue
  # The same parser that validates .env.example, relaxed for a working copy. A .env it
  # refuses is one Docker Compose would read differently, so stopping here is the point.
  pairs=$(awk -v template=0 -f "$PARSER" "$env_file") ||
    die 2 "$env_file is malformed — see the errors above"
  # Earlier files win, so the module's own .env is appended first and searched first.
  env_pairs=${env_pairs:+$env_pairs
}$pairs
done

# env_value NAME — the value NAME carries in the first .env that sets it, or nothing.
# Looked up rather than eval'd into the shell, so a .env can never execute anything.
env_value() {
  [ -n "$env_pairs" ] || return 0
  printf '%s\n' "$env_pairs" | awk -F"$TAB" -v name="$1" '$1 == name { print $2; exit }'
}

# setting NAME DEFAULT — resolve one parameter from .env, or fall back to DEFAULT.
setting() {
  found=$(env_value "$1")
  printf '%s' "${found:-$2}"
}

db_host=${OURO_DB_HOST:-$(setting OURO_DB_HOST localhost)}
db_port=${OURO_DB_PORT:-$(setting OURO_DB_PORT 5432)}
db_name=${OURO_DB_NAME:-$(setting OURO_DB_NAME ouroboros)}
db_user=${OURO_DB_USER:-$(setting OURO_DB_USER ouroboros)}
db_password=${OURO_DB_PASSWORD:-$(setting OURO_DB_PASSWORD ouroboros)}
db_schema=${OURO_DB_SCHEMA:-$(setting OURO_DB_SCHEMA ouroboros)}

JDBC_URL="jdbc:postgresql://$db_host:$db_port/$db_name"

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

# have COMMAND — is it on PATH?
have() {
  command -v "$1" >/dev/null 2>&1
}

if [ "$runner" = auto ]; then
  # A local Flyway is preferred when there is one: it is faster, and it means a machine
  # without Docker can still migrate.
  if have flyway; then
    runner=flyway
  else
    runner=docker
  fi
fi

case $runner in
  flyway)
    have flyway ||
      die 2 'no flyway on PATH — install it, or use --runner docker'
    ;;
  docker)
    have docker ||
      die 2 'no docker on PATH — start Docker, or install Flyway and use --runner flyway'
    ;;
esac

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

# The settings both runners share, in the order the compose stack passes them.
set -- \
  -url="$JDBC_URL" \
  -user="$db_user" \
  -password="$db_password" \
  -schemas="$db_schema" \
  -createSchemas=true \
  -validateMigrationNaming=true \
  -connectRetries=10 \
  -connectRetriesInterval=2 \
  "$@"

if [ "$runner" = docker ]; then
  # A server on this machine is almost always bound to loopback, which inside a
  # container means the container itself. Host networking is what bridges that.
  case $db_host in
    localhost | 127.0.0.1 | ::1 | host.docker.internal) network='--network=host' ;;
    *) network='' ;;
  esac

  set -- \
    run --rm ${network:+"$network"} \
    --volume "$MIGRATIONS:/flyway/sql:ro" \
    "$FLYWAY_IMAGE" \
    -locations=filesystem:/flyway/sql \
    "$@"
  set -- docker "$@"
else
  # The local binary reads the migrations where they actually are.
  set -- flyway -locations="filesystem:$MIGRATIONS" "$@"
fi

# The password reaches Flyway but is never printed: this output lands in CI logs and
# terminal scrollback, and a development password is still a password.
if [ "$dry_run" -eq 1 ]; then
  separator=''
  for argument in "$@"; do
    case $argument in
      -password=*) printf '%s%s' "$separator" '-password=*******' ;;
      *) printf '%s%s' "$separator" "$argument" ;;
    esac
    separator=' '
  done
  printf '\n'
  exit 0
fi

printf 'run.sh: %s on %s:%s/%s as %s (schema %s, runner %s)\n' \
  "$flyway_command" "$db_host" "$db_port" "$db_name" "$db_user" "$db_schema" "$runner"

exec "$@"
