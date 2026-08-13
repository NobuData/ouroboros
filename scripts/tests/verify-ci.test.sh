#!/usr/bin/env sh
#
# verify-ci.test.sh — integration tests for scripts/verify-ci.sh.
#
# The script is run against synthetic repository trees rather than this checkout, so the
# tests pin the contract independently of the files that currently satisfy it: the
# fixture is a minimal .github/ that passes every check, and each case copies it, breaks
# exactly one thing, and asserts that the matching check — and the run — fails.
#
# No GitHub and no runner are involved, because the script under test starts nothing.
#
# Usage:
#   scripts/tests/verify-ci.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
VERIFY="$SCRIPTS_DIR/verify-ci.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# A GitHub Actions expression, held in a variable so a mutation below can write one into
# a file without the test's own shell trying to expand it.
EXPR='${{ inputs.module }}'

# make_fixture DIR — write a .github/ tree, and the two documents it is cross-checked
# against, that satisfy every check.
make_fixture() {
  fixture=$1
  mkdir -p "$fixture/.github/workflows" \
    "$fixture/.github/actions/node-module" \
    "$fixture/.github/actions/scaffold-gate" \
    "$fixture/docs"

  # The two TypeScript modules run the same shared pipeline over different directories.
  #
  # ouroboros-rest watches the data tier as well, since issue #37: its integration harness
  # starts a PostgreSQL and applies ouroboros-db's Flyway project to it, so a migration is
  # one of that module's test inputs — and its unit suite compares the harness's image pins
  # against docker-compose.yml. Held in a variable because the two workflows are otherwise
  # identical, and the shared template is what makes that visible.
  for module in ui rest; do
    data_tier=''
    if [ "$module" = rest ]; then
      data_tier='
      - "ouroboros-db/migrations/**"
      - "ouroboros-db/flyway.toml"
      - "ouroboros-db/run.sh"
      - "docker-compose.yml"'
    fi

    cat > "$fixture/.github/workflows/$module.yml" <<YAML
name: ouroboros-$module · ci

on:
  pull_request:
    branches: [main]
    paths:
      - "ouroboros-$module/**"$data_tier
      - ".github/actions/node-module/**"
      - ".github/actions/scaffold-gate/**"
      - ".github/workflows/$module.yml"
      - "package.json"
      - "yarn.lock"
      - "turbo.json"
      - ".yarnrc.yml"
  push:
    branches: [main]
    paths:
      - "ouroboros-$module/**"$data_tier
      - ".github/actions/node-module/**"
      - ".github/actions/scaffold-gate/**"
      - ".github/workflows/$module.yml"
      - "package.json"
      - "yarn.lock"
      - "turbo.json"
      - ".yarnrc.yml"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-$module-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: ci/$module
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: ./.github/actions/node-module
        with:
          module: ouroboros-$module
          scaffolded-by: "#0"

  publish:
    name: publish/$module
    runs-on: ubuntu-latest
    needs: ci
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - name: Build the image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ouroboros-$module/Dockerfile
          push: false

      - name: Log in to registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: \${{ secrets.DOCKER_HOSTNAME }}
          username: \${{ secrets.DOCKER_USERNAME }}
          password: \${{ secrets.DOCKER_PASSWORD }}

      - name: Push the image
        if: github.event_name != 'pull_request'
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ouroboros-$module/Dockerfile
          push: true
          tags: |
            \${{ secrets.DOCKER_HOSTNAME }}/ouroboros-$module:latest
            \${{ secrets.DOCKER_HOSTNAME }}/ouroboros-$module:\${{ github.sha }}
YAML

    # The image each of those jobs publishes. Only its presence is this script's
    # business — what is inside it is the module's own container test's.
    mkdir -p "$fixture/ouroboros-$module"
    printf 'FROM node:24-alpine\n' > "$fixture/ouroboros-$module/Dockerfile"
  done

  cat > "$fixture/.github/workflows/engine.yml" <<'YAML'
name: ouroboros-engine · ci

on:
  pull_request:
    branches: [main]
    paths:
      - "ouroboros-engine/**"
      - ".github/actions/scaffold-gate/**"
      - ".github/workflows/engine.yml"
  push:
    branches: [main]
    paths:
      - "ouroboros-engine/**"
      - ".github/actions/scaffold-gate/**"
      - ".github/workflows/engine.yml"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-engine-${{ github.ref }}
  cancel-in-progress: true

env:
  PYTHON_VERSION: "3.12"

jobs:
  ci:
    name: ci/engine
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Detect the scaffold
        id: gate
        uses: ./.github/actions/scaffold-gate
        with:
          module: ouroboros-engine
          manifest: pyproject.toml
          scaffolded-by: "#0"

      - name: Install uv
        if: steps.gate.outputs.scaffolded == 'true'
        uses: astral-sh/setup-uv@v9
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install dependencies
        if: steps.gate.outputs.scaffolded == 'true'
        shell: bash
        working-directory: ouroboros-engine
        run: uv sync --locked

      - name: Lint
        if: steps.gate.outputs.scaffolded == 'true'
        shell: bash
        working-directory: ouroboros-engine
        run: uv run ruff check .

      - name: Format
        if: steps.gate.outputs.scaffolded == 'true'
        shell: bash
        working-directory: ouroboros-engine
        run: uv run ruff format --check .

      - name: Test
        if: steps.gate.outputs.scaffolded == 'true'
        shell: bash
        working-directory: ouroboros-engine
        run: uv run pytest

  publish:
    name: publish/engine
    runs-on: ubuntu-latest
    needs: ci
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - name: Build the image
        uses: docker/build-push-action@v6
        with:
          context: ouroboros-engine
          file: ouroboros-engine/Dockerfile
          push: false

      - name: Log in to registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ secrets.DOCKER_HOSTNAME }}
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Push the image
        if: github.event_name != 'pull_request'
        uses: docker/build-push-action@v6
        with:
          context: ouroboros-engine
          file: ouroboros-engine/Dockerfile
          push: true
          tags: |
            ${{ secrets.DOCKER_HOSTNAME }}/ouroboros-engine:latest
            ${{ secrets.DOCKER_HOSTNAME }}/ouroboros-engine:${{ github.sha }}
YAML

  # The image that job publishes — see the note beside the TypeScript modules'.
  mkdir -p "$fixture/ouroboros-engine"
  printf 'FROM python:3.12-slim\n' > "$fixture/ouroboros-engine/Dockerfile"

  cat > "$fixture/.github/workflows/db.yml" <<'YAML'
name: ouroboros-db · ci

on:
  pull_request:
    branches: [main]
    paths:
      - "ouroboros-db/**"
      - "docker-compose.yml"
      - ".env.example"
      - ".github/workflows/db.yml"
      - "ouroboros-rest/src/auth/**"
      - "ouroboros-rest/package.json"
  push:
    branches: [main]
    paths:
      - "ouroboros-db/**"
      - "docker-compose.yml"
      - ".env.example"
      - ".github/workflows/db.yml"
      - "ouroboros-rest/src/auth/**"
      - "ouroboros-rest/package.json"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-db-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: ci/db
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: ouroboros
          POSTGRES_PASSWORD: ouroboros
          POSTGRES_DB: ouroboros
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U ouroboros -d ouroboros"
          --health-interval 2s
          --health-timeout 3s
          --health-retries 30

    steps:
      - uses: actions/checkout@v4

      - name: Install Node 24
        uses: actions/setup-node@v4
        with:
          node-version: "24"

      - name: Enable corepack (Yarn 4)
        run: corepack enable

      - name: Install dependencies
        run: yarn install --immutable

      - name: Build the service whose auth configuration decides the schema
        run: yarn workspace ouroboros-rest build

      - name: Migration & data-tier contract
        run: scripts/verify-dev-env.sh

      - name: Point the migration commands at that database
        run: |
          {
            echo "OURO_DB_HOST=localhost"
            echo "OURO_DB_PORT=5432"
            echo "OURO_DB_NAME=ouroboros"
            echo "OURO_DB_USER=ouroboros"
            echo "OURO_DB_PASSWORD=ouroboros"
            echo "OURO_DB_SCHEMA=ouroboros"
            echo "PGPASSWORD=ouroboros"
            echo "SEED_DB_NAME=ouroboros_seed"
            echo "POSTGRES_IMAGE=postgres:17-alpine"
          } >> "$GITHUB_ENV"

      - name: Migrate a clean database
        run: ouroboros-db/scripts/migrate

      - name: Validate the applied migrations
        run: ouroboros-db/scripts/validate

      - name: Assert what the schema enforces
        run: |
          docker run --rm --network=host "$POSTGRES_IMAGE" \
            psql -v ON_ERROR_STOP=1 -f /tests/constraints.sql

      - name: Assert the applied schema still satisfies BetterAuth
        run: ouroboros-db/scripts/betterauth-schema.mjs --applied

      - name: Assert the committed snapshot still describes what BetterAuth expects
        run: ouroboros-db/scripts/betterauth-schema.mjs --check

      - name: Seed a second database
        run: ouroboros-db/scripts/migrate --config flyway.seed.toml

      - name: Assert what the seed put there
        run: |
          docker run --rm --network=host "$POSTGRES_IMAGE" \
            psql -v ON_ERROR_STOP=1 -f /tests/seed.sql

  publish:
    name: publish/db
    runs-on: ubuntu-latest
    needs: ci
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - name: Build the image
        uses: docker/build-push-action@v6
        with:
          context: ouroboros-db
          file: ouroboros-db/Dockerfile
          push: false
          load: true
          tags: ouroboros-db:ci

      - name: Log in to registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ secrets.DOCKER_HOSTNAME }}
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Push the image
        if: github.event_name != 'pull_request'
        uses: docker/build-push-action@v6
        with:
          context: ouroboros-db
          file: ouroboros-db/Dockerfile
          push: true
          tags: |
            ${{ secrets.DOCKER_HOSTNAME }}/ouroboros-db:latest
            ${{ secrets.DOCKER_HOSTNAME }}/ouroboros-db:${{ github.sha }}
YAML

  # The image that job publishes. Only its presence is this script's business — what is
  # inside it is scripts/verify-dev-env.sh's, and the tests for that are its own suite.
  mkdir -p "$fixture/ouroboros-db"
  printf 'FROM flyway/flyway:11-alpine\n' > "$fixture/ouroboros-db/Dockerfile"

  # The development stack, present because ci/db's whole purpose is to migrate the
  # PostgreSQL it pins — so the pin is cross-checked against this file rather than
  # written down twice and trusted.
  cat > "$fixture/docker-compose.yml" <<'YAML'
name: ouroboros

services:
  db:
    image: postgres:17-alpine
YAML

  # The marketing site's own pipeline. It is in the fixture because the routing checks
  # are only meaningful against every workflow the repository has, not only the four.
  cat > "$fixture/.github/workflows/docker-publish.yml" <<'YAML'
name: ouroboros-web · build & publish

on:
  push:
    branches: [main]
    paths:
      - "ouroboros-web/**"
      - ".github/workflows/docker-publish.yml"
  pull_request:
    branches: [main]
    paths:
      - "ouroboros-web/**"
  workflow_dispatch:

jobs:
  build:
    name: Yarn build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
YAML

  cat > "$fixture/.github/actions/node-module/action.yml" <<'YAML'
name: TypeScript module checks
description: Install and check one TypeScript module.

inputs:
  module:
    description: Module directory.
    required: true
  scaffolded-by:
    description: Issue that lands the scaffold.
    required: true
  node-version:
    description: Node major every TypeScript module builds on.
    default: "24"

runs:
  using: composite
  steps:
    - name: Detect the scaffold
      id: gate
      uses: ./.github/actions/scaffold-gate
      with:
        module: ${{ inputs.module }}
        manifest: package.json
        scaffolded-by: ${{ inputs.scaffolded-by }}

    - name: Install Node
      if: steps.gate.outputs.scaffolded == 'true'
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}

    - name: Enable corepack (Yarn 4)
      if: steps.gate.outputs.scaffolded == 'true'
      shell: bash
      run: corepack enable

    - name: Install dependencies
      if: steps.gate.outputs.scaffolded == 'true'
      shell: bash
      working-directory: ${{ inputs.module }}
      run: yarn install --immutable

    - name: Lint
      if: steps.gate.outputs.scaffolded == 'true'
      shell: bash
      working-directory: ${{ inputs.module }}
      run: yarn lint

    - name: Typecheck
      if: steps.gate.outputs.scaffolded == 'true'
      shell: bash
      working-directory: ${{ inputs.module }}
      run: yarn typecheck

    - name: Test
      if: steps.gate.outputs.scaffolded == 'true'
      shell: bash
      working-directory: ${{ inputs.module }}
      run: yarn test

    - name: Build
      if: steps.gate.outputs.scaffolded == 'true'
      shell: bash
      working-directory: ${{ inputs.module }}
      run: yarn build
YAML

  cat > "$fixture/.github/actions/scaffold-gate/action.yml" <<'YAML'
name: Scaffold gate
description: Report whether a module has been scaffolded yet.

inputs:
  module:
    description: Module directory.
    required: true
  manifest:
    description: File whose presence means the module is scaffolded.
    required: true
  scaffolded-by:
    description: Issue that lands the scaffold.
    required: true

outputs:
  scaffolded:
    description: "\"true\" when the manifest is present."
    value: ${{ steps.detect.outputs.scaffolded }}

runs:
  using: composite
  steps:
    - id: detect
      shell: bash
      env:
        MODULE: ${{ inputs.module }}
        MANIFEST: ${{ inputs.manifest }}
        SCAFFOLDED_BY: ${{ inputs.scaffolded-by }}
      run: |
        set -euo pipefail
        if [ -f "$MODULE/$MANIFEST" ]; then
          echo "scaffolded=true" >> "$GITHUB_OUTPUT"
        else
          echo "scaffolded=false" >> "$GITHUB_OUTPUT"
          echo "::notice::$MODULE waits for $SCAFFOLDED_BY"
        fi
YAML

  cat > "$fixture/docs/CONVENTIONS.md" <<'DOC'
# Fixture conventions

TypeScript modules run on Node 24; the engine runs on Python 3.12.

```
ouroboros-ui/**     ─▶ ci/ui
ouroboros-rest/**   ─▶ ci/rest
ouroboros-engine/** ─▶ ci/engine
ouroboros-db/**     ─▶ ci/db
```
DOC

  cat > "$fixture/README.md" <<'DOC'
# Fixture

A pull request touching `ouroboros-ui/` runs `ci/ui` and nothing else.
DOC
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
  # the workflow they are about — which is context the case does not need to restate.
  if [ "$status" -ne 0 ] && printf '%s\n' "$out" | grep -Eq -- "^  FAIL .*$pattern"; then
    pass "$description"
  else
    fail "$description (status $status, no FAIL matching /$pattern/)"
  fi
}

printf '\nverify-ci.sh\n\n'

# ---------------------------------------------------------------------------
# The passing baseline
# ---------------------------------------------------------------------------

printf 'A conforming tree\n'

good="$work/good"
make_fixture "$good"
run_verify "$good"
check_equals 0 "$status" 'a conforming tree passes'
check_matches "$out" '0 failed' 'a conforming tree reports no failures'
check_matches "$out" 'CI workflows' 'the report names what it checked'

# ---------------------------------------------------------------------------
# Workflow files
# ---------------------------------------------------------------------------

printf '\nMissing workflows\n'

for module in ui rest engine db; do
  check_break "a missing $module workflow is reported" \
    "workflows/$module\.yml exists" \
    "rm \"\$root/.github/workflows/$module.yml\""
done

check_break 'a missing scaffold gate is reported' \
  'scaffold-gate/action\.yml exists' \
  'rm -r "$root/.github/actions/scaffold-gate"'

check_break 'a workflow whose on: block does not parse is reported' \
  'parseable .on:. block' \
  'sed -i "s|^    paths:|    paths-ignore:|" "$root/.github/workflows/ui.yml"'

# ---------------------------------------------------------------------------
# Status checks
# ---------------------------------------------------------------------------

printf '\nStatus check violations\n'

check_break 'a renamed job is reported — it renames the status check' \
  'reports as ci/ui' \
  'sed -i "s|name: ci/ui|name: build|" "$root/.github/workflows/ui.yml"'

check_break 'a workflow that does not restrict its token is reported' \
  'declares its token permissions' \
  'sed -i "/^permissions:$/d" "$root/.github/workflows/rest.yml"'

check_break 'a workflow asking for write access is reported' \
  'no more than read access' \
  'sed -i "s|^  contents: read$|  contents: write|" "$root/.github/workflows/engine.yml"'

check_break 'a workflow that never cancels superseded runs is reported' \
  'cancels superseded runs' \
  'sed -i "/cancel-in-progress/d" "$root/.github/workflows/db.yml"'

check_break 'an action pinned to a branch is reported' \
  'pins every action to a release' \
  'sed -i "s|actions/checkout@v4|actions/checkout@main|" "$root/.github/workflows/ui.yml"'

# ---------------------------------------------------------------------------
# Path filters and routing
# ---------------------------------------------------------------------------

printf '\nPath filter violations\n'

check_break 'an unfiltered pull_request is reported' \
  'ui\.yml filters pull_request by path' \
  'sed -i "0,/^    paths:$/{/^    paths:$/d}" "$root/.github/workflows/ui.yml" &&
   sed -i "0,/^      - \"ouroboros-ui/{/^      - \"ouroboros-ui/d}" "$root/.github/workflows/ui.yml"'

check_break 'a workflow that stopped watching its own module is reported' \
  'watches ouroboros-engine/ on push' \
  'sed -i "0,/^      - \"ouroboros-engine/!{/^      - \"ouroboros-engine/d}" "$root/.github/workflows/engine.yml"'

check_break 'a workflow that does not watch its own file is reported' \
  'rest\.yml watches itself' \
  'sed -i "/workflows\/rest.yml\"$/d" "$root/.github/workflows/rest.yml"'

printf '\nRouting violations\n'

check_break 'one module workflow reaching into another is reported' \
  'ouroboros-rest/src/main\.ts runs rest\.yml' \
  'sed -i "s|      - \"ouroboros-ui/\*\*\"|      - \"ouroboros-ui/**\"\n      - \"ouroboros-rest/**\"|" "$root/.github/workflows/ui.yml"'

check_break 'a module workflow triggered by documentation is reported' \
  'docs/CONVENTIONS\.md runs no workflow' \
  'sed -i "s|      - \"ouroboros-ui/\*\*\"|      - \"ouroboros-ui/**\"\n      - \"docs/**\"|" "$root/.github/workflows/ui.yml"'

check_break 'a shared pipeline only one module watches is reported' \
  'node-module/action\.yml runs rest\.yml ui\.yml' \
  'sed -i "/actions\/node-module\/\*\*/d" "$root/.github/workflows/rest.yml"'

# #37: ouroboros-rest's integration harness migrates with ouroboros-db's Flyway project,
# so a module that stops watching it tests against a schema its own pull requests never
# see change.
check_break 'a rest workflow that stops watching the migrations is reported' \
  'migrations/V001__tenants\.sql runs db\.yml rest\.yml' \
  'sed -i "/ouroboros-db\/migrations\/\*\*/d" "$root/.github/workflows/rest.yml"'

check_break 'a rest workflow that stops watching the image pins is reported' \
  'docker-compose\.yml runs db\.yml rest\.yml' \
  'sed -i "/^      - \"docker-compose.yml\"$/d" "$root/.github/workflows/rest.yml"'

# The workspace root, #13. A module that stops watching the lockfile it installs from
# builds green against a resolution nobody asked for.
check_break 'a module that stops watching the workspace lockfile is reported' \
  'yarn\.lock runs rest\.yml ui\.yml' \
  'sed -i "/^      - \"yarn.lock\"$/d" "$root/.github/workflows/ui.yml"'

check_break 'a module that stops watching the task graph is reported' \
  'watches turbo\.json on push' \
  'sed -i "0,/^      - \"turbo.json\"$/!{/^      - \"turbo.json\"$/d}" "$root/.github/workflows/rest.yml"'

check_break 'an unfiltered workflow added alongside is reported' \
  'runs no workflow' \
  'printf "on:\n  pull_request:\n    branches: [main]\n" > "$root/.github/workflows/everything.yml"'

# ---------------------------------------------------------------------------
# Toolchain pins
# ---------------------------------------------------------------------------

printf '\nToolchain pin violations\n'

check_break 'a Node version other than 24 is reported' \
  'pins Node 24' \
  'sed -i "s|default: \"24\"|default: \"22\"|" "$root/.github/actions/node-module/action.yml"'

check_break 'a module pinning its own Node version is reported' \
  'ui\.yml takes the shared Node pin' \
  'sed -i "s|          module: ouroboros-ui|          node-version: \"22\"\n          module: ouroboros-ui|" "$root/.github/workflows/ui.yml"'

check_break 'a Python version other than 3.12 is reported' \
  'pins Python 3\.12' \
  'sed -i "s|PYTHON_VERSION: \"3.12\"|PYTHON_VERSION: \"3.11\"|" "$root/.github/workflows/engine.yml"'

check_break 'a pin the conventions do not document is reported' \
  'documents the Python pin' \
  'sed -i "s|Python 3.12|Python 3.13|" "$root/docs/CONVENTIONS.md"'

# ---------------------------------------------------------------------------
# Scaffold gating
# ---------------------------------------------------------------------------

printf '\nScaffold gating violations\n'

check_break 'a gate that reports nothing is reported' \
  'reports whether the module is scaffolded' \
  'sed -i "/^  scaffolded:$/d" "$root/.github/actions/scaffold-gate/action.yml"'

check_break 'an input interpolated into the gate script is reported' \
  'never splices an input into its script' \
  'printf "%s\n" "          echo $EXPR" >> "$root/.github/actions/scaffold-gate/action.yml"'

check_break 'a TypeScript step that skips the gate is reported' \
  'every TypeScript step waits for the scaffold' \
  'sed -i "/- name: Lint/{n;d}" "$root/.github/actions/node-module/action.yml"'

# Into the `ci:` job, which is the only job the gate governs — appending to the file would
# now land the step in `publish:`, where a scaffold condition would be wrong rather than
# missing. That the publish job needs no gate is what the conforming fixture already says.
check_break 'an engine step added without the gate is reported' \
  'every engine step waits for the scaffold' \
  'sed -i "s|^  publish:$|      - name: Extra\n        run: true\n\n  publish:|" "$root/.github/workflows/engine.yml"'

check_break 'a pipeline that activates on the wrong manifest is reported' \
  'activates on a package\.json' \
  'sed -i "s|manifest: package.json|manifest: yarn.lock|" "$root/.github/actions/node-module/action.yml"'

check_break 'gating the database, whose migrations already exist, is reported' \
  'db\.yml is not gated' \
  'sed -i "s|      - name: Migration|      - uses: ./.github/actions/scaffold-gate\n      - name: Migration|" "$root/.github/workflows/db.yml"'

# ---------------------------------------------------------------------------
# Module pipelines
# ---------------------------------------------------------------------------

printf '\nPipeline violations\n'

check_break 'a TypeScript pipeline that skips typecheck is reported' \
  'runs yarn typecheck' \
  'sed -i "s|run: yarn typecheck|run: yarn lint|" "$root/.github/actions/node-module/action.yml"'

check_break 'a mutable install is reported' \
  'runs yarn install --immutable' \
  'sed -i "s|yarn install --immutable|yarn install|" "$root/.github/actions/node-module/action.yml"'

check_break 'a module that does not run the shared pipeline is reported' \
  'rest\.yml runs the shared TypeScript pipeline' \
  'sed -i "s|uses: ./.github/actions/node-module|uses: actions/setup-node@v4|" "$root/.github/workflows/rest.yml"'

check_break 'an engine pipeline that never checks formatting is reported' \
  'runs uv run ruff format --check' \
  'sed -i "s|run: uv run ruff format --check .|run: uv run ruff check .|" "$root/.github/workflows/engine.yml"'

check_break 'an engine install that may refresh the lockfile is reported' \
  'runs uv sync --locked' \
  'sed -i "s|uv sync --locked|uv sync|" "$root/.github/workflows/engine.yml"'

check_break 'a database workflow that asserts nothing is reported' \
  'asserts the migration and data-tier contract' \
  'sed -i "s|run: scripts/verify-dev-env.sh|run: true|" "$root/.github/workflows/db.yml"'

# ---------------------------------------------------------------------------
# The database's live pass (#24)
# ---------------------------------------------------------------------------

# Each of these removes one step of the pass and asserts the run says which. A live pass
# that quietly stops running is the failure mode worth testing for: the job still reports
# green, and it is green about the half of the contract that a file read already covered.

printf '\nLive migration pass violations\n'

check_break 'a database workflow with no database is reported' \
  'starts a database to migrate' \
  'sed -i "/^    services:$/d" "$root/.github/workflows/db.yml"'

check_break 'a healthcheck that probes as the OS user is reported' \
  'names the role and database' \
  'sed -i "s|pg_isready -U ouroboros -d ouroboros|pg_isready|" "$root/.github/workflows/db.yml"'

check_break 'a pass that never applies the migrations is reported' \
  'migrates a clean database' \
  'sed -i "s|^        run: ouroboros-db/scripts/migrate$|        run: true|" "$root/.github/workflows/db.yml"'

check_break 'a pass that never validates what it applied is reported' \
  'validates what it applied' \
  'sed -i "s|^        run: ouroboros-db/scripts/validate$|        run: true|" "$root/.github/workflows/db.yml"'

# The behavioural half. Dropping it leaves a job that proves the migrations *apply* and
# says nothing about what the schema they leave behind refuses.
check_break 'a pass that never asserts the constraints is reported' \
  'asserts what the schema enforces' \
  'sed -i "s|/tests/constraints.sql|/tests/nothing.sql|" "$root/.github/workflows/db.yml"'

check_break 'a seeded leg migrated without the overlay is reported' \
  'dev-seed overlay' \
  'sed -i "s| --config flyway.seed.toml||" "$root/.github/workflows/db.yml"'

check_break 'a pass that never asserts the seed is reported' \
  'what the seed put there' \
  'sed -i "s|/tests/seed.sql|/tests/nothing.sql|" "$root/.github/workflows/db.yml"'

# The drift check (#710), both halves and the toolchain they need. Each is dropped on its
# own, because a job that runs one of the two is the failure worth naming: the applied
# check alone passes every day until an upgrade lands, and the snapshot check alone can be
# satisfied by a snapshot no database was ever compared against.
check_break 'a pass that never checks the applied schema against BetterAuth is reported' \
  'applied schema still satisfies BetterAuth' \
  'sed -i "/betterauth-schema.mjs --applied/d" "$root/.github/workflows/db.yml"'

check_break 'a pass that never checks the snapshot for drift is reported' \
  'snapshot still describes what BetterAuth expects' \
  'sed -i "/betterauth-schema.mjs --check/d" "$root/.github/workflows/db.yml"'

check_break 'a drift check with no workspace installed under it is reported' \
  'installs the workspace' \
  'sed -i "s|^        run: yarn install --immutable$|        run: true|" "$root/.github/workflows/db.yml"'

check_break 'a drift check with no auth configuration built for it is reported' \
  'builds the auth configuration' \
  'sed -i "s|^        run: yarn workspace ouroboros-rest build$|        run: true|" "$root/.github/workflows/db.yml"'

# The routing half of the same feature. A drift check that never runs when the library
# version moves is the one arrangement that reads as passing while proving nothing, so the
# filters that carry ouroboros-rest's two schema-deciding paths into ci/db are asserted
# the same way the steps are.
check_break 'a db workflow blind to the auth configuration is reported' \
  'runs db.yml rest.yml' \
  'sed -i "/ouroboros-rest\/src\/auth/d" "$root/.github/workflows/db.yml"'

check_break 'a db workflow blind to the manifest that pins better-auth is reported' \
  'runs db.yml rest.yml' \
  'sed -i "/ouroboros-rest\/package.json/d" "$root/.github/workflows/db.yml"'

# The pin, in all three places it has to agree. CI proving a PostgreSQL nobody develops
# against is worth less than the minute it costs.
check_break 'a service container drifting from the stack pin is reported' \
  'migrates the PostgreSQL the development stack pins' \
  'sed -i "s|^        image: postgres:17-alpine$|        image: postgres:16-alpine|" "$root/.github/workflows/db.yml"'

check_break 'an assertion client drifting from the stack pin is reported' \
  'from that same image' \
  'sed -i "s|POSTGRES_IMAGE=postgres:17-alpine|POSTGRES_IMAGE=postgres:16-alpine|" "$root/.github/workflows/db.yml"'

# The regression that produced this check: OURO_DB_* in job scope is the last word in
# run.sh'"'"'s precedence, so it silently redirects the tooling suite the same job runs two
# steps earlier — which exists to test that precedence — at this workflow.
check_break 'connection parameters declared job-wide are reported' \
  'out of the tooling tests' \
  'sed -i "s|^    steps:$|    env:\n      OURO_DB_HOST: localhost\n\n    steps:|" "$root/.github/workflows/db.yml"'

check_break 'a development stack that pins no PostgreSQL at all is reported' \
  'the compose stack pins a PostgreSQL version' \
  'sed -i "s|^    image: postgres:17-alpine$|    image: postgres|" "$root/docker-compose.yml"'

# ---------------------------------------------------------------------------
# The published images
# ---------------------------------------------------------------------------

# An image is its module in the form something other than a laptop runs, so the two things
# worth breaking are the order — nothing ships that ci/<module> has not proved — and the
# rule that a pull request builds it without a credential. Everything else about an image
# is scripts/verify-dev-env.sh'"'"'s subject, or its module'"'"'s own container test'"'"'s,
# and is broken in those suites.
#
# db.yml is the workflow most of these break, because it is the one with the longest-
# standing publish job; the cases that break another module are the ones that would pass
# against a check written for db.yml alone.

printf '\nPublished image violations\n'

check_break 'a module with no image to publish is reported' \
  'an image to publish' \
  'rm "$root/ouroboros-db/Dockerfile"'

check_break 'a workflow that publishes nothing is reported' \
  'db\.yml publishes it' \
  'sed -i "s|^  publish:$|  x-publish:|" "$root/.github/workflows/db.yml"'

# The same, one module over. Without it the loop could be checking db.yml four times.
check_break 'a TypeScript module that publishes nothing is reported' \
  'ui\.yml publishes it' \
  'sed -i "s|^  publish:$|  x-publish:|" "$root/.github/workflows/ui.yml"'

check_break 'an engine image published without waiting for ci/engine is reported' \
  'until ci/engine has passed' \
  'sed -i "/^    needs: ci$/d" "$root/.github/workflows/engine.yml"'

check_break 'a publish job under another name is reported' \
  'reports as publish/db' \
  'sed -i "s|^    name: publish/db$|    name: images|" "$root/.github/workflows/db.yml"'

# The one that matters most: without `needs: ci`, a tag moves for a schema whose
# migrations were never applied to anything.
check_break 'an image published without waiting for ci/db is reported' \
  'until ci/db has passed' \
  'sed -i "/^    needs: ci$/d" "$root/.github/workflows/db.yml"'

check_break 'a build of some other Dockerfile is reported' \
  'builds that Dockerfile' \
  'sed -i "s|file: ouroboros-db/Dockerfile|file: Dockerfile|" "$root/.github/workflows/db.yml"'

check_break 'a build context of the whole repository is reported' \
  'db\.yml builds it from ouroboros-db' \
  'sed -i "s|^          context: ouroboros-db$|          context: .|" "$root/.github/workflows/db.yml"'

# The mirror of it, and the reason the context is checked per module rather than pinned to
# the module directory for all four: ouroboros-rest is a Yarn workspace, so the root *is*
# its context and a module-directory build could not run an immutable install at all.
check_break 'a workspace image built from its own directory is reported' \
  'rest\.yml builds it from \.' \
  'sed -i "s|^          context: \.$|          context: ouroboros-rest|" "$root/.github/workflows/rest.yml"'

# A fork'"'"'s pull request carries no secrets, so a credentialed step that runs on one
# cannot succeed — and on any pull request it would move a tag nobody has merged.
check_break 'a push that is not held back on a pull request is reported' \
  'stop on a pull request' \
  'sed -i "/^      - name: Push the image$/{n;/if:/d;}" "$root/.github/workflows/db.yml"'

check_break 'a login that is not held back on a pull request is reported' \
  'stop on a pull request' \
  'sed -i "/^      - name: Log in to registry$/{n;/if:/d;}" "$root/.github/workflows/db.yml"'

# The other half of that rule: the build itself must *not* be gated, or a broken
# Dockerfile is a merge failure instead of a pull request failure.
check_break 'an image never built on a pull request is reported' \
  'on a pull request too' \
  'sed -i "s|^          push: false$|          push: true|" "$root/.github/workflows/db.yml"'

check_break 'an image published without an immutable tag is reported' \
  'cannot move' \
  'sed -i "/ouroboros-db:\${{ github.sha }}/d" "$root/.github/workflows/db.yml"'

check_break 'an image tagged for a registry written into the workflow is reported' \
  'not written into db\.yml' \
  'sed -i "s|\${{ secrets.DOCKER_HOSTNAME }}/ouroboros-db:latest|registry.example.com/ouroboros-db:latest|" "$root/.github/workflows/db.yml"'

check_break 'a login to a registry written into the workflow is reported' \
  'logs in to comes from a secret' \
  'sed -i "s|^          registry: .*$|          registry: registry.example.com|" "$root/.github/workflows/db.yml"'

# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------

printf '\nDocumentation violations\n'

check_break 'a status check the conventions never mention is reported' \
  'documents the ci/engine check' \
  'sed -i "/ci\/engine/d" "$root/docs/CONVENTIONS.md"'

check_break 'a README that never names the checks is reported' \
  'README\.md names the status checks' \
  'sed -i "s|ci/ui|the UI check|" "$root/README.md"'

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
