#!/usr/bin/env sh
#
# verify-dev-env.sh — assert the local development stack established by issues #10 and #55.
#
# Checks the contract of the repo-root compose stack: that PostgreSQL is pinned and
# healthchecked onto a named volume, that Flyway waits for it and migrates the checkout
# read-only, that the three application services start behind those healthchecks and
# publish only what a browser has to reach, that every credential is interpolated rather
# than written down, that .env.example declares every variable anything in the repo
# actually reads, and that the up / reset flow is documented where a developer will look
# for it.
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
      sed -n '2,24p' "$0" | cut -c 3-
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
FLYWAY_CONFIG=ouroboros-db/flyway.toml
FLYWAY_DEV_CONFIG=ouroboros-db/flyway.dev.toml
FLYWAY_SEED_CONFIG=ouroboros-db/flyway.seed.toml
DB_SCRIPTS=ouroboros-db/scripts
PARSER="$SCRIPT_DIR/lib/parse-env-example.awk"
EXTRACT="$SCRIPT_DIR/lib/compose-service.awk"

# The three application images, and the file each one's contract is written in. They are
# checked as a set because what makes the stack start in order is a property of all three
# at once: compose reads the probe out of the image, so a service whose Dockerfile
# declares no HEALTHCHECK is one nothing downstream of it can wait for.
ENGINE_DOCKERFILE=ouroboros-engine/Dockerfile
REST_DOCKERFILE=ouroboros-rest/Dockerfile
UI_DOCKERFILE=ouroboros-ui/Dockerfile

# The published migration image — the module in the form a deployment applies.
ENTRYPOINT_NAME=docker-entrypoint.sh
DOCKERFILE=ouroboros-db/Dockerfile
DOCKERIGNORE=ouroboros-db/.dockerignore
ENTRYPOINT="ouroboros-db/$ENTRYPOINT_NAME"

# Where the container sees the module. Both mounts and -workingDirectory name it, so the
# relative locations inside flyway.toml resolve the same way on both sides.
PROJECT=/flyway/project

# Where the extracted service blocks are kept for the run. One compose file now describes
# five services, and a grep over the whole of it answers about all five at once — so the
# assertions below are made against one service's lines at a time (lib/compose-service.awk).
BLOCKS=$(mktemp -d)
trap 'rm -rf "$BLOCKS"' EXIT HUP INT TERM

# service_block NAME — path to a file holding NAME's block of the compose file.
#
# Extracted once per service per run. A service that is not there leaves an empty file
# rather than stopping the run, so every check about it fails and is reported, which is
# the same shape as a missing file elsewhere in this script.
service_block() {
  block="$BLOCKS/$1.yml"
  if [ ! -f "$block" ]; then
    awk -v service="$1" -f "$EXTRACT" "$COMPOSE" > "$block" 2>/dev/null || :
  fi
  printf '%s' "$block"
}

# service_dependencies NAME — one `dependency:condition` line per depends_on entry.
#
# What `depends_on` is worth is the condition attached to each name, and the two are on
# different lines: a stack can name every dependency and still start `rest` beside a
# migration that has not run. Pairing them here is what lets a single check assert the
# gate rather than only the edge.
service_dependencies() {
  awk '
    /^    depends_on:$/ { depends = 1; next }
    depends && /^    [a-z]/ { depends = 0 }
    depends && /^      [A-Za-z0-9_.-]+:$/ { name = $1; sub(/:$/, "", name); next }
    depends && /^        condition: / { print name ":" $2 }
  ' "$(service_block "$1")"
}

# service_setting NAME KEY — the value of a `KEY: value` line in NAME's environment.
#
# Used where two services have to agree about a string — the address the UI renders into
# a link and the origin `ouroboros-rest` builds its OAuth redirect_uri from are the same
# address, and a stack where they differ is one whose sign-in lands nowhere.
service_setting() {
  awk -v key="$2" '
    $1 == key ":" { sub(/^[^:]*:[ \t]*/, ""); print; exit }
  ' "$(service_block "$1")"
}

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
check_contains "$COMPOSE" "^      - \\./$FLYWAY_CONFIG:$PROJECT/flyway\\.toml:ro\$" 'flyway mounts the project configuration read-only'
check_contains "$COMPOSE" "^      - \\./$MIGRATIONS:$PROJECT/migrations:ro\$" 'flyway mounts the migrations read-only'
check_contains "$COMPOSE" "^      - -workingDirectory=$PROJECT\$" 'flyway takes its settings from the module, not from this file'
check_contains "$COMPOSE" '^      - migrate$' 'flyway runs migrate'
# The stack is a laptop by definition, and it is the one place the dev seed is on (#23).
# -configFiles replaces the file Flyway would have auto-loaded, so flyway.toml has to be
# named alongside the overlay or the project's own rules go with it.
check_contains "$COMPOSE" "^      - \\./$FLYWAY_SEED_CONFIG:$PROJECT/flyway\\.seed\\.toml:ro\$" \
  'flyway mounts the dev-seed overlay read-only'
check_contains "$COMPOSE" "^      - -configFiles=$PROJECT/flyway\\.toml,$PROJECT/flyway\\.seed\\.toml\$" \
  'flyway layers that overlay over flyway.toml rather than replacing it'
# Everything that is a rule rather than a connection moved into flyway.toml with #19.
# Restating one here would put the stack back in a position to disagree with run.sh.
check_absent "$COMPOSE" '^ *- -(locations|createSchemas|validateMigrationNaming|connectRetries)' \
  'the compose file does not restate what flyway.toml settles'
# A migrator is a task: a restart policy would re-run it forever behind `up -d`.
check_contains "$COMPOSE" '^    restart: "no"$' 'flyway does not restart after it succeeds'

# ---------------------------------------------------------------------------
# Application services (#55)
# ---------------------------------------------------------------------------

printf '\nStack shape\n'
for service in engine rest ui; do
  check_contains "$COMPOSE" "^  $service:\$" "$COMPOSE defines the $service service"
done
# The data tier is what a bare `docker compose up` means, in the README, in the
# conventions and in this file's own header — which is true only while `db` and `flyway`
# are in no profile at all. Putting either of them in one would silently turn that
# command into a stack that starts nothing.
for service in db flyway; do
  check_absent "$(service_block "$service")" '^ *profiles:' \
    "$service is in no profile, so the data tier is what a bare \`up\` starts"
done
for service in engine rest ui; do
  check_contains "$(service_block "$service")" '^      - full$' \
    "$service starts only under the full profile"
done
check_contains "$COMPOSE" '^networks:$' "$COMPOSE declares its networks"
check_contains "$COMPOSE" '^  ouroboros:$' 'the services share one named network'

printf '\nStartup order\n'
# The chain the issue describes: db, then the migrations, then the engine, then the
# service that needs all three, then the UI. Every edge is a healthcheck or an exit
# status — never a sleep — and the conditions are what say so.
check_matches "$(service_dependencies flyway)" '^db:service_healthy$' \
  'flyway waits for the database to be healthy'
check_matches "$(service_dependencies rest)" '^db:service_healthy$' \
  'rest waits for the database to be healthy'
# The one that would otherwise be a race with data in it: `service_started` here would
# let the API answer requests against a schema this checkout has not migrated yet.
check_matches "$(service_dependencies rest)" '^flyway:service_completed_successfully$' \
  'rest waits for the migrations to have succeeded, not merely to have started'
check_matches "$(service_dependencies rest)" '^engine:service_healthy$' \
  'rest waits for the engine to be healthy'
check_matches "$(service_dependencies ui)" '^rest:service_healthy$' \
  'ui waits for rest to be healthy'

# A `condition: service_healthy` is only as real as the probe behind it, and for these
# three the probe is in the image — which is why each of them is checked for one here,
# and why none of them restates the probe in the compose file.
check_contains "$ENGINE_DOCKERFILE" '^HEALTHCHECK ' "$ENGINE_DOCKERFILE declares the probe compose waits on"
check_contains "$REST_DOCKERFILE" '^HEALTHCHECK ' "$REST_DOCKERFILE declares the probe compose waits on"
check_contains "$UI_DOCKERFILE" '^HEALTHCHECK ' "$UI_DOCKERFILE declares the probe compose waits on"
for service in engine rest ui; do
  check_absent "$(service_block "$service")" '^ *test:' \
    "$service takes its probe from its image rather than restating it"
  # Without it the first probe of a cold container is one image interval away — 30
  # seconds per link, on a chain four deep.
  check_contains "$(service_block "$service")" '^      start_interval: ' \
    "$service is probed at a cold-start rate until it is up"
done

printf '\nPublished surface\n'
# The boundary the issue asks to be checked deliberately: the engine is reachable at
# engine:8000 from the network and at no address the host has.
check_absent "$(service_block engine)" '^ *ports:' 'the engine publishes no port at all'
check_absent "$COMPOSE" '^ *- "[0-9.:]*:8000"' 'nothing in the stack publishes the engine port'
# The two a browser has to reach, on loopback for the same reason the database is: this
# stack carries development secrets, and Docker's default is every interface.
check_contains "$(service_block rest)" '^      - "127\.0\.0\.1:4000:4000"$' \
  'rest publishes its own port on loopback only'
check_contains "$(service_block rest)" '^      - "127\.0\.0\.1:3000:3000"$' \
  "rest publishes the UI's port, which is the namespace it owns"
# The UI shares that namespace, so both are settled above; declaring either here is what
# compose refuses outright, and this is the check that says why before it is tried.
check_contains "$(service_block ui)" '^    network_mode: "service:rest"$' \
  "ui shares rest's network namespace, so one OURO_REST_URL is right on both sides of it"
check_absent "$(service_block ui)" '^ *ports:' 'ui declares no port of its own'
check_absent "$(service_block ui)" '^ *networks:' 'ui declares no network of its own'

printf '\nService wiring\n'
# An address inside this network is not a matter of opinion, and one on the host cannot
# be reached from inside it: OURO_DATABASE_URL and OURO_ENGINE_URL as .env.example
# documents them — pointing at localhost — are exactly the values that cannot work here.
check_contains "$(service_block rest)" '^      OURO_DATABASE_URL: postgresql://[^@]*@db:5432/' \
  'rest reaches the database at db:5432, the address inside the network'
check_contains "$(service_block rest)" '^      OURO_ENGINE_URL: http://engine:8000$' \
  'rest reaches the engine at engine:8000, which nothing outside the network can resolve'
# And the reverse: the two values a *browser* is given have to be the host's view.
check_matches "$(service_setting rest OURO_REST_URL)" '^http://localhost:4000$' \
  "rest builds its OAuth redirect_uri from the browser's address, not a container's"
check_matches "$(service_setting rest OURO_UI_URL)" '^http://localhost:3000$' \
  "rest sends a signed-in browser to the browser's address"
check_matches "$(service_setting rest OURO_CORS_ORIGINS)" '^http://localhost:3000$' \
  "rest allows credentialed calls from the UI's origin"
# The invariant the shared namespace exists to make keepable: the address the UI renders
# into "Continue with GitHub" and the address rest registers with GitHub are one string.
check_equals "$(service_setting rest OURO_REST_URL)" "$(service_setting ui OURO_REST_URL)" \
  'ui and rest agree on the one address OURO_REST_URL names'
# Both sides of the internal call read one variable: two would be a stack that answers
# 401 to every engine request whenever a developer changed only one of them.
for service in engine rest; do
  check_contains "$(service_block "$service")" \
    '^      OURO_ENGINE_SHARED_SECRET: \$\{OURO_ENGINE_SHARED_SECRET' \
    "$service reads the shared secret from the one variable that names it"
done

printf '\nCredential handling\n'
# Every credential must arrive by interpolation. A literal here would be a password in
# git that also silently ignores whatever the developer put in .env.
check_absent "$COMPOSE" '^ *POSTGRES_[A-Z_]+:[[:space:]]*[^$[:space:]]' 'no literal POSTGRES_* credential in the compose file'
check_absent "$COMPOSE" '^ *- -(user|password|url)=[^$]*$' 'no literal Flyway credential in the compose file'
# The application services brought more of them, and the same rule: a value that does not
# open with `$` is one somebody typed into a committed file, and one a developer cannot
# change from their .env because nothing here would read it.
#
# Matched on the *suffix* rather than on the OURO_ prefix, because not every credential in
# this stack carries one — BETTER_AUTH_SECRET is the library's own name (issue #700,
# docs/CONVENTIONS.md § 4), and a rule anchored to the prefix would have let it through.
check_absent "$COMPOSE" '^ *[A-Z_]*(SECRET|CLIENT_ID):[[:space:]]*[^$[:space:]]' \
  'no literal credential in the compose file'
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
#
# `BETTER_AUTH_` is matched beside the prefix rather than instead of it: docs/CONVENTIONS.md
# § 4 lets a library's own canonical variable keep its own name, and a pattern that only
# knew about OURO_ would stop checking a variable the moment it became an exception —
# which is the moment it most needs checking (issue #700).
for name in $(cat ouroboros-*/README.md docs/CONVENTIONS.md 2>/dev/null |
  grep -oE '(OURO_|BETTER_AUTH_)[A-Z0-9_]+' | sort -u); do
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

# ---------------------------------------------------------------------------
# Flyway project
# ---------------------------------------------------------------------------

printf '\nFlyway project\n'

# The settings that used to be spelled out on two command lines. They live here once, in
# the module, and both the compose stack and run.sh read them from here (#19).
check_exists "$FLYWAY_CONFIG" "$FLYWAY_CONFIG exists"
check_contains "$FLYWAY_CONFIG" '^locations = \["filesystem:migrations"\]$' \
  'flyway.toml locates the migrations relative to the project, so both runners find the same ones'
check_contains "$FLYWAY_CONFIG" '^schemas = \["ouroboros"\]$' 'flyway.toml owns the ouroboros schema'
check_contains "$FLYWAY_CONFIG" '^createSchemas = true$' 'flyway.toml creates that schema if it is absent'
check_contains "$FLYWAY_CONFIG" '^validateMigrationNaming = true$' 'flyway.toml rejects a misnamed migration'
check_contains "$FLYWAY_CONFIG" '^connectRetries = ' 'flyway.toml retries a database that is still starting'
# It is committed, so anything that names a machine or authenticates to one is out: those
# arrive from OURO_DB_* on the command line.
check_absent "$FLYWAY_CONFIG" '^(url|user|password) = ' 'flyway.toml carries no connection or credential'

# `clean` drops every object in the schema, so the configuration everything else reads
# has it off, one file turns it back on, and one script loads that file.
check_contains "$FLYWAY_CONFIG" '^cleanDisabled = true$' 'flyway.toml disables clean'
check_exists "$FLYWAY_DEV_CONFIG" "$FLYWAY_DEV_CONFIG exists"
check_contains "$FLYWAY_DEV_CONFIG" '^cleanDisabled = false$' 'the dev overlay is what re-enables it'
# Anchored past any `#`, so the compose file may *explain* why it does not load this one
# — which it does, next to the seed overlay it does load — while a mount or a
# -configFiles naming it still fails here.
check_absent "$COMPOSE" '^[^#]*flyway\.dev\.toml' 'the stack never loads the dev overlay'
check_contains "$DB_SCRIPTS/clean-dev" 'flyway\.dev\.toml' 'clean-dev is what does load it'

# The dev seed's guard, on the same pattern: off in the file everything reads, on in one
# overlay, and loaded by the stack because the stack is a developer's laptop (#23). What
# the seed itself must look like is ouroboros-db/tests/seed.test.sh.
check_exists "$FLYWAY_SEED_CONFIG" "$FLYWAY_SEED_CONFIG exists"
check_contains "$FLYWAY_CONFIG" '^ouro_dev_seed = "false"$' \
  'flyway.toml resolves the dev-seed guard to false'
check_contains "$FLYWAY_CONFIG" '^placeholderReplacement = true$' \
  'flyway.toml substitutes placeholders, which is what makes that guard a guard'
check_contains "$FLYWAY_SEED_CONFIG" '^ouro_dev_seed = "true"$' \
  'the seed overlay is what turns it on'
check_absent "$FLYWAY_SEED_CONFIG" '^cleanDisabled' \
  'and it does not smuggle clean in alongside the seed'

printf '\nNamed commands\n'
for name in migrate info validate clean-dev; do
  check_executable "$DB_SCRIPTS/$name" "$DB_SCRIPTS/$name is executable"
done
# An ungated clean is the one command this module must not offer.
check_missing "$DB_SCRIPTS/clean" "there is no $DB_SCRIPTS/clean to reach for by mistake"

printf '\nMigration runner\n'
check_executable ouroboros-db/run.sh 'ouroboros-db/run.sh is executable'

MODULE_ENV=ouroboros-db/.env.example
check_exists "$MODULE_ENV" "$MODULE_ENV exists"
check_run "$MODULE_ENV parses" awk -f "$PARSER" "$MODULE_ENV"

# A parameter the runner reads but the template omits is one a developer cannot
# discover; a variable the template declares but nothing reads is a lie.
module_declared=$(awk -f "$PARSER" "$MODULE_ENV" 2>/dev/null | cut -f 1 || true)
for name in $module_declared; do
  check_contains ouroboros-db/run.sh "$name" "run.sh reads the $name the template declares"
done
for name in OURO_DB_HOST OURO_DB_PORT OURO_DB_NAME OURO_DB_USER OURO_DB_PASSWORD \
  OURO_DB_SCHEMA; do
  check_matches "$module_declared" "^$name\$" "$MODULE_ENV declares $name"
done

# It applies the same migrations the compose pass does, so anything that drifted between
# the two would give `up` and `run.sh` different databases from the same checkout. Since
# #19 that is the project directory and the image: the rules themselves are in the one
# flyway.toml they both read from it.
check_contains ouroboros-db/run.sh '\-workingDirectory=' 'run.sh reads flyway.toml, as the stack does'
check_contains ouroboros-db/run.sh 'flyway/flyway:11' 'run.sh pins the same Flyway 11 image'
# A password that comes from a variable opens with `"` or `$`, and the redaction branch
# opens with `*`; anything alphanumeric is a credential someone typed in.
check_absent ouroboros-db/run.sh '\-password=[[:alnum:]]' 'run.sh holds no literal password'

# ---------------------------------------------------------------------------
# Migration image
# ---------------------------------------------------------------------------

# The third way these migrations are applied: the published image, for an environment
# where there is no checkout to mount. It is checked here rather than beside the CI
# contract because what makes it safe is what makes the other two safe — the same pinned
# Flyway, the same project directory, the overlays that stay inert, and no credential in
# a file anybody can read. `ci/db` publishes it; that half is scripts/verify-ci.sh.
printf '\nMigration image\n'
check_exists "$DOCKERFILE" "$DOCKERFILE exists"
# The third place Flyway is pinned, after the compose stack and run.sh. An image that
# applied these migrations with a different Flyway than the one the pull request proved
# them against would make ci/db prove something other than what ships.
check_contains "$DOCKERFILE" '^FROM flyway/flyway:11' 'the image pins the same Flyway 11 image'
# The same directory the other two runners use, so flyway.toml's relative
# `filesystem:migrations` resolves to the migrations in all three.
check_contains "$DOCKERFILE" "^COPY migrations/ $PROJECT/migrations/\$" 'the image carries the migrations'
check_contains "$DOCKERFILE" "^COPY flyway\\.toml flyway\\.seed\\.toml $PROJECT/\$" \
  'the image carries the project configuration and the seed overlay'
check_contains "$DOCKERFILE" "$ENTRYPOINT_NAME" 'the image carries its entrypoint'
check_contains "$DOCKERFILE" '^USER ' 'the image drops root'
# `clean` drops every object in the schema and this is the image that gets pointed at a
# real database. flyway.toml disables it; leaving the one overlay that re-enables it out
# of the layer is what makes that undoable from inside the container. Anchored past any
# `#`, as the compose check above is, so the Dockerfile may explain the absence while a
# COPY that ended it still fails here.
check_absent "$DOCKERFILE" '^[^#]*flyway\.dev\.toml' 'the image cannot reach the clean overlay'
# A migrator is a task: it exits, and its exit status is the answer. A restart policy or
# a healthcheck would be describing a service this is not.
check_absent "$DOCKERFILE" '^HEALTHCHECK' 'the image declares no healthcheck: it is a task, not a service'
# Anything an image needs to reach a database differs per deployment, and one of them is
# a secret. They arrive in the environment at run time; a literal here would be baked
# into a published layer.
check_absent "$DOCKERFILE" '^(ENV|ARG) *OURO_' 'the image bakes in no connection parameter'
check_absent "$DOCKERFILE" '\-password=' 'the image holds no literal password'

check_executable "$ENTRYPOINT" "$ENTRYPOINT is executable"
check_contains "$ENTRYPOINT" '\-workingDirectory=' 'the entrypoint reads flyway.toml, as the other runners do'
# The parameters are the module's six, so one set of variables points every way of
# migrating at a database. A seventh here would be one only the image understood.
for name in $module_declared; do
  check_contains "$ENTRYPOINT" "$name" "the entrypoint reads the $name the template declares"
done
# The password reaches Flyway in the environment, never in argv, where anything else in
# the container's namespace could read it off the process list. What that forbids is a
# -password= carrying a *value*, so the pattern is the opening quote or `$` of one:
# naming the flag in a comment or in the message that says how to pass one yourself is
# how a caller learns it exists.
check_absent "$ENTRYPOINT" '^[^#]*\-password=["$]' \
  'the entrypoint keeps the password out of the command line'
# `localhost` inside a container is the container. A default host would turn a missing
# variable into a run that reports success against nothing.
check_contains "$ENTRYPOINT" 'OURO_DB_HOST:-\}' 'the entrypoint refuses to guess a host'

# The build context is this module, so BuildKit reads a plain .dockerignore beside the
# Dockerfile (docs/CONVENTIONS.md § 5). It is an allow-list — `*` and then what the build
# copies — because a deny-list has to be extended for every file added here, and the
# first thing it would let through is this module's real .env.
check_exists "$DOCKERIGNORE" "$DOCKERIGNORE exists"
check_contains "$DOCKERIGNORE" '^\*$' "$DOCKERIGNORE excludes the context before allowing anything"
for allowed in 'migrations/' 'flyway\.toml' 'flyway\.seed\.toml' "$ENTRYPOINT_NAME"; do
  check_contains "$DOCKERIGNORE" "^!$allowed\$" "$DOCKERIGNORE allows $(printf '%s' "$allowed" | tr -d '\\')"
done
check_absent "$DOCKERIGNORE" '^!\.env' "$DOCKERIGNORE never admits an .env to the build context"
check_absent "$DOCKERIGNORE" '^!flyway\.dev\.toml$' "$DOCKERIGNORE never admits the clean overlay"

# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------

printf '\nDocumented flow\n'
for doc in README.md ouroboros-db/README.md; do
  check_contains "$doc" 'docker compose up' "$doc documents bringing the stack up"
  check_contains "$doc" 'docker compose down -v' "$doc documents the reset flow"
done
# The whole-stack command, and the one that picks up a source change: compose builds an
# image that is missing and never rebuilds one that is stale, so a developer who only
# ever reads the first of these has a UI that silently stays at the commit they built it
# from.
check_contains README.md 'docker compose --profile full up' \
  'README.md documents the cold start of the whole stack'
check_contains README.md 'docker compose --profile full (up --build|build)' \
  'README.md documents rebuilding an image after a source change'
check_contains ouroboros-db/README.md 'flyway_schema_history' \
  'ouroboros-db/README.md says how to read the applied versions'

check_summary
