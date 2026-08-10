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
# Inline links only, deduplicated. A relative target is resolved against the file's own
# directory; an anchor against the headings the file itself defines, using GitHub's slug
# rules — lower-cased, everything but alphanumerics, spaces, underscores and hyphens
# dropped, spaces hyphenated. Headings inside a fenced block are code rather than headings,
# so the fence state is tracked. External links are somebody else's uptime problem and are
# left alone.
#
# Locals are prefixed so a caller's own variables survive the call.
check_markdown_links() {
  links_file=$1
  links_dir=$(dirname -- "$links_file")
  links_targets=$(grep -oE '\]\([^)]+\)' "$links_file" 2>/dev/null | sed 's/^](//; s/)$//' | sort -u || true)
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

# check_summary — print the tally. Returns non-zero if any check failed, so it can be
# the last statement of a `set -e` script and become its exit status.
check_summary() {
  printf '\n%s checks, %s failed\n\n' "$checks" "$failures"
  [ "$failures" -eq 0 ]
}
