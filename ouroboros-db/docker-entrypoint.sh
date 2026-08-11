#!/usr/bin/env sh
#
# docker-entrypoint.sh — the migration image's front door.
#
# Flyway needs to be told which database to migrate. Everywhere else in this repository
# that is said with OURO_DB_* (.env.example, run.sh, the compose stack), so it is said
# with OURO_DB_* here too — this translates them into the connection Flyway reads and
# then gets out of the way:
#
#   OURO_DB_HOST       required — the server to migrate. No default: `localhost` inside
#                      a container is the container, so a default would turn a missing
#                      value into a confusing failure instead of a named one.
#   OURO_DB_PORT       5432
#   OURO_DB_NAME       ouroboros
#   OURO_DB_USER       the role to connect as
#   OURO_DB_PASSWORD   its password
#   OURO_DB_SCHEMA     the schema Flyway owns; unset leaves flyway.toml's `ouroboros`
#
# Those six and no others, because they are the six run.sh reads and the six
# ../.env.example declares — a seventh that only this image understood would be a
# parameter no other way of migrating had.
#
# They become FLYWAY_URL / FLYWAY_USER / FLYWAY_PASSWORD / FLYWAY_SCHEMAS — Flyway's own
# environment variables — rather than -url/-user/-password arguments. The difference is
# the password: an argument is visible in the container's process list to anything else
# in that namespace and in whatever logged the command, while an environment variable is
# not. Flyway's own FLYWAY_* variables therefore still work if a deployment would rather
# set them directly; everything below only fills in the ones it was given OURO_DB_* for.
#
# Everything on the command line is Flyway's, untouched, and Flyway reads an argument in
# preference to the environment — so `-url=` on the command line is honoured, and a
# caller who gives one is asking for a database this script then has no business
# resolving:
#
#   docker run … ouroboros-db                     # migrate, from OURO_DB_*
#   docker run … ouroboros-db info                # what is applied and what is pending
#   docker run … ouroboros-db validate            # checksums and the naming rule
#   docker run ouroboros-db -url=jdbc:… -user=… -password=… migrate   # no OURO_DB_* at all
#
# The dev seed is not reachable by accident and is reachable on purpose, exactly as it
# is from a laptop — flyway.seed.toml is in the image, and Flyway loads no overlay it is
# not handed. -configFiles *replaces* the file Flyway would have auto-loaded, so the
# project configuration has to be named alongside it:
#
#   docker run … ouroboros-db \
#     -configFiles=/flyway/project/flyway.toml,/flyway/project/flyway.seed.toml migrate
#
# `clean` is not reachable at all: flyway.toml disables it and flyway.dev.toml, the one
# file that re-enables it, is not in this image. See the Dockerfile.
#
# Exit status:
#   0  Flyway succeeded
#   1  Flyway failed
#   2  there was nothing to point Flyway at

set -eu

# Where the Dockerfile put the project — the same path the compose stack mounts it at
# and the same one run.sh's container arm uses, so flyway.toml's relative
# `filesystem:migrations` means the same thing in all three.
PROJECT=/flyway/project

# die MESSAGE... — report what is missing and what would fix it, and run nothing.
die() {
  printf 'ouroboros-db: %s\n' "$*" >&2
  exit 2
}

# A caller who passed -url= is speaking Flyway directly and has said which database this
# is. Resolving one from the environment as well would put a second answer in the
# environment for the first to quietly beat.
url_given=0
for argument in "$@"; do
  case $argument in
    -url=*) url_given=1 ;;
  esac
done

if [ "$url_given" -eq 0 ] && [ -z "${FLYWAY_URL:-}" ]; then
  [ -n "${OURO_DB_HOST:-}" ] ||
    die 'no database to migrate: set OURO_DB_HOST, OURO_DB_USER and OURO_DB_PASSWORD,' \
      'or pass -url= -user= -password= yourself'
  FLYWAY_URL="jdbc:postgresql://$OURO_DB_HOST:${OURO_DB_PORT:-5432}/${OURO_DB_NAME:-ouroboros}"
  export FLYWAY_URL
fi

# Each one is passed on only when it was set, so an unset variable leaves whatever
# flyway.toml settles rather than overriding it with an empty string.
if [ -n "${OURO_DB_USER:-}" ]; then
  FLYWAY_USER=$OURO_DB_USER
  export FLYWAY_USER
fi

if [ -n "${OURO_DB_PASSWORD:-}" ]; then
  FLYWAY_PASSWORD=$OURO_DB_PASSWORD
  export FLYWAY_PASSWORD
fi

if [ -n "${OURO_DB_SCHEMA:-}" ]; then
  FLYWAY_SCHEMAS=$OURO_DB_SCHEMA
  export FLYWAY_SCHEMAS
fi

# -workingDirectory is what makes Flyway read the project configuration in $PROJECT, and
# with it the relative location of the migrations — the same mechanism the compose stack
# and run.sh use, so this image applies the checkout under the rules it was reviewed
# under rather than under a set written into a container.
exec flyway -workingDirectory="$PROJECT" "$@"
