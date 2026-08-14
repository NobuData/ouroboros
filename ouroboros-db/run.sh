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
#   ouroboros-db/run.sh --config FILE      # layer another config file over flyway.toml
#   ouroboros-db/run.sh --print-target     # print the database it would migrate
#
# scripts/{migrate,info,validate,clean-dev} are the named commands built on this. Use
# them for the everyday four; use this directly for anything they do not cover.
#
# How Flyway is *configured* is not an argument here. flyway.toml beside this script
# holds the project's settings — where the migrations are, that the schema is created,
# that a misnamed migration fails the run, that `clean` is off — and both runners are
# pointed at that directory with -workingDirectory, so they read it the same way the
# compose stack does. Only what differs per machine (url, user, password, schema) is
# passed on the command line. --config layers one more file on top, which is how
# scripts/clean-dev reaches flyway.dev.toml and nothing else does.
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

# The project configuration both runners read, and the directory the container sees it
# in. Everything under PROJECT mirrors this module, so the relative paths inside
# flyway.toml mean the same thing on both sides of the container boundary.
CONFIG=flyway.toml
PROJECT=/flyway/project

# The module's own .env first, so a database belonging to this module can be configured
# without touching the settings the whole stack shares.
ENV_FILES="$MODULE_DIR/.env $ROOT/.env"

# Matches the flyway service in ../docker-compose.yml, so both apply the same migrations
# the same way.
FLYWAY_IMAGE=flyway/flyway:13-alpine

TAB=$(printf '\t')
dry_run=0
print_target=0
runner=auto
overlay=''

# die STATUS MESSAGE... — report why nothing ran, and stop.
die() {
  status=$1
  shift
  printf 'run.sh: %s\n' "$*" >&2
  exit "$status"
}

# usage — the header comment above, minus its leading `# `.
usage() {
  sed -n '3,54p' "$0" | cut -c 3-
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
    --print-target)
      print_target=1
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
    --config)
      [ $# -ge 2 ] || die 2 "--config needs the name of a file in $MODULE_DIR"
      overlay=$2
      shift 2
      ;;
    --config=*)
      overlay=${1#--config=}
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

if [ -n "$overlay" ]; then
  # A bare file name inside this module, never a path: the container only ever sees this
  # directory, and a --config that could reach anywhere on the disk would be a way to
  # feed Flyway a configuration nobody reviewed.
  case $overlay in
    */* | .*) die 2 "--config takes the name of a file in $MODULE_DIR, not a path: $overlay" ;;
  esac
  [ -f "$MODULE_DIR/$overlay" ] || die 2 "no $overlay in $MODULE_DIR"
fi

# Flyway's own default is to print its usage, which is not what "run it" should mean.
[ $# -gt 0 ] || set -- migrate

# The command for the progress line: the first argument that is not a Flyway flag, so a
# `-X info` reports itself as info rather than as -X.
flyway_command=$1
for argument in "$@"; do
  case $argument in
    -*) ;;
    *)
      flyway_command=$argument
      break
      ;;
  esac
done

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

[ -f "$MODULE_DIR/$CONFIG" ] || die 2 "no $CONFIG in $MODULE_DIR — this is not a Flyway project"

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
# The resolved target, for anything that has to decide before it runs
# ---------------------------------------------------------------------------

# scripts/clean-dev refuses a database that is not on this machine, and asks for the
# database name back before it drops anything. Both facts are resolved here, and this is
# how it reads them rather than parsing .env a second way. The password is not among
# them: nothing that needs to *decide* something needs the password.
if [ "$print_target" -eq 1 ]; then
  printf '%s\n' \
    "host$TAB$db_host" \
    "port$TAB$db_port" \
    "name$TAB$db_name" \
    "user$TAB$db_user" \
    "schema$TAB$db_schema" \
    "runner$TAB$runner"
  exit 0
fi

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

# What differs per machine. Everything else is flyway.toml's, which both runners reach
# through -workingDirectory below.
set -- \
  -url="$JDBC_URL" \
  -user="$db_user" \
  -password="$db_password" \
  -schemas="$db_schema" \
  "$@"

# An overlay is only ever read when it is named, so flyway.toml has to be named too:
# -configFiles replaces the auto-discovered file rather than adding to it.
if [ "$runner" = docker ]; then
  [ -z "$overlay" ] || set -- -configFiles="$PROJECT/$CONFIG,$PROJECT/$overlay" "$@"
  set -- -workingDirectory="$PROJECT" "$@"
  set -- "$FLYWAY_IMAGE" "$@"

  # Only what Flyway reads is mounted, and all of it read-only: the config, the
  # migrations, and the overlay when one was asked for. Mounting the module wholesale
  # would hand the container this developer's .env as well, which it has no use for.
  [ -z "$overlay" ] ||
    set -- --volume "$MODULE_DIR/$overlay:$PROJECT/$overlay:ro" "$@"
  set -- --volume "$MIGRATIONS:$PROJECT/migrations:ro" "$@"
  set -- --volume "$MODULE_DIR/$CONFIG:$PROJECT/$CONFIG:ro" "$@"

  # A server on this machine is almost always bound to loopback, which inside a
  # container means the container itself. Host networking is what bridges that.
  case $db_host in
    localhost | 127.0.0.1 | ::1 | host.docker.internal)
      set -- --network=host "$@"
      ;;
  esac

  set -- docker run --rm "$@"
else
  # The local binary reads the project where it actually is.
  [ -z "$overlay" ] || set -- -configFiles="$MODULE_DIR/$CONFIG,$MODULE_DIR/$overlay" "$@"
  set -- flyway -workingDirectory="$MODULE_DIR" "$@"
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
