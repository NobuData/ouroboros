#!/usr/bin/env sh
#
# reference-bundle.test.sh — tests for scripts/reference-bundle.sh (DL.3, #1327).
#
# It builds export directories shaped like scripts/reference-run.sh's — a published attempt and
# two earlier ones — and checks that the bundle carries them byte for byte, that every figure on
# SUMMARY.md is the one its source file gives, that the "does not show" section and the attempt
# count are there, and that each input a published bundle may not hold is refused with nothing
# written.
#
# Usage:
#   scripts/tests/reference-bundle.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
BUNDLE="$SCRIPTS_DIR/reference-bundle.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# make_export DIR MODE OUTCOME STARTED — a reference-run export: two metered calls ($0.41, 9,300
# tokens in), an implement stage that ran twice (one correction round) and a build stage whose two
# attempts took 50 s and 72 s.
make_export() {
  mkdir -p "$1"
  pr='https://github.com/me/sample/pull/12'
  [ "$3" = pr_opened ] || pr=''
  cat > "$1/manifest.json" << JSON
{
  "mode": "$2",
  "outcome": "$3",
  "repository": "me/sample",
  "issue": 3,
  "run": "11111111-2222-4333-8444-555555555555",
  "pullRequest": $([ -n "$pr" ] && printf '"%s"' "$pr" || printf null),
  "started": "$4",
  "finished": "2026-10-24T10:06:12Z",
  "checkout": { "commit": "abc1234", "tag": "v0.9.0", "dirty": false },
  "aliases": { "slice-planner": "claude-sonnet-4-5", "slice-coder": "claude-sonnet-4-5-20250929" }
}
JSON
  printf '%s\n' '{"seq":1,"ts":"2026-10-24T10:00:01.000Z","actor":"system","simulated":false,"body":"run opened"}' \
    '{"seq":2,"ts":"2026-10-24T10:00:09.000Z","actor":"model","stage_key":"plan","simulated":false,"body":"plan"}' \
    > "$1/run.jsonl"
  cat > "$1/usage.csv" << 'CSV'
occurred_at,stage,attempt,alias,model,tokens_in,tokens_out,cost_cents
2026-10-24 10:00:09+00,plan,1,slice-planner,claude-sonnet-4-5,5300,700,16
"2026-10-24 10:02:30+00",implement,1,slice-coder,claude-sonnet-4-5-20250929,4000,1200,25
CSV
  printf 'sh tests/check.sh\nok\n' > "$1/farm-job.log"
  printf '%s\n' "$pr" > "$1/pr-url.txt"
  cat > "$1/run.json" << 'JSON'
{"run":{"status":"awaiting_review","prNumber":12},"timeline":{"stages":[
 {"stageKey":"plan","attempts":[{"attempt":1,"durationSeconds":20}]},
 {"stageKey":"implement","attempts":[{"attempt":1,"durationSeconds":90},{"attempt":2,"durationSeconds":60}]},
 {"stageKey":"build","build":{"jobId":"j1"},"attempts":[{"attempt":1,"durationSeconds":50},{"attempt":2,"durationSeconds":72}]}
]}}
JSON
}

make_export "$work/real" real pr_opened 2026-10-24T10:00:00Z
make_export "$work/try1" real failed 2026-10-23T09:00:00Z
make_export "$work/try2" real needs_human 2026-10-23T15:00:00Z
make_export "$work/fixture" fixture pr_opened 2026-10-24T10:00:00Z
make_export "$work/stopped" real failed 2026-10-24T10:00:00Z
make_export "$work/simulated" real pr_opened 2026-10-24T10:00:00Z
printf '%s\n' '{"seq":1,"ts":"2026-10-24T10:00:01.000Z","actor":"system","simulated":true}' > "$work/simulated/run.jsonl"

printf 'not really a video, but bytes all the same\n' > "$work/recording.mp4"
cat > "$work/cuts.txt" << 'CUTS'
# AT LENGTH WHAT
00:01:10 00:03:20 waiting for the runner to pick up the build
00:02:05 00:00:40 waiting for the pull request poll
CUTS
printf '# none\n' > "$work/manual.txt"
printf 'Re-ran the sync from Settings → Sources after a 502\n' > "$work/manual-one.txt"

URL='https://github.com/NobuData/ouroboros/releases/download/reference-run-2026-10-24/recording.mp4'

# bundle [ARGS...] — run the script with the common inputs plus ARGS; sets $out and $status.
bundle() {
  out=$("$BUNDLE" --recording "$work/recording.mp4" --recording-url "$URL" --cuts "$work/cuts.txt" \
    --operator 'a maintainer' --out "$work/docs" "$@" 2>&1)
  status=$?
}

# --- a published attempt with two before it -------------------------------------------------------
bundle --export "$work/real" --attempt "$work/try1" --attempt "$work/try2" --manual-steps "$work/manual.txt"
check_equals 0 "$status" 'a real export with its earlier attempts is bundled'
dest="$work/docs/2026-10-24"
check_exists "$dest/SUMMARY.md" 'the bundle is dated by the day the run started'
for f in manifest.json run.jsonl usage.csv farm-job.log pr-url.txt run.json; do
  check_run "the published export's $f is copied byte for byte" cmp -s "$work/real/$f" "$dest/run/$f"
done
check_run 'the first earlier attempt is kept as attempts/1' cmp -s "$work/try1/manifest.json" "$dest/attempts/1/manifest.json"
check_run 'the second earlier attempt is kept as attempts/2' cmp -s "$work/try2/manifest.json" "$dest/attempts/2/manifest.json"
check_run 'the cuts are kept' cmp -s "$work/cuts.txt" "$dest/cuts.txt"
check_exists "$dest/manual-steps.txt" 'the manual steps are kept'
check_missing "$dest/recording.mp4" 'the recording itself stays out of git'

summary=$(cat "$dest/SUMMARY.md")
check_matches "$summary" 'Wall-clock, queue to draft pull request \| \*\*6m 12s\*\* \| \[`run/manifest.json`\]' \
  'the wall-clock is finished − started, from the manifest'
check_matches "$summary" 'Model calls \| \*\*2\*\* \| \[`run/usage.csv`\]' 'model calls count usage.csv rows'
check_matches "$summary" 'Tokens in \| \*\*9,300\*\*' 'tokens in sum usage.csv, quoted fields included'
check_matches "$summary" 'Tokens out \| \*\*1,900\*\*' 'tokens out sum usage.csv'
check_matches "$summary" 'Cost, customer-key price list \| \*\*\$0\.41\*\*' 'the cost sums cost_cents'
check_matches "$summary" 'Correction rounds \| \*\*1\*\* \| \[`run/run.json`\]' "correction rounds are implement's extra attempts"
check_matches "$summary" 'Build duration \| \*\*2m 2s over 2 build attempts\*\*' 'the build duration sums the build attempts'
check_not_matches "$summary" '[0-9]%' 'no percentage is stated'
check_matches "$summary" '## What this does not show' 'the "does not show" section is there'
check_matches "$summary" 'n = 1' 'it says it is one run'
check_matches "$summary" 'One repository\*\* — me/sample' 'it names the one repository'
check_matches "$summary" 'chosen by the authors' 'it says the authors chose the issue'
check_matches "$summary" 'No merge' 'it says nothing merged'
check_matches "$summary" 'L5 restrictions were in force' 'it says L5 was in force'
check_matches "$summary" 'Manual steps\.\*\* None was taken' 'an all-comment manual-steps file means none'
check_matches "$summary" '2 marked cuts removing 4m 0s' 'it totals the cut waiting time'
check_matches "$summary" 'This is attempt 3; 2 attempts preceded it' 'the attempts before it are counted'
check_matches "$summary" '\| 1 \| 2026-10-23T09:00:00Z \| `failed` \|' 'the failed attempt is listed'
check_matches "$summary" '\| 3 \(published\) \|' 'the published attempt is marked'
check_matches "$summary" 'AI disclosure' 'the AI disclosure leads the page'
check_matches "$summary" 'Reviewed by: _pending' 'the review is left to someone who did not run it'
check_matches "$summary" "$(sha256sum "$work/recording.mp4" | cut -d' ' -f1)" "the recording's checksum is stated"

check_markdown_links "$dest/SUMMARY.md"

manifest=$(cat "$dest/manifest.json")
check_matches "$manifest" '"attemptsBeforePublished": 2' 'the manifest counts the earlier attempts'
check_matches "$manifest" "\"url\": \"$URL\"" "the manifest holds the recording's URL"
check_matches "$manifest" "\"sha256\": \"$(sha256sum "$work/recording.mp4" | cut -d' ' -f1)\"" "and its checksum"
check_matches "$manifest" "\"sha256\": \"$(sha256sum "$dest/run/usage.csv" | cut -d' ' -f1)\"" 'every file has its checksum'
check_matches "$manifest" '"source": "run/usage.csv"' 'each figure names its source file'
check_matches "$out" 'attempt 3, 2 before it' 'it says what it wrote'

# --- written once -------------------------------------------------------------------------------
bundle --export "$work/real" --manual-steps "$work/manual.txt"
check_equals 2 "$status" 'an existing bundle is not overwritten'
check_matches "$out" 'already exists' 'it says why'

# --- a first attempt, a manual step, an explicit date ---------------------------------------------
bundle --export "$work/real" --manual-steps "$work/manual-one.txt" --date 2026-10-25
check_equals 0 "$status" '--date names the bundle'
summary=$(cat "$work/docs/2026-10-25/SUMMARY.md")
check_matches "$summary" 'This is attempt 1; 0 attempts preceded it' 'a first attempt says none preceded it'
check_matches "$summary" '1 step was taken by hand' 'a manual step is counted'
check_matches "$summary" 'Re-ran the sync' 'and listed'
check_missing "$work/docs/2026-10-25/attempts" 'and there is no attempts directory'

# --- refusals: nothing is written -----------------------------------------------------------------
refused() {
  check_equals 2 "$status" "$1 exits two"
  check_matches "$out" "$2" 'it says why'
  check_missing "$work/docs/2026-10-26" 'and writes nothing'
}
bundle --export "$work/fixture" --manual-steps "$work/manual.txt" --date 2026-10-26
refused 'a --fixture export' 'not a real run'
bundle --export "$work/simulated" --manual-steps "$work/manual.txt" --date 2026-10-26
refused 'a simulated transcript' 'not marked "simulated": false'
bundle --export "$work/stopped" --manual-steps "$work/manual.txt" --date 2026-10-26
refused 'a published attempt that opened no pull request' 'did not open its pull request'
bundle --export "$work/real" --attempt "$work/fixture" --manual-steps "$work/manual.txt" --date 2026-10-26
refused 'an earlier attempt made with --fixture' 'not a real run'
bundle --export "$work/real" --attempt "$work/nowhere" --manual-steps "$work/manual.txt" --date 2026-10-26
refused 'a missing attempt directory' 'no attempt directory'
printf '1:10 3:20 waiting\n' > "$work/bad-cuts.txt"
out=$("$BUNDLE" --export "$work/real" --recording "$work/recording.mp4" --recording-url "$URL" \
  --cuts "$work/bad-cuts.txt" --manual-steps "$work/manual.txt" --operator x --out "$work/docs" \
  --date 2026-10-26 2>&1)
status=$?
refused 'a malformed cut' 'cuts line 1'
bundle --export "$work/real" --manual-steps "$work/manual.txt" --date 2026-10-26 --recording-url http://example.com/r.mp4
refused 'a plain-http recording URL' 'must be an https URL'
out=$("$BUNDLE" --export "$work/real" --recording "$work/recording.mp4" --cuts "$work/cuts.txt" \
  --manual-steps "$work/manual.txt" --operator x --out "$work/docs" --date 2026-10-26 2>&1)
status=$?
refused 'no --recording-url' 'upload the recording first'
bundle --export "$work/real" --date 2026-10-26
refused 'no --manual-steps' '--manual-steps is required'

out=$("$BUNDLE" --help 2>&1)
status=$?
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'Usage:' '--help prints the usage'

check_summary
