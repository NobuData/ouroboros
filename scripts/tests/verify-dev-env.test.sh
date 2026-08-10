#!/usr/bin/env sh
#
# verify-dev-env.test.sh — integration tests for scripts/verify-dev-env.sh.
#
# The script is run against synthetic repository trees rather than this checkout, so the
# tests pin the contract independently of the files that currently satisfy it: the
# fixture is a minimal tree that passes every check, and each case copies it, breaks
# exactly one thing, and asserts that the matching check — and the run — fails.
#
# No Docker daemon is involved, because the script under test starts nothing.
#
# Usage:
#   scripts/tests/verify-dev-env.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
VERIFY="$SCRIPTS_DIR/verify-dev-env.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# make_fixture DIR — write a repository tree that satisfies every check.
make_fixture() {
  fixture=$1
  mkdir -p "$fixture/docs" "$fixture/ouroboros-db/migrations"

  cat > "$fixture/docker-compose.yml" <<'YAML'
name: ouroboros

services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${OURO_DB_USER:-ouroboros}
      POSTGRES_PASSWORD: ${OURO_DB_PASSWORD:-ouroboros}
      POSTGRES_DB: ${OURO_DB_NAME:-ouroboros}
    ports:
      - "127.0.0.1:${OURO_DB_PORT:-5432}:5432"
    volumes:
      - ouroboros-db-data:/var/lib/postgresql/data
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "pg_isready -U ${OURO_DB_USER:-ouroboros} -d ${OURO_DB_NAME:-ouroboros}",
        ]
    restart: unless-stopped

  flyway:
    image: flyway/flyway:11-alpine
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./ouroboros-db/flyway.toml:/flyway/project/flyway.toml:ro
      - ./ouroboros-db/migrations:/flyway/project/migrations:ro
    command:
      - -workingDirectory=/flyway/project
      - -url=jdbc:postgresql://db:5432/${OURO_DB_NAME:-ouroboros}
      - -user=${OURO_DB_USER:-ouroboros}
      - -password=${OURO_DB_PASSWORD:-ouroboros}
      - -schemas=${OURO_DB_SCHEMA:-ouroboros}
      - migrate
    restart: "no"

volumes:
  ouroboros-db-data:
YAML

  cat > "$fixture/.env.example" <<'ENV'
# The role.
OURO_DB_USER=ouroboros
# The password.
OURO_DB_PASSWORD=ouroboros
# The database.
OURO_DB_NAME=ouroboros
# The schema Flyway owns.
OURO_DB_SCHEMA=ouroboros
# The published host port.
OURO_DB_PORT=5432
# The connection string.
OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros
# Log verbosity.
OURO_LOG_LEVEL=info
ENV

  cat > "$fixture/.gitignore" <<'IGNORE'
.env
.env.*
!.env.example
IGNORE

  cat > "$fixture/README.md" <<'DOC'
# Fixture

    docker compose up
    docker compose down -v
DOC

  cat > "$fixture/ouroboros-db/README.md" <<'DOC'
# ouroboros-db fixture

    docker compose up
    docker compose down -v

Reads `OURO_DATABASE_URL`, `OURO_DB_USER`, `OURO_DB_PASSWORD`, `OURO_DB_NAME`.
The applied versions are in `ouroboros.flyway_schema_history`.
DOC

  cat > "$fixture/docs/CONVENTIONS.md" <<'DOC'
# Fixture conventions

Everything Ouroboros-specific is prefixed, e.g. `OURO_LOG_LEVEL`.
DOC

  printf 'select 1;\n' > "$fixture/ouroboros-db/migrations/V000__bootstrap.sql"

  # The Flyway project: the settings the compose stack no longer spells out, and the
  # overlay that is the only way to a `clean`. What Flyway makes of them is exercised by
  # the module's own suite; here they only have to satisfy the contract.
  cat > "$fixture/ouroboros-db/flyway.toml" <<'TOML'
[environments.default]
schemas = ["ouroboros"]
connectRetries = 10

[flyway]
locations = ["filesystem:migrations"]
createSchemas = true
validateMigrationNaming = true
cleanDisabled = true
TOML

  cat > "$fixture/ouroboros-db/flyway.dev.toml" <<'TOML'
[flyway]
cleanDisabled = false
TOML

  # Only what the verifier cross-checks — the project directory and image that must
  # match the compose stack, and the parameters the template declares. The real runner
  # is exercised by ouroboros-db/tests/run.test.sh.
  cat > "$fixture/ouroboros-db/run.sh" <<'RUNNER'
#!/usr/bin/env sh
: "${OURO_DB_HOST?} ${OURO_DB_PORT?} ${OURO_DB_NAME?}"
: "${OURO_DB_USER?} ${OURO_DB_PASSWORD?} ${OURO_DB_SCHEMA?}"
exec docker run --rm flyway/flyway:11-alpine \
  -workingDirectory=/flyway/project -password="$db_password" migrate
RUNNER
  chmod +x "$fixture/ouroboros-db/run.sh"

  # The named commands over it. Each one only has to be there and be runnable; what they
  # do is ouroboros-db/tests/scripts.test.sh's subject.
  mkdir -p "$fixture/ouroboros-db/scripts"
  for named in migrate info validate; do
    printf '#!/usr/bin/env sh\nexec ../run.sh %s\n' "$named" \
      > "$fixture/ouroboros-db/scripts/$named"
  done
  printf '#!/usr/bin/env sh\nexec ../run.sh --config flyway.dev.toml clean\n' \
    > "$fixture/ouroboros-db/scripts/clean-dev"
  chmod +x "$fixture/ouroboros-db/scripts/"*

  cat > "$fixture/ouroboros-db/.env.example" <<'MODULEENV'
# Where the database is.
OURO_DB_HOST=localhost
# What it is listening on.
OURO_DB_PORT=5432
# What to migrate.
OURO_DB_NAME=ouroboros
# Who to connect as.
OURO_DB_USER=ouroboros
# The password for that role.
OURO_DB_PASSWORD=ouroboros
# The schema Flyway owns.
OURO_DB_SCHEMA=ouroboros
MODULEENV
}

# run_verify DIR [ARG...] — run the script, leaving combined output in $out and the exit
# status in $status.
run_verify() {
  out=$("$VERIFY" --root "$@" 2>&1)
  status=$?
}

# check_break DESCRIPTION PATTERN MUTATION — build a fresh fixture in $root, apply the
# MUTATION snippet to it, and assert the run fails reporting PATTERN.
check_break() {
  description=$1
  pattern=$2
  mutation=$3

  root="$work/case"
  rm -rf "$root"
  make_fixture "$root"
  eval "$mutation"

  run_verify "$root"
  # PATTERN matches anywhere in the failing line, because most descriptions open with
  # the file they are about — which is context the case does not need to restate.
  if [ "$status" -ne 0 ] && printf '%s\n' "$out" | grep -Eq -- "^  FAIL .*$pattern"; then
    pass "$description"
  else
    fail "$description (status $status, no FAIL matching /$pattern/)"
  fi
}

printf '\nverify-dev-env.sh\n\n'

# ---------------------------------------------------------------------------
# The passing baseline
# ---------------------------------------------------------------------------

printf 'A conforming tree\n'

good="$work/good"
make_fixture "$good"
run_verify "$good"
check_equals 0 "$status" 'a conforming tree passes'
check_matches "$out" '0 failed' 'a conforming tree reports no failures'
check_matches "$out" 'Local development environment' 'the report names what it checked'

# ---------------------------------------------------------------------------
# Compose stack
# ---------------------------------------------------------------------------

printf '\nCompose stack violations\n'

check_break 'a missing compose file is reported' \
  'docker-compose\.yml exists' \
  'rm "$root/docker-compose.yml"'

check_break 'an unpinned PostgreSQL image is reported' \
  'db pins postgres:17-alpine' \
  'sed -i "s|postgres:17-alpine|postgres:latest|" "$root/docker-compose.yml"'

check_break 'a database without a healthcheck is reported' \
  'db declares a healthcheck' \
  'sed -i "s|^    healthcheck:|    x-healthcheck:|" "$root/docker-compose.yml"'

check_break 'a healthcheck that does not name the database is reported' \
  'the healthcheck names the role and database' \
  'sed -i "s|pg_isready -U [^\"]*|pg_isready|" "$root/docker-compose.yml"'

check_break 'an anonymous data volume is reported' \
  'db stores data in the named volume' \
  'sed -i "s|- ouroboros-db-data:/var/lib|- /var/lib|" "$root/docker-compose.yml"'

check_break 'publishing the database on every interface is reported' \
  'publishes its port on loopback only' \
  'sed -i "s|- \"127\.0\.0\.1:|- \"|" "$root/docker-compose.yml"'

check_break 'an unpinned Flyway image is reported' \
  'flyway pins the Flyway 11 image' \
  'sed -i "s|flyway/flyway:11-alpine|flyway/flyway:latest|" "$root/docker-compose.yml"'

check_break 'starting the migrator before the healthcheck is reported' \
  'flyway waits for the healthcheck' \
  'sed -i "s|condition: service_healthy|condition: service_started|" "$root/docker-compose.yml"'

check_break 'a writable migrations mount is reported' \
  'flyway mounts the migrations read-only' \
  'sed -i "s|/flyway/project/migrations:ro|/flyway/project/migrations|" "$root/docker-compose.yml"'

check_break 'a writable configuration mount is reported' \
  'flyway mounts the project configuration read-only' \
  'sed -i "s|/flyway/project/flyway.toml:ro|/flyway/project/flyway.toml|" "$root/docker-compose.yml"'

check_break 'a migrator that never reads the project is reported' \
  'flyway takes its settings from the module' \
  'sed -i "/-workingDirectory=/d" "$root/docker-compose.yml"'

check_break 'a stack that restates a setting flyway.toml settles is reported' \
  'does not restate what flyway\.toml settles' \
  'sed -i "s|^      - migrate|      - -validateMigrationNaming=false\n      - migrate|" "$root/docker-compose.yml"'

check_break 'a stack that loads the development overlay is reported' \
  'never loads the dev overlay' \
  'sed -i "s|^      - migrate|      - -configFiles=/flyway/project/flyway.dev.toml\n      - migrate|" "$root/docker-compose.yml"'

check_break 'a restarting migrator is reported' \
  'flyway does not restart after it succeeds' \
  'sed -i "s|^    restart: \"no\"|    restart: always|" "$root/docker-compose.yml"'

printf '\nCredential violations\n'

check_break 'a literal PostgreSQL password is reported' \
  'no literal POSTGRES_\* credential' \
  'sed -i "s|POSTGRES_PASSWORD: .*|POSTGRES_PASSWORD: hunter2|" "$root/docker-compose.yml"'

check_break 'a literal Flyway password is reported' \
  'no literal Flyway credential' \
  'sed -i "s|- -password=.*|- -password=hunter2|" "$root/docker-compose.yml"'

check_break 'depending on an uncommitted env_file is reported' \
  'does not depend on an uncommitted env_file' \
  'sed -i "s|^    image: postgres|    env_file: .env\n    image: postgres|" "$root/docker-compose.yml"'

# ---------------------------------------------------------------------------
# Environment template
# ---------------------------------------------------------------------------

printf '\nEnvironment template violations\n'

check_break 'a missing template is reported' \
  '\.env\.example exists' \
  'rm "$root/.env.example"'

check_break 'a template that does not parse is reported' \
  '\.env\.example parses' \
  'printf "OURO_DB_USER=twice\n" >> "$root/.env.example"'

check_break 'a variable the compose stack reads but the template omits is reported' \
  'declares OURO_DB_SCHEMA' \
  'sed -i "/OURO_DB_SCHEMA=/d" "$root/.env.example"'

check_break 'a variable a module documents but the template omits is reported' \
  'declares OURO_LOG_LEVEL' \
  'sed -i "/OURO_LOG_LEVEL=/d" "$root/.env.example"'

check_break 'a .gitignore that would commit a real .env is reported' \
  'keeps real \.env files out of git' \
  'sed -i "/^\.env$/d" "$root/.gitignore"'

check_break 'a .gitignore that would drop the template is reported' \
  'still tracks the template' \
  'sed -i "/^!\.env\.example$/d" "$root/.gitignore"'

check_break 'a real credential pasted into the template is reported' \
  'carries no real credential' \
  'printf "# A token.\nOURO_GITHUB_TOKEN=ghp_0123456789abcdefghij\n" >> "$root/.env.example"'

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------

printf '\nMigration violations\n'

check_break 'a missing migrations directory is reported' \
  'migrations/ exists' \
  'rm -rf "$root/ouroboros-db/migrations"'

check_break 'an empty migrations directory is reported' \
  'holds at least one migration' \
  'rm -f "$root"/ouroboros-db/migrations/*.sql'

check_break 'a misnamed migration is reported' \
  'follows the migration naming rule' \
  'mv "$root/ouroboros-db/migrations/V000__bootstrap.sql" "$root/ouroboros-db/migrations/V1__Bootstrap.sql"'

printf '\nFlyway project violations\n'

check_break 'a module with no flyway.toml is reported' \
  'flyway\.toml exists' \
  'rm "$root/ouroboros-db/flyway.toml"'

check_break 'a project that does not find its own migrations is reported' \
  'flyway\.toml locates the migrations' \
  'sed -i "s|^locations = .*|locations = [\"filesystem:/flyway/sql\"]|" "$root/ouroboros-db/flyway.toml"'

check_break 'a project that stops rejecting misnamed migrations is reported' \
  'flyway\.toml rejects a misnamed migration' \
  'sed -i "s|^validateMigrationNaming = true|validateMigrationNaming = false|" "$root/ouroboros-db/flyway.toml"'

check_break 'a project that no longer creates its schema is reported' \
  'flyway\.toml creates that schema' \
  'sed -i "/^createSchemas = /d" "$root/ouroboros-db/flyway.toml"'

check_break 'a project that owns some other schema is reported' \
  'flyway\.toml owns the ouroboros schema' \
  'sed -i "s|^schemas = .*|schemas = [\"public\"]|" "$root/ouroboros-db/flyway.toml"'

check_break 'a credential committed into the project is reported' \
  'flyway\.toml carries no connection or credential' \
  'printf "password = \"hunter2\"\n" >> "$root/ouroboros-db/flyway.toml"'

check_break 'a project that ships with clean enabled is reported' \
  'flyway\.toml disables clean' \
  'sed -i "s|^cleanDisabled = true|cleanDisabled = false|" "$root/ouroboros-db/flyway.toml"'

check_break 'a missing development overlay is reported' \
  'flyway\.dev\.toml exists' \
  'rm "$root/ouroboros-db/flyway.dev.toml"'

check_break 'an overlay that no longer enables clean is reported' \
  'the dev overlay is what re-enables it' \
  'sed -i "s|^cleanDisabled = false|cleanDisabled = true|" "$root/ouroboros-db/flyway.dev.toml"'

check_break 'a clean-dev that does not load the overlay is reported' \
  'clean-dev is what does load it' \
  'printf "#!/usr/bin/env sh\nexec ../run.sh clean\n" > "$root/ouroboros-db/scripts/clean-dev"'

printf '\nNamed command violations\n'

check_break 'a missing named command is reported' \
  'scripts/info is executable' \
  'rm "$root/ouroboros-db/scripts/info"'

check_break 'a named command that is not executable is reported' \
  'scripts/migrate is executable' \
  'chmod -x "$root/ouroboros-db/scripts/migrate"'

check_break 'an ungated clean is reported' \
  'no ouroboros-db/scripts/clean' \
  'printf "#!/usr/bin/env sh\nexec ../run.sh clean\n" > "$root/ouroboros-db/scripts/clean"'

printf '\nMigration runner violations\n'

check_break 'a runner that is not executable is reported' \
  'run\.sh is executable' \
  'chmod -x "$root/ouroboros-db/run.sh"'

check_break 'a runner that has drifted from the stack is reported' \
  'run\.sh reads flyway\.toml' \
  'sed -i "s|-workingDirectory=/flyway/project ||" "$root/ouroboros-db/run.sh"'

check_break 'a runner on a different Flyway is reported' \
  'run\.sh pins the same Flyway 11 image' \
  'sed -i "s|flyway/flyway:11-alpine|flyway/flyway:10|" "$root/ouroboros-db/run.sh"'

check_break 'a literal password in the runner is reported' \
  'run\.sh holds no literal password' \
  'sed -i "s|-password=\\\"\$db_password\\\"|-password=hunter2|" "$root/ouroboros-db/run.sh"'

check_break 'a missing module template is reported' \
  'ouroboros-db/\.env\.example exists' \
  'rm "$root/ouroboros-db/.env.example"'

check_break 'a module template missing a parameter is reported' \
  'ouroboros-db/\.env\.example declares OURO_DB_HOST' \
  'sed -i "/OURO_DB_HOST=/d" "$root/ouroboros-db/.env.example"'

check_break 'a module template declaring what nothing reads is reported' \
  'run\.sh reads the OURO_DB_SCHEMA' \
  'sed -i "/OURO_DB_SCHEMA/d" "$root/ouroboros-db/run.sh"'

# A repeatable migration is legal under the same rule, so it must not be flagged.
root="$work/repeatable"
rm -rf "$root"
make_fixture "$root"
printf 'select 1;\n' > "$root/ouroboros-db/migrations/R__dev_seed.sql"
run_verify "$root"
check_equals 0 "$status" 'a repeatable migration is accepted alongside a versioned one'

# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------

printf '\nDocumentation violations\n'

check_break 'a root README missing the reset flow is reported' \
  'README\.md documents the reset flow' \
  'sed -i "/docker compose down -v/d" "$root/README.md"'

check_break 'a module README missing the up flow is reported' \
  'ouroboros-db/README\.md documents bringing the stack up' \
  'sed -i "/docker compose up/d" "$root/ouroboros-db/README.md"'

check_break 'a module README that never says how to read the history is reported' \
  'says how to read the applied versions' \
  'sed -i "/flyway_schema_history/d" "$root/ouroboros-db/README.md"'

# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

printf '\nCommand line\n'

out=$("$VERIFY" --help 2>&1)
status=$?
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'Usage:' '--help prints the usage'

out=$("$VERIFY" --nonsense 2>&1)
status=$?
check_equals 2 "$status" 'an unknown argument exits 2'

out=$("$VERIFY" --root 2>&1)
status=$?
check_equals 2 "$status" '--root without a directory exits 2'

# ---------------------------------------------------------------------------
# This repository
# ---------------------------------------------------------------------------

printf '\nThis checkout\n'

REPO_ROOT=$(dirname -- "$SCRIPTS_DIR")
run_verify "$REPO_ROOT"
check_equals 0 "$status" 'the committed tree satisfies every check'

check_summary
