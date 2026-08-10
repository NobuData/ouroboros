#!/usr/bin/env sh
#
# verify-brand.test.sh — integration tests for scripts/verify-brand.sh.
#
# The script is run against synthetic repository trees rather than this checkout, so the
# tests pin the contract independently of the assets that currently satisfy it: the
# fixture is a minimal tree that passes every check, and each case copies it, breaks
# exactly one thing, and asserts that the matching check — and the run — fails.
#
# The fixture's PNGs are headers and nothing else. That is not a shortcut: the verifier
# reads the signature and the IHDR chunk and stops, deliberately, because the pixel
# properties (transparency, halos, contrast) belong to the generator's own checks and to
# review by eye. A fixture built out of what the script actually reads is a fixture that
# cannot pass for the wrong reason.
#
# The committed docs/brand/ and docs/BRAND.md are exercised once at the end, which is what
# proves the checks and the real assets agree.
#
# Usage:
#   scripts/tests/verify-brand.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
VERIFY="$SCRIPTS_DIR/verify-brand.sh"

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

# write_png FILE WIDTH HEIGHT DEPTH COLOURTYPE — write a PNG signature and IHDR chunk.
#
# Everything after the header is filler: no image data, no CRC. The verifier never decodes
# a pixel, so this is exactly the part of a PNG it has an opinion about.
write_png() {
  {
    printf '\211PNG\r\n\032\n'
    printf '\000\000\000\015IHDR'
    be32 "$2"
    be32 "$3"
    byte "$4"
    byte "$5"
    printf '\000\000\000'
    printf 'crc.'
  } > "$1"
}

# make_fixture DIR — write a repository tree that satisfies every check.
#
# The smallest tree that can: the sheet, an executable generator, the six assets, and a
# document with one row per file, every required section, both grounds and no broken link.
make_fixture() {
  fixture=$1
  mkdir -p "$fixture/docs/brand" "$fixture/scripts"

  write_png "$fixture/logo-unsplit.png" 1376 768 8 6
  write_png "$fixture/docs/brand/icon-light.png" 512 512 8 6
  write_png "$fixture/docs/brand/icon-dark.png" 512 512 8 6
  write_png "$fixture/docs/brand/glyph-light.png" 512 296 8 6
  write_png "$fixture/docs/brand/glyph-dark.png" 512 296 8 6
  write_png "$fixture/docs/brand/lockup-tagline-light.png" 640 471 8 6
  write_png "$fixture/docs/brand/lockup-tagline-dark.png" 640 471 8 6

  cat > "$fixture/scripts/split-brand-sheet.py" <<'GENERATOR'
#!/usr/bin/env python3
"""Fixture generator. Writes docs/brand from logo-unsplit.png."""
GENERATOR
  chmod +x "$fixture/scripts/split-brand-sheet.py"

  : > "$fixture/docs/CONVENTIONS.md"

  cat > "$fixture/docs/BRAND.md" <<'DOC'
# Fixture — brand assets

Cut from [the sheet](../logo-unsplit.png) by
[split-brand-sheet.py](../scripts/split-brand-sheet.py); the conventions are in
[CONVENTIONS.md](CONVENTIONS.md).

## Source of truth

The sheet is the only original.

## The asset set

| File | Pixels | Working size | Minimum | For |
|---|---|---|---|---|
| [icon-light.png](brand/icon-light.png) | 512×512 | 256×256 | 16 px | Favicons |
| [icon-dark.png](brand/icon-dark.png) | 512×512 | 256×256 | 16 px | Favicons |
| [glyph-light.png](brand/glyph-light.png) | 512×296 | 256×148 | 96 px wide | App shell |
| [glyph-dark.png](brand/glyph-dark.png) | 512×296 | 256×148 | 96 px wide | App shell |
| [lockup-tagline-light.png](brand/lockup-tagline-light.png) | 640×471 | 320×236 | 200 px wide | Login |
| [lockup-tagline-dark.png](brand/lockup-tagline-dark.png) | 640×471 | 320×236 | 200 px wide | Login |

## Which treatment goes on which surface

Dark treatments on `#12181d`, light treatments on `#f5f8fa`.

## Clear space

A quarter of the rendered height, on every side.

## Rules

Do not recolour. Do not use `mix-blend-mode` on them.

## Transparency

The ground is solved for and removed.

## Regenerating and verifying

```bash
scripts/split-brand-sheet.py
```
DOC
}

# run_verify DIR [ARG...] — run the script, leaving combined output in $out and the exit
# status in $status.
run_verify() {
  out=$("$VERIFY" --root "$@" 2>&1)
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

printf '\nverify-brand.sh\n\n'

# ---------------------------------------------------------------------------
# The passing baseline
# ---------------------------------------------------------------------------

printf 'A conforming tree\n'

good="$work/good"
make_fixture "$good"
run_verify "$good"
check_equals 0 "$status" 'a conforming tree passes'
check_matches "$out" '0 failed' 'a conforming tree reports no failures'
check_matches "$out" 'Brand assets' 'the report names what it checked'
check_matches "$out" 'icon-light\.png is 8-bit RGBA' 'the alpha channel is asserted per asset'

# ---------------------------------------------------------------------------
# The source sheet and the generator
# ---------------------------------------------------------------------------

printf '\nSource violations\n'

check_break 'a missing sheet is reported' \
  'logo-unsplit\.png exists' \
  'rm "$root/logo-unsplit.png"'

check_break 'a sheet that is not a PNG is reported' \
  'logo-unsplit\.png is a PNG' \
  'printf "not a png at all" > "$root/logo-unsplit.png"'

# The crop coordinates are pixel positions in one particular rendering, so another
# rendering of the same artwork invalidates every asset in the directory.
check_break 'a re-rendered sheet of another size is reported' \
  'the rendering the crops were derived from' \
  'write_png "$root/logo-unsplit.png" 1400 800 8 6'

check_break 'a missing generator is reported' \
  'split-brand-sheet\.py exists' \
  'rm "$root/scripts/split-brand-sheet.py"'

check_break 'a generator that cannot be run is reported' \
  'split-brand-sheet\.py is executable' \
  'chmod -x "$root/scripts/split-brand-sheet.py"'

check_break 'a generator that no longer writes the asset directory is reported' \
  'split-brand-sheet\.py writes docs/brand' \
  'printf "#!/usr/bin/env python3\n" > "$root/scripts/split-brand-sheet.py"'

# ---------------------------------------------------------------------------
# The assets
# ---------------------------------------------------------------------------

printf '\nAsset violations\n'

check_break 'a missing asset is reported' \
  'icon-light\.png exists' \
  'rm "$root/docs/brand/icon-light.png"'

check_break 'an asset that is not a PNG is reported' \
  'glyph-dark\.png is a PNG' \
  'printf "PNG-ish, but not a PNG" > "$root/docs/brand/glyph-dark.png"'

# Colour type 2 is truecolour without alpha — a flattened export, which is the failure the
# whole asset set exists to prevent.
check_break 'an asset flattened onto a background is reported' \
  'icon-dark\.png is 8-bit RGBA' \
  'write_png "$root/docs/brand/icon-dark.png" 512 512 8 2'

check_break 'an asset at another bit depth is reported' \
  'glyph-light\.png is 8-bit RGBA' \
  'write_png "$root/docs/brand/glyph-light.png" 512 296 16 6'

check_break 'an asset re-exported at another size is reported' \
  'publishes glyph-light\.png' \
  'write_png "$root/docs/brand/glyph-light.png" 400 232 8 6'

# Theme switching swaps one file of a pair for the other, so a pair that disagrees moves
# the layout even when both files match their own documented size.
check_break 'a pair whose two files are different sizes is reported' \
  'the icon pair is one size in both themes' \
  'write_png "$root/docs/brand/icon-dark.png" 500 512 8 6;
   sed -i "/icon-dark\.png/s|512×512|500×512|" "$root/docs/BRAND.md"'

# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------

printf '\nDocument violations\n'

check_break 'a missing document is reported' \
  'docs/BRAND\.md exists' \
  'rm "$root/docs/BRAND.md"'

check_break 'a document without a brand title is reported' \
  'opens with a brand title' \
  'sed -i "1s|.*|# Fixture|" "$root/docs/BRAND.md"'

check_break 'an asset the document never names is reported' \
  'documents lockup-tagline-dark\.png' \
  'sed -i "/lockup-tagline-dark\.png/d" "$root/docs/BRAND.md"'

check_break 'an asset row with no minimum size is reported' \
  'gives icon-light\.png a minimum size' \
  'sed -i "/icon-light\.png/s|16 px|see below|" "$root/docs/BRAND.md"'

check_break 'an asset row that never says what the file is for is reported' \
  'says what glyph-dark\.png is for' \
  'sed -i "/glyph-dark\.png/s|App shell ||" "$root/docs/BRAND.md"'

check_break 'a missing provenance section is reported' \
  'the sheet has a provenance section' \
  'sed -i "s|^## Source of truth|## Origins|" "$root/docs/BRAND.md"'

check_break 'a missing surfaces section is reported' \
  'which treatment goes on which surface has a section' \
  'sed -i "s|^## Which treatment goes on which surface|## Themes|" "$root/docs/BRAND.md"'

check_break 'a missing clear-space section is reported' \
  'clear space has a section' \
  'sed -i "s|^## Clear space|## Spacing|" "$root/docs/BRAND.md"'

check_break 'a missing rules section is reported' \
  'the usage rules have a section' \
  'sed -i "s|^## Rules|## Guidance|" "$root/docs/BRAND.md"'

check_break 'a missing transparency section is reported' \
  'transparency has a section' \
  'sed -i "s|^## Transparency|## Alpha|" "$root/docs/BRAND.md"'

check_break 'a missing regeneration section is reported' \
  'regeneration has a section' \
  'sed -i "s|^## Regenerating and verifying|## Building|" "$root/docs/BRAND.md"'

check_break 'a document that never names the dark ground is reported' \
  'names the dark ground' \
  'sed -i "s|#12181d|the dark one|" "$root/docs/BRAND.md"'

check_break 'a document that never names the light ground is reported' \
  'names the light ground' \
  'sed -i "s|#f5f8fa|the light one|" "$root/docs/BRAND.md"'

# The mockups' crops only work on dark because their background was never removed. A
# document that stops warning against the trick is a document that lets it come back.
check_break 'a document that stops ruling out the blend-mode crops is reported' \
  "rules out the mockups' blend-mode crops" \
  'sed -i "s|mix-blend-mode|that old trick|" "$root/docs/BRAND.md"'

check_break 'a document that stops pointing at the generator is reported' \
  'points at the generator' \
  'sed -i "s|split-brand-sheet\.py|the script|g" "$root/docs/BRAND.md"'

check_break 'an unclosed code fence is reported' \
  'every code fence is closed' \
  'printf "\n\`\`\`sh\nunclosed\n" >> "$root/docs/BRAND.md"'

check_break 'a link to a file that does not exist is reported' \
  'the link to MISSING\.md resolves' \
  'printf "\n[gone](MISSING.md)\n" >> "$root/docs/BRAND.md"'

# The link check is what proves a documented filename is the file on disk: the row can
# name an asset that was never written, and the link in that row catches it.
check_break 'a documented asset missing from the directory is reported' \
  'the link to brand/icon-light\.png resolves' \
  'rm "$root/docs/brand/icon-light.png"'

# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

printf '\nCommand line\n'

out=$("$VERIFY" --help 2>&1)
status=$?
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'Usage:' '--help prints the usage'

out=$("$VERIFY" --nonsense 2>&1)
status=$?
check_equals 2 "$status" 'an unknown argument exits 2'

out=$("$VERIFY" --root 2>&1)
status=$?
check_equals 2 "$status" '--root without a directory exits 2'

# ---------------------------------------------------------------------------
# This repository
# ---------------------------------------------------------------------------

printf '\nThis checkout\n'

REPO_ROOT=$(dirname -- "$SCRIPTS_DIR")
run_verify "$REPO_ROOT"
check_equals 0 "$status" 'the committed tree satisfies every check'
check_matches "$out" 'publishes icon-dark\.png as 512×512' 'the committed document matches the committed assets'

check_summary
