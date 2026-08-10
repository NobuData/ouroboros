#!/usr/bin/env sh
#
# sync-labels.test.sh — integration tests for scripts/sync-labels.sh.
#
# The GitHub CLI is replaced by a stub on PATH, so every reconciliation path — create,
# update, unchanged, extras, dry run, failure — is exercised without a network call and
# without mutating a real repository. The stub records the `gh label` commands it was
# asked to run, which is how the tests assert that nothing is ever deleted.
#
# Usage:
#   scripts/tests/sync-labels.test.sh       # or scripts/run-tests.sh for the whole suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
SYNC="$SCRIPTS_DIR/sync-labels.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

TAB=$(printf '\t')
mkdir -p "$work/bin"

GH_STUB_LOG="$work/gh.log"
export GH_STUB_LOG

# A stand-in for the GitHub CLI. It answers the three calls sync-labels.sh makes and
# logs every label mutation so the tests can assert on them.
cat > "$work/bin/gh" <<'STUB'
#!/usr/bin/env sh
set -u
case "${1:-}" in
  auth) exit 0 ;;
  repo) printf 'stub/repo\n'; exit 0 ;;
  api) cat "$GH_STUB_LABELS"; exit 0 ;;
  label)
    action=$2
    name=$3
    printf '%s %s\n' "$action" "$name" >> "$GH_STUB_LOG"
    if [ "${GH_STUB_FAIL:-}" = "$name" ]; then
      printf 'stub: refusing to %s %s\n' "$action" "$name" >&2
      exit 1
    fi
    exit 0
    ;;
esac
printf 'stub: unexpected gh invocation: %s\n' "$*" >&2
exit 1
STUB
chmod +x "$work/bin/gh"

# write_file PATH CONTENT — put a fixture on disk.
write_file() {
  printf '%s\n' "$2" > "$1"
}

# run_sync EXISTING_TSV LABELS_FILE [ARG...] — run the script against the stub, leaving
# combined output in $out, exit status in $status and the stub's mutation log in $log.
run_sync() {
  GH_STUB_LABELS=$1
  export GH_STUB_LABELS
  labels_file=$2
  shift 2
  : > "$GH_STUB_LOG"
  out=$(PATH="$work/bin:$PATH" "$SYNC" --repo stub/repo --file "$labels_file" "$@" 2>&1)
  status=$?
  log=$(cat "$GH_STUB_LOG")
}

printf '\nsync-labels.sh\n\n'

# The definitions under test: two labels, unchanged across most cases.
write_file "$work/labels.yml" '- name: "mvp"
  color: "3dd6f5"
  description: "Targeted for the v1 / MVP release"
- name: "infra"
  color: "5319e7"
  description: "Repo infrastructure, containers, dev environment"'

printf 'Nothing to do\n'

printf 'mvp%s3dd6f5%sTargeted for the v1 / MVP release\ninfra%s5319e7%sRepo infrastructure, containers, dev environment\n' \
  "$TAB" "$TAB" "$TAB" "$TAB" > "$work/existing-matching.tsv"

run_sync "$work/existing-matching.tsv" "$work/labels.yml"
check_equals 0 "$status" 'a repository already in sync exits zero'
check_matches "$out" '0 created, 0 updated, 2 unchanged, 0 failed' 'both labels are reported unchanged'
check_equals '' "$log" 'no label is touched when nothing has drifted'

printf 'mvp%s3DD6F5%sTargeted for the v1 / MVP release\ninfra%s5319E7%sRepo infrastructure, containers, dev environment\n' \
  "$TAB" "$TAB" "$TAB" "$TAB" > "$work/existing-uppercase.tsv"

run_sync "$work/existing-uppercase.tsv" "$work/labels.yml"
check_matches "$out" '0 created, 0 updated, 2 unchanged, 0 failed' 'colors compare case-insensitively'
check_equals '' "$log" 'a case difference in the hex color is not treated as drift'

printf '\nCreating\n'

printf 'mvp%s3dd6f5%sTargeted for the v1 / MVP release\n' "$TAB" "$TAB" > "$work/existing-missing.tsv"

run_sync "$work/existing-missing.tsv" "$work/labels.yml"
check_equals 0 "$status" 'creating a missing label exits zero'
check_matches "$out" '1 created, 0 updated, 1 unchanged, 0 failed' 'only the missing label is created'
check_equals 'create infra' "$log" 'gh label create is called once, for the missing label'

run_sync "$work/existing-missing.tsv" "$work/labels.yml" --dry-run
check_equals 0 "$status" 'a dry run exits zero'
check_matches "$out" 'would' 'a dry run reports the change it would make'
check_equals '' "$log" 'a dry run never calls gh label'

printf '\nUpdating\n'

printf 'mvp%sff0000%sTargeted for the v1 / MVP release\ninfra%s5319e7%sRepo infrastructure, containers, dev environment\n' \
  "$TAB" "$TAB" "$TAB" "$TAB" > "$work/existing-color-drift.tsv"

run_sync "$work/existing-color-drift.tsv" "$work/labels.yml"
check_matches "$out" '0 created, 1 updated, 1 unchanged, 0 failed' 'a drifted color is updated'
check_matches "$out" '\(color\)' 'the report names the color as the drift'
check_equals 'edit mvp' "$log" 'gh label edit is called for the drifted label only'

printf 'mvp%s3dd6f5%sstale text\ninfra%s5319e7%sRepo infrastructure, containers, dev environment\n' \
  "$TAB" "$TAB" "$TAB" "$TAB" > "$work/existing-description-drift.tsv"

run_sync "$work/existing-description-drift.tsv" "$work/labels.yml"
check_matches "$out" '\(description\)' 'a drifted description is detected'
check_equals 'edit mvp' "$log" 'a description-only drift still edits the label'

printf 'mvp%sff0000%sstale text\ninfra%s5319e7%sRepo infrastructure, containers, dev environment\n' \
  "$TAB" "$TAB" "$TAB" "$TAB" > "$work/existing-both-drift.tsv"

run_sync "$work/existing-both-drift.tsv" "$work/labels.yml"
check_matches "$out" '\(color, description\)' 'both kinds of drift are reported together'

printf '\nExtras are never deleted\n'

printf 'mvp%s3dd6f5%sTargeted for the v1 / MVP release\ninfra%s5319e7%sRepo infrastructure, containers, dev environment\nwontfix%sffffff%sThis will not be worked on\n' \
  "$TAB" "$TAB" "$TAB" "$TAB" "$TAB" "$TAB" > "$work/existing-extra.tsv"

run_sync "$work/existing-extra.tsv" "$work/labels.yml"
check_equals 0 "$status" 'an unmanaged label does not fail the run'
check_matches "$out" 'wontfix' 'the unmanaged label is reported'
check_matches "$out" 'left alone' 'the report says the unmanaged label was left alone'
check_equals '' "$log" 'no delete is ever issued'

printf '\nFailure handling\n'

GH_STUB_FAIL=infra
export GH_STUB_FAIL
run_sync "$work/existing-missing.tsv" "$work/labels.yml"
check_equals 1 "$status" 'a rejected label makes the run fail'
check_matches "$out" '0 created, 0 updated, 1 unchanged, 1 failed' 'the failure is counted, the rest still applied'
unset GH_STUB_FAIL

write_file "$work/broken.yml" '- name: "mvp"
  color: "not-a-color"
  description: "invalid"'

run_sync "$work/existing-matching.tsv" "$work/broken.yml"
check_equals 1 "$status" 'an invalid label file makes the run fail'
check_matches "$out" 'is invalid' 'the report says the definitions are invalid'
check_equals '' "$log" 'nothing is applied when the definitions are invalid'

printf '\nUsage\n'

out=$(PATH="$work/bin:$PATH" "$SYNC" --help 2>&1)
check_equals 0 "$?" '--help exits zero'
check_matches "$out" 'Usage: scripts/sync-labels.sh' '--help prints the usage'

out=$(PATH="$work/bin:$PATH" "$SYNC" --nonsense 2>&1)
check_equals 2 "$?" 'an unknown argument exits 2'

out=$(PATH="$work/bin:$PATH" "$SYNC" --repo 2>&1)
check_equals 2 "$?" 'an option missing its value exits 2'

check_summary
