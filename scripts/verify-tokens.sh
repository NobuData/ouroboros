#!/usr/bin/env sh
#
# verify-tokens.sh — assert the design token sheet established by issue #16.
#
# docs/design/tokens.css is the product's whole colour vocabulary, docs/DESIGN_TOKENS.md is
# the document that publishes it, and docs/design/tokens-preview.html is the page that
# proves the sheet is sufficient. All three can drift apart, and two of the ways they can
# are invisible until somebody with a screen reader or a bright window finds them: a
# palette edit that drops a ratio below AA, and a dark palette that no longer matches
# itself between "the user asked for dark" and "the OS is dark".
#
# So this script does not check colours against fixed numbers. It reads the sheet, and:
#
#   - refuses anything in it but the three palette blocks — that is the mechanical form of
#     "no literal colour values outside the token blocks";
#   - holds the two dark blocks to being identical;
#   - holds the palettes to each other, so no colour is themed in one and not the other,
#     and no theme-independent token is redefined per theme;
#   - holds the dark palette to docs/mockups/assets/ouroboros.css, the committed identity
#     it was extracted from, token by carried-over token;
#   - holds the preview page to containing no colour literal at all;
#   - holds the application's copy of the sheet byte-identical to it, because "copy, do
#     not fork" is only a rule if something notices the fork;
#   - holds the document to the sheet in both directions — every token documented with the
#     value the sheet gives it, and no token documented that the sheet does not define;
#   - recomputes every contrast ratio the document publishes, with
#     scripts/lib/contrast.awk, and fails a row that has drifted or fallen below its
#     published minimum.
#
# What a shell script cannot see, it does not claim: whether a palette is *handsome* is a
# judgement, which is what the two committed renders of the preview page are for.
#
# Usage:
#   scripts/verify-tokens.sh              # run from anywhere; resolves the repo root
#   scripts/verify-tokens.sh --root DIR   # check DIR instead (used by the tests)
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
      [ $# -ge 2 ] || { printf 'verify-tokens: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$2" && pwd)
      shift 2
      ;;
    -h | --help)
      sed -n '2,38p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'verify-tokens: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# The assertion harness, shared with the repo's other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

SHEET=docs/design/tokens.css
ADOPTED=ouroboros-ui/app/tokens.css
GLOBALS=ouroboros-ui/app/globals.css
PREVIEW=docs/design/tokens-preview.html
DOC=docs/DESIGN_TOKENS.md
MOCKUP_SHEET=docs/mockups/assets/ouroboros.css
RENDERER=scripts/render-token-preview.sh
TOKENS_AWK="$SCRIPT_DIR/lib/tokens.awk"
CONTRAST_AWK="$SCRIPT_DIR/lib/contrast.awk"
RENDERS='preview-light.png preview-dark.png'

# Any colour a stylesheet can spell, used to prove their absence in the preview page: `#`
# followed by exactly 3, 4, 6 or 8 hex digits and then something that is not part of the
# word, or any of the colour functions. The lengths are CSS's own, which is what keeps an
# `href="#faced"` out of the results.
COLOUR_LITERAL='#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})([^0-9a-zA-Z-]|$)|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\('

# What the dark palette inherited from the mockups' sheet, as `token=source-variable`
# pairs. Every one of these is expected to be the same literal in both files; the three
# tokens that deliberately differ are named in DESIGN_TOKENS.md's Departures section and
# are absent here on purpose.
PROVENANCE='--ground-deep=--bg0
--ground=--bg1
--surface=--surface
--raised=--raised
--inset=--inset
--line=--border
--line-strong=--border-strong
--ink=--ink
--ink-dim=--ink-dim
--ink-mut=--mut
--accent=--accent
--accent-deep=--accent-deep
--accent-ink=--accent-ink
--ok=--ok
--warn=--warn
--err=--err
--model=--model
--f-disp=--f-disp
--f-ui=--f-ui
--f-mono=--f-mono'

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

printf '\nDesign tokens — %s\n\n' "$ROOT"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# read_block BLOCK OUT — write the BLOCK palette's declarations to OUT as TSV.
# Returns non-zero when the parser refuses the sheet, so a caller can stop rather than
# assert its way through an empty file.
read_block() {
  awk -f "$TOKENS_AWK" -v block="$1" "$SHEET" > "$2" 2>"$work/parse.err"
}

# token_value FILE NAME — print the value FILE gives a property, or nothing.
token_value() {
  awk -F'\t' -v name="$2" '$1 == name { print $2; exit }' "$1"
}

# is_colour VALUE — succeed when VALUE is a colour rather than a length, family or number.
is_colour() {
  case $1 in
    '#'* | rgb\(* | rgba\(* | hsl\(* | hsla\(*) return 0 ;;
    *) return 1 ;;
  esac
}

# mockup_value NAME — print the value the mockups' sheet gives a custom property.
mockup_value() {
  awk -v name="$1" '
    index($0, name ":") == 0 { next }
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      if (index(line, name ":") != 1) { next }
      value = substr(line, length(name) + 2)
      sub(/;.*$/, "", value)
      sub(/\/\*.*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/[[:space:]]+/, " ", value)
      print value
      exit
    }
  ' "$MOCKUP_SHEET"
}

# ratio_meets RATIO MINIMUM — succeed when RATIO is at or above MINIMUM.
# Shell arithmetic is integer-only, so the comparison is awk's.
ratio_meets() {
  awk -v ratio="$1" -v minimum="$2" 'BEGIN { exit !(ratio + 0 >= minimum + 0) }'
}

# ---------------------------------------------------------------------------
# The sheet
# ---------------------------------------------------------------------------

printf 'Sheet\n'
check_exists "$SHEET" "$SHEET exists"
check_exists "$TOKENS_AWK" 'scripts/lib/tokens.awk exists'
check_exists "$CONTRAST_AWK" 'scripts/lib/contrast.awk exists'

parsed=yes
for block in light dark system; do
  if read_block "$block" "$work/$block.tsv"; then
    pass "the $block palette block parses"
  else
    fail "the $block palette block parses ($(tr '\n' ' ' < "$work/parse.err"))"
    parsed=no
    : > "$work/$block.tsv"
  fi
done

# The mechanical form of "no literal color values outside the token blocks": the parser
# emits every line that is not inside one of the three, and a well-formed sheet has none.
if awk -f "$TOKENS_AWK" -v mode=outside "$SHEET" > "$work/outside" 2>/dev/null; then
  outside=$(wc -l < "$work/outside" | tr -d ' ')
  check_equals '0' "$outside" 'the sheet declares nothing outside the palette blocks'
else
  fail 'the sheet declares nothing outside the palette blocks (the sheet does not parse)'
fi

# CSS cannot share a declaration block across a media boundary, so the dark palette is
# written twice. A difference between them only shows up when a user toggles the theme.
if [ "$parsed" = yes ] && diff "$work/dark.tsv" "$work/system.tsv" > "$work/dark.diff" 2>&1; then
  pass 'the two dark blocks are identical'
else
  fail "the two dark blocks are identical ($(head -n 4 "$work/dark.diff" | tr '\n' ' '))"
fi

# color-scheme is what makes native scrollbars and form controls follow the theme.
check_equals 'light' "$(token_value "$work/light.tsv" color-scheme)" \
  'the light block declares color-scheme: light'
check_equals 'dark' "$(token_value "$work/dark.tsv" color-scheme)" \
  'the dark block declares color-scheme: dark'
check_equals 'dark' "$(token_value "$work/system.tsv" color-scheme)" \
  'the unset-case block declares color-scheme: dark'

printf '\nPalette parity\n'

# Every colour on :root is themed, and nothing else is: a colour the dark block forgets
# stays light in dark mode, and a spacing step redefined per theme is a scale that can
# disagree with itself.
colour_tokens=0
parity=0
while IFS="$(printf '\t')" read -r name value; do
  case $name in --*) ;; *) continue ;; esac
  dark=$(token_value "$work/dark.tsv" "$name")
  if is_colour "$value"; then
    colour_tokens=$((colour_tokens + 1))
    if [ -z "$dark" ]; then
      fail "$name is themed (the dark block does not redefine it)"
      parity=$((parity + 1))
    fi
  elif [ -n "$dark" ]; then
    fail "$name is theme-independent (the dark block redefines it as $dark)"
    parity=$((parity + 1))
  fi
done < "$work/light.tsv"
[ "$parity" -gt 0 ] ||
  pass "every colour token is themed and every other token is not ($colour_tokens colours)"

# A token the dark block invents is a token no light-mode user ever gets.
strays=0
while IFS="$(printf '\t')" read -r name value; do
  case $name in --*) ;; *) continue ;; esac
  if [ -z "$(token_value "$work/light.tsv" "$name")" ]; then
    fail "$name is defined on :root (dark-only token)"
    strays=$((strays + 1))
  fi
  if ! is_colour "$value"; then
    fail "the dark block redefines colour only ($name is $value)"
    strays=$((strays + 1))
  fi
done < "$work/dark.tsv"
[ "$strays" -gt 0 ] ||
  pass 'the dark block defines only colours the light block already defines'

printf '\nProvenance\n'
check_exists "$MOCKUP_SHEET" "$MOCKUP_SHEET exists"
printf '%s\n' "$PROVENANCE" > "$work/provenance"
carried=0
while IFS='=' read -r token source; do
  [ -n "$token" ] || continue
  # The families are theme-independent and live on :root; everything else carried over is
  # part of the dark palette.
  case $token in
    --f-*) mine=$(token_value "$work/light.tsv" "$token") ;;
    *) mine=$(token_value "$work/dark.tsv" "$token") ;;
  esac
  # A token the sheet does not define is not this check's business — renaming one is a wide,
  # deliberate edit the catalogue and coverage checks already refuse to let through quietly.
  # A token it does define has to still be the literal the mockups set, and a mockup sheet
  # that has lost the source variable fails here as the drift it is.
  [ -n "$mine" ] || continue
  carried=$((carried + 1))
  check_equals "$(mockup_value "$source")" "$mine" \
    "$token still carries the mockups' $source"
done < "$work/provenance"
if [ "$carried" -gt 0 ]; then
  pass "$carried tokens were compared against the mockups' sheet"
else
  fail "the dark palette is compared against the mockups' sheet (nothing carried over)"
fi

# ---------------------------------------------------------------------------
# The preview page
# ---------------------------------------------------------------------------

printf '\nPreview\n'
check_exists "$PREVIEW" "$PREVIEW exists"
check_contains "$PREVIEW" 'href="tokens\.css"' 'the preview links the token sheet'
check_contains "$PREVIEW" 'data-theme' 'the preview can stamp data-theme'

# The acceptance criterion, made visible: a page that renders the whole design system
# without one colour literal is a page whose sheet is complete.
if [ -f "$PREVIEW" ] && grep -nE "$COLOUR_LITERAL" "$PREVIEW" > "$work/literals" 2>/dev/null; then
  fail "the preview carries no colour literal (line $(head -n 1 "$work/literals" | cut -d: -f1))"
else
  pass 'the preview carries no colour literal'
fi

printf '\nRenders\n'
check_exists "$RENDERER" "$RENDERER exists"
check_executable "$RENDERER" "$RENDERER is executable"
check_contains "$RENDERER" 'tokens-preview\.html' "$RENDERER renders the preview page"

pair_size=''
for name in $RENDERS; do
  file="docs/design/$name"
  check_exists "$file" "$name exists"
  header=$(png_header "$file" || true)
  if [ -z "$header" ]; then
    fail "$name is a PNG (no PNG signature or IHDR)"
    continue
  fi
  pass "$name is a PNG"
  set -- $header
  # A render whose size the document does not publish is a render nobody can tell has been
  # re-taken at another size, and the pair has to match for the two to be comparable.
  check_equals "$(documented_size "$name" "$DOC")" "${1}×${2}" \
    "$DOC publishes $name as ${1}×${2}"
  if [ -z "$pair_size" ]; then
    pair_size="${1}×${2}"
  else
    check_equals "$pair_size" "${1}×${2}" 'both renders are the same size'
  fi
done

# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------

printf '\nDocument\n'
check_exists "$DOC" "$DOC exists"
check_contains "$DOC" '^# .*[Dd]esign tokens' "$DOC opens with a design-token title"

# One section per question the sheet has to answer for whoever is adopting it.
check_contains "$DOC" '^#+ .*[Ww]here this goes' 'the adopters have a section'
check_contains "$DOC" '^#+ .*palettes came from' 'the derivation has a section'
check_contains "$DOC" '^#+ .*[Ss]tructure' 'the three blocks have a section'
check_contains "$DOC" '^#+ .*[Tt]he palette' 'the palette has a section'
check_contains "$DOC" '^#+ .*[Tt]ype' 'type has a section'
check_contains "$DOC" '^#+ .*[Ss]pacing' 'spacing has a section'
check_contains "$DOC" '^#+ .*[Cc]ontrast' 'contrast has a section'
check_contains "$DOC" '^#+ .*[Dd]epartures' 'the departures from the mockups have a section'
check_contains "$DOC" '^#+ .*[Vv]erifying' 'verification has a section'

# The two thresholds the palettes are held to, named where a reader can find them.
check_contains "$DOC" '4\.5:1' 'the document names the text minimum'
check_contains "$DOC" '3:1|3\.0:1' 'the document names the non-text minimum'

# An unclosed fence swallows the rest of the page into a code block.
fences=$(grep -c '^```' "$DOC" 2>/dev/null || true)
if [ "$((${fences:-0} % 2))" -eq 0 ]; then
  pass 'every code fence is closed'
else
  fail "every code fence is closed (odd number of fences: $fences)"
fi

printf '\nCatalogue\n'

# The catalogue rows: `--token` | value | dark value or — | prose. Every token in the
# sheet has to appear with the value the sheet gives it, and nothing may be documented
# that the sheet does not define.
awk -F'|' '
  NF != 6 { next }        # a four-column row: one empty cell either side of the pipes
  {
    for (i = 1; i <= NF; i++) {
      cell[i] = $i
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", cell[i])
    }
    if (cell[2] !~ /^`--[a-z0-9-]+`$/) { next }
    if (cell[3] !~ /^`.+`$/) { next }
    gsub(/`/, "", cell[2]); gsub(/`/, "", cell[3]); gsub(/`/, "", cell[4])
    printf "%s\t%s\t%s\n", cell[2], cell[3], cell[4]
  }
' "$DOC" > "$work/catalogue.tsv"

documented=$(wc -l < "$work/catalogue.tsv" | tr -d ' ')
defined=$(grep -c '^--' "$work/light.tsv" || true)
# One row per token, and a row for every token: the count and the uniqueness together are
# what stop a token documented twice covering for one documented nowhere.
distinct=$(cut -f1 < "$work/catalogue.tsv" | sort -u | wc -l | tr -d ' ')
check_equals "$documented" "$distinct" 'the catalogue documents each token once'
check_equals "$defined" "$documented" 'the catalogue documents every token the sheet defines'

while IFS="$(printf '\t')" read -r name light dark; do
  actual_light=$(token_value "$work/light.tsv" "$name")
  if [ -z "$actual_light" ]; then
    fail "$DOC documents $name, which the sheet does not define"
    continue
  fi
  check_equals "$actual_light" "$light" "the catalogue publishes $name as the sheet defines it"
  actual_dark=$(token_value "$work/dark.tsv" "$name")
  if [ "$dark" = '—' ]; then
    check_equals '' "$actual_dark" "the catalogue shows $name has no dark override"
  else
    check_equals "$actual_dark" "$dark" "the catalogue publishes $name's dark value correctly"
  fi
done < "$work/catalogue.tsv"

printf '\nContrast\n'

# The contrast rows: ink | on | where | minimum | light ratio | dark ratio, where the
# minimum is `N:1` or `—` and the background may be `--tint` over `--surface`. Recomputed
# rather than trusted, because a hand-maintained ratio is a ratio that stops being true.
awk -F'|' '
  NF != 8 { next }        # a six-column row
  {
    for (i = 1; i <= NF; i++) {
      cell[i] = $i
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", cell[i])
    }
    if (cell[5] !~ /^([0-9]+(\.[0-9]+)?:1|—)$/) { next }
    if (cell[2] !~ /^`--[a-z0-9-]+`$/) { next }
    gsub(/`/, "", cell[2]); gsub(/`/, "", cell[3])
    sub(/:1$/, "", cell[5])
    printf "%s\t%s\t%s\t%s\t%s\n", cell[2], cell[3], cell[5], cell[6], cell[7]
  }
' "$DOC" > "$work/contrast.tsv"

rows=$(wc -l < "$work/contrast.tsv" | tr -d ' ')
if [ "$rows" -gt 0 ]; then
  pass "the contrast tables publish $rows rows"
else
  fail 'the contrast tables publish at least one row (none parsed)'
fi

: > "$work/measured"
while IFS="$(printf '\t')" read -r ink on minimum want_light want_dark; do
  # "--tint over --surface" is a translucent colour and the opaque surface below it.
  under=''
  case $on in
    *' over '*)
      under=${on##* over }
      on=${on%% over *}
      ;;
  esac
  printf '%s\n%s\n%s\n' "$ink" "$on" "$under" >> "$work/measured"

  row_ok=yes
  for theme in light dark; do
    fg=$(token_value "$work/$theme.tsv" "$ink")
    bg=$(token_value "$work/$theme.tsv" "$on")
    if [ -z "$fg" ] || [ -z "$bg" ]; then
      fail "$ink on $on: both tokens exist in the $theme palette"
      row_ok=no
      continue
    fi
    below=''
    if [ -n "$under" ]; then
      below=$(token_value "$work/$theme.tsv" "$under")
      if [ -z "$below" ]; then
        fail "$ink on $on over $under: $under exists in the $theme palette"
        row_ok=no
        continue
      fi
    fi
    got=$(awk -f "$CONTRAST_AWK" -v fg="$fg" -v bg="$bg" -v under="$below" 2>&1 || true)
    if [ "$theme" = light ]; then want=$want_light; else want=$want_dark; fi
    if [ "$got" != "$want" ]; then
      fail "$ink on $on ($theme): the document publishes $want, the sheet gives $got"
      row_ok=no
      continue
    fi
    if [ "$minimum" != '—' ] && ! ratio_meets "$got" "$minimum"; then
      fail "$ink on $on ($theme): $got is below the published minimum of $minimum:1"
      row_ok=no
    fi
  done
  [ "$row_ok" = no ] || pass "$ink on $on — $want_light light / $want_dark dark"
done < "$work/contrast.tsv"

# A token nobody measured is a token whose legibility nobody knows.
sort -u "$work/measured" > "$work/measured.sorted"
grep '^--' "$work/light.tsv" > "$work/light.tokens" || true
unmeasured=0
while IFS="$(printf '\t')" read -r name value; do
  is_colour "$value" || continue
  if ! grep -qx -- "$name" "$work/measured.sorted"; then
    fail "$name appears in a contrast table"
    unmeasured=$((unmeasured + 1))
  fi
done < "$work/light.tokens"
[ "$unmeasured" -gt 0 ] || pass 'every colour token is measured in a contrast table'

# ---------------------------------------------------------------------------
# The documents that point here
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Adoption by the application (#40)
# ---------------------------------------------------------------------------
#
# ouroboros-ui carries its own copy of the sheet, because Next.js has to bundle a file
# inside the module. A copy is a fork waiting to happen, so the two are held byte-
# identical here: a palette change is made at the source, where this script and the
# contrast tables can see it, and copied down.
#
# This is the check that spans two directories, which is why it lives at the repository
# level. The complementary rule — that no stylesheet in the module except its copy of the
# sheet writes a colour down — is asserted by the module's own suite, so that it runs in
# ci/ui on every pull request touching the UI.

printf '\nAdoption\n'
check_exists "$ADOPTED" "$ADOPTED exists"
check_exists "$GLOBALS" "$GLOBALS exists"

if [ -f "$SHEET" ] && [ -f "$ADOPTED" ]; then
  if cmp -s "$SHEET" "$ADOPTED"; then
    pass "$ADOPTED is byte-identical to $SHEET"
  else
    fail "$ADOPTED has drifted from $SHEET — copy it down rather than editing it"
  fi
fi

check_contains "$GLOBALS" '@import[[:space:]]*"\./tokens\.css"' \
  'the application imports its copy of the sheet'

printf '\nCross-references\n'
check_contains docs/CONVENTIONS.md 'design/tokens\.css' 'CONVENTIONS.md points at the sheet'
check_contains README.md 'DESIGN_TOKENS\.md' 'the root README links the document'
check_contains ouroboros-ui/README.md 'DESIGN_TOKENS\.md' \
  'the ouroboros-ui README links the document it adopts'

printf '\nLinks\n'
check_markdown_links "$DOC"

check_summary
