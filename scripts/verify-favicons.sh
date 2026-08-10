#!/usr/bin/env sh
#
# verify-favicons.sh — assert the favicon and web-app manifest set from issue #15.
#
# ouroboros-ui/public/ holds the browser and home-screen icons derived from the brand icon
# pair by scripts/build-favicons.py, plus the manifest that lists two of them. All of it
# can drift: an icon can be re-exported at another size, a flattened icon can come back
# carrying an alpha channel, the manifest can name a file nobody generated, and the
# documents can go on describing the set that used to be there.
#
# So the checks run between the files, the manifest and the documents rather than against
# a list of magic numbers kept somewhere else. Sizes are read out of the PNG headers, the
# resolutions in favicon.ico are read out of its own directory — the same bytes a browser
# reads to choose one — and every icon the manifest names has to be a file on disk.
#
# The one property asserted here that is usually a matter of trust is opacity. An icon a
# launcher draws on an unknown background must not be transparent, and rather than
# document that and hope, the generator writes those files with no alpha channel at all.
# That turns "is it opaque" into a PNG colour-type byte, which this script can read
# without decoding a pixel — and the transparency the tab icons need is the same byte
# saying the opposite thing.
#
# What a shell script cannot see, it does not claim: whether the mark still reads at 16 px
# and whether it holds contrast on real browser chrome are judgements for the generator's
# own self-checks and for review by eye. The reading here stops at the file headers, which
# is what keeps this dependency-free POSIX shell like the repo's other verify-* scripts.
#
# Usage:
#   scripts/verify-favicons.sh              # run from anywhere; resolves the repo root
#   scripts/verify-favicons.sh --root DIR   # check DIR instead (used by the tests)
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
      [ $# -ge 2 ] || { printf 'verify-favicons: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$2" && pwd)
      shift 2
      ;;
    -h | --help)
      sed -n '2,34p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'verify-favicons: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# The assertion harness, shared with the repo's other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

PUBLIC_DIR=ouroboros-ui/public
BRAND_DIR=docs/brand
GENERATOR=scripts/build-favicons.py
MANIFEST="$PUBLIC_DIR/manifest.webmanifest"
FAVICON="$PUBLIC_DIR/favicon.ico"
BRAND_DOC=docs/BRAND.md
UI_DOC=ouroboros-ui/README.md

# The set, as "FILE:WIDTH:HEIGHT". Split in two because the two groups make opposite
# promises about transparency, and that promise is the point of the split.
#
# Transparent: the browser-tab pair. The page does not own the colour behind a tab, so
# these carry alpha and the browser picks one by prefers-color-scheme.
TRANSPARENT_ICONS='favicon-32-light.png:32:32 favicon-32-dark.png:32:32'

# Opaque: everything a launcher, a home screen or an installed app draws on a background
# this project has never seen. Flattened onto the brand's dark ground.
OPAQUE_ICONS='apple-touch-icon.png:180:180 icon-192.png:192:192 icon-512.png:512:512'

# The resolutions favicon.ico has to carry: the tab, the HiDPI tab and address bar, and
# the desktop shortcut.
ICO_SIZES='16 32 48'

# PNG colour type 6 is truecolour with alpha, 2 is truecolour without one; 8 is bits per
# channel. The colour type is the opacity contract, so it is read rather than assumed.
PNG_DEPTH=8
PNG_COLOUR_RGBA=6
PNG_COLOUR_RGB=2

# The ground the opaque icons are flattened onto, which the manifest also declares as its
# theme and background colour. Named here because a manifest that stops agreeing with the
# pixels is exactly the drift worth catching.
DARK_GROUND='#12181d'

# ico_sizes FILE — print the square edge lengths an ICO's directory advertises, ascending.
#
# An ICO opens with a 6-byte ICONDIR — a reserved zero, the type (1 for an icon) and the
# image count, all little-endian — followed by one 16-byte ICONDIRENTRY per image whose
# first two bytes are its width and height. A zero there means 256, which is how the
# format fits 256 into a byte. Prints nothing when the file is not an ICO.
ico_sizes() {
  ico_file=$1
  [ -f "$ico_file" ] || return 1
  set -- $(od -An -tu1 -N6 -- "$ico_file" 2>/dev/null)
  [ $# -eq 6 ] || return 1
  # Reserved must be zero and the type must be 1; both are little-endian pairs.
  [ "$1" -eq 0 ] && [ "$2" -eq 0 ] || return 1
  [ "$3" -eq 1 ] && [ "$4" -eq 0 ] || return 1
  ico_count=$(( $5 + $6 * 256 ))
  [ "$ico_count" -gt 0 ] || return 1

  # Collected into a variable rather than piped straight into sort: a pipeline runs the
  # loop in a subshell, where a `return` on a malformed entry would be swallowed and the
  # function would report the entries it had managed to read as if they were all of them.
  ico_list=''
  ico_index=0
  while [ "$ico_index" -lt "$ico_count" ]; do
    set -- $(od -An -tu1 -j $(( 6 + ico_index * 16 )) -N2 -- "$ico_file" 2>/dev/null)
    [ $# -eq 2 ] || return 1
    ico_width=$1
    ico_height=$2
    [ "$ico_width" -ne 0 ] || ico_width=256
    [ "$ico_height" -ne 0 ] || ico_height=256
    # A non-square entry is a malformed icon, and printing its width would hide that.
    [ "$ico_width" -eq "$ico_height" ] || return 1
    ico_list="$ico_list$ico_width
"
    ico_index=$(( ico_index + 1 ))
  done
  printf '%s' "$ico_list" | sort -n
}

# check_icon FILE WIDTH HEIGHT COLOURTYPE LABEL — assert one generated PNG.
#
# Existence, the PNG signature, the exact pixel size the set is built around, and the
# colour type that carries its transparency promise. Leaves the size the file really is
# in $icon_actual — empty when it could not be read — so a caller can compare two files
# with each other rather than each against the same constant.
check_icon() {
  icon_name=$1
  icon_width=$2
  icon_height=$3
  icon_colour=$4
  icon_label=$5
  icon_file="$PUBLIC_DIR/$icon_name"
  icon_actual=''

  check_exists "$icon_file" "$icon_name exists"

  icon_header=$(png_header "$icon_file" || true)
  if [ -z "$icon_header" ]; then
    fail "$icon_name is a PNG (no PNG signature or IHDR)"
    return
  fi
  pass "$icon_name is a PNG"

  set -- $icon_header
  icon_actual="${1}x${2}"
  check_equals "${icon_width}x${icon_height}" "$icon_actual" \
    "$icon_name is ${icon_width}×${icon_height}"
  check_equals "$PNG_DEPTH/$icon_colour" "${3}/${4}" "$icon_name is $icon_label"
}

printf '\nFavicon set — %s\n\n' "$ROOT"

# ---------------------------------------------------------------------------
# The source and the generator
# ---------------------------------------------------------------------------

printf 'Source\n'
# The whole set is scaled from this pair, so a missing source is a set nobody can rebuild.
for theme in light dark; do
  check_exists "$BRAND_DIR/icon-$theme.png" "the $theme brand icon it is derived from exists"
done

printf '\nGenerator\n'
check_exists "$GENERATOR" "$GENERATOR exists"
check_executable "$GENERATOR" "$GENERATOR is executable"
check_contains "$GENERATOR" "$PUBLIC_DIR" "$GENERATOR writes $PUBLIC_DIR"
check_contains "$GENERATOR" "$BRAND_DIR" "$GENERATOR reads $BRAND_DIR"
check_contains "$BRAND_DOC" 'build-favicons\.py' "$BRAND_DOC points at the generator"
check_contains "$UI_DOC" 'build-favicons\.py' "$UI_DOC points at the generator"

# ---------------------------------------------------------------------------
# The icons
# ---------------------------------------------------------------------------

printf '\nBrowser-tab icons\n'
tab_size=''
for record in $TRANSPARENT_ICONS; do
  name=${record%%:*}
  rest=${record#*:}
  width=${rest%%:*}
  height=${rest#*:}

  check_icon "$name" "$width" "$height" "$PNG_COLOUR_RGBA" \
    '8-bit RGBA (carries an alpha channel)'

  # The browser swaps one for the other as the colour scheme changes; different sizes
  # would make the tab jump. Measured, not declared — comparing the two constants above
  # with each other would be a check that cannot fail.
  if [ -z "$tab_size" ]; then
    tab_size=$icon_actual
  elif [ -n "$icon_actual" ]; then
    check_equals "$tab_size" "$icon_actual" \
      'the tab pair is one size in both schemes'
  fi
done

printf '\nHome-screen icons\n'
for record in $OPAQUE_ICONS; do
  name=${record%%:*}
  rest=${record#*:}
  width=${rest%%:*}
  height=${rest#*:}

  # No alpha channel at all, so a launcher cannot draw its own background through it.
  check_icon "$name" "$width" "$height" "$PNG_COLOUR_RGB" \
    '8-bit RGB (no alpha channel, so it is opaque)'
done

printf '\nfavicon.ico\n'
check_exists "$FAVICON" 'favicon.ico exists'
found=$(ico_sizes "$FAVICON" 2>/dev/null || true)
if [ -z "$found" ]; then
  fail 'favicon.ico is an ICO with square entries (no readable ICONDIR)'
else
  pass 'favicon.ico is an ICO with square entries'
  # The description does not restate the sizes: check_equals prints both lists on a
  # mismatch, and a message that repeats a constant is a message that outlives it.
  expected=$(printf '%s\n' $ICO_SIZES | sort -n)
  check_equals "$(printf '%s' "$expected" | tr '\n' ' ')" \
    "$(printf '%s' "$found" | tr '\n' ' ')" \
    'favicon.ico carries exactly the resolutions the set promises'
fi

# ---------------------------------------------------------------------------
# The manifest
# ---------------------------------------------------------------------------

printf '\nManifest\n'
check_exists "$MANIFEST" 'manifest.webmanifest exists'

# The members an installable web app is expected to declare. Presence, not shape: a shell
# script has no business pretending to parse JSON, and the cross-reference below is the
# check that actually catches drift.
for member in name short_name start_url scope display background_color theme_color icons; do
  check_contains "$MANIFEST" "\"$member\"[[:space:]]*:" "the manifest declares $member"
done

check_contains "$MANIFEST" "$DARK_GROUND" \
  "the manifest's colours are the dark ground the icons are flattened onto"

# Every icon the manifest points at has to be a file that was generated beside it — the
# failure a valid-looking manifest hides, and the one Lighthouse reports as a broken icon.
manifest_srcs=$(grep -oE '"src"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST" 2>/dev/null |
  sed 's/.*"\([^"]*\)"$/\1/' | sort -u || true)
if [ -z "$manifest_srcs" ]; then
  fail 'the manifest lists at least one icon'
else
  pass 'the manifest lists at least one icon'
  for src in $manifest_srcs; do
    # Everything in public/ is served from the root of the site, so a manifest source is
    # a root-absolute path and the file sits at the same name inside public/.
    case $src in
      /*) check_exists "$PUBLIC_DIR/${src#/}" "the manifest icon $src is a file in $PUBLIC_DIR" ;;
      *) fail "the manifest icon $src is a root-absolute path" ;;
    esac
  done
fi

# An installable app declares both of these, and they are the two the generator writes.
for size in 192 512; do
  check_contains "$MANIFEST" "\"${size}x${size}\"" "the manifest declares the ${size}×${size} icon"
done

# ---------------------------------------------------------------------------
# The documents
# ---------------------------------------------------------------------------

printf '\nDocumentation\n'
check_exists "$BRAND_DOC" "$BRAND_DOC exists"
check_exists "$UI_DOC" "$UI_DOC exists"

# docs/BRAND.md is where the brand set is described, and this set is derived from it; the
# module README is where whoever wires it up will look.
check_contains "$BRAND_DOC" '^#+ .*[Ff]avicon' "$BRAND_DOC has a section for the derived set"
check_contains "$UI_DOC" '^#+ .*[Ff]avicon' "$UI_DOC has a section for the set"

# Every generated file has to be named by both documents, so neither can describe a set
# that is no longer the one on disk — and the size docs/BRAND.md publishes for it has to
# be the size the file is, which is the drift a document survives longest.
for record in $TRANSPARENT_ICONS $OPAQUE_ICONS; do
  name=${record%%:*}
  rest=${record#*:}
  width=${rest%%:*}
  height=${rest#*:}
  check_contains "$BRAND_DOC" "$name" "$BRAND_DOC documents $name"
  check_contains "$UI_DOC" "$name" "$UI_DOC documents $name"
  check_equals "${width}×${height}" "$(documented_size "$name" "$BRAND_DOC")" \
    "$BRAND_DOC publishes $name as ${width}×${height}"
done
for name in favicon.ico manifest.webmanifest; do
  check_contains "$BRAND_DOC" "$name" "$BRAND_DOC documents $name"
  check_contains "$UI_DOC" "$name" "$UI_DOC documents $name"
done

# The wiring is issue #39's to write and this ticket's to specify, so the README has to
# carry the metadata contract rather than leave the next person to infer it.
check_contains "$UI_DOC" 'prefers-color-scheme' \
  "$UI_DOC specifies how the theme-aware pair is selected"

printf '\nLinks\n'
check_markdown_links "$UI_DOC"

check_summary
