#!/usr/bin/env sh
#
# verify-workspace.sh — assert the workspace-runner decision taken in issue #13.
#
# docs/DECISION_WORKSPACE_TOOLING.md is the write-up that issue asked for: Turborepo over
# Yarn 4 workspaces, with three limits on it and one cache boundary that is not obvious.
# A decision doc goes stale the moment the repository stops matching it, so this asserts
# the parts of it a checkout can prove — that the roster of workspaces is the one the
# document names, that ouroboros-web is still outside it, that every repo-level verb
# reaches the graph, that nothing long-running or Docker-facing is cached, and that a
# task whose command reads files above its own package says so in its inputs.
#
# The last of those is the one worth having. `ouroboros-db#test` runs the repo-root
# scripts/run-tests.sh; a task's hash covers its own package, so without an explicit
# input the runner and the assertion harness can both change under a cached pass and the
# cached pass is replayed anyway — a green that proves nothing. The rule generalises:
# any script that reaches above its package needs the boundary declared, and this finds
# the ones that do not.
#
# turbo.json is JSON with comments, and its comments name the same keys the checks below
# look for, so the file is read through scripts/lib/parse-json.awk rather than grepped —
# a paragraph about a setting must never be able to satisfy a check about it.
#
# It reads files and runs nothing: no install, no turbo, no Docker, no network.
#
# Deliberately dependency-free POSIX shell, matching the repo's other verify-* scripts.
#
# Usage:
#   scripts/verify-workspace.sh              # run from anywhere; resolves the repo root
#   scripts/verify-workspace.sh --root DIR   # check DIR instead (used by the tests)
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
      [ $# -ge 2 ] || { printf 'verify-workspace: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$2" && pwd)
      shift 2
      ;;
    -h | --help)
      sed -n '2,34p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'verify-workspace: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# The assertion harness, shared with the repo's other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

PARSER="$SCRIPT_DIR/lib/parse-json.awk"
DECISION=docs/DECISION_WORKSPACE_TOOLING.md

# The four application modules, in the order the workspaces array has to list them.
# ouroboros-web is deliberately not among them — that is limit 1 of the decision.
MODULES="ouroboros-db ouroboros-engine ouroboros-rest ouroboros-ui"

# The repo-level verbs. Each is a script at the root that delegates to a task of the same
# name in the graph, which is the whole of what the root owns.
VERBS="dev build lint typecheck test"

TAB=$(printf '\t')

# json_value FILE SCOPE KEY — print the value parse-json.awk records for SCOPE/KEY, or
# nothing when the file, the key or the parse is missing. Absence is reported by the
# check that wanted the value, so this stays quiet.
json_value() {
  [ -f "$1" ] || return 0
  awk -f "$PARSER" "$1" 2>/dev/null |
    awk -F"$TAB" -v scope="$2" -v key="$3" \
      '$1 == scope && $2 == key { sub(/^[^\t]*\t[^\t]*\t/, ""); print; exit }' || true
}

# json_keys FILE SCOPE — print the keys recorded under SCOPE, one per line, in document
# order.
json_keys() {
  [ -f "$1" ] || return 0
  awk -f "$PARSER" "$1" 2>/dev/null |
    awk -F"$TAB" -v scope="$2" '$1 == scope { print $2 }' || true
}

# json_strings VALUE — print the string literals of a JSON array value, one per line.
json_strings() {
  printf '%s\n' "$1" | grep -oE '"[^"]*"' | sed 's/^"//; s/"$//' || true
}

printf '\nWorkspace & task graph — %s\n\n' "$ROOT"

# ---------------------------------------------------------------------------
# The decision document
# ---------------------------------------------------------------------------

printf 'Decision document\n'
check_exists "$DECISION" "$DECISION exists"
# The sections issue #13 asked for: the options weighed, the decision, and what would
# reopen it. A write-up missing any of the three is a note, not a decision.
check_contains "$DECISION" '^## The options' "$DECISION weighs the options"
check_contains "$DECISION" '^## The decision' "$DECISION states the decision"
check_contains "$DECISION" '^## When to revisit' "$DECISION says what would reopen it"
check_contains "$DECISION" 'issues/13' "$DECISION cites the issue it answers"
# Both alternatives have to appear by name, or the "evaluation" considered one candidate.
check_contains "$DECISION" 'Turborepo' "$DECISION names Turborepo"
check_contains "$DECISION" 'Nx' "$DECISION names Nx"
check_markdown_links "$DECISION"

# A decision nobody can find is one the next contributor re-takes.
check_contains README.md 'docs/DECISION_WORKSPACE_TOOLING\.md' 'README.md links the decision'
check_contains docs/CONVENTIONS.md 'DECISION_WORKSPACE_TOOLING\.md' 'docs/CONVENTIONS.md links the decision'

# The runner that was not adopted leaves configuration behind when it is. Its absence is
# how a checkout shows the decision is still in force.
check_missing nx.json 'no Nx workspace configuration'
for module in $MODULES; do
  check_missing "$module/project.json" "no Nx project configuration in $module"
done

# ---------------------------------------------------------------------------
# The workspace
# ---------------------------------------------------------------------------

printf '\nWorkspace roster\n'
check_exists package.json 'the workspace root package.json exists'
check_run 'the workspace root package.json parses' \
  sh -c "awk -f '$PARSER' package.json"
check_exists yarn.lock 'one lockfile at the root, for every workspace'
check_exists .yarnrc.yml 'one Yarn configuration at the root'

# Exactly the four application modules, in exactly that order: a roster that has drifted
# from the document is the failure this whole script exists to catch.
workspaces=$(json_strings "$(json_value package.json root workspaces)" | tr '\n' ' ' | sed 's/ *$//')
check_equals "$MODULES" "$workspaces" 'the workspaces are the four application modules'

# Private, because the root owns no source and must never be published by an absent-minded
# `yarn npm publish`.
check_equals 'true' "$(json_value package.json root private)" 'the workspace root is private'

# Both the package manager and the runner are pinned to an exact version. A range here is
# a different build on a different machine — and a cache whose hits mean less than they
# claim to, since the tool that produced them is not the one replaying them.
check_matches "$(json_value package.json root packageManager)" \
  '^"yarn@[0-9]+\.[0-9]+\.[0-9]+"$' 'the package manager is pinned to an exact version'
check_matches "$(json_value package.json devDependencies turbo)" \
  '^"[0-9]+\.[0-9]+\.[0-9]+"$' 'the workspace runner is pinned to an exact version'

printf '\nWorkspace members\n'
for module in $MODULES; do
  if [ -f "$module/package.json" ]; then
    # A workspace whose name differs from its directory is one that `turbo run --filter`
    # and every error message name differently from the path a developer types.
    check_equals "\"$module\"" "$(json_value "$module/package.json" root name)" \
      "$module is named for its directory"
    # There is exactly one Yarn project here, so there is exactly one lockfile (§ 2).
    check_missing "$module/yarn.lock" "$module resolves from the root lockfile"
    check_missing "$module/.yarnrc.yml" "$module takes the root Yarn configuration"
  else
    # A module that is still a README has nothing to check and is not a failure — the
    # same rule the CI scaffold gate applies. It is listed as a workspace already so the
    # pull request that adds its package.json needs no edit here either.
    pass "$module is not scaffolded yet — nothing to resolve"
  fi
done

printf '\nouroboros-web stays outside\n'
# Limit 1 of the decision: the marketing site is not a workspace. It is checked from the
# outside in — absent from the roster, and still carrying the two files that make it
# self-contained.
if printf '%s\n' "$workspaces" | grep -qw 'ouroboros-web'; then
  fail 'ouroboros-web is not a workspace (it is listed in the roster)'
else
  pass 'ouroboros-web is not a workspace'
fi
check_exists ouroboros-web/yarn.lock 'ouroboros-web keeps its own lockfile'
check_exists ouroboros-web/.yarnrc.yml 'ouroboros-web keeps its own Yarn configuration'
# `yarn dev` must not start it: it wants the same port 3000 the product UI does.
check_matches "$(json_value package.json scripts 'dev:web')" 'ouroboros-web' \
  'ouroboros-web has its own start verb'

# ---------------------------------------------------------------------------
# The task graph
# ---------------------------------------------------------------------------

printf '\nTask graph\n'
check_exists turbo.json 'turbo.json exists'
check_run 'turbo.json parses once its comments are removed' \
  sh -c "awk -f '$PARSER' turbo.json"

tasks=$(json_keys turbo.json tasks)

for verb in $VERBS; do
  # The root verb and the graph task are two halves of one thing: a script that runs a
  # task nobody declared, or a task no verb reaches, is a verb that silently does nothing.
  check_equals "\"turbo run $verb\"" "$(json_value package.json scripts "$verb")" \
    "yarn $verb delegates to the graph"
  if printf '%s\n' "$tasks" | grep -qx "$verb"; then
    pass "the graph declares $verb"
  else
    fail "the graph declares $verb (no $verb task in turbo.json)"
  fi
done

# The reverse direction: a generic task with no verb behind it is unreachable from the
# root and is either dead or a missing script. Package-specific tasks (`module#task`) are
# refinements of a generic one and are checked with it.
for task in $tasks; do
  case $task in
    *'#'*) continue ;;
  esac
  case " $VERBS " in
    *" $task "*) pass "the $task task is reachable from yarn $task" ;;
    *) fail "the $task task is reachable from a root verb (no yarn $task script)" ;;
  esac
done

# Every module the graph can reach has to implement something, or it is in the roster for
# nothing — `turbo run test` would report a module that never ran as a module with
# nothing to run.
for module in $MODULES; do
  [ -f "$module/package.json" ] || continue
  implemented=''
  for verb in $VERBS; do
    if json_keys "$module/package.json" scripts | grep -qx "$verb"; then
      implemented="$implemented $verb"
    fi
  done
  if [ -n "$implemented" ]; then
    pass "$module implements$implemented"
  else
    fail "$module implements at least one graph verb (its package.json declares none)"
  fi
done

printf '\nCache correctness\n'
# Nothing that talks to Docker or never exits may be cached: `dev` brings up containers
# and streams logs, and a replayed log is not a running stack.
for task in dev ouroboros-db#dev; do
  value=$(json_value turbo.json tasks "$task")
  check_matches "$value" '"cache": *false' "$task is never cached"
done
check_matches "$(json_value turbo.json tasks dev)" '"persistent": *true' \
  'dev is persistent, so turbo keeps the stack up'
# turbo refuses to let a task depend on one that never finishes, so the data tier — which
# the services depend on — has to be declared as the one dev task that exits.
check_matches "$(json_value turbo.json tasks 'ouroboros-db#dev')" '"persistent": *false' \
  'the data tier exits, so the services can depend on it'

# The environment a cached task ran under is part of what makes the hit honest.
global_deps=$(json_value turbo.json root globalDependencies)
for dependency in .env .env.example; do
  check_matches "$global_deps" "\"$dependency\"" "a change to $dependency invalidates the cache"
done
# docs/CONVENTIONS.md § 4 guarantees the prefix, so the namespace is declared once rather
# than variable by variable. Without it, strict mode does not merely ignore a setting —
# it withholds it from the task.
check_matches "$(json_value turbo.json root globalEnv)" '"OURO_\*"' \
  'the OURO_* namespace reaches the tasks'

printf '\nCache boundaries\n'
# The rule: a script that reads files above its own package must declare that in its
# task inputs, because the hash covers the package and nothing else. `cd ..` and `../`
# are the two ways a script in this repository leaves its directory.
for module in $MODULES; do
  [ -f "$module/package.json" ] || continue
  for verb in $VERBS; do
    command=$(json_value "$module/package.json" scripts "$verb")
    [ -n "$command" ] || continue
    case $command in
      *'cd ..'* | *'../'*) ;;
      *) continue ;;
    esac

    task=$(json_value turbo.json tasks "$module#$verb")
    if [ -z "$task" ]; then
      fail "$module#$verb declares the files it reads above its package (no $module#$verb task in turbo.json)"
      continue
    fi
    if printf '%s\n' "$task" | grep -q '"cache": *false'; then
      # Not cached at all is also a correct answer: nothing is replayed, so nothing is
      # replayed staly.
      pass "$module#$verb is never cached, so its inputs cannot go stale"
      continue
    fi
    check_matches "$task" 'TURBO_ROOT' \
      "$module#$verb declares the files it reads above its package"
    # inputs replaces the default set rather than adding to it, so a package-specific
    # entry that forgets $TURBO_DEFAULT$ drops the module's own files out of its hash —
    # trading one stale green for a worse one.
    check_matches "$task" 'TURBO_DEFAULT' \
      "$module#$verb keeps its own files in its hash"
  done
done

# ---------------------------------------------------------------------------
# Artefacts
# ---------------------------------------------------------------------------

printf '\nArtefacts\n'
# The cache is a build artefact of this checkout and is nobody else's business.
check_contains .gitignore '^\.turbo/' 'the local cache is ignored'

check_summary
