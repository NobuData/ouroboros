#!/usr/bin/env sh
#
# verify-tokens.test.sh — integration tests for scripts/verify-tokens.sh.
#
# The script is run against synthetic repository trees rather than this checkout, so the
# tests pin the contract independently of the palette that currently satisfies it: the
# fixture is a minimal tree that passes every check, and each case copies it, breaks exactly
# one thing, and asserts that the matching check — and the run — fails.
#
# The fixture's palette is four tokens and its contrast table three rows, with ratios worked
# out from the same arithmetic the script uses. That is not circular: contrast.test.sh pins
# the arithmetic against WCAG's own fixed points, and what these cases pin is the plumbing
# — that a drifted ratio, a palette below AA, a dark block that disagrees with itself and a
# literal outside the token blocks each fail, and fail saying which.
#
# The fixture's PNGs are headers and nothing else, because the header is all the script
# reads: whether the renders are *good* is a judgement made by looking at them.
#
# The committed sheet, document and renders are exercised once at the end, which is what
# proves the checks and the real palette agree.
#
# Usage:
#   scripts/tests/verify-tokens.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$SCRIPTS_DIR")
VERIFY="$SCRIPTS_DIR/verify-tokens.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# byte VALUE — write one raw byte.
byte() {
  printf "$(printf '\\%03o' "$1")"
}

# be32 VALUE — write a 32-bit big-endian integer, the way PNG stores a dimension.
be32() {
  byte $(((  $1 / 16777216 ) % 256 ))
  byte $((( $1 / 65536 ) % 256 ))
  byte $((( $1 / 256 ) % 256 ))
  byte $(( $1 % 256 ))
}

# write_png FILE WIDTH HEIGHT — write a PNG signature and IHDR chunk, and nothing else.
write_png() {
  {
    printf '\211PNG\r\n\032\n'
    printf '\000\000\000\015IHDR'
    be32 "$2"
    be32 "$3"
    byte 8
    byte 2
    printf '\000\000\000'
    printf 'crc.'
  } > "$1"
}

# make_fixture DIR — write a repository tree that satisfies every check.
make_fixture() {
  fixture=$1
  mkdir -p "$fixture/docs/design" "$fixture/docs/mockups/assets" \
           "$fixture/scripts" "$fixture/ouroboros-ui"

  cat > "$fixture/docs/design/tokens.css" <<'SHEET'
:root {
  color-scheme: light;
  --ground: #f5f8fa;
  --ink: #16232b;
  --line: #d4dee5;
  --sp-4: 0.5rem;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --ground: #12181d;
  --ink: #e9f2f6;
  --line: #253039;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --ground: #12181d;
    --ink: #e9f2f6;
    --line: #253039;
  }
}
SHEET

  cat > "$fixture/docs/design/tokens-preview.html" <<'PREVIEW'
<!doctype html>
<html lang="en" data-theme="light">
<head><link rel="stylesheet" href="tokens.css"></head>
<body style="background: var(--ground); color: var(--ink)">every colour is a token</body>
</html>
PREVIEW

  write_png "$fixture/docs/design/preview-light.png" 1440 1660
  write_png "$fixture/docs/design/preview-dark.png" 1440 1660

  # The mockups' sheet the dark palette is extracted from, carrying the three source
  # variables this fixture's palette inherits. The rest of the carried-over set is absent on
  # purpose: provenance compares what both sheets define, so a fixture with a three-token
  # palette makes three comparisons.
  cat > "$fixture/docs/mockups/assets/ouroboros.css" <<'MOCKUP'
:root {
  --bg1: #12181d;
  --border: #253039;
  --ink: #e9f2f6;
}
MOCKUP

  cat > "$fixture/scripts/render-token-preview.sh" <<'RENDERER'
#!/usr/bin/env sh
# Fixture renderer. Screenshots docs/design/tokens-preview.html in both palettes.
RENDERER
  chmod +x "$fixture/scripts/render-token-preview.sh"

  printf 'See [the sheet](design/tokens.css).\n' > "$fixture/docs/CONVENTIONS.md"
  printf 'See [the tokens](docs/DESIGN_TOKENS.md).\n' > "$fixture/README.md"
  printf 'See [the tokens](../docs/DESIGN_TOKENS.md).\n' > "$fixture/ouroboros-ui/README.md"

  write_doc "$fixture" \
    '| `--ink` | `--ground` | body text on the page | 4.5:1 | 15.04 | 15.75 |' \
    '| `--line` | `--ground` | hairline | — | 1.28 | 1.33 |'
}

# write_doc DIR ROW... — write the fixture's DESIGN_TOKENS.md with the given contrast rows.
#
# A parameter because half the cases are about what the document claims: a ratio that has
# drifted from the sheet, a minimum the palette misses, a token measured nowhere.
write_doc() {
  doc_dir=$1
  shift
  {
    cat <<'HEAD'
# Fixture — design tokens

The sheet is [`design/tokens.css`](design/tokens.css), the preview is
[`design/tokens-preview.html`](design/tokens-preview.html), the renderer is
[`render-token-preview.sh`](../scripts/render-token-preview.sh).

## Where this goes

Into the application, in #40.

## Where the two palettes came from

Dark extracted, light derived.

## Structure

Three blocks.

## The palette

| Token | Light | Dark | What it is |
|---|---|---|---|
| `--ground` | `#f5f8fa` | `#12181d` | The page |
| `--ink` | `#16232b` | `#e9f2f6` | Body text |
| `--line` | `#d4dee5` | `#253039` | Separators |

## Type

| Token | Value | Dark override | What it is |
|---|---|---|---|
| `--sp-4` | `0.5rem` | — | 8px |

## Spacing

Covered above.

## Contrast

Text is held to 4.5:1 and non-text chrome to 3:1.

| Ink | On | Where | Minimum | Light | Dark |
|---|---|---|---|---|---|
HEAD
    for row in "$@"; do
      printf '%s\n' "$row"
    done
    cat <<'TAIL'

## Departures from the mockup sheet

None.

## The preview page

| Render | Pixels | Palette |
|---|---|---|
| [`design/preview-light.png`](design/preview-light.png) | 1440×1660 | light |
| [`design/preview-dark.png`](design/preview-dark.png) | 1440×1660 | dark |

## Verifying and regenerating

```bash
scripts/verify-tokens.sh
```
TAIL
  } > "$doc_dir/docs/DESIGN_TOKENS.md"
}

# make_doc_row ROW... — rewrite the fixture's document with exactly these contrast rows.
# Used by the cases that are about what the document claims rather than what the sheet says.
make_doc_row() {
  write_doc "$root" "$@"
}

# run_verify DIR — run the script, leaving combined output in $out and the status in
# $status.
run_verify() {
  out=$("$VERIFY" --root "$1" 2>&1)
  status=$?
}

# check_break DESCRIPTION PATTERN MUTATION — build a fresh fixture in $root, apply the
# MUTATION snippet to it, and assert the run fails reporting PATTERN.
check_break() {
  description=$1
  pattern=$2
  mutation=$3

  root="$work/case"
  rm -rf "$root"
  make_fixture "$root"
  eval "$mutation"

  run_verify "$root"
  if [ "$status" -ne 0 ] && printf '%s\n' "$out" | grep -Eq -- "^  FAIL .*$pattern"; then
    pass "$description"
  else
    fail "$description (status $status, no FAIL matching /$pattern/)"
  fi
}

printf '\nverify-tokens.sh\n\n'

# ---------------------------------------------------------------------------
# The passing baseline
# ---------------------------------------------------------------------------

printf 'A conforming tree\n'

good="$work/good"
make_fixture "$good"
run_verify "$good"
check_equals 0 "$status" 'a conforming tree passes'
check_matches "$out" '0 failed' 'a conforming tree reports no failures'
check_matches "$out" 'Design tokens' 'the report names what it checked'
check_matches "$out" '\-\-ink on --ground — 15\.04 light / 15\.75 dark' \
  'each contrast row is reported with both recomputed ratios'

# ---------------------------------------------------------------------------
# The sheet
# ---------------------------------------------------------------------------

printf '\nSheet violations\n'

check_break 'a missing sheet is reported' \
  'docs/design/tokens\.css exists' \
  'rm "$root/docs/design/tokens.css"'

# The acceptance criterion for #16: colour literals live in the palette blocks or nowhere.
check_break 'a component rule in the sheet is reported' \
  'palette block parses' \
  'printf ".card { background: #ff0000; }\n" >> "$root/docs/design/tokens.css"'

check_break 'a declaration between the blocks is reported' \
  'declares nothing outside the palette blocks|palette block parses' \
  'printf -- "--rogue: #ff0000;\n" >> "$root/docs/design/tokens.css"'

# The failure nobody sees until they toggle the theme.
check_break 'a dark palette that disagrees with the unset case is reported' \
  'the two dark blocks are identical' \
  'sed -i "s/^  --ground: #12181d;$/  --ground: #101418;/" "$root/docs/design/tokens.css"'

check_break 'a missing color-scheme is reported' \
  'declares color-scheme: light' \
  'sed -i "s/^  color-scheme: light;$//" "$root/docs/design/tokens.css"'

printf '\nParity violations\n'

# A colour the dark block forgets stays light in dark mode.
check_break 'a colour that is not themed is reported' \
  '\-\-line is themed' \
  'sed -i "/^  --line: #253039;$/d" "$root/docs/design/tokens.css"'

# A scale redefined per theme is a scale that can disagree with itself.
check_break 'a theme-independent token redefined in dark is reported' \
  '\-\-sp-4 is theme-independent' \
  'sed -i "s/^  --ink: #e9f2f6;$/  --ink: #e9f2f6; --sp-4: 0.25rem;/" "$root/docs/design/tokens.css"'

check_break 'a dark-only token is reported' \
  'is defined on :root' \
  'sed -i "s/^  --line: #253039;$/  --line: #253039; --shadow: #000000;/" "$root/docs/design/tokens.css"'

printf '\nProvenance violations\n'

# The committed dark identity: a drift on either side of it is the same bug.
check_break "a dark token that no longer matches the mockups' sheet is reported" \
  "\-\-ink still carries the mockups' --ink" \
  'sed -i "s/--ink: #e9f2f6;/--ink: #e8f1f5;/g" "$root/docs/design/tokens.css"'

check_break 'a mockup sheet that has moved on is reported too' \
  "\-\-ground still carries the mockups' --bg1" \
  'sed -i "s/--bg1: #12181d;/--bg1: #11171c;/" "$root/docs/mockups/assets/ouroboros.css"'

check_break 'a missing mockup sheet is reported' \
  'ouroboros\.css exists' \
  'rm "$root/docs/mockups/assets/ouroboros.css"'

# ---------------------------------------------------------------------------
# The preview and its renders
# ---------------------------------------------------------------------------

printf '\nPreview violations\n'

check_break 'a missing preview page is reported' \
  'tokens-preview\.html exists' \
  'rm "$root/docs/design/tokens-preview.html"'

check_break 'a preview that does not link the sheet is reported' \
  'the preview links the token sheet' \
  'sed -i "s/tokens\.css/tokens-other.css/" "$root/docs/design/tokens-preview.html"'

# The whole point of the preview: a page that needs a literal is a sheet with a hole in it.
check_break 'a hex literal in the preview is reported' \
  'the preview carries no colour literal' \
  'sed -i "s/var(--ground)/#fafafa/" "$root/docs/design/tokens-preview.html"'

check_break 'an rgba() literal in the preview is reported' \
  'the preview carries no colour literal' \
  'sed -i "s/var(--ink)/rgba(0, 0, 0, 0.8)/" "$root/docs/design/tokens-preview.html"'

printf '\nRender violations\n'

check_break 'a missing render is reported' \
  'preview-dark\.png exists' \
  'rm "$root/docs/design/preview-dark.png"'

check_break 'a render that is not a PNG is reported' \
  'preview-light\.png is a PNG' \
  'printf "not a png" > "$root/docs/design/preview-light.png"'

check_break 'a render re-taken at another size is reported' \
  'publishes preview-light\.png' \
  'write_png "$root/docs/design/preview-light.png" 1280 1024'

check_break 'a pair of renders that cannot be compared is reported' \
  'both renders are the same size' \
  'write_png "$root/docs/design/preview-dark.png" 1440 1660
   write_png "$root/docs/design/preview-light.png" 1440 1660
   sed -i "s/1440×1660 | light/1280×1024 | light/" "$root/docs/DESIGN_TOKENS.md"
   write_png "$root/docs/design/preview-light.png" 1280 1024'

check_break 'a renderer that cannot be run is reported' \
  'render-token-preview\.sh is executable' \
  'chmod -x "$root/scripts/render-token-preview.sh"'

# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------

printf '\nDocument violations\n'

check_break 'a missing section is reported' \
  'the departures from the mockups have a section' \
  'sed -i "s/^## Departures from the mockup sheet$/## Notes/" "$root/docs/DESIGN_TOKENS.md"'

check_break 'an unclosed code fence is reported' \
  'every code fence is closed' \
  'printf "\n\`\`\`\nunclosed\n" >> "$root/docs/DESIGN_TOKENS.md"'

check_break 'a broken link is reported' \
  'the link to design/tokens-elsewhere\.css resolves' \
  'sed -i "s|(design/tokens\.css)|(design/tokens-elsewhere.css)|" "$root/docs/DESIGN_TOKENS.md"'

printf '\nCatalogue violations\n'

check_break 'a token the catalogue does not document is reported' \
  'documents every token the sheet defines' \
  'sed -i "/| \`--line\` | \`#d4dee5\`/d" "$root/docs/DESIGN_TOKENS.md"'

# A token documented twice would otherwise cover for one documented nowhere, since the
# count would still come out right.
check_break 'a token documented twice is reported' \
  'the catalogue documents each token once' \
  'sed -i "/^| \`--ink\` | \`#16232b\`/a| \`--ink\` | \`#16232b\` | \`#e9f2f6\` | Body text, again |" \
     "$root/docs/DESIGN_TOKENS.md"'

check_break 'a catalogue value that has drifted from the sheet is reported' \
  'publishes --ground as the sheet defines it' \
  'sed -i "s/| \`--ground\` | \`#f5f8fa\`/| \`--ground\` | \`#f4f7f9\`/" "$root/docs/DESIGN_TOKENS.md"'

check_break "a catalogue dark value that has drifted is reported" \
  "publishes --ink's dark value correctly" \
  'sed -i "s/| \`--ink\` | \`#16232b\` | \`#e9f2f6\`/| \`--ink\` | \`#16232b\` | \`#e8f1f5\`/" "$root/docs/DESIGN_TOKENS.md"'

check_break 'a scale documented as themed is reported' \
  'shows --sp-4 has no dark override|publishes --sp-4' \
  'sed -i "s/| \`--sp-4\` | \`0.5rem\` | — |/| \`--sp-4\` | \`0.5rem\` | \`0.25rem\` |/" "$root/docs/DESIGN_TOKENS.md"'

printf '\nContrast violations\n'

# A hand-maintained ratio is a ratio that stops being true. The published number and the
# sheet are compared, not trusted.
check_break 'a published ratio that no longer matches the sheet is reported' \
  'the document publishes 15\.99, the sheet gives 15\.04' \
  'make_doc_row "| \`--ink\` | \`--ground\` | body text | 4.5:1 | 15.99 | 15.75 |" \
                "| \`--line\` | \`--ground\` | hairline | — | 1.28 | 1.33 |"'

check_break 'a palette that falls below its published minimum is reported' \
  'below the published minimum of 4\.5' \
  'sed -i "s/--ink: #16232b;/--ink: #b8c4ca;/" "$root/docs/design/tokens.css"
   make_doc_row "| \`--ink\` | \`--ground\` | body text | 4.5:1 | 1.67 | 15.75 |" \
                "| \`--line\` | \`--ground\` | hairline | — | 1.28 | 1.33 |"
   sed -i "s/| \`--ink\` | \`#16232b\`/| \`--ink\` | \`#b8c4ca\`/" "$root/docs/DESIGN_TOKENS.md"'

check_break 'a row naming a token the sheet does not define is reported' \
  'both tokens exist in the light palette' \
  'make_doc_row "| \`--ink\` | \`--nonexistent\` | nowhere | 4.5:1 | 1.00 | 1.00 |"'

# A tint has no ratio without the surface below it, so the row has to name one — and the
# named one has to exist.
check_break 'a composited row naming a surface the sheet does not define is reported' \
  'over --nonexistent' \
  'make_doc_row "| \`--ink\` | \`--line\` over \`--nonexistent\` | nowhere | 4.5:1 | 1.00 | 1.00 |"'

check_break 'a colour token that no contrast table measures is reported' \
  '\-\-line appears in a contrast table' \
  'make_doc_row "| \`--ink\` | \`--ground\` | body text on the page | 4.5:1 | 15.04 | 15.75 |"'

check_break 'a document with no contrast table at all is reported' \
  'at least one row' \
  'sed -i "/^| \`--ink\` | \`--ground\` | body text on the page/d;/^| \`--line\` | \`--ground\` | hairline/d" \
     "$root/docs/DESIGN_TOKENS.md"'

# ---------------------------------------------------------------------------
# The documents that point here
# ---------------------------------------------------------------------------

printf '\nCross-reference violations\n'

check_break 'conventions that no longer point at the sheet is reported' \
  'CONVENTIONS\.md points at the sheet' \
  'printf "no mention\n" > "$root/docs/CONVENTIONS.md"'

check_break 'a root README that no longer links the document is reported' \
  'root README links the document' \
  'printf "no mention\n" > "$root/README.md"'

check_break 'a module README that no longer links the document is reported' \
  'ouroboros-ui README links the document' \
  'printf "no mention\n" > "$root/ouroboros-ui/README.md"'

# ---------------------------------------------------------------------------
# The committed tree
# ---------------------------------------------------------------------------

printf '\nThe committed sheet, document and renders\n'

run_verify "$ROOT"
check_equals 0 "$status" 'the repository passes its own token checks'
check_matches "$out" '0 failed' 'the committed palette reports no failures'

check_summary
