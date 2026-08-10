#!/usr/bin/env sh
#
# render-token-preview.test.sh — integration tests for scripts/render-token-preview.sh.
#
# The script's job is orchestration: ask a browser for the preview page twice, once per
# palette, and put the two pictures where the document says they are. That is what these
# tests cover, and they cover it with a stub browser rather than a real one — a nine-line
# shell script that records the URL it was handed into the file it was told to write.
#
# Using a stub is what makes the tests dependency-free like the rest of the suite, and it
# tests the part that can actually be wrong: whether each render is asked for with its own
# `?theme=`, whether a browser that produces nothing is reported rather than leaving a
# stale PNG in place, and whether --check compares instead of overwriting. Whether Chrome
# draws the page correctly is Chrome's business, and the committed renders are how a human
# checks it.
#
# Usage:
#   scripts/tests/render-token-preview.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
RENDER="$SCRIPTS_DIR/render-token-preview.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# write_stub FILE BODY — write an executable stand-in for a browser.
write_stub() {
  printf '#!/usr/bin/env sh\n%s\n' "$2" > "$1"
  chmod +x "$1"
}

# The browser that behaves: it writes what it was asked to render into the path it was
# given, so the output files carry the URL that produced them.
write_stub "$work/browser" '
for arg in "$@"; do
  case $arg in
    --screenshot=*) shot=${arg#--screenshot=} ;;
    file://*) url=$arg ;;
  esac
done
printf "render of %s\n" "$url" > "$shot"
'

# The browser that fails silently — the case that would otherwise leave the previous
# render in place and report success.
write_stub "$work/silent" 'exit 0'

# run_render [ARG...] — run the script, leaving combined output in $out and the exit status
# in $status.
run_render() {
  out=$("$RENDER" "$@" 2>&1)
  status=$?
}

printf '\nrender-token-preview.sh\n\n'

# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

printf 'Rendering\n'

mkdir -p "$work/out"
run_render --browser "$work/browser" --out "$work/out"
check_equals 0 "$status" 'a working browser renders both palettes'
check_exists "$work/out/preview-light.png" 'the light render is written'
check_exists "$work/out/preview-dark.png" 'the dark render is written'

# Each render has to be asked for with its own palette; one URL for both would produce two
# identical pictures and nobody would notice.
check_contains "$work/out/preview-light.png" 'theme=light' \
  'the light render was asked for with theme=light'
check_contains "$work/out/preview-dark.png" 'theme=dark' \
  'the dark render was asked for with theme=dark'
check_contains "$work/out/preview-light.png" 'tokens-preview\.html' \
  'the page rendered is the preview page'
check_matches "$out" 'preview-light\.png' 'the run says what it wrote'

# ---------------------------------------------------------------------------
# --check
# ---------------------------------------------------------------------------

printf '\nChecking\n'

run_render --browser "$work/browser" --out "$work/out" --check
check_equals 0 "$status" '--check passes when both renders are current'
check_matches "$out" 'preview-light\.png is current' '--check says which renders it compared'

printf 'stale\n' > "$work/out/preview-dark.png"
run_render --browser "$work/browser" --out "$work/out" --check
check_equals 1 "$status" '--check fails when a render is out of date'
check_matches "$out" 'preview-dark\.png differs' '--check names the stale render'
check_equals 'stale' "$(cat "$work/out/preview-dark.png")" '--check does not rewrite it'

# ---------------------------------------------------------------------------
# What it refuses
# ---------------------------------------------------------------------------

printf '\nRefusals\n'

run_render --browser "$work/nonexistent-browser" --out "$work/out"
check_equals 2 "$status" 'a browser that is not there is refused'
check_matches "$out" 'no Chrome or Chromium found' 'and says how to fix it'

printf 'previous\n' > "$work/out/preview-light.png"
run_render --browser "$work/silent" --out "$work/out"
check_equals 2 "$status" 'a browser that produces nothing is refused'
check_matches "$out" 'produced no light render' 'and says which render it wanted'
check_equals 'previous' "$(cat "$work/out/preview-light.png")" \
  'the previous render is left alone rather than half-replaced'

run_render --browser "$work/browser" --out "$work/no-such-directory"
check_equals 2 "$status" 'an output directory that is not there is refused'
check_matches "$out" 'no output directory' 'and says so'

run_render --frobnicate
check_equals 2 "$status" 'an unknown argument is refused'
check_matches "$out" 'unknown argument' 'and is named'

run_render --out
check_equals 2 "$status" 'an option missing its value is refused'

run_render --help
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'Usage:' '--help prints the usage'

check_summary
