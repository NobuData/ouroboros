#!/usr/bin/env sh
#
# refresh-releases.sh — keep a deployment's runner releases directory current.
#
# ouroboros-rest serves the runner installer and the agent's binaries from a directory
# (OURO_FARM_RELEASES_DIR): one subdirectory per version, each exactly as a GitHub release
# `ouroboros-runner-v<version>` carries it. This script, run on the deployment's host,
# finds the newest stable release, downloads it, verifies it, and puts it in place. The
# service picks a new version up at once, without a restart.
#
#   1. asks GitHub for the releases named ouroboros-runner-v<X.Y.Z> and takes the newest;
#   2. stops there if the directory already holds it — so it is safe to run from cron;
#   3. downloads the release into a hidden directory beside its destination;
#   4. verifies every file against the release's SHA256SUMS, and that the installer is
#      among them — a release that does not verify is removed and nothing changes;
#   5. makes it readable by the service, which does not run as root;
#   6. renames it into place in one step, so the service never serves half a release;
#   7. with --keep N, removes all but the newest N versions.
#
# It needs the GitHub CLI, `gh`, signed in to an account that can read the repository:
# `gh auth login` once, or GH_TOKEN in the environment for cron.
#
# Usage:
#   refresh-releases.sh [--dir DIR] [--version X.Y.Z] [--keep N] [--repo OWNER/NAME]
#
# Exit status: 0 the directory is current / 1 anything else, with the reason on stderr.
#
# POSIX sh, and checked by shellcheck in `make lint`.

set -eu

TAG_PREFIX=ouroboros-runner-v
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

# The options, before parsing.
dir=${OURO_FARM_RELEASES_DIR:-/srv/ouroboros/runner-releases}
repo=NobuData/ouroboros
version=''
keep=''

# Set by the steps below.
incoming=''

# say MESSAGE — one line of progress.
say() {
  printf '%s\n' "$*"
}

# die MESSAGE — stop with a message on stderr. Every refusal ends here, and exits 1.
die() {
  printf 'refresh-releases.sh: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Download the newest ouroboros-runner release into a deployment's releases directory.

  refresh-releases.sh [--dir DIR] [--version X.Y.Z] [--keep N] [--repo OWNER/NAME]

Options:
  --dir DIR         the releases directory, as ouroboros-rest mounts it; default
                    $OURO_FARM_RELEASES_DIR, else /srv/ouroboros/runner-releases
  --version X.Y.Z   fetch this release rather than the newest
  --keep N          afterwards, remove all but the newest N versions; default keeps all
  --repo OWNER/NAME the GitHub repository the releases are in; default NobuData/ouroboros
  -h, --help        this text

Needs `gh`, signed in (`gh auth login`) or with GH_TOKEN set.
USAGE
}

# matches TEXT PATTERN — whether all of TEXT matches the extended regular expression.
matches() {
  printf '%s\n' "$1" | grep -Eq "$2"
}

parse_arguments() {
  while [ $# -gt 0 ]; do
    case $1 in
      --dir | --version | --keep | --repo)
        [ $# -ge 2 ] || die "$1 needs a value"
        case $1 in
          --dir) dir=$2 ;;
          --version) version=$2 ;;
          --keep) keep=$2 ;;
          --repo) repo=$2 ;;
        esac
        shift 2
        ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done

  case $dir in
    /*) ;;
    *) die "--dir must be an absolute path (got $dir)" ;;
  esac
  [ -z "$version" ] || matches "$version" "$SEMVER" ||
    die "--version must be a semantic version such as 0.8.1 (got $version)"
  [ -z "$keep" ] || { matches "$keep" '^[0-9]+$' && [ "$keep" -ge 1 ]; } ||
    die "--keep must be a whole number of versions, 1 or more (got $keep)"
}

# newest_release — print the newest stable version GitHub holds for the runner. Drafts and
# pre-releases are left out, as is every release of anything else in the repository.
newest_release() {
  gh release list --repo "$repo" --limit 200 --exclude-drafts --exclude-pre-releases \
    --json tagName --jq '.[].tagName' |
    sed -n "s/^$TAG_PREFIX//p" | grep -E "$SEMVER" | sort -V | tail -n 1
}

# verify DIR — check every file in DIR against its SHA256SUMS, with whichever tool this
# machine has.
verify() {
  (
    cd "$1"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c SHA256SUMS >/dev/null
    else
      shasum -a 256 -c SHA256SUMS >/dev/null
    fi
  )
}

# discard — remove a download that was never put in place.
discard() {
  [ -z "$incoming" ] || rm -rf "$incoming"
}

# fetch_release — download $version beside its destination, verify it, and rename it in.
fetch_release() {
  mkdir -p "$dir"
  # Beside the destination, so the rename below is one step on one filesystem. The name is
  # not a version, so ouroboros-rest never lists it.
  incoming=$(mktemp -d "$dir/.incoming.XXXXXX")
  trap discard EXIT
  trap 'exit 1' HUP INT TERM

  say "downloading ouroboros-runner $version from $repo"
  gh release download "$TAG_PREFIX$version" --repo "$repo" --dir "$incoming" ||
    die "could not download the release $TAG_PREFIX$version from $repo"

  [ -f "$incoming/SHA256SUMS" ] || die "the release $version carries no SHA256SUMS; nothing was changed"
  [ -f "$incoming/install.sh" ] || die "the release $version carries no install.sh; nothing was changed"
  grep -q ' \*\{0,1\}install\.sh$' "$incoming/SHA256SUMS" ||
    die "the release $version does not list install.sh in SHA256SUMS; nothing was changed"
  verify "$incoming" ||
    die "the release $version does not match its SHA256SUMS — the download was altered or corrupted; nothing was changed"
  say "verified   every file against SHA256SUMS"

  # mktemp made it private; the service reads it as another account.
  chmod 0755 "$incoming"
  chmod 0644 "$incoming"/*

  # A directory of that name with no installer in it is a half-copied release from some
  # other tool: it is replaced, since renaming onto it would put this one inside it.
  [ ! -e "$dir/$version" ] || rm -rf "${dir:?}/$version"
  mv "$incoming" "$dir/$version"
  incoming=''
  say "installed  $dir/$version"
}

# prune — remove all but the newest $keep versions. Only directories named as versions are
# counted or touched.
prune() {
  versions=$(find "$dir" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | grep -E "$SEMVER" | sort -V)
  total=$(printf '%s\n' "$versions" | grep -c . || true)
  [ "$total" -gt "$keep" ] || return 0
  printf '%s\n' "$versions" | head -n "$((total - keep))" | while read -r old; do
    rm -rf "${dir:?}/$old"
    say "removed    $dir/$old"
  done
}

main() {
  parse_arguments "$@"
  command -v gh >/dev/null 2>&1 ||
    die "this needs the GitHub CLI, gh — install it, then sign in with \`gh auth login\` or set GH_TOKEN"

  if [ -z "$version" ]; then
    version=$(newest_release) || version=''
    [ -n "$version" ] ||
      die "found no $TAG_PREFIX<version> release in $repo — is gh signed in to an account that can read it?"
  fi

  if [ -f "$dir/$version/install.sh" ]; then
    say "current    $dir already holds ouroboros-runner $version"
  else
    fetch_release
  fi

  [ -z "$keep" ] || prune
}

main "$@"
