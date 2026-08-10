#!/usr/bin/env sh
#
# verify-ci.sh — assert the per-module CI contract established by issue #11.
#
# Checks that every application module has a workflow; that each one reports under the
# agreed status-check name (`ci/ui`, `ci/rest`, `ci/engine`, `ci/db`); that the path
# filters route a change to exactly the workflows that can be affected by it and to no
# others; that the Node and Python versions are pinned in one place rather than per
# workflow; that a module whose scaffold has not landed yet is skipped deliberately
# instead of failing; and that each pipeline runs the verbs docs/CONVENTIONS.md § 3
# promises for its toolchain.
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
check_route ouroboros-db/migrations/V001__tenants.sql 'db.yml'
check_route ouroboros-web/app/page.tsx 'docker-publish.yml'

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
check_route docker-compose.yml 'db.yml'
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
# Documentation
# ---------------------------------------------------------------------------

printf '\nDocumentation\n'
for module in $MODULES; do
  check_contains docs/CONVENTIONS.md "ci/$module" "docs/CONVENTIONS.md documents the ci/$module check"
done
check_contains README.md 'ci/ui' 'README.md names the status checks a pull request runs'

check_summary
