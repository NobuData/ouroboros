#!/usr/bin/env sh
#
# verify-layout.sh — assert the monorepo layout matches the documented conventions.
#
# Checks the structural contract established by issue #8 (extended to ouroboros-docs by
# #1164): that every application module has a home and a README covering purpose, stack
# and run instructions; that the root README maps the modules and points at the
# architecture doc; and that .editorconfig covers all five languages in the repo.
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

# The application modules created by #8, plus ouroboros-runner, which joined the layout
# with the build farm (#243) and answers to the same structural contract: a README with
# purpose, stack and run instructions, and a row in the root README's module map.
#
# ouroboros-docs, the documentation site (#1164), postdates them and is held to the whole of
# CONVENTIONS.md § 2 from its first commit — see the extra checks below.
#
# ouroboros-web is intentionally excluded: it is the marketing site and predates these
# conventions.
MODULES="ouroboros-ui ouroboros-rest ouroboros-engine ouroboros-db ouroboros-runner ouroboros-docs"

# The assertion harness (pass/fail/check_*/check_summary) is shared with the repo's
# other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

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

printf '\nouroboros-docs\n'
# The documentation site is the first module scaffolded after the README structure was
# written down, so it carries all six sections rather than the three the older modules are
# checked for, and the module-local files § 2 requires of a directory that can be lifted out
# of the repository — the Dockerfile (#1206) among them, which builds from the module alone.
for section in Configuration Layout 'Related issues'; do
  check_contains ouroboros-docs/README.md "^## $section" "ouroboros-docs README documents $section"
done
check_exists ouroboros-docs/.gitignore 'ouroboros-docs/.gitignore exists'
check_exists ouroboros-docs/.dockerignore 'ouroboros-docs/.dockerignore exists'
check_exists ouroboros-docs/Dockerfile 'ouroboros-docs/Dockerfile exists'
check_exists ouroboros-docs/nginx.conf 'ouroboros-docs/nginx.conf exists'
# A user-visible change updates the site in the same pull request (#1209): the rule is in
# AGENTS.md and CONVENTIONS.md § 11, and the /implement skill carries the steps.
check_contains AGENTS.md 'User-visible changes must update `ouroboros-docs`' \
  'AGENTS.md requires user-visible changes to update ouroboros-docs'
check_contains docs/CONVENTIONS.md '^## 11\. Documentation$' 'docs/CONVENTIONS.md § 11 is Documentation'
check_contains .claude/skills/implement/SKILL.md '^- \*\*Documentation\*\* \(`ouroboros-docs`' \
  'the /implement skill has a Documentation step'
check_contains .claude/skills/implement/SKILL.md 'yarn screenshots --only <id>' \
  'and recaptures only the affected screenshots'
check_contains .claude/skills/implement/SKILL.md '^- \*\*Documentation\*\*: the `ouroboros-docs` pages' \
  'and asks the PR body for a Documentation section'
# The work is named on the ticket first (#1210): the roadmap skills give every issue a
# Documentation line and list ouroboros-docs among the modules of anything user-visible, and
# create-issues carries the section into the GitHub issue.
for skill in create-roadmap update-roadmap create-issues; do
  check_contains ".claude/skills/$skill/SKILL.md" '^  - Documentation — the `ouroboros-docs` pages' \
    "the $skill skill gives every issue a Documentation section"
  check_contains ".claude/skills/$skill/SKILL.md" 'include `ouroboros-docs` whenever the issue is user-visible|list `ouroboros-docs` whenever the issue is user-visible' \
    "and lists ouroboros-docs among the modules of a user-visible issue"
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
# Go joined the repository with the build farm agent (#243, roadmap decision B1). It is
# the one language whose formatter is not configurable: gofmt uses tabs, so the section
# exists to stop an editor's space default fighting it on every save.
check_contains .editorconfig '^\[\*\.go\]' '.editorconfig covers Go'

check_summary
