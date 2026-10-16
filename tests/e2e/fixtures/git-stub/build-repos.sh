#!/bin/sh
# Build the fixture repositories (#991) — two bare repositories under $1, each with one commit
# whose sha is the same on every build: every date git records is pinned, and so are the author
# and the committer.
#
#   acme-robotics/helios-bootloader.git   public
#   acme-robotics/helios-console.git      private (the server guards it; the content is the same
#                                         shape, so the only difference under test is the auth)
#
# `uploadpack.allowAnySHA1InWant` lets a client fetch a commit by sha — the runner's first
# attempt (`git fetch --depth 1 origin <commit>`), which GitHub serves too.
set -eu

root=$1
mkdir -p "$root"

export GIT_AUTHOR_NAME="Acme Robotics"
export GIT_AUTHOR_EMAIL="firmware@acme-robotics.example"
export GIT_COMMITTER_NAME="Acme Robotics"
export GIT_COMMITTER_EMAIL="firmware@acme-robotics.example"
export GIT_AUTHOR_DATE="2026-09-01T09:00:00Z"
export GIT_COMMITTER_DATE="2026-09-01T09:00:00Z"
export GIT_CONFIG_NOSYSTEM=1
export HOME=/tmp/git-stub-home
mkdir -p "$HOME"

# build NAME TITLE — one bare repository with one commit on `main`.
build() {
  name=$1
  title=$2
  work=$(mktemp -d)
  bare="$root/acme-robotics/$name.git"

  git init -q -b main "$work"
  cat >"$work/README.md" <<EOF
# $title

A fixture repository the e2e suite's build runner checks out (#991).
EOF
  mkdir -p "$work/src"
  printf 'int main(void) { return 0; }\n' >"$work/src/main.c"
  printf 'all:\n\t@echo built %s\n' "$name" >"$work/Makefile"
  git -C "$work" add -A
  git -C "$work" commit -q -m "Initial import of $title"

  mkdir -p "$(dirname "$bare")"
  git clone -q --bare "$work" "$bare"
  git -C "$bare" config uploadpack.allowAnySHA1InWant true
  git -C "$bare" config http.receivepack false
  # Dumb-HTTP readers and `git ls-remote` find HEAD through these.
  git -C "$bare" update-server-info
  rm -rf "$work"

  printf 'git-stub: %s at %s\n' "acme-robotics/$name" "$(git -C "$bare" rev-parse HEAD)"
}

build helios-bootloader "Helios bootloader"
build helios-console "Helios console"
