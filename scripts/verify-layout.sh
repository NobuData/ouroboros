#!/usr/bin/env sh
#
# verify-layout.sh — assert the monorepo layout matches the documented conventions.
#
# Checks the structural contract established by issue #8: that every application module
# has a home and a README covering purpose, stack and run instructions; that the root
# README maps the modules and points at the architecture doc; and that .editorconfig
# covers all five languages in the repo.
#
# Deliberately dependency-free POSIX shell so it runs identically on a developer's
# machine, in a container, and in CI (#11) without an install step.
#
# Usage:
#   scripts/verify-layout.sh          # run from anywhere; resolves the repo root itself
#
# Exit status:
#   0  every check passed
#   1  at least one check failed (each failure is printed with its reason)
#
# Note: the "ouroboros-web untouched" criterion of #8 is a property of a diff, not of a
# checkout, so it is verified at review time rather than here.

set -eu

# Repo root = parent of the directory holding this script.
# CDPATH is cleared so `cd` cannot resolve to an unrelated directory.
unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
cd "$ROOT"

# The four application modules created by #8. ouroboros-web is intentionally excluded:
# it is the marketing site and predates these conventions.
MODULES="ouroboros-ui ouroboros-rest ouroboros-engine ouroboros-db"

failures=0
checks=0

# pass MESSAGE — record a satisfied check.
pass() {
  checks=$((checks + 1))
  printf '  ok    %s\n' "$1"
}

# fail MESSAGE — record a violated check and mark the run as failed.
fail() {
  checks=$((checks + 1))
  failures=$((failures + 1))
  printf '  FAIL  %s\n' "$1"
}

# check_exists PATH DESCRIPTION — assert a file or directory exists.
check_exists() {
  if [ -e "$1" ]; then
    pass "$2"
  else
    fail "$2 (missing: $1)"
  fi
}

# check_contains FILE PATTERN DESCRIPTION — assert FILE matches an extended regex.
check_contains() {
  if [ -f "$1" ] && grep -Eq -- "$2" "$1"; then
    pass "$3"
  else
    fail "$3 (no match for /$2/ in $1)"
  fi
}

printf '\nRepository layout — %s\n\n' "$ROOT"

printf 'Root files\n'
check_exists README.md 'root README.md exists'
check_exists .editorconfig 'root .editorconfig exists'
check_exists .gitignore 'root .gitignore exists'
check_exists docs/CONVENTIONS.md 'docs/CONVENTIONS.md exists'

printf '\nModule directories\n'
for module in $MODULES; do
  check_exists "$module" "$module/ exists"
  check_exists "$module/README.md" "$module/README.md exists"

  # Acceptance criterion: each README states purpose, stack, and run instructions.
  check_contains "$module/README.md" '^## Purpose' "$module README documents purpose"
  check_contains "$module/README.md" '^## Stack' "$module README documents the stack"
  check_contains "$module/README.md" '^## Run' "$module README documents how to run it"
done

printf '\nRoot README module map\n'
for module in $MODULES ouroboros-web; do
  check_contains README.md "\\($module\\)" "root README links $module/"
done
check_contains README.md '\(docs/ARCHITECTURE\.md\)' 'root README links docs/ARCHITECTURE.md'
check_contains README.md '\(docs/CONVENTIONS\.md\)' 'root README links docs/CONVENTIONS.md'

printf '\n.editorconfig language coverage\n'
check_contains .editorconfig '^root = true' '.editorconfig is the top-level config'
# One section per language named in the acceptance criteria: TS, Python, SQL, MD, YAML.
check_contains .editorconfig '^\[\*\.\{?ts' '.editorconfig covers TypeScript'
check_contains .editorconfig '^\[\*\.\{?py' '.editorconfig covers Python'
check_contains .editorconfig '^\[\*\.sql\]' '.editorconfig covers SQL'
check_contains .editorconfig '^\[\*\.\{?md' '.editorconfig covers Markdown'
check_contains .editorconfig '^\[\*\.\{?yml' '.editorconfig covers YAML'

printf '\n%s checks, %s failed\n\n' "$checks" "$failures"

[ "$failures" -eq 0 ]
