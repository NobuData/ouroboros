#!/usr/bin/env sh
#
# verify-github-config.sh — assert the .github/ contract established by issue #9.
#
# Checks that the label definitions are present, parseable and complete for the roadmap's
# taxonomy; that the issue forms and the pull-request template exist and carry the
# sections the repository's conventions rely on; and that the tooling which applies them
# is runnable. It talks to no network, so it is safe in CI and offline — whether GitHub's
# live labels match the file is what `scripts/sync-labels.sh --dry-run` answers.
#
# Deliberately dependency-free POSIX shell, matching verify-layout.sh.
#
# Usage:
#   scripts/verify-github-config.sh   # run from anywhere; resolves the repo root itself
#
# Exit status:
#   0  every check passed
#   1  at least one check failed (each failure is printed with its reason)

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
cd "$ROOT"

# The assertion harness, shared with verify-layout.sh.
. "$SCRIPT_DIR/lib/checks.sh"

LABELS=.github/labels.yml
FORMS=.github/ISSUE_TEMPLATE
PR_TEMPLATE=.github/pull_request_template.md

# The taxonomy issue #9 defines: release scoping, module routing, cross-cutting.
ROADMAP_LABELS="mvp v2 ui rest db engine infra design ci"

printf '\nGitHub configuration — %s\n\n' "$ROOT"

printf 'Label definitions\n'
check_exists "$LABELS" "$LABELS exists"
check_run "$LABELS parses" awk -f "$SCRIPT_DIR/lib/parse-labels.awk" "$LABELS"
for label in $ROADMAP_LABELS; do
  check_contains "$LABELS" "^- name: \"$label\"\$" "$LABELS defines the $label label"
done
check_contains "$LABELS" '^- name: "epic"$' "$LABELS defines the epic label for parent issues"
# The accent cyan is the brand nod called for by the issue; it is also what tells the
# roadmap's MVP scope apart at a glance.
check_contains "$LABELS" '^  color: "3dd6f5"' "$LABELS keeps mvp on the brand accent cyan"
check_absent "$LABELS" '^  color: "#' "$LABELS stores colors without a leading #"

printf '\nLabel tooling\n'
check_executable scripts/sync-labels.sh 'scripts/sync-labels.sh is executable'
check_exists scripts/lib/parse-labels.awk 'scripts/lib/parse-labels.awk exists'
check_exists scripts/lib/checks.sh 'scripts/lib/checks.sh exists'
check_executable scripts/run-tests.sh 'scripts/run-tests.sh is executable'

printf '\nIssue forms\n'
check_exists "$FORMS" "$FORMS/ exists"
for form in feature bug; do
  check_exists "$FORMS/$form.yml" "$FORMS/$form.yml exists"
  check_contains "$FORMS/$form.yml" '^name: ' "the $form form has a name"
  check_contains "$FORMS/$form.yml" '^description: ' "the $form form has a description"
  check_contains "$FORMS/$form.yml" '^body:' "the $form form has a body"
  check_contains "$FORMS/$form.yml" '^title: ' "the $form form seeds the title convention"
done
# GitHub issue types, so a filed issue lands typed rather than needing triage.
check_contains "$FORMS/feature.yml" '^type: Feature' 'the feature form files a Feature'
check_contains "$FORMS/bug.yml" '^type: Bug' 'the bug form files a Bug'
check_contains "$FORMS/feature.yml" '^title: "<project>: \[<epic>\.<issue>\] ' 'the feature form seeds <project>: [<epic>.<issue>]'

# The anatomy every roadmap issue shares — see docs/CONVENTIONS.md § 7.
for field in release effort systems problem scope acceptance dependencies stack; do
  check_contains "$FORMS/feature.yml" "^    id: $field\$" "the feature form collects $field"
done
for field in module summary steps expected actual; do
  check_contains "$FORMS/bug.yml" "^    id: $field\$" "the bug form collects $field"
done

# A scalar carrying a colon must be quoted or YAML reads it as a nested mapping and
# GitHub rejects the whole form — the one syntax trap these files actually hit, caught
# here without needing a YAML parser on the machine.
UNQUOTED_COLON="^[ -]*[a-zA-Z_]+: [^\"'|>].*: "
for form in feature bug config; do
  check_absent "$FORMS/$form.yml" "$UNQUOTED_COLON" "the $form form quotes every value containing a colon"
done

check_exists "$FORMS/config.yml" "$FORMS/config.yml exists"
check_contains "$FORMS/config.yml" '^blank_issues_enabled: ' 'the form config decides on blank issues'
check_contains "$FORMS/config.yml" 'CONVENTIONS\.md' 'the form config links the conventions'

printf '\nPull-request template\n'
check_exists "$PR_TEMPLATE" "$PR_TEMPLATE exists"
check_contains "$PR_TEMPLATE" '<project>: \[<epic>\.<issue>\] <title>' 'the PR template states the title convention'
check_contains "$PR_TEMPLATE" '^## What & why' 'the PR template asks what and why'
check_contains "$PR_TEMPLATE" '^## How to test' 'the PR template asks how to test'
check_contains "$PR_TEMPLATE" '^## Risk & notes' 'the PR template asks for risks and notes'
check_contains "$PR_TEMPLATE" '^Closes #' 'the PR template links the issue it closes'
check_contains "$PR_TEMPLATE" 'ticket-<issue-number>' 'the PR template states the branch convention'
check_contains "$PR_TEMPLATE" 'Fix #<number> - <concise title>' 'the PR template states the commit convention'

check_summary
