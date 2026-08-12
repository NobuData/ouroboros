#!/usr/bin/env sh
#
# verify-workspace.test.sh — integration tests for scripts/verify-workspace.sh.
#
# The script is run against synthetic repository trees rather than this checkout, so the
# tests pin the contract independently of the files that currently satisfy it: the
# fixture is a minimal workspace that passes every check, and each case copies it, breaks
# exactly one thing, and asserts that the matching check — and the run — fails.
#
# Nothing is installed and no task is run, because the script under test starts nothing.
#
# Usage:
#   scripts/tests/verify-workspace.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
VERIFY="$SCRIPTS_DIR/verify-workspace.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# make_fixture DIR — write a workspace that satisfies every check.
#
# Four modules, of which one (rest) is deliberately unscaffolded, mirroring this
# repository: the roster names it, the gate finds no package.json, and that is a pass
# rather than a failure. ouroboros-web and tests/e2e sit beside them, each with its own
# lockfile — the two directories the decision deliberately keeps out of the roster.
make_fixture() {
  fixture=$1
  mkdir -p "$fixture/docs" "$fixture/scripts" "$fixture/ouroboros-web" "$fixture/tests/e2e"
  for module in ouroboros-db ouroboros-engine ouroboros-rest ouroboros-ui; do
    mkdir -p "$fixture/$module"
  done

  cat > "$fixture/package.json" <<'JSON'
{
  "name": "ouroboros",
  "private": true,
  "packageManager": "yarn@4.18.0",
  "workspaces": ["ouroboros-db", "ouroboros-engine", "ouroboros-rest", "ouroboros-ui"],
  "scripts": {
    "dev": "turbo run dev",
    "dev:web": "cd ouroboros-web && yarn dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "e2e": "cd tests/e2e && scripts/run.sh"
  },
  "devDependencies": { "turbo": "2.10.9" }
}
JSON

  # Comments included on purpose: the fixture is JSONC because the real file is, and the
  # script has to read past them.
  cat > "$fixture/turbo.json" <<'JSON'
{
  "$schema": "https://turborepo.com/schema.json",

  // The graph over the modules.
  "globalDependencies": [".env", ".env.example"],
  "globalEnv": ["NODE_ENV", "OURO_*"],

  "tasks": {
    "dev": { "dependsOn": ["ouroboros-db#dev"], "cache": false, "persistent": true },
    "ouroboros-db#dev": { "cache": false, "persistent": false },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "lint": {},
    "typecheck": {},
    "test": { "dependsOn": ["^build"] },
    "ouroboros-db#test": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/scripts/**"]
    }
  }
}
JSON

  printf '# lockfile\n' > "$fixture/yarn.lock"
  printf 'nodeLinker: node-modules\n' > "$fixture/.yarnrc.yml"
  printf '.turbo/\nnode_modules/\n' > "$fixture/.gitignore"

  cat > "$fixture/ouroboros-db/package.json" <<'JSON'
{
  "name": "ouroboros-db",
  "private": true,
  "scripts": { "dev": "./run.sh", "test": "cd .. && scripts/run-tests.sh ouroboros-db/tests" }
}
JSON
  cat > "$fixture/ouroboros-engine/package.json" <<'JSON'
{
  "name": "ouroboros-engine",
  "private": true,
  "scripts": { "dev": "uv run dev", "lint": "uv run ruff check .", "test": "uv run pytest" }
}
JSON
  cat > "$fixture/ouroboros-ui/package.json" <<'JSON'
{
  "name": "ouroboros-ui",
  "version": "0.4.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
JSON

  printf '# marketing site lockfile\n' > "$fixture/ouroboros-web/yarn.lock"
  printf 'nodeLinker: node-modules\n' > "$fixture/ouroboros-web/.yarnrc.yml"

  printf '# e2e suite lockfile\n' > "$fixture/tests/e2e/yarn.lock"
  printf 'nodeLinker: node-modules\n' > "$fixture/tests/e2e/.yarnrc.yml"

  # The decision document, with the sections and the two inbound links the script asks
  # for. Its own links have to resolve, so it references only files the fixture has.
  cat > "$fixture/docs/DECISION_WORKSPACE_TOOLING.md" <<'MARKDOWN'
# Decision — the workspace runner

> Issue: https://github.com/NobuData/ouroboros/issues/13

Turborepo over Yarn workspaces; Nx was considered and not adopted.

## The options

Status quo, Turborepo, Nx.

## The decision

Turborepo, see [`CONVENTIONS.md`](CONVENTIONS.md).

## When to revisit

More JavaScript packages than this.
MARKDOWN

  printf 'See [the decision](docs/DECISION_WORKSPACE_TOOLING.md).\n' > "$fixture/README.md"
  printf 'See [the decision](DECISION_WORKSPACE_TOOLING.md).\n' > "$fixture/docs/CONVENTIONS.md"
}

# run_verify DIR — run the script against DIR, leaving its output in $out and its exit
# status in $status.
run_verify() {
  out=$("$VERIFY" --root "$1" 2>&1)
  status=$?
}

# check_broken DESCRIPTION PATTERN MUTATE — copy the fixture, apply MUTATE (a shell
# command taking the tree as $1), and assert the run fails with a failure line matching
# PATTERN.
#
# Both halves are asserted, not just the exit status: a script that fails for a different
# reason than the one under test passes an exit-status-only assertion while proving
# nothing about the check it was meant to exercise.
check_broken() {
  broken_description=$1
  broken_pattern=$2
  broken_mutate=$3

  broken_dir="$work/case"
  rm -rf "$broken_dir"
  cp -R "$work/fixture" "$broken_dir"
  ( cd "$broken_dir" && eval "$broken_mutate" ) || {
    fail "$broken_description (the mutation itself failed)"
    return
  }

  run_verify "$broken_dir"
  # The pattern matches anywhere in the failure line: a check's description opens with
  # the file or task it is about, and a case is named for the rule it breaks, not for the
  # whole sentence the script prints.
  if [ "$status" -ne 0 ] && printf '%s\n' "$out" | grep -Eq "^  FAIL .*$broken_pattern"; then
    pass "$broken_description"
  else
    fail "$broken_description (status $status; failures: $(printf '%s\n' "$out" | grep -c '^  FAIL' || true))"
  fi
}

printf '\nverify-workspace.sh\n\n'

make_fixture "$work/fixture"

# ---------------------------------------------------------------------------
# The fixture passes
# ---------------------------------------------------------------------------

printf 'A correct workspace\n'
run_verify "$work/fixture"
check_equals 0 "$status" 'a workspace matching the decision passes'
check_matches "$out" 'checks, 0 failed' 'it reports no failures'
check_matches "$out" 'ouroboros-rest is not scaffolded yet' \
  'an unscaffolded module is a pass, not a failure'
check_matches "$out" 'ouroboros-db#test declares the files it reads above its package' \
  'the cache boundary is checked, not assumed'

# ---------------------------------------------------------------------------
# The decision document
# ---------------------------------------------------------------------------

printf '\nThe decision document\n'
check_broken 'a missing decision document fails' \
  'docs/DECISION_WORKSPACE_TOOLING.md exists' \
  'rm docs/DECISION_WORKSPACE_TOOLING.md'
check_broken 'a document that weighs no options fails' \
  'weighs the options' \
  "sed -i 's/^## The options/## Notes/' docs/DECISION_WORKSPACE_TOOLING.md"
check_broken 'a document with no revisit condition fails' \
  'says what would reopen it' \
  "sed -i 's/^## When to revisit/## Postscript/' docs/DECISION_WORKSPACE_TOOLING.md"
check_broken 'a document that never names the alternative fails' \
  'names Nx' \
  "sed -i 's/Nx/an alternative/g' docs/DECISION_WORKSPACE_TOOLING.md"
check_broken 'a document with a broken link fails' \
  'the link to CONVENTIONS.md resolves' \
  'rm docs/CONVENTIONS.md'
check_broken 'a decision the README does not link fails' \
  'README.md links the decision' \
  'printf "no link here\\n" > README.md'

printf '\nThe runner that was not adopted\n'
check_broken 'Nx configuration left at the root fails' \
  'no Nx workspace configuration' \
  'printf "{}\\n" > nx.json'
check_broken 'Nx configuration inside a module fails' \
  'no Nx project configuration in ouroboros-ui' \
  'printf "{}\\n" > ouroboros-ui/project.json'

# ---------------------------------------------------------------------------
# The workspace
# ---------------------------------------------------------------------------

printf '\nThe roster\n'
check_broken 'a module missing from the roster fails' \
  'the workspaces are the four application modules' \
  "sed -i 's/\"ouroboros-engine\", //' package.json"
check_broken 'the marketing site joining the roster fails' \
  'ouroboros-web is not a workspace' \
  "sed -i 's/\"ouroboros-ui\"/\"ouroboros-ui\", \"ouroboros-web\"/' package.json"
# The one that would put a Docker daemon on the critical path of `yarn test` (#56).
check_broken 'the e2e suite joining the roster fails' \
  'tests/e2e is not a workspace' \
  "sed -i 's|\"ouroboros-ui\"|\"ouroboros-ui\", \"tests/e2e\"|' package.json"
check_broken 'a workspace root that is publishable fails' \
  'the workspace root is private' \
  "sed -i 's/\"private\": true/\"private\": false/' package.json"
check_broken 'a floating package manager fails' \
  'the package manager is pinned to an exact version' \
  "sed -i 's/yarn@4.18.0/yarn@4.x/' package.json"
check_broken 'a floating runner fails' \
  'the workspace runner is pinned to an exact version' \
  "sed -i 's/\"turbo\": \"2.10.9\"/\"turbo\": \"^2.10.9\"/' package.json"

printf '\nOne resolution\n'
check_broken 'a second lockfile inside a workspace fails' \
  'ouroboros-ui resolves from the root lockfile' \
  'printf "# stray\\n" > ouroboros-ui/yarn.lock'
check_broken 'a workspace with its own Yarn configuration fails' \
  'ouroboros-ui takes the root Yarn configuration' \
  'printf "nodeLinker: pnp\\n" > ouroboros-ui/.yarnrc.yml'
check_broken 'a workspace named for something other than its directory fails' \
  'ouroboros-ui is named for its directory' \
  "sed -i 's/\"ouroboros-ui\"/\"@ouroboros\\/ui\"/' ouroboros-ui/package.json"
check_broken 'the marketing site losing its own lockfile fails' \
  'ouroboros-web keeps its own lockfile' \
  'rm ouroboros-web/yarn.lock'
check_broken 'the e2e suite losing its own lockfile fails' \
  'tests/e2e keeps its own lockfile' \
  'rm tests/e2e/yarn.lock'
check_broken 'the e2e suite with no root verb fails' \
  'tests/e2e has its own root verb' \
  "sed -i 's|cd tests/e2e && scripts/run.sh|echo nothing|' package.json"

# ---------------------------------------------------------------------------
# The task graph
# ---------------------------------------------------------------------------

printf '\nThe task graph\n'
check_broken 'a verb that does not reach the graph fails' \
  'yarn lint delegates to the graph' \
  "sed -i 's|\"lint\": \"turbo run lint\"|\"lint\": \"cd ouroboros-ui \&\& yarn lint\"|' package.json"
check_broken 'a verb with no task behind it fails' \
  'the graph declares typecheck' \
  "sed -i 's/\"typecheck\": {},//' turbo.json"
check_broken 'a task no verb reaches fails' \
  'the openapi task is reachable from a root verb' \
  "sed -i 's/\"lint\": {},/\"lint\": {}, \"openapi\": {},/' turbo.json"
check_broken 'a workspace that implements nothing fails' \
  'ouroboros-engine implements at least one graph verb' \
  "sed -i 's/\"dev\": \"uv run dev\", \"lint\": \"uv run ruff check .\", \"test\": \"uv run pytest\"/\"openapi\": \"uv run openapi\"/' ouroboros-engine/package.json"

printf '\nCache correctness\n'
check_broken 'a cached dev task fails' \
  'dev is never cached' \
  "sed -i 's/\"dev\": { \"dependsOn\": \[\"ouroboros-db#dev\"\], \"cache\": false/\"dev\": { \"dependsOn\": [\"ouroboros-db#dev\"], \"cache\": true/' turbo.json"
check_broken 'a persistent data tier fails' \
  'the data tier exits, so the services can depend on it' \
  "sed -i 's/\"ouroboros-db#dev\": { \"cache\": false, \"persistent\": false }/\"ouroboros-db#dev\": { \"cache\": false, \"persistent\": true }/' turbo.json"
check_broken 'an environment template outside the cache key fails' \
  'a change to .env.example invalidates the cache' \
  "sed -i 's/\\[\".env\", \".env.example\"\\]/[\".env\"]/' turbo.json"
check_broken 'a withheld OURO_* namespace fails' \
  'the OURO_\* namespace reaches the tasks' \
  "sed -i 's/\"globalEnv\": \[\"NODE_ENV\", \"OURO_\\*\"\]/\"globalEnv\": [\"NODE_ENV\"]/' turbo.json"

# ---------------------------------------------------------------------------
# The cache boundary — the check this script exists for
# ---------------------------------------------------------------------------

printf '\nCache boundaries\n'
check_broken 'a task reading above its package with no boundary declared fails' \
  'ouroboros-db#test declares the files it reads above its package' \
  "sed -i 's|\"inputs\": \[\"\$TURBO_DEFAULT\$\", \"\$TURBO_ROOT\$/scripts/\*\*\"\]|\"inputs\": [\"src/**\"]|' turbo.json"
check_broken 'a boundary that drops the package own files fails' \
  'ouroboros-db#test keeps its own files in its hash' \
  "sed -i 's|\"\$TURBO_DEFAULT\$\", ||' turbo.json"
check_broken 'a task reading above its package with no entry at all fails' \
  'no ouroboros-db#test task in turbo.json' \
  "sed -i '/\"ouroboros-db#test\": {/,/}/d' turbo.json"
# A new module that reaches out of its directory has to declare it too — the rule is not
# a special case for ouroboros-db.
check_broken 'a newly reaching script with no boundary fails' \
  'ouroboros-ui#test declares the files it reads above its package' \
  "sed -i 's|\"test\": \"vitest run\"|\"test\": \"vitest run \&\& cd ../ouroboros-rest \&\& yarn check\"|' ouroboros-ui/package.json"
# Not caching it at all is the other correct answer, and must not be reported as a break.
run_verify_uncached() {
  rm -rf "$work/uncached"
  cp -R "$work/fixture" "$work/uncached"
  sed -i 's|"inputs": \["$TURBO_DEFAULT$", "$TURBO_ROOT$/scripts/\*\*"\]|"cache": false|' "$work/uncached/turbo.json"
  run_verify "$work/uncached"
}
run_verify_uncached
check_equals 0 "$status" 'a task that is never cached needs no boundary'
check_matches "$out" 'ouroboros-db#test is never cached' 'and is reported as such'

# ---------------------------------------------------------------------------
# Artefacts
# ---------------------------------------------------------------------------

printf '\nArtefacts\n'
check_broken 'a committed cache directory fails' \
  'the local cache is ignored' \
  'printf "node_modules/\\n" > .gitignore'

# ---------------------------------------------------------------------------
# Invocation
# ---------------------------------------------------------------------------

printf '\nInvocation\n'
check_run 'the script explains itself with --help' sh -c "'$VERIFY' --help"
if "$VERIFY" --nonsense >/dev/null 2>&1; then
  fail 'an unknown argument is refused'
else
  pass 'an unknown argument is refused'
fi

check_summary
