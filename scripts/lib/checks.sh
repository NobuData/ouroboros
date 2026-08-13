# checks.sh — the shared assertion harness for the repo's verify-* scripts.
#
# Dot-source it, call the check_* helpers, and close with check_summary:
#
#   . "$(dirname -- "$0")/lib/checks.sh"
#   check_exists README.md 'root README.md exists'
#   check_summary                       # prints the tally; non-zero if any check failed
#
# Every helper takes its human-readable description last, so the call reads as the
# assertion it makes. Failures print the reason inline and are counted; nothing exits
# early, so one run reports every problem rather than only the first.
#
# Alongside the assertions it carries the readers they need — png_header, documented_size
# — for facts more than one verify-* script has to pull out of a file's bytes or a
# document's tables.
#
# POSIX shell with no dependencies — the same portability contract as its callers, so
# these checks run identically on a laptop, in a container and in CI.

# Counters, read by check_summary.
checks=0
failures=0

# pass DESCRIPTION — record a satisfied check.
pass() {
  checks=$((checks + 1))
  printf '  ok    %s\n' "$1"
}

# fail DESCRIPTION — record a violated check and mark the run as failed.
fail() {
  checks=$((checks + 1))
  failures=$((failures + 1))
  printf '  FAIL  %s\n' "$1"
}

# check_exists PATH DESCRIPTION — assert a file or directory exists.
check_exists() {
  if [ -e "$1" ]; then
    pass "$2"
  else
    fail "$2 (missing: $1)"
  fi
}

# check_missing PATH DESCRIPTION — assert a file or directory is not there.
#
# The inverse of check_exists, for the cases where the absence is the point: a command
# that must not exist to be reached for by mistake, an artefact that must not be
# committed.
check_missing() {
  if [ -e "$1" ]; then
    fail "$2 (unexpectedly present: $1)"
  else
    pass "$2"
  fi
}

# check_executable PATH DESCRIPTION — assert a file exists and carries the execute bit.
check_executable() {
  if [ -x "$1" ]; then
    pass "$2"
  else
    fail "$2 (not executable: $1)"
  fi
}

# check_contains FILE PATTERN DESCRIPTION — assert FILE matches an extended regex.
check_contains() {
  if [ -f "$1" ] && grep -Eq -- "$2" "$1"; then
    pass "$3"
  else
    fail "$3 (no match for /$2/ in $1)"
  fi
}

# check_absent FILE PATTERN DESCRIPTION — assert FILE does not match an extended regex.
check_absent() {
  if [ -f "$1" ] && grep -Eq -- "$2" "$1"; then
    fail "$3 (unexpected match for /$2/ in $1)"
  else
    pass "$3"
  fi
}

# check_equals EXPECTED ACTUAL DESCRIPTION — assert two strings are identical.
check_equals() {
  if [ "$1" = "$2" ]; then
    pass "$3"
  else
    fail "$3 (expected [$1], got [$2])"
  fi
}

# check_matches TEXT PATTERN DESCRIPTION — assert TEXT matches an extended regex.
check_matches() {
  if printf '%s\n' "$1" | grep -Eq -- "$2"; then
    pass "$3"
  else
    fail "$3 (no match for /$2/ in [$1])"
  fi
}

# check_not_matches TEXT PATTERN DESCRIPTION — assert TEXT does not match an extended
# regex.
#
# The inverse of check_matches, and check_absent's counterpart for text that is a
# command's output rather than a file: the cases where what a command did *not* print is
# the assertion — a prompt that must not appear, a file it must not have reached for.
check_not_matches() {
  if printf '%s\n' "$1" | grep -Eq -- "$2"; then
    fail "$3 (unexpected match for /$2/ in [$1])"
  else
    pass "$3"
  fi
}

# check_run DESCRIPTION COMMAND [ARG...] — assert a command exits zero, output discarded.
check_run() {
  description=$1
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$description"
  else
    fail "$description (command failed: $*)"
  fi
}

# check_markdown_links FILE — assert every link a markdown file makes resolves.
#
# Inline links only, deduplicated, in both forms markdown writes them: the plain
# `](target)`, and the angle-bracketed `](<target>)` a target needs the moment it contains
# parentheses — which every link into Next.js route groups does, `(app)` and `(auth)` being
# directories. A plain-form-only reader truncates those at the group's own closing paren
# and reports a file called `<app/(app` missing, which is how this case was found.
#
# A relative target is resolved against the file's own directory; an anchor against the
# headings the file itself defines, using GitHub's slug rules — lower-cased, everything but
# alphanumerics, spaces, underscores and hyphens dropped, spaces hyphenated. Headings
# inside a fenced block are code rather than headings, so the fence state is tracked.
# External links are somebody else's uptime problem and are left alone.
#
# Locals are prefixed so a caller's own variables survive the call.
check_markdown_links() {
  links_file=$1
  links_dir=$(dirname -- "$links_file")
  # The angle form first, then the plain form — which must not open with `<`, or it would
  # re-read every angle target with the bracket still on and the tail cut at the first `)`.
  links_targets=$({
    grep -oE '\]\(<[^>]+>\)' "$links_file" 2>/dev/null | sed 's/^](<//; s/>)$//'
    grep -oE '\]\([^<)][^)]*\)' "$links_file" 2>/dev/null | sed 's/^](//; s/)$//'
  } | sort -u || true)
  links_slugs=$(LC_ALL=C awk '
    /^```/ { fence = !fence; next }
    !fence && /^#+[[:space:]]/ {
      sub(/^#+[[:space:]]+/, "")
      line = tolower($0)
      gsub(/[^a-z0-9 _-]/, "", line)
      gsub(/ /, "-", line)
      print line
    }
  ' "$links_file" 2>/dev/null || true)

  for links_target in $links_targets; do
    case $links_target in
      http://* | https://* | mailto:*)
        ;;
      '#'*)
        links_anchor=${links_target#\#}
        if printf '%s\n' "$links_slugs" | grep -qx -- "$links_anchor"; then
          pass "the anchor $links_target resolves to a heading"
        else
          fail "the anchor $links_target resolves to a heading (no heading with that slug)"
        fi
        ;;
      *)
        # Strip any anchor: the file is what the checkout can vouch for.
        links_path=${links_target%%#*}
        [ -n "$links_path" ] || continue
        check_exists "$links_dir/$links_path" "the link to $links_path resolves"
        ;;
    esac
  done
}

# png_header FILE — print "WIDTH HEIGHT DEPTH COLOURTYPE" for a PNG, or nothing.
#
# Reads the signature and the IHDR chunk, which a PNG is required to open with: 8 bytes of
# signature, a 4-byte length, the type "IHDR", then the width and height as 4-byte
# big-endian integers, the bit depth and the colour type. od is POSIX, so no image library
# is needed to learn what the file claims to be — which is what lets a script assert an
# image's size and whether it carries an alpha channel without decoding a pixel.
#
# Shared because both the scripts that check images want the same four numbers: the brand
# assets have to carry alpha at the sizes BRAND.md publishes, and the favicons derived
# from them have to carry it in one group and not in the other.
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

# documented_size FILE_NAME DOC — print the WIDTH×HEIGHT a document publishes for a file.
#
# Finds the first row naming the file and takes the first dimension pair on it, which by
# the convention both asset tables follow is the file's own pixel size — the columns after
# it are working sizes, minimums and prose. Prints nothing when the file is not in the
# document or its row publishes no size, which a caller reports as the mismatch it is.
#
# Shared because a document that goes on publishing the size an asset used to be is the
# same failure whether the asset is a brand master or a favicon cut from one.
documented_size() {
  size_row=$(grep -F -m 1 -- "$1" "$2" 2>/dev/null || true)
  [ -n "$size_row" ] || return 0
  printf '%s\n' "$size_row" | grep -oE '[0-9]+×[0-9]+' | head -n 1
}

# check_summary — print the tally. Returns non-zero if any check failed, so it can be
# the last statement of a `set -e` script and become its exit status.
check_summary() {
  printf '\n%s checks, %s failed\n\n' "$checks" "$failures"
  [ "$failures" -eq 0 ]
}
