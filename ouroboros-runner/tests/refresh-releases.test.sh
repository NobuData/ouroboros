#!/usr/bin/env sh
#
# refresh-releases.test.sh — tests for ouroboros-runner's refresh-releases.sh.
#
# The script is run for real against a stub `gh` that lists and "downloads" fixture
# releases from a directory, so what is asserted is what it leaves in the releases
# directory: the newest stable release, verified, readable, and nothing at all when a
# download does not verify.
#
# Usage:
#   ouroboros-runner/tests/refresh-releases.test.sh
#   make test                                       # from ouroboros-runner/
#
# Exit status: 0 all assertions passed / 1 at least one failed.

# The stub's body is single-quoted on purpose: its variables are its own to expand.
# shellcheck disable=SC2016

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")

# shellcheck source-path=SCRIPTDIR/../..
# shellcheck source=scripts/lib/checks.sh
. "$REPO_ROOT/scripts/lib/checks.sh"

SCRIPT="$MODULE_DIR/refresh-releases.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

FIXTURES="$work/github"
STUB_LOG="$work/stub.log"
export FIXTURES STUB_LOG
mkdir -p "$work/bin" "$FIXTURES"

# gh: `release list` prints one tag per fixture directory, plus $STUB_EXTRA_TAGS;
# `release download TAG --dir DIR` copies that fixture's files, and fails when there is none.
cat >"$work/bin/gh" <<'GH'
#!/bin/sh
printf 'gh %s\n' "$*" >>"$STUB_LOG"
case "$1 $2" in
  "release list")
    ls "$FIXTURES"
    [ -z "${STUB_EXTRA_TAGS:-}" ] || printf '%s\n' $STUB_EXTRA_TAGS
    ;;
  "release download")
    tag=$3 dir=''
    while [ $# -gt 0 ]; do
      [ "$1" = --dir ] && dir=$2
      shift
    done
    [ -d "$FIXTURES/$tag" ] || { echo "release not found" >&2; exit 1; }
    cp "$FIXTURES/$tag"/* "$dir"/
    ;;
esac
GH
chmod +x "$work/bin/gh"

# sums [ARG...] — sha256sum, or shasum -a 256 where there is none (macOS).
sums() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

# publish VERSION — a fixture release: the installer, one binary, and SHA256SUMS over both.
publish() {
  release="$FIXTURES/ouroboros-runner-v$1"
  mkdir -p "$release"
  printf 'installer %s\n' "$1" >"$release/install.sh"
  printf 'agent %s\n' "$1" >"$release/ouroboros-runner-linux-amd64"
  (cd "$release" && sums install.sh ouroboros-runner-linux-amd64 >SHA256SUMS)
}

# refresh [ARG...] — run the script on a releases directory of its own. Leaves its combined
# output in $out, its exit status in $status and the stub's record in $log.
refresh() {
  : >"$STUB_LOG"
  out=$(PATH="$work/bin:$PATH" sh "$SCRIPT" --dir "$DIR" "$@" 2>&1)
  status=$?
  log=$(cat "$STUB_LOG")
}

# leftovers — what the releases directory holds besides versions.
leftovers() {
  find "$DIR" -mindepth 1 -maxdepth 1 ! -name '[0-9]*' | wc -l | tr -d ' '
}

DIR="$work/releases"
publish 0.8.0
publish 0.9.0
publish 0.10.0

printf '\nouroboros-runner — refresh-releases.sh\n\n'

printf 'An empty releases directory\n'
STUB_EXTRA_TAGS='ouroboros-ui-v9.9.9 ouroboros-runner-v1.0.0-rc.1 not-a-tag' refresh
check_equals 0 "$status" "the refresh succeeds (output: $out)"
check_exists "$DIR/0.10.0/install.sh" 'the newest version is fetched — 0.10.0 after 0.9.0, as a version and not as text'
check_exists "$DIR/0.10.0/SHA256SUMS" 'with its checksums'
check_missing "$DIR/0.9.0" 'and no older one'
check_missing "$DIR/1.0.0-rc.1" 'a pre-release name is not a release'
check_equals 0 "$(leftovers)" 'nothing else is left in the directory'
check_equals 755 "$(stat -c %a "$DIR/0.10.0" 2>/dev/null || stat -f %Lp "$DIR/0.10.0")" \
  'the service, which is not root, can enter it'
check_equals 644 "$(stat -c %a "$DIR/0.10.0/install.sh" 2>/dev/null || stat -f %Lp "$DIR/0.10.0/install.sh")" \
  'and read what is in it'

printf '\nRun again\n'
refresh
check_equals 0 "$status" 'it succeeds'
check_matches "$out" 'already holds ouroboros-runner 0.10.0' 'and says the directory is current'
check_not_matches "$log" 'release download' 'without downloading anything'

printf '\nA named version, keeping one\n'
refresh --version 0.8.0
check_exists "$DIR/0.8.0/install.sh" 'the version asked for is fetched'
refresh --keep 1
check_missing "$DIR/0.8.0" '--keep 1 removes the older version'
check_exists "$DIR/0.10.0/install.sh" 'and keeps the newest'

printf '\nA release that does not verify\n'
publish 0.11.0
printf 'tampered\n' >"$FIXTURES/ouroboros-runner-v0.11.0/ouroboros-runner-linux-amd64"
refresh
check_equals 1 "$status" 'the refresh fails'
check_matches "$out" 'does not match its SHA256SUMS' 'and says why'
check_missing "$DIR/0.11.0" 'the release is not put in place'
check_equals 0 "$(leftovers)" 'and the download is removed'
check_exists "$DIR/0.10.0/install.sh" 'what was being served is untouched'

printf '\nA release with no installer\n'
rm -rf "$FIXTURES/ouroboros-runner-v0.11.0"
publish 0.12.0
rm "$FIXTURES/ouroboros-runner-v0.12.0/install.sh"
refresh
check_equals 1 "$status" 'the refresh fails'
check_matches "$out" 'carries no install.sh' 'and names what is missing'
check_missing "$DIR/0.12.0" 'nothing is put in place'
rm -rf "$FIXTURES/ouroboros-runner-v0.12.0"

printf '\nA half-copied version already there\n'
rm -rf "$DIR"
mkdir -p "$DIR/0.10.0"
printf 'partial\n' >"$DIR/0.10.0/SHA256SUMS"
refresh
check_equals 0 "$status" "the refresh succeeds (output: $out)"
check_exists "$DIR/0.10.0/install.sh" 'the version is replaced by the whole release'
check_missing "$DIR/0.10.0/.incoming" 'not nested inside what was there'

printf '\nRefusals\n'
refresh --keep 0
check_matches "$out" '--keep must be a whole number' 'a --keep of nothing is refused'
refresh --version latest
check_matches "$out" '--version must be a semantic version' 'so is a version that is not one'
out=$(PATH="$work/bin:$PATH" sh "$SCRIPT" --dir relative 2>&1)
check_matches "$out" '--dir must be an absolute path' 'and a relative directory'
rm -rf "${FIXTURES:?}"/*
refresh
check_equals 1 "$status" 'no release at all is a failure'
check_matches "$out" 'found no ouroboros-runner-v<version> release' 'that says what was looked for'

check_summary
