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
      - ./ouroboros-db/flyway.seed.toml:/flyway/project/flyway.seed.toml:ro
      - ./ouroboros-db/migrations:/flyway/project/migrations:ro
    command:
      - -workingDirectory=/flyway/project
      - -configFiles=/flyway/project/flyway.toml,/flyway/project/flyway.seed.toml
      - -url=jdbc:postgresql://db:5432/${OURO_DB_NAME:-ouroboros}
      - -user=${OURO_DB_USER:-ouroboros}
      - -password=${OURO_DB_PASSWORD:-ouroboros}
      - -schemas=${OURO_DB_SCHEMA:-ouroboros}
      - migrate
    networks:
      - ouroboros
    restart: "no"

  engine:
    build:
      context: ./ouroboros-engine
    environment:
      OURO_ENGINE_SHARED_SECRET: ${OURO_ENGINE_SHARED_SECRET:-dev-engine-shared-secret-change-me}
      OURO_LOG_LEVEL: ${OURO_LOG_LEVEL:-info}
    healthcheck:
      start_period: 30s
      start_interval: 1s
    networks:
      - ouroboros
    profiles:
      - full

  rest:
    build:
      context: .
      dockerfile: ouroboros-rest/Dockerfile
    depends_on:
      db:
        condition: service_healthy
      flyway:
        condition: service_completed_successfully
      engine:
        condition: service_healthy
    environment:
      OURO_DATABASE_URL: postgresql://${OURO_DB_USER:-ouroboros}:${OURO_DB_PASSWORD:-ouroboros}@db:5432/${OURO_DB_NAME:-ouroboros}
      OURO_REST_URL: http://localhost:4000
      OURO_UI_URL: http://localhost:3000
      OURO_ENGINE_URL: http://engine:8000
      OURO_ENGINE_SHARED_SECRET: ${OURO_ENGINE_SHARED_SECRET:-dev-engine-shared-secret-change-me}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-dev-better-auth-secret-change-me}
      BETTER_AUTH_URL: http://localhost:4000
      OURO_SESSION_SECRET: ${OURO_SESSION_SECRET:-dev-session-secret-change-me}
      OURO_GITHUB_CLIENT_ID: ${OURO_GITHUB_CLIENT_ID:-dev-github-client-id}
      OURO_GITHUB_CLIENT_SECRET: ${OURO_GITHUB_CLIENT_SECRET:-dev-github-client-secret}
      OURO_CORS_ORIGINS: http://localhost:3000
    ports:
      - "127.0.0.1:4000:4000"
      - "127.0.0.1:3000:3000"
    healthcheck:
      start_period: 30s
      start_interval: 1s
    networks:
      - ouroboros
    profiles:
      - full

  ui:
    build:
      context: .
      dockerfile: ouroboros-ui/Dockerfile
    depends_on:
      rest:
        condition: service_healthy
    environment:
      OURO_REST_URL: http://localhost:4000
    healthcheck:
      start_period: 30s
      start_interval: 1s
    network_mode: "service:rest"
    profiles:
      - full

networks:
  ouroboros:
    driver: bridge

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
# The key on the internal call.
OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me
# BetterAuth's own two, which keep the library's names rather than the OURO_ prefix.
BETTER_AUTH_SECRET=dev-better-auth-secret-change-me
BETTER_AUTH_URL=http://localhost:4000
# The session cookie's signing key.
OURO_SESSION_SECRET=dev-session-secret-change-me
# The GitHub OAuth application.
OURO_GITHUB_CLIENT_ID=dev-github-client-id
OURO_GITHUB_CLIENT_SECRET=dev-github-client-secret
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
    docker compose --profile full up
    docker compose --profile full up --build
    docker compose down -v
DOC

  # The three application images. Only what the verifier cross-checks is here — the
  # HEALTHCHECK every `condition: service_healthy` in the stack above is really waiting
  # on. What each image is otherwise made of is that module's own subject.
  for module in engine rest ui; do
    mkdir -p "$fixture/ouroboros-$module"
    cat > "$fixture/ouroboros-$module/Dockerfile" <<'IMAGE'
FROM scratch
HEALTHCHECK CMD probe || exit 1
IMAGE
  done

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

  # The Flyway project: the settings the compose stack no longer spells out, the overlay
  # that is the only way to a `clean`, and the overlay that is the only way to seed data.
  # What Flyway makes of them is exercised by the module's own suite; here they only have
  # to satisfy the contract.
  cat > "$fixture/ouroboros-db/flyway.toml" <<'TOML'
[environments.default]
schemas = ["ouroboros"]
connectRetries = 10

[flyway]
locations = ["filesystem:migrations"]
createSchemas = true
validateMigrationNaming = true
cleanDisabled = true
placeholderReplacement = true

[flyway.placeholders]
ouro_dev_seed = "false"
TOML

  cat > "$fixture/ouroboros-db/flyway.dev.toml" <<'TOML'
[flyway]
cleanDisabled = false
TOML

  cat > "$fixture/ouroboros-db/flyway.seed.toml" <<'TOML'
[flyway.placeholders]
ouro_dev_seed = "true"
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

  # The published migration image — the third way these migrations are applied,
  # and the only one with no checkout behind it. Like the runner above, only what the
  # verifier cross-checks is here: the Flyway pin it shares with the other two, the
  # project directory all three use, and the guards that keep a credential and a `clean`
  # out of a layer.
  cat > "$fixture/ouroboros-db/Dockerfile" <<'IMAGE'
FROM flyway/flyway:11-alpine

COPY migrations/ /flyway/project/migrations/
COPY flyway.toml flyway.seed.toml /flyway/project/
COPY docker-entrypoint.sh /flyway/docker-entrypoint.sh

USER nobody

ENTRYPOINT ["/flyway/docker-entrypoint.sh"]
CMD ["migrate"]
IMAGE

  cat > "$fixture/ouroboros-db/docker-entrypoint.sh" <<'ENTRY'
#!/usr/bin/env sh
set -eu
: "${OURO_DB_PORT:-} ${OURO_DB_NAME:-} ${OURO_DB_USER:-}"
: "${OURO_DB_PASSWORD:-} ${OURO_DB_SCHEMA:-}"
[ -n "${OURO_DB_HOST:-}" ] || { printf 'set OURO_DB_HOST\n' >&2; exit 2; }
exec flyway -workingDirectory=/flyway/project "$@"
ENTRY
  chmod +x "$fixture/ouroboros-db/docker-entrypoint.sh"

  cat > "$fixture/ouroboros-db/.dockerignore" <<'IGNORE'
*

!migrations/
!flyway.toml
!flyway.seed.toml
!docker-entrypoint.sh
IGNORE

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

# ---------------------------------------------------------------------------
# Application services (#55)
# ---------------------------------------------------------------------------

printf '\nStack shape violations\n'

# The data tier is what a bare `docker compose up` means everywhere it is documented,
# and it means that only while neither of its two services is in a profile.
check_break 'a data-tier service put behind a profile is reported' \
  'db is in no profile' \
  'sed -i "s|^    image: postgres:17-alpine|    profiles:\n      - db\n    image: postgres:17-alpine|" "$root/docker-compose.yml"'

check_break 'an application service outside the full profile is reported' \
  'engine starts only under the full profile' \
  'sed -i "/^  engine:$/,/^  rest:$/ s|^      - full$||" "$root/docker-compose.yml"'

check_break 'a stack with no named network is reported' \
  'the services share one named network' \
  'sed -i "/^  ouroboros:$/d" "$root/docker-compose.yml"'

# A service that is not there at all: every assertion about it has to fail and be
# reported, rather than an empty block reading as an absence of violations.
check_break 'a missing application service is reported' \
  'docker-compose\.yml defines the ui service' \
  'sed -i "/^  ui:$/,/^networks:$/{/^networks:$/!d}" "$root/docker-compose.yml"'
check_break 'and its wiring is reported missing with it' \
  'ui waits for rest to be healthy' \
  'sed -i "/^  ui:$/,/^networks:$/{/^networks:$/!d}" "$root/docker-compose.yml"'

printf '\nStartup order violations\n'

# The edge with data behind it: `rest` beside a migration that has not finished is an API
# answering against a schema that is not this checkout's.
check_break 'a rest that starts beside the migrations rather than after them is reported' \
  'waits for the migrations to have succeeded' \
  'sed -i "s|condition: service_completed_successfully|condition: service_started|" "$root/docker-compose.yml"'

check_break 'a rest that does not wait for the engine is reported' \
  'rest waits for the engine to be healthy' \
  'sed -i "/^      engine:$/,+1d" "$root/docker-compose.yml"'

check_break 'a ui that does not wait for rest is reported' \
  'ui waits for rest to be healthy' \
  'sed -i "/^      rest:$/,+1d" "$root/docker-compose.yml"'

# `condition: service_healthy` is worth exactly what the image's probe is worth, and
# there is nothing else for compose to read.
check_break 'an image with no healthcheck to wait on is reported' \
  'ouroboros-ui/Dockerfile declares the probe' \
  'printf "FROM scratch\\n" > "$root/ouroboros-ui/Dockerfile"'

check_break 'a stack that restates a probe its image already declares is reported' \
  'engine takes its probe from its image' \
  'sed -i "/^  engine:$/,/^  rest:$/ s|^      start_period: 30s|      test: ["'"'"'CMD'"'"'", "'"'"'true'"'"'"]\n      start_period: 30s|" "$root/docker-compose.yml"'

check_break 'a service probed at the image interval while it is starting is reported' \
  'ui is probed at a cold-start rate' \
  'sed -i "/^  ui:$/,\$ s|^      start_interval: 1s||" "$root/docker-compose.yml"'

printf '\nPublished surface violations\n'

# The boundary check the issue asks for, from both sides: the engine declaring a port,
# and anything at all publishing the port it serves on.
check_break 'an engine that publishes a port is reported' \
  'the engine publishes no port at all' \
  'sed -i "/^  engine:$/,/^  rest:$/ s|^    healthcheck:|    ports:\n      - \"127.0.0.1:8000:8000\"\n    healthcheck:|" "$root/docker-compose.yml"'

check_break 'any service publishing the engine port is reported' \
  'nothing in the stack publishes the engine port' \
  'sed -i "s|- \"127.0.0.1:4000:4000\"|- \"127.0.0.1:8000:8000\"|" "$root/docker-compose.yml"'

check_break 'publishing the API on every interface is reported' \
  'rest publishes its own port on loopback only' \
  'sed -i "s|- \"127.0.0.1:4000:4000\"|- \"4000:4000\"|" "$root/docker-compose.yml"'

check_break 'a ui that publishes a port of its own is reported' \
  'ui declares no port of its own' \
  'sed -i "/^  ui:$/,\$ s|^    network_mode:|    ports:\n      - \"127.0.0.1:3000:3000\"\n    network_mode:|" "$root/docker-compose.yml"'

check_break 'a ui that does not share the namespace it is addressed through is reported' \
  'ui shares rest.s network namespace' \
  'sed -i "/^    network_mode: /d" "$root/docker-compose.yml"'

printf '\nService wiring violations\n'

# `localhost` inside a container is the container. Both of these are the value
# .env.example documents, and both are the one value that cannot work in here.
check_break 'a database address a container cannot reach is reported' \
  'rest reaches the database at db:5432' \
  'sed -i "s|@db:5432|@localhost:5432|" "$root/docker-compose.yml"'

check_break 'an engine address a container cannot reach is reported' \
  'rest reaches the engine at engine:8000' \
  'sed -i "s|http://engine:8000|http://localhost:8000|" "$root/docker-compose.yml"'

# And the reverse mistake: an address inside the network handed to a browser.
check_break 'an OAuth origin a browser cannot reach is reported' \
  'rest builds its OAuth redirect_uri' \
  'sed -i "s|OURO_REST_URL: http://localhost:4000|OURO_REST_URL: http://rest:4000|" "$root/docker-compose.yml"'

check_break 'a ui and rest that disagree about that one address is reported' \
  'agree on the one address OURO_REST_URL names' \
  'sed -i "/^  ui:$/,\$ s|OURO_REST_URL: http://localhost:4000|OURO_REST_URL: http://rest:4000|" "$root/docker-compose.yml"'

check_break 'an engine reading a shared secret rest does not is reported' \
  'engine reads the shared secret from the one variable' \
  'sed -i "/^  engine:$/,/^  rest:$/ {/OURO_ENGINE_SHARED_SECRET/d}" "$root/docker-compose.yml"'

printf '\nCredential violations\n'

check_break 'a literal session secret is reported' \
  'no literal credential' \
  'sed -i "s|OURO_SESSION_SECRET: .*|OURO_SESSION_SECRET: hunter2hunter2hunter2|" "$root/docker-compose.yml"'

# The same rule, on the one credential in the stack that carries no OURO_ prefix — the
# case a check anchored to that prefix would have missed (issue #700).
check_break 'a literal BetterAuth secret is reported' \
  'no literal credential' \
  'sed -i "s|BETTER_AUTH_SECRET: .*|BETTER_AUTH_SECRET: hunter2hunter2hunter2|" "$root/docker-compose.yml"'

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

# The dev seed's guard (#23). Each of these is a way the seed could start running
# somewhere it must not, or stop running where the mockups need it to.
check_break 'a missing dev-seed overlay is reported' \
  'flyway\.seed\.toml exists' \
  'rm "$root/ouroboros-db/flyway.seed.toml"'

check_break 'a project that ships with the dev seed on is reported' \
  'resolves the dev-seed guard to false' \
  'sed -i "s|^ouro_dev_seed = \"false\"|ouro_dev_seed = \"true\"|" "$root/ouroboros-db/flyway.toml"'

check_break 'a project that stops substituting placeholders is reported' \
  'substitutes placeholders' \
  'sed -i "/^placeholderReplacement = true/d" "$root/ouroboros-db/flyway.toml"'

check_break 'an overlay that no longer enables the seed is reported' \
  'the seed overlay is what turns it on' \
  'sed -i "s|^ouro_dev_seed = \"true\"|ouro_dev_seed = \"false\"|" "$root/ouroboros-db/flyway.seed.toml"'

check_break 'a seed overlay that also re-enables clean is reported' \
  'does not smuggle clean in alongside the seed' \
  'printf "cleanDisabled = false\n" >> "$root/ouroboros-db/flyway.seed.toml"'

check_break 'a stack that never loads the seed overlay is reported' \
  'mounts the dev-seed overlay' \
  'sed -i "\|flyway.seed.toml:/flyway/project|d" "$root/docker-compose.yml"'

check_break 'a stack that replaces flyway.toml with the overlay is reported' \
  'layers that overlay over flyway\.toml' \
  'sed -i "s|^      - -configFiles=.*|      - -configFiles=/flyway/project/flyway.seed.toml|" "$root/docker-compose.yml"'

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

# ---------------------------------------------------------------------------
# Migration image
# ---------------------------------------------------------------------------

# The image is the one way these migrations are applied with nobody watching, so each of
# these breaks one property that makes that safe: the Flyway it shares with the other two
# runners, the project directory that decides which rules apply, the credential that must
# not be in a layer, the root it must not run as, and the two files — the clean overlay
# and this module's .env — that must not be inside it. Whether the workflow publishes it
# at all is scripts/verify-ci.sh's half.

printf '\nMigration image violations\n'

check_break 'a missing image is reported' \
  'ouroboros-db/Dockerfile exists' \
  'rm "$root/ouroboros-db/Dockerfile"'

check_break 'an image on a different Flyway is reported' \
  'the image pins the same Flyway 11 image' \
  'sed -i "s|flyway/flyway:11-alpine|flyway/flyway:10|" "$root/ouroboros-db/Dockerfile"'

check_break 'an image without the migrations is reported' \
  'the image carries the migrations' \
  'sed -i "/^COPY migrations/d" "$root/ouroboros-db/Dockerfile"'

check_break 'an image without the project configuration is reported' \
  'carries the project configuration' \
  'sed -i "/^COPY flyway.toml/d" "$root/ouroboros-db/Dockerfile"'

check_break 'an image running as root is reported' \
  'the image drops root' \
  'sed -i "/^USER /d" "$root/ouroboros-db/Dockerfile"'

# The guard that makes `clean` unreachable from a published image: flyway.toml disables
# it and the one overlay that re-enables it is not in the layer to be named.
check_break 'an image carrying the clean overlay is reported' \
  'cannot reach the clean overlay' \
  'sed -i "s|^COPY flyway.toml.*$|&\nCOPY flyway.dev.toml /flyway/project/|" "$root/ouroboros-db/Dockerfile"'

check_break 'a connection parameter baked into the image is reported' \
  'bakes in no connection parameter' \
  'sed -i "s|^USER nobody$|ENV OURO_DB_HOST=db.internal\nUSER nobody|" "$root/ouroboros-db/Dockerfile"'

check_break 'a password baked into the image is reported' \
  'the image holds no literal password' \
  'sed -i "s|^CMD .*$|CMD ["'"'"'migrate'"'"'", "-password=hunter2"]|" "$root/ouroboros-db/Dockerfile"'

check_break 'an image that describes itself as a service is reported' \
  'it is a task, not a service' \
  'sed -i "s|^USER nobody$|HEALTHCHECK CMD true\nUSER nobody|" "$root/ouroboros-db/Dockerfile"'

check_break 'a missing entrypoint is reported' \
  'docker-entrypoint\.sh is executable' \
  'rm "$root/ouroboros-db/docker-entrypoint.sh"'

check_break 'an entrypoint that has drifted from the project is reported' \
  'the entrypoint reads flyway\.toml' \
  'sed -i "s|-workingDirectory=/flyway/project ||" "$root/ouroboros-db/docker-entrypoint.sh"'

check_break 'an entrypoint that ignores a documented parameter is reported' \
  'the entrypoint reads the OURO_DB_SCHEMA' \
  'sed -i "/OURO_DB_SCHEMA/d" "$root/ouroboros-db/docker-entrypoint.sh"'

# On the command line the password is readable from the process list by anything sharing
# the container's namespace, and by whatever logged the command.
check_break 'an entrypoint that passes the password as an argument is reported' \
  'keeps the password out of the command line' \
  'sed -i "s|exec flyway |exec flyway -password=\"\$OURO_DB_PASSWORD\" |" "$root/ouroboros-db/docker-entrypoint.sh"'

# `localhost` inside a container is the container, so a default would turn "you forgot to
# say which database" into a run that migrates nothing and reports success.
check_break 'an entrypoint that defaults the host is reported' \
  'refuses to guess a host' \
  'sed -i "s|\${OURO_DB_HOST:-}|\$OURO_DB_HOST|g" "$root/ouroboros-db/docker-entrypoint.sh"'

check_break 'a missing ignore file is reported' \
  'ouroboros-db/\.dockerignore exists' \
  'rm "$root/ouroboros-db/.dockerignore"'

# A deny-list looks exactly like an allow-list until something is added to the module —
# and the first thing it lets through is this developer's .env.
check_break 'an ignore file that is a deny-list is reported' \
  'excludes the context before allowing anything' \
  'sed -i "s|^\*$|.env|" "$root/ouroboros-db/.dockerignore"'

check_break 'an ignore file that drops the migrations is reported' \
  '\.dockerignore allows migrations/' \
  'sed -i "\|^!migrations/$|d" "$root/ouroboros-db/.dockerignore"'

check_break 'an ignore file that admits an .env is reported' \
  'never admits an \.env' \
  'printf "!.env\\n" >> "$root/ouroboros-db/.dockerignore"'

check_break 'an ignore file that admits the clean overlay is reported' \
  'never admits the clean overlay' \
  'printf "!flyway.dev.toml\\n" >> "$root/ouroboros-db/.dockerignore"'

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

check_break 'a root README that never says how to start the whole stack is reported' \
  'documents the cold start of the whole stack' \
  'sed -i "/--profile full/d" "$root/README.md"'

# Compose builds an image that is missing and never rebuilds one that is stale, so a
# developer who only ever reads the first command is looking at an old commit.
check_break 'a root README that never says how to rebuild is reported' \
  'documents rebuilding an image after a source change' \
  'sed -i "/--profile full up --build/d" "$root/README.md"'

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
