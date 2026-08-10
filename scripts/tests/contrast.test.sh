#!/usr/bin/env sh
#
# contrast.test.sh — unit tests for scripts/lib/contrast.awk.
#
# The ratios docs/DESIGN_TOKENS.md publishes, and the AA gate the palettes are held to, are
# only as good as this arithmetic. So the cases pin it against values that are not this
# implementation's opinion: black on white is 21:1 and a colour on itself is 1:1 by
# definition, and the rest are WCAG's own worked numbers for the sRGB transfer.
#
# The parse cases matter as much as the maths. A colour read as black would make a failing
# pair pass, so anything unrecognised has to be refused rather than defaulted, and a
# translucent background has to be refused unless the surface below it is named.
#
# Usage:
#   scripts/tests/contrast.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
CONTRAST="$SCRIPTS_DIR/lib/contrast.awk"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# run_contrast [-v ...] — run the program, leaving stdout in $out, stderr in $err and the
# exit status in $status.
run_contrast() {
  out=$(awk -f "$CONTRAST" "$@" 2>"$work/err")
  status=$?
  err=$(cat "$work/err")
}

# check_ratio FG BG EXPECTED DESCRIPTION — assert an opaque pair's ratio.
check_ratio() {
  run_contrast -v fg="$1" -v bg="$2"
  if [ "$status" -eq 0 ] && [ "$out" = "$3" ]; then
    pass "$4"
  else
    fail "$4 (status $status, got [$out${err:+ / $err}], wanted $3)"
  fi
}

# check_over FG BG UNDER EXPECTED DESCRIPTION — assert a composited pair's ratio.
check_over() {
  run_contrast -v fg="$1" -v bg="$2" -v under="$3"
  if [ "$status" -eq 0 ] && [ "$out" = "$4" ]; then
    pass "$5"
  else
    fail "$5 (status $status, got [$out${err:+ / $err}], wanted $4)"
  fi
}

# check_refused DESCRIPTION PATTERN [-v ...] — assert the program exits 2 saying why, and
# prints nothing a caller could mistake for a ratio.
check_refused() {
  description=$1
  pattern=$2
  shift 2
  run_contrast "$@"
  if [ "$status" -eq 2 ] && [ -z "$out" ] && printf '%s\n' "$err" | grep -Eq -- "$pattern"; then
    pass "$description"
  else
    fail "$description (status $status, stdout [$out], stderr [$err])"
  fi
}

printf '\ncontrast.awk\n\n'

# ---------------------------------------------------------------------------
# The two ends of the scale, which are true by definition
# ---------------------------------------------------------------------------

printf 'Fixed points\n'

check_ratio '#000000' '#ffffff' '21.00' 'black on white is the maximum, 21:1'
check_ratio '#ffffff' '#000000' '21.00' 'the ratio does not depend on which colour is which'
check_ratio '#ffffff' '#ffffff' '1.00' 'a colour on itself is 1:1'
check_ratio '#3dd6f5' '#3dd6f5' '1.00' 'that holds for a mid-tone too'

# 0.5 grey is not half way up the scale: the sRGB transfer is a curve, and a linear
# reading of it would put this at 2.0 rather than 5.28.
check_ratio '#808080' '#ffffff' '3.95' 'mid grey on white is 3.95:1, not a linear 2:1'
check_ratio '#808080' '#000000' '5.32' 'and 5.32:1 on black'

# ---------------------------------------------------------------------------
# The palettes' own numbers
# ---------------------------------------------------------------------------

printf '\nThe committed palettes\n'

check_ratio '#e9f2f6' '#12181d' '15.75' "the dark palette's body text is 15.75:1"
check_ratio '#16232b' '#f5f8fa' '15.04' "the light palette's body text is 15.04:1"
check_ratio '#3dd6f5' '#12181d' '10.34' 'the dark accent is 10.34:1 on the page'
check_ratio '#07708e' '#ffffff' '5.65' 'the light accent is 5.65:1 on a card'

# The brand cyan on white is the measurement the light palette exists because of.
check_ratio '#3dd6f5' '#ffffff' '1.73' 'the brand cyan on white is 1.73:1 — unusable as text'

# ---------------------------------------------------------------------------
# Syntax
# ---------------------------------------------------------------------------

printf '\nSyntax\n'

check_ratio '#fff' '#000' '21.00' 'three-digit hex is expanded'
check_ratio '#FFF' '#000000' '21.00' 'hex is case-insensitive'
check_ratio 'rgb(255, 255, 255)' 'rgb(0, 0, 0)' '21.00' 'rgb() with commas'
check_ratio 'rgb(255 255 255)' 'rgb(0 0 0)' '21.00' 'rgb() with spaces'
check_ratio 'rgb(100%, 100%, 100%)' '#000000' '21.00' 'percentage channels'
check_ratio 'rgba(255, 255, 255, 1)' '#000000' '21.00' 'an alpha of 1 is opaque'

# ---------------------------------------------------------------------------
# Compositing
# ---------------------------------------------------------------------------

printf '\nCompositing\n'

# A tint has no contrast of its own; it borrows the surface below it. 12% of the accent
# over the card is the live pill, and 7.45:1 is what the document publishes for it.
check_over '#3dd6f5' 'rgba(61, 214, 245, 0.12)' '#171f26' '7.45' \
  'a translucent background is composited over the surface named'
check_over '#0b7048' 'rgba(11, 112, 72, 0.10)' '#ffffff' '5.30' \
  'the same holds for the light palette'

# 50% white over black is the grey the transfer curve puts at 5.28:1 — the same number as
# the opaque #808080 case above, which is what says the compositing is source-over.
check_ratio 'rgba(255, 255, 255, 0.5)' '#000000' '5.28' \
  'a translucent foreground is composited over the background'

check_over '#000000' 'rgba(255, 255, 255, 1)' '#000000' '21.00' \
  'an opaque background makes the surface below it irrelevant'

# ---------------------------------------------------------------------------
# What it refuses
# ---------------------------------------------------------------------------

printf '\nRefusals\n'

check_refused 'a missing foreground is refused' 'required' -v bg='#000000'
check_refused 'a missing background is refused' 'required' -v fg='#000000'

check_refused 'a colour that is not hex is refused' 'not a hex colour' \
  -v fg='#zzzzzz' -v bg='#000000'
check_refused 'a hex colour of the wrong length is refused' 'not a hex colour' \
  -v fg='#12345' -v bg='#000000'
check_refused 'a named colour is refused' 'unsupported colour syntax' \
  -v fg='rebeccapurple' -v bg='#000000'
check_refused 'a colour function it cannot do is refused' 'unsupported colour syntax' \
  -v fg='oklch(70% 0.1 200)' -v bg='#000000'
check_refused 'rgb() with too few channels is refused' 'three channels' \
  -v fg='rgb(255, 255)' -v bg='#000000'
check_refused 'a channel out of range is refused' 'out of range' \
  -v fg='rgb(300, 0, 0)' -v bg='#000000'

# The important one: a tint on its own has no ratio, and guessing a surface for it would
# publish a number that is true of nothing.
check_refused 'a translucent background with no surface below it is refused' 'translucent' \
  -v fg='#3dd6f5' -v bg='rgba(61, 214, 245, 0.12)'
check_refused 'a translucent surface below it is refused too' 'must be opaque' \
  -v fg='#3dd6f5' -v bg='rgba(61, 214, 245, 0.12)' -v under='rgba(0, 0, 0, 0.5)'

check_summary
