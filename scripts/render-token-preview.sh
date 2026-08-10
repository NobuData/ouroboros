#!/usr/bin/env sh
#
# render-token-preview.sh — screenshot the token preview page in each palette.
#
# docs/design/tokens-preview.html renders the design system from docs/design/tokens.css and
# nothing else. This drives a headless Chrome over it twice, once with `?theme=light` and
# once with `?theme=dark`, and writes the two PNGs that docs/DESIGN_TOKENS.md publishes and
# a pull request shows a reviewer. Whether a palette is legible is a measurement, and
# scripts/verify-tokens.sh makes it; whether it is handsome is a judgement, and these two
# files are what it is made from.
#
# Like the brand generator this is not dependency-free — it needs a Chrome or Chromium
# binary — so it runs by hand when the palette changes rather than on every pull request.
# The renders are committed for the same reason the brand assets are: so a change to them
# arrives in a diff.
#
# Usage:
#   scripts/render-token-preview.sh                 # rewrite both PNGs
#   scripts/render-token-preview.sh --check         # fail if either would change
#   scripts/render-token-preview.sh --out DIR       # write elsewhere (used by the tests)
#   scripts/render-token-preview.sh --browser PATH  # use a particular browser binary
#
# Exit status:
#   0  both renders were written (or, with --check, both are current)
#   1  a render differs from the committed file (--check only)
#   2  no usable browser, or a render Chrome would not produce

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")

PAGE="$ROOT/docs/design/tokens-preview.html"
OUT="$ROOT/docs/design"
BROWSER=''
CHECK=no

# The viewport both renders are taken at: wide enough for the twelve-column grid at its
# full width, tall enough for the whole page, and identical for the pair so the two can be
# flipped between without anything moving.
WIDTH=1440
HEIGHT=1660

while [ $# -gt 0 ]; do
  case $1 in
    --check)
      CHECK=yes
      shift
      ;;
    --out)
      [ $# -ge 2 ] || { printf 'render-token-preview: --out needs a directory\n' >&2; exit 2; }
      OUT=$2
      shift 2
      ;;
    --browser)
      [ $# -ge 2 ] || { printf 'render-token-preview: --browser needs a path\n' >&2; exit 2; }
      BROWSER=$2
      shift 2
      ;;
    -h | --help)
      sed -n '2,27p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'render-token-preview: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

[ -f "$PAGE" ] || { printf 'render-token-preview: no preview page at %s\n' "$PAGE" >&2; exit 2; }
[ -d "$OUT" ] || { printf 'render-token-preview: no output directory at %s\n' "$OUT" >&2; exit 2; }

# find_browser — print the first usable Chrome-family binary, or nothing.
find_browser() {
  for candidate in google-chrome google-chrome-stable chromium chromium-browser \
                   chrome headless_shell; do
    if command -v "$candidate" > /dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

if [ -z "$BROWSER" ]; then
  BROWSER=$(find_browser || true)
fi
if [ -z "$BROWSER" ] || ! command -v "$BROWSER" > /dev/null 2>&1; then
  printf 'render-token-preview: no Chrome or Chromium found — install one, or pass --browser PATH\n' >&2
  exit 2
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

changed=0

for theme in light dark; do
  target="$OUT/preview-$theme.png"
  shot="$work/preview-$theme.png"

  # --headless takes the screenshot and exits. The profile goes to a throwaway directory so
  # a developer's own Chrome session is never touched, and --hide-scrollbars keeps a
  # platform's scrollbar out of a picture that is about colour.
  "$BROWSER" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --user-data-dir="$work/profile" \
    --window-size="$WIDTH,$HEIGHT" \
    --screenshot="$shot" \
    "file://$PAGE?theme=$theme" > "$work/browser.log" 2>&1 || true

  if [ ! -s "$shot" ]; then
    printf 'render-token-preview: %s produced no %s render\n' "$BROWSER" "$theme" >&2
    sed -n '1,20p' "$work/browser.log" >&2
    exit 2
  fi

  if [ "$CHECK" = yes ]; then
    if [ -f "$target" ] && cmp -s "$shot" "$target"; then
      printf '  ok    preview-%s.png is current\n' "$theme"
    else
      printf '  FAIL  preview-%s.png differs from a fresh render\n' "$theme"
      changed=$((changed + 1))
    fi
    continue
  fi

  cp "$shot" "$target"
  printf '  wrote %s (%sx%s)\n' "$target" "$WIDTH" "$HEIGHT"
done

if [ "$CHECK" = yes ] && [ "$changed" -gt 0 ]; then
  printf '\n%s render(s) out of date — run scripts/render-token-preview.sh\n\n' "$changed" >&2
  exit 1
fi

printf '\n'
