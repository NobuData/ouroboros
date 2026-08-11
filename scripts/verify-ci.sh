#!/usr/bin/env sh
#
# verify-ci.sh — assert the per-module CI contract established by issue #11.
#
# Checks that every application module has a workflow; that each one reports under the
# agreed status-check name (`ci/ui`, `ci/rest`, `ci/engine`, `ci/db`); that the path
# filters route a change to exactly the workflows that can be affected by it and to no
# others; that the Node and Python versions are pinned in one place rather than per
# workflow; that a module whose scaffold has not landed yet is skipped deliberately
# instead of failing; that each pipeline runs the verbs docs/CONVENTIONS.md § 3 promises
# for its toolchain; and that `ci/db` still carries the live migration pass (#24) against
# the PostgreSQL the development stack pins.
#
# It reads files and starts nothing: no runner, no network, no GitHub. Whether a
# workflow passes is what a pull request answers; what this answers is whether the right
# workflow would run at all — which is the half that is invisible until it is wrong,
# because a filter that matches nothing looks exactly like a suite with no failures.
#
# Deliberately dependency-free POSIX shell, matching the repo's other verify-* scripts.
#
# Usage:
#   scripts/verify-ci.sh              # run from anywhere; resolves the repo root
#   scripts/verify-ci.sh --root DIR   # check DIR instead (used by the tests)
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
      [ $# -ge 2 ] || { printf 'verify-ci: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$2" && pwd)
      shift 2
      ;;
    -h | --help)
      sed -n '2,26p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'verify-ci: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# The assertion harness, shared with the repo's other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

WORKFLOWS=.github/workflows
ACTIONS=.github/actions
NODE_ACTION="$ACTIONS/node-module/action.yml"
GATE_ACTION="$ACTIONS/scaffold-gate/action.yml"
PARSER="$SCRIPT_DIR/lib/parse-workflow-paths.awk"

# The four application modules and the workflow each one reports under. ouroboros-web is
# not among them: it is the marketing site, and docker-publish.yml is its own pipeline.
MODULES="ui rest engine db"

# The repo-root files the Yarn workspace and its Turborepo task graph are made of (#13).
# A change to any of them can change what a TypeScript module builds without touching
# that module's directory, so both TypeScript workflows have to watch all four.
WORKSPACE_FILES="package.json yarn.lock turbo.json .yarnrc.yml"

TAB=$(printf '\t')

printf '\nCI workflows — %s\n\n' "$ROOT"

# ---------------------------------------------------------------------------
# Workflow files
# ---------------------------------------------------------------------------

printf 'Workflow files\n'
for module in $MODULES; do
  check_exists "$WORKFLOWS/$module.yml" "$WORKFLOWS/$module.yml exists"
done
check_exists "$GATE_ACTION" "$GATE_ACTION exists"
check_exists "$NODE_ACTION" "$NODE_ACTION exists"

# Every workflow in the directory is parsed, not only the four: the routing checks below
# are only as honest as the set of workflows they consider, and a workflow left out
# could be the one that also runs.
check_run 'every workflow declares a parseable `on:` block' \
  sh -c "awk -f '$PARSER' $WORKFLOWS/*.yml"

# The path filters, one `<file><TAB><event><TAB><glob>` record per line. Empty if the
# parse failed, in which case every routing check below reports what that costs.
ROUTES=$(awk -f "$PARSER" "$WORKFLOWS"/*.yml 2>/dev/null || true)

# ---------------------------------------------------------------------------
# Status checks
# ---------------------------------------------------------------------------

printf '\nStatus checks\n'
for module in $MODULES; do
  workflow="$WORKFLOWS/$module.yml"
  # The job name is what GitHub names the check run, and therefore what a branch
  # protection rule is configured against. Renaming it silently un-requires the check.
  check_contains "$workflow" "^    name: ci/$module\$" "$module.yml reports as ci/$module"
  check_contains "$workflow" '^permissions:$' "$module.yml declares its token permissions"
  check_contains "$workflow" '^  contents: read$' "$module.yml asks for no more than read access"
  check_contains "$workflow" '^concurrency:$' "$module.yml groups its runs"
  check_contains "$workflow" '^  cancel-in-progress: true$' "$module.yml cancels superseded runs"
  check_contains "$workflow" '^      - uses: actions/checkout@v[0-9]' "$module.yml checks the repository out"
  # A floating branch reference is a third party's next commit running in this repo.
  check_absent "$workflow" 'uses: [a-z].*@(main|master)$' "$module.yml pins every action to a release"
done

# ---------------------------------------------------------------------------
# Path routing
# ---------------------------------------------------------------------------

# workflows_for EVENT PATH — the workflow filenames whose EVENT filter matches PATH,
# space-separated and alphabetical.
#
# GitHub's `**` matches across directory separators, and so does POSIX `case`'s `*`, so
# the translation between the two is a single substitution.
workflows_for() {
  wf_event=$1
  wf_path=$2
  printf '%s\n' "$ROUTES" | while IFS="$TAB" read -r wf_file wf_evt wf_glob; do
    [ "$wf_evt" = "$wf_event" ] || continue
    wf_pattern=$(printf '%s' "$wf_glob" | sed 's/\*\*/*/g')
    case $wf_path in
      $wf_pattern) printf '%s\n' "${wf_file##*/}" ;;
    esac
  done | sort -u | tr '\n' ' ' | sed 's/ *$//'
}

# check_route PATH EXPECTED — assert a pull request touching PATH runs exactly the
# EXPECTED workflows, given as a space-separated alphabetical list.
check_route() {
  route_actual=$(workflows_for pull_request "$1")
  check_equals "$2" "$route_actual" "a pull request touching $1 runs ${2:-no workflow}"
}

# check_glob FILE EVENT GLOB DESCRIPTION — assert FILE's EVENT filter lists GLOB.
check_glob() {
  if printf '%s\n' "$ROUTES" | grep -Fqx "$1$TAB$2$TAB$3"; then
    pass "$4"
  else
    fail "$4 ($1 does not filter $2 on $3)"
  fi
}

# check_filtered FILE EVENT DESCRIPTION — assert FILE's EVENT carries a path filter at
# all. The parser emits `**` for an event that declares none.
check_filtered() {
  if printf '%s\n' "$ROUTES" | grep -Fqx "$1$TAB$2$TAB**"; then
    fail "$3 ($2 in $1 has no paths: filter, so it runs for every change)"
  else
    pass "$3"
  fi
}

printf '\nPath filters\n'
for module in $MODULES; do
  workflow="$WORKFLOWS/$module.yml"
  for event in pull_request push; do
    check_filtered "$workflow" "$event" "$module.yml filters $event by path"
    check_glob "$workflow" "$event" "ouroboros-$module/**" \
      "$module.yml watches ouroboros-$module/ on $event"
    # A workflow that does not watch itself is one whose own edit goes untested.
    check_glob "$workflow" "$event" "$workflow" "$module.yml watches itself on $event"
  done
done

# Both events, not only pull_request: a filter that is right on one and wrong on the
# other passes review and then lets a broken main through.
for module in ui rest; do
  for event in pull_request push; do
    for workspace_file in $WORKSPACE_FILES; do
      check_glob "$WORKFLOWS/$module.yml" "$event" "$workspace_file" \
        "$module.yml watches $workspace_file on $event"
    done
  done
done

printf '\nRouting\n'
# The acceptance criterion: a change confined to one module runs that module's workflow
# and nothing else — including nothing belonging to ouroboros-web.
check_route ouroboros-ui/app/page.tsx 'ui.yml'
check_route ouroboros-ui/README.md 'ui.yml'
check_route ouroboros-rest/src/main.ts 'rest.yml'
check_route ouroboros-engine/src/ouroboros_engine/api/health.py 'engine.yml'
check_route ouroboros-web/app/page.tsx 'docker-publish.yml'

# The third deliberate exception, and the newest (#37). A migration is not confined to
# ouroboros-db: ci/rest's integration harness starts a PostgreSQL, applies this Flyway
# project to it, and compares the `Database` interface in ouroboros-rest against the schema
# that comes out. A column that moves has to fail on the pull request that moves it rather
# than on the next one that happens to touch a controller.
check_route ouroboros-db/migrations/V001__tenants.sql 'db.yml rest.yml'
check_route ouroboros-db/flyway.toml 'db.yml rest.yml'

# Documentation and repo tooling affect no module's build, so they queue nothing.
check_route docs/CONVENTIONS.md ''
check_route README.md ''
check_route scripts/verify-ci.sh ''

# Shared pipeline code is the deliberate exception: it belongs to every module that
# runs it, so editing it has to run all of them.
check_route "$NODE_ACTION" 'rest.yml ui.yml'
check_route "$GATE_ACTION" 'engine.yml rest.yml ui.yml'

# The workspace root is the other exception, and it exists for the same reason (#13).
# Both TypeScript modules are Yarn workspaces: they resolve from one lockfile, against
# one manifest, through one task graph. None of those files lives under a module
# directory, so without these a change that breaks both builds would queue neither.
#
# ouroboros-web is deliberately absent — it is not a workspace, it keeps its own
# lockfile, and docker-publish.yml is its own pipeline.
for workspace_file in $WORKSPACE_FILES; do
  check_route "$workspace_file" 'rest.yml ui.yml'
done

# The data tier is one contract across three files, and ci/db asserts all of it.
# docker-compose.yml reaches ci/rest as well, for the reason above: it is where the
# PostgreSQL and Flyway images are pinned, and ouroboros-rest's unit suite fails when the
# harness's copy of those pins stops matching (#37). .env.example does not — nothing in
# ouroboros-rest reads it.
check_route docker-compose.yml 'db.yml rest.yml'
check_route .env.example 'db.yml'

# ---------------------------------------------------------------------------
# Toolchain pins
# ---------------------------------------------------------------------------

printf '\nToolchain pins\n'
# One Node version for both TypeScript modules, written where they share it.
check_contains "$NODE_ACTION" '^    default: "24"$' 'the TypeScript pipeline pins Node 24'
for module in ui rest; do
  check_absent "$WORKFLOWS/$module.yml" 'node-version' \
    "$module.yml takes the shared Node pin rather than one of its own"
done
check_contains "$WORKFLOWS/engine.yml" '^  PYTHON_VERSION: "3\.12"$' 'engine.yml pins Python 3.12'
# The pins are only shared if they are the ones the conventions document promises.
check_contains docs/CONVENTIONS.md 'Node 24' 'docs/CONVENTIONS.md documents the Node pin'
check_contains docs/CONVENTIONS.md 'Python 3\.12' 'docs/CONVENTIONS.md documents the Python pin'

# ---------------------------------------------------------------------------
# Scaffold gating
# ---------------------------------------------------------------------------

# check_gated FILE INDENT UNGATED DESCRIPTION — assert every step of FILE past the
# UNGATED leading ones carries the scaffold condition. Steps are counted rather than
# listed, so a step added later without the condition fails this instead of silently
# running against a module that does not exist.
check_gated() {
  gated_total=$(grep -cE "^$2- (uses|name):" "$1" 2>/dev/null || true)
  gated_count=$(grep -cF "if: steps.gate.outputs.scaffolded == 'true'" "$1" 2>/dev/null || true)
  check_equals "$((gated_total - $3))" "$gated_count" "$4"
}

# check_no_expression FILE DESCRIPTION — assert the shell script FILE ends with, opened
# by `run: |`, contains no ${{ }} expression.
#
# An expression on an `env:` line is an assignment the runner makes before the shell
# starts; the same expression inside the script is text spliced into the shell as code.
# Only the second is a way in, and only the second is what this refuses.
check_no_expression() {
  if sed -n '/run: |/,$p' "$1" 2>/dev/null | grep -q '\${{'; then
    fail "$2 (an expression is interpolated into the script in $1)"
  else
    pass "$2"
  fi
}

printf '\nScaffold gating\n'
check_contains "$GATE_ACTION" '^  scaffolded:$' 'the gate reports whether the module is scaffolded'
check_contains "$GATE_ACTION" '^      run: \|$' 'the gate detects the manifest in a script step'
check_contains "$GATE_ACTION" '^        MODULE: \$\{\{ inputs\.module \}\}$' \
  'the gate takes its module from the environment'
check_no_expression "$GATE_ACTION" 'the gate never splices an input into its script'

check_contains "$NODE_ACTION" '^        manifest: package\.json$' \
  'the TypeScript pipeline activates on a package.json'
check_gated "$NODE_ACTION" '    ' 1 'every TypeScript step waits for the scaffold'

check_contains "$WORKFLOWS/engine.yml" '^          manifest: pyproject\.toml$' \
  'engine.yml activates on a pyproject.toml'
check_gated "$WORKFLOWS/engine.yml" '      ' 2 'every engine step waits for the scaffold'

# ouroboros-db is scaffolded already — its migrations run today — so ci/db is not gated.
check_absent "$WORKFLOWS/db.yml" 'scaffold-gate' 'db.yml is not gated: its migrations exist'

# ---------------------------------------------------------------------------
# Module pipelines
# ---------------------------------------------------------------------------

printf '\nModule pipelines\n'
# The five verbs docs/CONVENTIONS.md § 3 asks of every TypeScript module, in the order
# the issue specifies: install → lint → typecheck → test → build.
for step in 'yarn install --immutable' 'yarn lint' 'yarn typecheck' 'yarn test' 'yarn build'; do
  check_contains "$NODE_ACTION" "^      run: $step\$" "the TypeScript pipeline runs $step"
done
for module in ui rest; do
  check_contains "$WORKFLOWS/$module.yml" '^      - uses: \./\.github/actions/node-module$' \
    "$module.yml runs the shared TypeScript pipeline"
  check_contains "$WORKFLOWS/$module.yml" "^          module: ouroboros-$module\$" \
    "$module.yml points that pipeline at ouroboros-$module"
done

for step in 'uv sync --locked' 'uv run ruff check \.' 'uv run ruff format --check \.' 'uv run pytest'; do
  check_contains "$WORKFLOWS/engine.yml" "^        run: $step\$" \
    "engine.yml runs $(printf '%s' "$step" | tr -d '\\')"
done

check_contains "$WORKFLOWS/db.yml" '^        run: scripts/verify-dev-env\.sh$' \
  'db.yml asserts the migration and data-tier contract'

# ---------------------------------------------------------------------------
# The database's live pass (#24)
# ---------------------------------------------------------------------------

# Everything else `ci/db` runs is a file read, and a file read cannot tell whether a
# migration applies or whether the schema it leaves behind enforces what it claims. These
# assert that the half which needs a running PostgreSQL is still wired in: a database is
# started, the migrations are applied to it from empty, Flyway is asked to validate what
# it wrote, and both `.sql` assertion suites are run against the result.
#
# What each of those steps *proves* is the suites' business; what this proves is that
# they are still invoked, because a live pass silently dropped from the workflow looks
# exactly like a data tier with nothing wrong with it.

printf '\nDatabase live pass\n'

DB_WORKFLOW="$WORKFLOWS/db.yml"

check_contains "$DB_WORKFLOW" '^    services:$' 'db.yml starts a database to migrate'
# The same gate the compose file uses, and named the same way: pg_isready probing as the
# OS user reports ready while the database being created is still absent, so a run
# without -U/-d races initdb rather than waiting for it.
check_contains "$DB_WORKFLOW" 'pg_isready -U .* -d ' \
  'db.yml waits on a healthcheck that names the role and database'

# The commands a developer runs, so CI and a laptop apply the same checkout under the
# same rules — both read ouroboros-db/flyway.toml through -workingDirectory.
check_contains "$DB_WORKFLOW" '^        run: ouroboros-db/scripts/migrate$' \
  'db.yml migrates a clean database'
check_contains "$DB_WORKFLOW" '^        run: ouroboros-db/scripts/validate$' \
  'db.yml validates what it applied'

# `validate` compares checksums, so a unique index on the wrong columns or a cascade
# left off passes it untouched. constraints.sql is what asks the schema to refuse things.
check_contains "$DB_WORKFLOW" 'tests/constraints\.sql' \
  'db.yml asserts what the schema enforces'

# The seed's own leg. It needs the overlay, because ${ouro_dev_seed} is false in every
# configuration but that one — which is the guard, and is also why this cannot simply be
# asserted against the database above.
check_contains "$DB_WORKFLOW" 'flyway\.seed\.toml' \
  'db.yml migrates a second database with the dev-seed overlay'
check_contains "$DB_WORKFLOW" 'tests/seed\.sql' \
  'db.yml asserts what the seed put there'

# The live pass's connection parameters must not be in job scope. OURO_DB_* present in
# the environment is the last word in run.sh's precedence, and the module's tooling suite
# — which db.yml runs before the live pass — is the suite that tests that precedence by
# writing .env files and asserting what Flyway would have been given. Declared job-wide
# they make it assert the workflow instead, and it fails. Six spaces is job scope; a step
# that sets them for itself and everything after it is indented deeper than this.
check_absent "$DB_WORKFLOW" '^      OURO_[A-Z0-9_]+:' \
  'db.yml keeps the live pass out of the tooling tests scope'

# PostgreSQL is pinned in three places that have to agree. The service container is one;
# POSTGRES_IMAGE — the image the psql steps run the `.sql` suites from — is the second,
# and it is a second place rather than the same one because the `env` context is not
# available to a service definition; the development stack is the third, and the point
# of the whole job is that a pull request proves what a developer will get.
#
# `head -n 1` throughout: the first match is the one that matters, and a file with none
# yields the empty string, which fails the comparison with the reason printed.
db_service_image=$(sed -n 's/^        image: \(postgres:[^ ]*\)$/\1/p' "$DB_WORKFLOW" 2>/dev/null | head -n 1)
db_client_image=$(sed -n 's/^ *echo "POSTGRES_IMAGE=\(postgres:[^"]*\)"$/\1/p' "$DB_WORKFLOW" 2>/dev/null | head -n 1)
compose_image=$(sed -n 's/^    image: \(postgres:[^ ]*\)$/\1/p' docker-compose.yml 2>/dev/null | head -n 1)

check_matches "$compose_image" '^postgres:[0-9]' 'the compose stack pins a PostgreSQL version'
check_equals "$compose_image" "$db_service_image" \
  'db.yml migrates the PostgreSQL the development stack pins'
check_equals "$compose_image" "$db_client_image" \
  'db.yml runs the assertion suites from that same image'

# ---------------------------------------------------------------------------
# The database's published image
# ---------------------------------------------------------------------------

# ci/db proves these migrations apply; the publish job turns the ones that did into the
# image a deployment runs. What matters is the order between the two — and that a pull
# request still builds the image without needing a credential to do it, because a
# Dockerfile that stopped building is worth reporting on the change that broke it.
#
# What the image *is* — the pinned Flyway, the project directory, the overlays that stay
# inert, root dropped — is scripts/verify-dev-env.sh's half of this.

printf '\nDatabase image\n'

check_exists ouroboros-db/Dockerfile 'the module has an image to publish'
check_contains "$DB_WORKFLOW" '^  publish:$' 'db.yml publishes it'
check_contains "$DB_WORKFLOW" '^    name: publish/db$' 'the publish job reports as publish/db'
# The gate. Without it a red ci/db still ships a tag, which is a schema nothing ran.
check_contains "$DB_WORKFLOW" '^    needs: ci$' 'nothing is published until ci/db has passed'
check_contains "$DB_WORKFLOW" '^          file: ouroboros-db/Dockerfile$' \
  'db.yml builds that Dockerfile'
# The module directory, so ouroboros-db/.dockerignore is the allow-list that governs the
# context. A root context would take its ignores from a file this module does not own.
check_contains "$DB_WORKFLOW" '^          context: ouroboros-db$' \
  'db.yml builds it from the module, not from the repository root'

# A push on a pull request is a tag moved by a change nobody has merged — and on a fork's
# pull request there are no credentials to push with in the first place. Every step that
# needs a secret carries the condition, and there are exactly as many conditions as there
# are such steps: a step added later without one fails this rather than running.
publish_secret_steps=$(sed -n '/^  publish:$/,$p' "$DB_WORKFLOW" 2>/dev/null |
  grep -c 'secrets\.DOCKER_' || true)
publish_guarded=$(sed -n '/^  publish:$/,$p' "$DB_WORKFLOW" 2>/dev/null |
  grep -cF "if: github.event_name != 'pull_request'" || true)
check_matches "$publish_secret_steps" '^[1-9]' 'the publish job authenticates to a registry'
check_equals 2 "$publish_guarded" 'both of its credentialed steps stop on a pull request'
# The build itself is not among them: it runs on every event, which is what makes a
# broken Dockerfile a pull request failure rather than a merge failure.
check_contains "$DB_WORKFLOW" '^          push: false$' 'db.yml builds the image on a pull request too'

# `latest` is what a deployment tracking main pulls; the commit is what a rollback names.
# The schema is versioned by its migrations rather than by a release number, so the sha
# is the only tag that says exactly which migrations are inside.
check_contains "$DB_WORKFLOW" '/ouroboros-db:latest$' 'the published image is tagged latest'
check_contains "$DB_WORKFLOW" '/ouroboros-db:\$\{\{ github\.sha \}\}$' \
  'and with the commit that built it, which is the tag that cannot move'
# Which registry this goes to is the deployment's business, not the repository's, and a
# hostname written down here is one that a fork of this repository would authenticate to
# and publish to. Both ends of that are checked: what it logs in to, and what it tags —
# the second anchored past any `#`, so the workflow may name an example registry while a
# tag built from one still fails.
check_absent "$DB_WORKFLOW" '^ *registry: *[^$[:space:]]' \
  'the registry it logs in to comes from a secret'
check_absent "$DB_WORKFLOW" '^[^#]*[a-z0-9-]+\.[a-z]{2,}/ouroboros-db' \
  'the registry it pushes to is not written into the workflow'

# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------

printf '\nDocumentation\n'
for module in $MODULES; do
  check_contains docs/CONVENTIONS.md "ci/$module" "docs/CONVENTIONS.md documents the ci/$module check"
done
check_contains README.md 'ci/ui' 'README.md names the status checks a pull request runs'

check_summary
