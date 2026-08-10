#!/usr/bin/env sh
#
# verify-dev-env.sh — assert the local development data tier established by issue #10.
#
# Checks the contract of the repo-root compose stack: that PostgreSQL is pinned and
# healthchecked onto a named volume, that Flyway waits for it and migrates the checkout
# read-only, that every credential is interpolated rather than written down, that
# .env.example declares every variable anything in the repo actually reads, and that the
# up / reset flow is documented where a developer will look for it.
#
# It reads files and starts nothing: no Docker daemon, no network, no database. Whether
# the stack really comes up is what `docker compose up` answers, and the README says how.
# That keeps this runnable in CI and on a laptop with Docker stopped, matching
# verify-layout.sh and verify-github-config.sh.
#
# Usage:
#   scripts/verify-dev-env.sh              # run from anywhere; resolves the repo root
#   scripts/verify-dev-env.sh --root DIR   # check DIR instead (used by the tests)
#
# Exit status:
#   0  every check passed
#   1  at least one check failed (each failure is printed with its reason)

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")

while [ $# -gt 0 ]; do
  case $1 in
    --root)
      [ $# -ge 2 ] || { printf 'verify-dev-env: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$2" && pwd)
      shift 2
      ;;
    -h | --help)
      sed -n '2,22p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'verify-dev-env: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# The assertion harness, shared with the repo's other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

COMPOSE=docker-compose.yml
ENV_EXAMPLE=.env.example
MIGRATIONS=ouroboros-db/migrations
PARSER="$SCRIPT_DIR/lib/parse-env-example.awk"

printf '\nLocal development environment — %s\n\n' "$ROOT"

# ---------------------------------------------------------------------------
# Compose stack
# ---------------------------------------------------------------------------

printf 'Compose stack\n'
check_exists "$COMPOSE" "$COMPOSE exists"
# A fixed project name keeps the volume named predictably, which is what makes the
# documented `down -v` reset reclaim the right one.
check_contains "$COMPOSE" '^name: ouroboros$' "$COMPOSE pins the compose project name"
check_contains "$COMPOSE" '^  db:$' "$COMPOSE defines the db service"
check_contains "$COMPOSE" '^  flyway:$' "$COMPOSE defines the flyway service"

printf '\nDatabase service\n'
check_contains "$COMPOSE" '^    image: postgres:17-alpine$' 'db pins postgres:17-alpine'
check_contains "$COMPOSE" '^    healthcheck:$' 'db declares a healthcheck'
check_contains "$COMPOSE" 'pg_isready' 'the healthcheck probes with pg_isready'
# Probing as the OS user reports ready while the database is still being created, so the
# role and database have to be named explicitly for the gate to mean anything.
check_contains "$COMPOSE" 'pg_isready -U .* -d ' 'the healthcheck names the role and database'
check_contains "$COMPOSE" '^      - ouroboros-db-data:/var/lib/postgresql/data$' 'db stores data in the named volume'
# A development password is a real password to anything on the same network, so the
# published port has to name the loopback interface rather than defaulting to 0.0.0.0.
check_contains "$COMPOSE" '^      - "127\.0\.0\.1:\$\{OURO_DB_PORT' 'db publishes its port on loopback only'
check_contains "$COMPOSE" '^volumes:$' "$COMPOSE declares its volumes"
check_contains "$COMPOSE" '^  ouroboros-db-data:$' 'the data volume is named, so down -v reclaims it'

printf '\nMigration service\n'
check_contains "$COMPOSE" '^    image: flyway/flyway:11' 'flyway pins the Flyway 11 image'
check_contains "$COMPOSE" '^      db:$' 'flyway depends on db'
check_contains "$COMPOSE" '^        condition: service_healthy$' 'flyway waits for the healthcheck, not a sleep'
check_contains "$COMPOSE" "^      - \\./$MIGRATIONS:/flyway/sql:ro\$" 'flyway mounts the migrations read-only'
check_contains "$COMPOSE" '^      - migrate$' 'flyway runs migrate'
check_contains "$COMPOSE" '^      - -validateMigrationNaming=true$' 'flyway rejects misnamed migrations'
check_contains "$COMPOSE" '^      - -createSchemas=true$' 'flyway creates the schema it owns'
check_contains "$COMPOSE" '^      - -connectRetries=' 'flyway retries the connection rather than failing the run'
# A migrator is a task: a restart policy would re-run it forever behind `up -d`.
check_contains "$COMPOSE" '^    restart: "no"$' 'flyway does not restart after it succeeds'

printf '\nCredential handling\n'
# Every credential must arrive by interpolation. A literal here would be a password in
# git that also silently ignores whatever the developer put in .env.
check_absent "$COMPOSE" '^ *POSTGRES_[A-Z_]+:[[:space:]]*[^$[:space:]]' 'no literal POSTGRES_* credential in the compose file'
check_absent "$COMPOSE" '^ *- -(user|password|url)=[^$]*$' 'no literal Flyway credential in the compose file'
check_absent "$COMPOSE" '^ *env_file:' 'the stack does not depend on an uncommitted env_file to start'

# ---------------------------------------------------------------------------
# Environment template
# ---------------------------------------------------------------------------

printf '\nEnvironment template\n'
check_exists "$ENV_EXAMPLE" "$ENV_EXAMPLE exists"
check_run "$ENV_EXAMPLE parses" awk -f "$PARSER" "$ENV_EXAMPLE"

# Declared names, one per line. Empty when the file is missing or invalid, in which case
# the checks below report every variable as undeclared — which is the honest result.
declared=$(awk -f "$PARSER" "$ENV_EXAMPLE" 2>/dev/null | cut -f 1 || true)

# check_declared NAME REASON — assert .env.example declares NAME.
check_declared() {
  if printf '%s\n' "$declared" | grep -qx -- "$1"; then
    pass "$ENV_EXAMPLE declares $1 ($2)"
  else
    fail "$ENV_EXAMPLE declares $1 ($2) (undeclared)"
  fi
}

# Anything the compose file interpolates has to be in the template, or a developer who
# copies it gets a stack that silently falls back to defaults they never saw.
for name in $(grep -oE '\$\{[A-Z][A-Z0-9_]*' "$COMPOSE" 2>/dev/null | cut -c 3- | sort -u); do
  check_declared "$name" 'read by the compose stack'
done

# Anything a module README documents has to be in the template too — this is the check
# that catches the template drifting behind the modules as they are scaffolded.
for name in $(cat ouroboros-*/README.md docs/CONVENTIONS.md 2>/dev/null |
  grep -oE 'OURO_[A-Z0-9_]+' | sort -u); do
  check_declared "$name" 'documented by a module'
done

printf '\nSecret hygiene\n'
check_contains .gitignore '^\.env$' '.gitignore keeps real .env files out of git'
check_contains .gitignore '^!\.env\.example$' '.gitignore still tracks the template'
# The template ships placeholders. A value that looks like a real GitHub token or a
# private key means someone pasted a live credential into a committed file.
check_absent "$ENV_EXAMPLE" '(gh[pousr]_[A-Za-z0-9]{16}|BEGIN [A-Z ]*PRIVATE KEY)' "$ENV_EXAMPLE carries no real credential"

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------

printf '\nMigrations\n'
check_exists "$MIGRATIONS" "$MIGRATIONS/ exists"

# Flyway needs something to apply for `up` to leave a history a developer can read.
migration_count=0
for migration in "$MIGRATIONS"/*.sql; do
  [ -f "$migration" ] || continue
  migration_count=$((migration_count + 1))
  # The naming rule from ouroboros-db/README.md, which flyway's own
  # validateMigrationNaming enforces at run time and this asserts before the run.
  check_matches "${migration##*/}" '^(V[0-9]{3}__[a-z0-9_]+|R__[a-z0-9_]+)\.sql$' \
    "${migration##*/} follows the migration naming rule"
done
if [ "$migration_count" -gt 0 ]; then
  pass "$MIGRATIONS/ holds at least one migration to apply"
else
  fail "$MIGRATIONS/ holds at least one migration to apply (none found)"
fi

printf '\nMigration runner\n'
check_executable ouroboros-db/run.sh 'ouroboros-db/run.sh is executable'
# It applies the same migrations the compose pass does, so a setting that drifts between
# the two would give `up` and `run.sh` different databases from the same checkout.
for setting in '\-createSchemas=true' '\-validateMigrationNaming=true' 'flyway/flyway:11'; do
  label=$(printf '%s' "$setting" | tr -d '\\')
  check_contains ouroboros-db/run.sh "$setting" "run.sh applies $label, as the stack does"
done
# A password that comes from a variable opens with `"` or `$`, and the redaction branch
# opens with `*`; anything alphanumeric is a credential someone typed in.
check_absent ouroboros-db/run.sh '\-password=[[:alnum:]]' 'run.sh holds no literal password'

# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------

printf '\nDocumented flow\n'
for doc in README.md ouroboros-db/README.md; do
  check_contains "$doc" 'docker compose up' "$doc documents bringing the stack up"
  check_contains "$doc" 'docker compose down -v' "$doc documents the reset flow"
done
check_contains ouroboros-db/README.md 'flyway_schema_history' \
  'ouroboros-db/README.md says how to read the applied versions'

check_summary
