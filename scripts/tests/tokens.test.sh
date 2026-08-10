#!/usr/bin/env sh
#
# tokens.test.sh — unit tests for scripts/lib/tokens.awk.
#
# The parser is what every other assertion about the token sheet is built on: the palette
# comparison, the catalogue check and every recomputed contrast ratio all read its TSV. A
# parser that quietly dropped a declaration would make all three pass on a sheet that does
# not say what they claim.
#
# So the accept cases pin the output contract exactly — which declarations, in which order,
# with values normalised the one way — and the reject cases pin every shape the parser
# refuses. The refusals are the interesting half: the sheet is allowed to contain three
# palette blocks and nothing else, which is what turns "no literal colour outside the token
# blocks" into something a script can check rather than something a reviewer has to.
#
# Usage:
#   scripts/tests/tokens.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$SCRIPTS_DIR")
PARSER="$SCRIPTS_DIR/lib/tokens.awk"
SHEET="$ROOT/docs/design/tokens.css"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

TAB=$(printf '\t')

# run_parser CONTENT [-v ...] — parse CONTENT as sheet.css, leaving stdout in $out, stderr
# in $err and the exit status in $status. Run from the temporary directory so the file
# column of any diagnostic is the bare name.
run_parser() {
  content=$1
  shift
  printf '%s\n' "$content" > "$work/sheet.css"
  out=$(cd "$work" && awk -f "$PARSER" "$@" sheet.css 2>"$work/err")
  status=$?
  err=$(cat "$work/err")
}

# A minimal sheet with all three blocks, one colour and one theme-independent token.
FIXTURE=':root {
  color-scheme: light;
  --ground: #f5f8fa;   /* the page */
  --sp-4: 0.5rem;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --ground: #12181d;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --ground: #12181d;
  }
}'

# check_output DESCRIPTION EXPECTED [-v ...] — assert a successful parse of $FIXTURE.
check_output() {
  description=$1
  expected=$2
  shift 2
  run_parser "$FIXTURE" "$@"
  if [ "$status" -eq 0 ] && [ "$out" = "$expected" ]; then
    pass "$description"
  else
    fail "$description (status $status, got [$out${err:+ / $err}])"
  fi
}

# check_refused DESCRIPTION PATTERN CONTENT [-v ...] — assert the parser refuses CONTENT
# and says why.
check_refused() {
  description=$1
  pattern=$2
  content=$3
  shift 3
  run_parser "$content" "$@"
  if [ "$status" -ne 0 ] && printf '%s\n' "$err" | grep -Eq -- "$pattern"; then
    pass "$description"
  else
    fail "$description (status $status, stderr [$err])"
  fi
}

printf '\ntokens.awk\n\n'

# ---------------------------------------------------------------------------
# The output contract
# ---------------------------------------------------------------------------

printf 'Reading a block\n'

check_output 'the light block is every declaration on :root, in file order' \
  "color-scheme${TAB}light
--ground${TAB}#f5f8fa
--sp-4${TAB}0.5rem"

check_output 'light is the default block' \
  "color-scheme${TAB}light
--ground${TAB}#f5f8fa
--sp-4${TAB}0.5rem" \
  -v block=light

check_output 'the dark block is the explicit-choice palette only' \
  "color-scheme${TAB}dark
--ground${TAB}#12181d" \
  -v block=dark

check_output 'the system block is the one inside the media query' \
  "color-scheme${TAB}dark
--ground${TAB}#12181d" \
  -v block=system

printf '\nNormalising\n'

# A trailing comment is not part of a value, and neither is the spacing a human used to
# line one up: two blocks that should be identical have to compare with a plain diff.
run_parser ':root {
  --a:   #f5f8fa  ;      /* spaced out */
  --b: rgba(7,   112, 142,   0.10);
  --c: "IBM Plex Sans",  system-ui;
}'
check_equals "--a${TAB}#f5f8fa
--b${TAB}rgba(7, 112, 142, 0.10)
--c${TAB}\"IBM Plex Sans\", system-ui" "$out" \
  'comments are dropped, whitespace inside a value is collapsed, quotes are kept'

# A comment spanning lines is whitespace, including any declaration-looking text in it.
run_parser ':root {
  --a: #ffffff;
  /* the mockups used
     --a: #12181d;
     which this is not */
  --b: #000000;
}'
check_equals "--a${TAB}#ffffff
--b${TAB}#000000" "$out" 'a declaration inside a multi-line comment is not a declaration'

printf '\nThe leftovers\n'

# mode=outside is how the caller proves nothing lives outside the palette blocks. On a
# well-formed sheet it says nothing at all.
run_parser "$FIXTURE" -v mode=outside
if [ "$status" -eq 0 ] && [ -z "$out" ]; then
  pass 'a well-formed sheet has nothing outside its blocks'
else
  fail "a well-formed sheet has nothing outside its blocks (status $status, got [$out])"
fi

run_parser 'body { color: #ff0000; }' -v mode=outside
check_matches "$err" 'not: body' 'a component rule is refused rather than reported as leftovers'
check_equals '' "$out" 'and nothing is emitted for it'

# A stray declaration between the blocks is exactly the escape the check exists for.
run_parser "--rogue: #ff0000;
$FIXTURE" -v mode=outside
check_matches "$out" '^1'"$TAB"'--rogue: #ff0000;$' 'a declaration outside every block is reported with its line'

# ---------------------------------------------------------------------------
# What it refuses
# ---------------------------------------------------------------------------

printf '\nRefusals\n'

check_refused 'an unknown block is refused' 'unknown block' "$FIXTURE" -v block=sepia
check_refused 'an unknown mode is refused' 'unknown mode' "$FIXTURE" -v mode=guess

check_refused 'a missing block is refused rather than reported as empty' \
  'no declarations found in the dark block' \
  ':root { --ground: #f5f8fa; }' -v block=dark

# The rule that makes the sheet a token sheet: three palette blocks, nothing else.
check_refused 'a component rule is refused' \
  'only palette blocks, not: \.card' \
  ':root { --ground: #f5f8fa; }
.card { background: var(--surface); }'

check_refused 'a second selector on the palette rule is refused' \
  'only palette blocks, not: :root, \.card' \
  ':root, .card { --ground: #f5f8fa; }'

check_refused 'a declaration outside every block is refused' \
  'declaration outside a palette block' \
  '--ground: #f5f8fa;
:root { --ground: #ffffff; }'

check_refused 'a media query the sheet has no business carrying is refused' \
  'only @media the token sheet may carry' \
  ':root { --ground: #f5f8fa; }
@media (max-width: 700px) {
  :root { --ground: #ffffff; }
}'

check_refused 'a nested media query is refused' \
  'nested @media' \
  '@media (prefers-color-scheme: dark) {
  @media (prefers-color-scheme: dark) {
    :root { --ground: #12181d; }
  }
}'

check_refused 'an unterminated block is refused' \
  'unterminated block' \
  ':root {
  --ground: #f5f8fa;'

check_refused 'an unterminated comment is refused' \
  'unterminated comment' \
  ':root {
  --ground: #f5f8fa;
}
/* and then nothing closed it'

check_refused 'a stray closing brace is refused' \
  'unbalanced \}' \
  ':root { --ground: #f5f8fa; }
}'

# The dark palette outside the media query is not the unset case, so the parser does not
# let a sheet claim it is.
check_refused 'the unset-case selector outside the media query is not the system block' \
  'only palette blocks, not: :root:not' \
  ':root:not([data-theme="light"]) { --ground: #12181d; }'

# ---------------------------------------------------------------------------
# The committed sheet
# ---------------------------------------------------------------------------

printf '\nThe committed sheet\n'

if [ -f "$SHEET" ]; then
  for block in light dark system; do
    if awk -f "$PARSER" -v block="$block" "$SHEET" > "$work/$block.tsv" 2>"$work/err"; then
      pass "the committed sheet's $block block parses"
    else
      fail "the committed sheet's $block block parses ($(cat "$work/err"))"
    fi
  done
  check_run 'the committed sheet has nothing outside its blocks' \
    sh -c "test -z \"\$(awk -f '$PARSER' -v mode=outside '$SHEET')\""
  check_run 'the committed dark blocks agree' \
    cmp -s "$work/dark.tsv" "$work/system.tsv"
  check_matches "$(cut -f1 < "$work/light.tsv" | tr '\n' ' ')" '\-\-accent .*--sp-4' \
    'the light block carries both the palette and the scales'
else
  fail "the committed sheet exists ($SHEET)"
fi

check_summary
