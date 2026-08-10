#!/usr/bin/env sh
#
# verify-brand.sh — assert the brand asset set established by issue #14.
#
# docs/brand/ holds six PNGs cut from logo-unsplit.png, and docs/BRAND.md is the document
# that tells everyone what they are and where they belong. Both can drift: an asset can be
# re-exported at another size, flattened onto a background, or replaced by hand, and the
# document goes on describing the file it used to be.
#
# So the checks run between the two rather than against fixed numbers. Every asset must be
# a real PNG carrying an alpha channel, every asset must be named in the document, and the
# pixel size the document publishes must be the pixel size the file actually is — the size
# a layout is built against. The light and dark file of a pair must also agree, because
# theme switching swaps one for the other and a mismatch moves the page.
#
# What a shell script cannot see, it does not claim: transparency at the edges, contrast on
# a ground and the absence of a halo are pixel properties, asserted by the generator
# itself (scripts/split-brand-sheet.py, which refuses to write an asset that fails them)
# and reviewed by eye from its --proof sheets. Here the reading stops at the PNG header,
# which is what keeps this dependency-free POSIX shell like the repo's other verify-*
# scripts.
#
# Usage:
#   scripts/verify-brand.sh              # run from anywhere; resolves the repo root
#   scripts/verify-brand.sh --root DIR   # check DIR instead (used by the tests)
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
      [ $# -ge 2 ] || { printf 'verify-brand: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$2" && pwd)
      shift 2
      ;;
    -h | --help)
      sed -n '2,30p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'verify-brand: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# The assertion harness, shared with the repo's other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

DOC=docs/BRAND.md
BRAND_DIR=docs/brand
SHEET=logo-unsplit.png
GENERATOR=scripts/split-brand-sheet.py

# The three pieces and the two treatments of each. Names, not sizes: the sizes are the
# document's to publish and the files' to honour, and this script's job is to make them
# agree with each other.
PIECES="icon glyph lockup-tagline"
THEMES="light dark"

# The sheet the assets are cut from, and the only dimensions hard-coded here — the crop
# coordinates in the generator are specific to this rendering, so a different one silently
# invalidates every asset.
SHEET_WIDTH=1376
SHEET_HEIGHT=768

# PNG colour type 6 is truecolour with alpha; 8 is bits per channel. Anything else means
# the transparency the whole asset set exists for is gone or reduced.
PNG_DEPTH=8
PNG_COLOUR_RGBA=6

# png_header FILE — print "WIDTH HEIGHT DEPTH COLOURTYPE" for a PNG, or nothing.
#
# Reads the signature and the IHDR chunk, which a PNG is required to open with: 8 bytes of
# signature, a 4-byte length, the type "IHDR", then the width and height as 4-byte
# big-endian integers, the bit depth and the colour type. od is POSIX, so no image library
# is needed to learn what the file claims to be.
png_header() {
  png_file=$1
  [ -f "$png_file" ] || return 1
  set -- $(od -An -tu1 -N8 -- "$png_file" 2>/dev/null)
  [ "$*" = "137 80 78 71 13 10 26 10" ] || return 1
  set -- $(od -An -tu1 -j16 -N10 -- "$png_file" 2>/dev/null)
  [ $# -eq 10 ] || return 1
  printf '%s %s %s %s\n' \
    "$(( $1 * 16777216 + $2 * 65536 + $3 * 256 + $4 ))" \
    "$(( $5 * 16777216 + $6 * 65536 + $7 * 256 + $8 ))" \
    "$9" "${10}"
}

# documented_size FILE_NAME — print the WIDTHxHEIGHT the document publishes for an asset.
#
# The asset table gives each pair one row, and the first dimension pair on that row is the
# file's own pixel size (the columns after it are the working size, which is half of it,
# and the minimum). Prints nothing when the file is not in the table.
documented_size() {
  row=$(grep -F -m 1 -- "$1" "$DOC" 2>/dev/null || true)
  [ -n "$row" ] || return 0
  printf '%s\n' "$row" | grep -oE '[0-9]+×[0-9]+' | head -n 1
}

printf '\nBrand assets — %s\n\n' "$ROOT"

# ---------------------------------------------------------------------------
# The sheet and the generator
# ---------------------------------------------------------------------------

printf 'Source\n'
check_exists "$SHEET" "$SHEET exists"
sheet_header=$(png_header "$SHEET" || true)
if [ -n "$sheet_header" ]; then
  pass "$SHEET is a PNG"
  set -- $sheet_header
  check_equals "${SHEET_WIDTH}x${SHEET_HEIGHT}" "${1}x${2}" \
    "$SHEET is the rendering the crops were derived from"
else
  fail "$SHEET is a PNG (no PNG signature or IHDR)"
fi

printf '\nGenerator\n'
check_exists "$GENERATOR" "$GENERATOR exists"
check_executable "$GENERATOR" "$GENERATOR is executable"
check_contains "$GENERATOR" "$BRAND_DIR" "$GENERATOR writes $BRAND_DIR"
check_contains "$DOC" 'split-brand-sheet\.py' "$DOC points at the generator"

# ---------------------------------------------------------------------------
# The assets
# ---------------------------------------------------------------------------

printf '\nAssets\n'
for piece in $PIECES; do
  pair_size=''
  for theme in $THEMES; do
    name="$piece-$theme.png"
    file="$BRAND_DIR/$name"

    check_exists "$file" "$name exists"

    header=$(png_header "$file" || true)
    if [ -z "$header" ]; then
      fail "$name is a PNG (no PNG signature or IHDR)"
      continue
    fi
    pass "$name is a PNG"

    set -- $header
    width=$1
    height=$2
    depth=$3
    colour=$4

    check_equals "$PNG_DEPTH/$PNG_COLOUR_RGBA" "$depth/$colour" \
      "$name is 8-bit RGBA (carries an alpha channel)"

    # The document is the contract a layout is built against, so it has to name the file
    # and publish the size the file actually is.
    if grep -qF -- "$name" "$DOC"; then
      pass "$DOC documents $name"
      check_equals "$(documented_size "$name")" "${width}×${height}" \
        "$DOC publishes $name as ${width}×${height}"
    else
      fail "$DOC documents $name (not named anywhere in the document)"
    fi

    # Every row of the table states where the piece stops reading, and what it is for —
    # the last cell of the row, which is the one a filled-in table ends with.
    row=$(grep -F -m 1 -- "$name" "$DOC" 2>/dev/null || true)
    check_matches "$row" '[0-9]+ px' "$DOC gives $name a minimum size"
    check_matches "$row" '\|[^|]*[A-Za-z][^|]*\|[[:space:]]*$' "$DOC says what $name is for"

    # Theme switching swaps one file for the other; different dimensions move the layout.
    if [ -z "$pair_size" ]; then
      pair_size="${width}×${height}"
    else
      check_equals "$pair_size" "${width}×${height}" "the $piece pair is one size in both themes"
    fi
  done
done

# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------

printf '\nDocument\n'
check_exists "$DOC" "$DOC exists"
check_contains "$DOC" '^# .*[Bb]rand' "$DOC opens with a brand title"

# One section per question the asset set has to answer for whoever is placing a logo.
check_contains "$DOC" '^#+ .*[Ss]ource of truth' 'the sheet has a provenance section'
check_contains "$DOC" '^#+ .*[Aa]sset set' 'the assets have a section'
check_contains "$DOC" '^#+ .*[Ss]urface' 'which treatment goes on which surface has a section'
check_contains "$DOC" '^#+ .*[Cc]lear space' 'clear space has a section'
check_contains "$DOC" '^#+ .*[Rr]ules' 'the usage rules have a section'
check_contains "$DOC" '^#+ .*[Tt]ransparency' 'transparency has a section'
check_contains "$DOC" '^#+ .*[Rr]egenerating' 'regeneration has a section'

# Both grounds the ticket names the assets have to work against.
check_contains "$DOC" '#12181d' 'the surfaces section names the dark ground'
check_contains "$DOC" '#f5f8fa' 'the surfaces section names the light ground'

# The mockups' crops are the thing these assets replace; saying so is what stops the old
# blend-mode trick being copied into new code.
check_contains "$DOC" 'mix-blend-mode' "$DOC rules out the mockups' blend-mode crops"

# An unclosed fence swallows the rest of the page into a code block.
fences=$(grep -c '^```' "$DOC" 2>/dev/null || true)
if [ "$((${fences:-0} % 2))" -eq 0 ]; then
  pass 'every code fence is closed'
else
  fail "every code fence is closed (odd number of fences: $fences)"
fi

printf '\nLinks\n'
# Every asset the document names is also a link to that asset, so this is the check that
# the two really are the same files — a documented name that is not in docs/brand/ fails
# here even though the grep above found it.
check_markdown_links "$DOC"

check_summary
