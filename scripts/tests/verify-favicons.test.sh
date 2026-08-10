#!/usr/bin/env sh
#
# verify-favicons.test.sh — integration tests for scripts/verify-favicons.sh.
#
# The script is run against synthetic repository trees rather than this checkout, so the
# tests pin the contract independently of the files that currently satisfy it: the fixture
# is a minimal tree that passes every check, and each case copies it, breaks exactly one
# thing, and asserts that the matching check — and the run — fails.
#
# The fixture's images are headers and nothing else. That is not a shortcut: the verifier
# reads a PNG's IHDR chunk and an ICO's directory and stops, deliberately, because whether
# the mark still reads at 16 px is a judgement for the generator's self-checks and for
# review by eye. A fixture built out of what the script actually reads is a fixture that
# cannot pass for the wrong reason.
#
# The committed ouroboros-ui/public/ and its two documents are exercised once at the end,
# which is what proves the checks and the real files agree.
#
# Usage:
#   scripts/tests/verify-favicons.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
VERIFY="$SCRIPTS_DIR/verify-favicons.sh"

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

# write_ico FILE ENTRY... — write an ICONDIR and one 16-byte entry per ENTRY.
#
# An entry is a square edge length ("32") or an explicit "WIDTHxHEIGHT" for the malformed
# cases. Image data is omitted entirely: the verifier reads the directory, which is the
# same table a browser reads to choose a resolution, and nothing past it. A 256 is written
# as the zero byte the format uses for it.
write_ico() {
  ico_target=$1
  shift
  {
    printf '\000\000\001\000'
    byte $(( $# % 256 ))
    byte $(( $# / 256 ))
    for entry in "$@"; do
      case $entry in
        *x*) ico_w=${entry%x*}; ico_h=${entry#*x} ;;
        *) ico_w=$entry; ico_h=$entry ;;
      esac
      byte $(( ico_w % 256 ))
      byte $(( ico_h % 256 ))
      printf '\000\000\001\000\040\000'   # colours, reserved, planes, bits per pixel
      printf '\000\000\000\000'           # image data length
      printf '\000\000\000\000'           # image data offset
    done
  } > "$ico_target"
}

# make_fixture DIR — write a repository tree that satisfies every check.
#
# The smallest tree that can: the two source icons, an executable generator that names
# both directories, the seven generated files, and two documents that name every one of
# them and break no link.
make_fixture() {
  fixture=$1
  mkdir -p "$fixture/docs/brand" "$fixture/scripts" "$fixture/ouroboros-ui/public"

  write_png "$fixture/docs/brand/icon-light.png" 512 512 8 6
  write_png "$fixture/docs/brand/icon-dark.png" 512 512 8 6

  # Colour type 6 is RGBA — the tab pair, which has to stay transparent.
  write_png "$fixture/ouroboros-ui/public/favicon-32-light.png" 32 32 8 6
  write_png "$fixture/ouroboros-ui/public/favicon-32-dark.png" 32 32 8 6
  # Colour type 2 is RGB — no alpha channel, which is how the flattened icons prove they
  # are opaque.
  write_png "$fixture/ouroboros-ui/public/apple-touch-icon.png" 180 180 8 2
  write_png "$fixture/ouroboros-ui/public/icon-192.png" 192 192 8 2
  write_png "$fixture/ouroboros-ui/public/icon-512.png" 512 512 8 2

  write_ico "$fixture/ouroboros-ui/public/favicon.ico" 16 32 48

  cat > "$fixture/ouroboros-ui/public/manifest.webmanifest" <<'MANIFEST'
{
  "name": "Fixture",
  "short_name": "Fixture",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#12181d",
  "theme_color": "#12181d",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
MANIFEST

  cat > "$fixture/scripts/build-favicons.py" <<'GENERATOR'
#!/usr/bin/env python3
"""Fixture generator. Reads docs/brand and writes ouroboros-ui/public."""
GENERATOR
  chmod +x "$fixture/scripts/build-favicons.py"

  cat > "$fixture/docs/BRAND.md" <<'BRAND'
# Fixture — brand assets

## The favicon and manifest set

Scaled from the icon pair by [build-favicons.py](../scripts/build-favicons.py).

| File | Size |
|---|---|
| `favicon.ico` | 16, 32, 48 |
| `favicon-32-light.png` | 32×32 |
| `favicon-32-dark.png` | 32×32 |
| `apple-touch-icon.png` | 180×180 |
| `icon-192.png` | 192×192 |
| `icon-512.png` | 512×512 |
| `manifest.webmanifest` | — |
BRAND

  cat > "$fixture/ouroboros-ui/README.md" <<'UIDOC'
# Fixture — ouroboros-ui

## Favicons and the web-app manifest

Generated by [build-favicons.py](../scripts/build-favicons.py) into
[public/](public). The browser picks between the tab pair with `prefers-color-scheme`.

| File |
|---|
| [public/favicon.ico](public/favicon.ico) |
| [public/favicon-32-light.png](public/favicon-32-light.png) |
| [public/favicon-32-dark.png](public/favicon-32-dark.png) |
| [public/apple-touch-icon.png](public/apple-touch-icon.png) |
| [public/icon-192.png](public/icon-192.png) |
| [public/icon-512.png](public/icon-512.png) |
| [public/manifest.webmanifest](public/manifest.webmanifest) |
UIDOC
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

printf '\nverify-favicons.sh\n\n'

# ---------------------------------------------------------------------------
# The passing baseline
# ---------------------------------------------------------------------------

printf 'A conforming tree\n'

good="$work/good"
make_fixture "$good"
run_verify "$good"
check_equals 0 "$status" 'a conforming tree passes'
check_matches "$out" '0 failed' 'a conforming tree reports no failures'
check_matches "$out" 'Favicon set' 'the report names what it checked'
check_matches "$out" 'favicon-32-light\.png is 8-bit RGBA' \
  'the alpha channel is asserted for the tab pair'
check_matches "$out" 'apple-touch-icon\.png is 8-bit RGB' \
  'the absence of an alpha channel is asserted for the flattened icons'

# ---------------------------------------------------------------------------
# The source and the generator
# ---------------------------------------------------------------------------

printf '\nSource violations\n'

# The whole set is scaled from this pair, so losing it means losing the ability to rebuild.
check_break 'a missing light source icon is reported' \
  'the light brand icon it is derived from exists' \
  'rm "$root/docs/brand/icon-light.png"'

check_break 'a missing dark source icon is reported' \
  'the dark brand icon it is derived from exists' \
  'rm "$root/docs/brand/icon-dark.png"'

printf '\nGenerator violations\n'

check_break 'a missing generator is reported' \
  'build-favicons\.py exists' \
  'rm "$root/scripts/build-favicons.py"'

check_break 'a generator that cannot be run is reported' \
  'build-favicons\.py is executable' \
  'chmod -x "$root/scripts/build-favicons.py"'

check_break 'a generator that no longer writes the public directory is reported' \
  'build-favicons\.py writes ouroboros-ui/public' \
  'printf "#!/usr/bin/env python3\n# reads docs/brand\n" > "$root/scripts/build-favicons.py"'

check_break 'a generator that no longer reads the brand directory is reported' \
  'build-favicons\.py reads docs/brand' \
  'printf "#!/usr/bin/env python3\n# writes ouroboros-ui/public\n" > "$root/scripts/build-favicons.py"'

check_break 'a brand document that stops pointing at the generator is reported' \
  'docs/BRAND\.md points at the generator' \
  'sed -i "s|build-favicons\.py|the script|g" "$root/docs/BRAND.md"'

check_break 'a module README that stops pointing at the generator is reported' \
  'ouroboros-ui/README\.md points at the generator' \
  'sed -i "s|(\.\./scripts/build-favicons\.py)|(../scripts/split-brand-sheet.py)|; s|\[build-favicons\.py\]|[the script]|" "$root/ouroboros-ui/README.md"'

# ---------------------------------------------------------------------------
# The browser-tab pair
# ---------------------------------------------------------------------------

printf '\nBrowser-tab icon violations\n'

check_break 'a missing tab icon is reported' \
  'favicon-32-light\.png exists' \
  'rm "$root/ouroboros-ui/public/favicon-32-light.png"'

check_break 'a tab icon that is not a PNG is reported' \
  'favicon-32-dark\.png is a PNG' \
  'printf "PNG-ish, but not a PNG" > "$root/ouroboros-ui/public/favicon-32-dark.png"'

# Colour type 2 is truecolour without alpha. A tab icon flattened onto the dark ground
# would draw a dark tile into light browser chrome, which is the whole reason the pair
# exists.
check_break 'a tab icon flattened onto a background is reported' \
  'favicon-32-dark\.png is 8-bit RGBA' \
  'write_png "$root/ouroboros-ui/public/favicon-32-dark.png" 32 32 8 2'

check_break 'a tab icon at another bit depth is reported' \
  'favicon-32-light\.png is 8-bit RGBA' \
  'write_png "$root/ouroboros-ui/public/favicon-32-light.png" 32 32 16 6'

check_break 'a tab icon re-exported at another size is reported' \
  'favicon-32-light\.png is 32×32' \
  'write_png "$root/ouroboros-ui/public/favicon-32-light.png" 64 64 8 6'

# The browser swaps one for the other as the scheme changes, so a pair that disagrees
# makes the tab jump. Caught even when the size the script expects has been moved to
# match one of them.
check_break 'a tab pair whose two files are different sizes is reported' \
  'the tab pair is one size in both schemes' \
  'write_png "$root/ouroboros-ui/public/favicon-32-dark.png" 32 48 8 6'

# ---------------------------------------------------------------------------
# The home-screen icons
# ---------------------------------------------------------------------------

printf '\nHome-screen icon violations\n'

check_break 'a missing home-screen icon is reported' \
  'apple-touch-icon\.png exists' \
  'rm "$root/ouroboros-ui/public/apple-touch-icon.png"'

# Colour type 6 is truecolour with alpha. iOS composites a transparent home-screen icon
# onto black, and a launcher draws its own background through one — which is why these
# are written without the channel rather than merely painted opaque.
check_break 'a home-screen icon carrying an alpha channel is reported' \
  'apple-touch-icon\.png is 8-bit RGB' \
  'write_png "$root/ouroboros-ui/public/apple-touch-icon.png" 180 180 8 6'

check_break 'a manifest icon carrying an alpha channel is reported' \
  'icon-512\.png is 8-bit RGB' \
  'write_png "$root/ouroboros-ui/public/icon-512.png" 512 512 8 6'

check_break 'a home-screen icon re-exported at another size is reported' \
  'icon-192\.png is 192×192' \
  'write_png "$root/ouroboros-ui/public/icon-192.png" 256 256 8 2'

check_break 'a home-screen icon that is not a PNG is reported' \
  'icon-512\.png is a PNG' \
  'printf "not a png" > "$root/ouroboros-ui/public/icon-512.png"'

# ---------------------------------------------------------------------------
# favicon.ico
# ---------------------------------------------------------------------------

printf '\nfavicon.ico violations\n'

check_break 'a missing favicon.ico is reported' \
  'favicon\.ico exists' \
  'rm "$root/ouroboros-ui/public/favicon.ico"'

check_break 'a favicon.ico that is not an ICO is reported' \
  'favicon\.ico is an ICO with square entries' \
  'printf "just some bytes, no ICONDIR here" > "$root/ouroboros-ui/public/favicon.ico"'

# A cursor file (type 2) opens with the same six bytes in every position but one.
check_break 'a favicon.ico that is really a cursor is reported' \
  'favicon\.ico is an ICO with square entries' \
  'printf "\\000\\000\\002\\000\\001\\000" > "$root/ouroboros-ui/public/favicon.ico"'

check_break 'a favicon.ico missing a resolution is reported' \
  'carries exactly the resolutions the set promises' \
  'write_ico "$root/ouroboros-ui/public/favicon.ico" 16 32'

check_break 'a favicon.ico carrying an unexpected resolution is reported' \
  'carries exactly the resolutions the set promises' \
  'write_ico "$root/ouroboros-ui/public/favicon.ico" 16 32 48 64'

# A non-square entry is a malformed icon, and reading only its width would hide that.
check_break 'a favicon.ico with a non-square entry is reported' \
  'favicon\.ico is an ICO with square entries' \
  'write_ico "$root/ouroboros-ui/public/favicon.ico" 16 32 48x16'

check_break 'an empty favicon.ico is reported' \
  'favicon\.ico is an ICO with square entries' \
  'write_ico "$root/ouroboros-ui/public/favicon.ico"'

# ---------------------------------------------------------------------------
# The manifest
# ---------------------------------------------------------------------------

printf '\nManifest violations\n'

check_break 'a missing manifest is reported' \
  'manifest\.webmanifest exists' \
  'rm "$root/ouroboros-ui/public/manifest.webmanifest"'

check_break 'a manifest with no short_name is reported' \
  'the manifest declares short_name' \
  'sed -i "/\"short_name\"/d" "$root/ouroboros-ui/public/manifest.webmanifest"'

check_break 'a manifest with no display mode is reported' \
  'the manifest declares display' \
  'sed -i "/\"display\"/d" "$root/ouroboros-ui/public/manifest.webmanifest"'

check_break 'a manifest with no start_url is reported' \
  'the manifest declares start_url' \
  'sed -i "/\"start_url\"/d" "$root/ouroboros-ui/public/manifest.webmanifest"'

# The manifest's colour and the ground the icons were flattened onto are the same
# decision; a manifest that drifts off it puts a seam around the installed app.
check_break 'a manifest whose colours are not the dark ground is reported' \
  "the manifest's colours are the dark ground" \
  'sed -i "s|#12181d|#000000|g" "$root/ouroboros-ui/public/manifest.webmanifest"'

# The failure a valid-looking manifest hides, and the one Lighthouse reports as a broken
# icon: every source has to be a file that was generated beside it.
check_break 'a manifest naming an icon that was never generated is reported' \
  'the manifest icon /icon-512\.png is a file in ouroboros-ui/public' \
  'rm "$root/ouroboros-ui/public/icon-512.png";
   sed -i "/icon-512\.png/d" "$root/docs/BRAND.md";
   sed -i "/icon-512\.png/d" "$root/ouroboros-ui/README.md"'

# Everything in public/ is served from the root of the site, so a relative source
# resolves against whatever page asked for the manifest.
check_break 'a manifest icon that is not a root-absolute path is reported' \
  'the manifest icon icon-192\.png is a root-absolute path' \
  'sed -i "s|\"/icon-192\.png\"|\"icon-192.png\"|" "$root/ouroboros-ui/public/manifest.webmanifest"'

check_break 'a manifest that lists no icons at all is reported' \
  'the manifest lists at least one icon' \
  'sed -i "/\"src\"/d" "$root/ouroboros-ui/public/manifest.webmanifest"'

check_break 'a manifest that stops declaring the 512 pixel icon is reported' \
  'the manifest declares the 512×512 icon' \
  'sed -i "s|\"512x512\"|\"1024x1024\"|" "$root/ouroboros-ui/public/manifest.webmanifest"'

# ---------------------------------------------------------------------------
# The documents
# ---------------------------------------------------------------------------

printf '\nDocument violations\n'

check_break 'a missing brand document is reported' \
  'docs/BRAND\.md exists' \
  'rm "$root/docs/BRAND.md"'

check_break 'a missing module README is reported' \
  'ouroboros-ui/README\.md exists' \
  'rm "$root/ouroboros-ui/README.md"'

check_break 'a brand document with no section for the set is reported' \
  'docs/BRAND\.md has a section for the derived set' \
  'sed -i "s|^## The favicon and manifest set|## The derived set|" "$root/docs/BRAND.md"'

check_break 'a module README with no section for the set is reported' \
  'ouroboros-ui/README\.md has a section for the set' \
  'sed -i "s|^## Favicons and the web-app manifest|## Icons|" "$root/ouroboros-ui/README.md"'

check_break 'a generated file the brand document never names is reported' \
  'docs/BRAND\.md documents apple-touch-icon\.png' \
  'sed -i "/apple-touch-icon\.png/d" "$root/docs/BRAND.md"'

check_break 'a generated file the module README never names is reported' \
  'ouroboros-ui/README\.md documents icon-192\.png' \
  'sed -i "/icon-192\.png/d" "$root/ouroboros-ui/README.md"'

# A document that goes on publishing the size a file used to be is the drift a reader has
# no way to notice, because everything it says still looks like a specification.
check_break 'a brand document publishing the wrong size for a file is reported' \
  'docs/BRAND\.md publishes apple-touch-icon\.png as 180×180' \
  'sed -i "/apple-touch-icon\.png/s|180×180|200×200|" "$root/docs/BRAND.md"'

check_break 'a brand document that publishes no size for a file is reported' \
  'docs/BRAND\.md publishes icon-192\.png as 192×192' \
  'sed -i "/icon-192\.png/s|192×192|see below|" "$root/docs/BRAND.md"'

check_break 'a brand document that stops naming the manifest is reported' \
  'docs/BRAND\.md documents manifest\.webmanifest' \
  'sed -i "/manifest\.webmanifest/d" "$root/docs/BRAND.md"'

# The wiring is #39's to write and this ticket's to specify. A README that stops saying
# how the pair is selected leaves the next person to guess it.
check_break 'a README that stops specifying how the pair is selected is reported' \
  'specifies how the theme-aware pair is selected' \
  'sed -i "s|prefers-color-scheme|the media query|" "$root/ouroboros-ui/README.md"'

check_break 'a README link to a file that does not exist is reported' \
  'the link to MISSING\.md resolves' \
  'printf "\n[gone](MISSING.md)\n" >> "$root/ouroboros-ui/README.md"'

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
check_matches "$out" 'favicon\.ico carries exactly the resolutions the set promises' \
  'the committed favicon.ico carries every resolution the set promises'
check_matches "$out" 'icon-512\.png is 8-bit RGB' \
  'the committed home-screen icons carry no alpha channel'

check_summary
