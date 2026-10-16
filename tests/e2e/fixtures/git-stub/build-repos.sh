#!/bin/sh
# Build the fixture repositories (#991, #1314) — three bare repositories under $1, each with one
# commit whose sha is the same on every build: every date git records is pinned, and so are the
# author and the committer.
#
#   acme-robotics/helios-bootloader.git   public
#   acme-robotics/helios-console.git      private (the server guards it; the content is the same
#                                         shape, so the only difference under test is the auth)
#   acme-robotics/helios-greeter.git      private — the live slice's repository (#1314, DI.5),
#                                         built from ./repos/acme-robotics/helios-greeter, the
#                                         directory the provider fixture's recording was made over
#
# `uploadpack.allowAnySHA1InWant` lets a client fetch a commit by sha — the runner's first
# attempt (`git fetch --depth 1 origin <commit>`), which GitHub serves too.
#
# **Every repository accepts a push, to run branches only** (#1314). `http.receivepack true` lets
# `git http-backend` serve receive-pack, and the `update` hook installed in each repository is the
# whole push policy: a ref under `refs/heads/ouro/run-*` may be created, moved or deleted, and any
# other ref — the default branch first among them — is refused with one sentence the client sees
# as a `remote:` line. GitHub's branch protection is a policy a person configures; this is the
# fixture's standing in for it, so the slice's single-branch push (DI.2) is proven against a host
# that would refuse anything else.
set -eu

root=$1
mkdir -p "$root"

here=$(cd -- "$(dirname -- "$0")" && pwd)

export GIT_AUTHOR_NAME="Acme Robotics"
export GIT_AUTHOR_EMAIL="firmware@acme-robotics.example"
export GIT_COMMITTER_NAME="Acme Robotics"
export GIT_COMMITTER_EMAIL="firmware@acme-robotics.example"
export GIT_AUTHOR_DATE="2026-09-01T09:00:00Z"
export GIT_COMMITTER_DATE="2026-09-01T09:00:00Z"
export GIT_CONFIG_NOSYSTEM=1
export HOME=/tmp/git-stub-home
mkdir -p "$HOME"

# finish WORK NAME TITLE — turn a working tree into the bare repository, with its push policy.
finish() {
  work=$1
  name=$2
  title=$3
  bare="$root/acme-robotics/$name.git"

  git -C "$work" add -A
  git -C "$work" commit -q -m "Initial import of $title"

  mkdir -p "$(dirname "$bare")"
  git clone -q --bare "$work" "$bare"
  git -C "$bare" config uploadpack.allowAnySHA1InWant true
  # A push is served — and judged by the update hook below, never by this switch alone.
  git -C "$bare" config http.receivepack true
  install_hook "$bare"
  # Dumb-HTTP readers and `git ls-remote` find HEAD through these.
  git -C "$bare" update-server-info
  rm -rf "$work"

  printf 'git-stub: %s at %s\n' "acme-robotics/$name" "$(git -C "$bare" rev-parse HEAD)"
}

# install_hook BARE — the push policy: run branches only.
#
# git calls `update <ref> <old-sha> <new-sha>` once per ref a push touches, before moving it; a
# non-zero exit refuses that ref and the client prints what the hook wrote to stderr.
install_hook() {
  bare=$1
  cat >"$bare/hooks/update" <<'EOF'
#!/bin/sh
# git-stub's push policy (#1314): only run branches may be pushed, created or deleted.
ref=$1
case "$ref" in
  refs/heads/ouro/run-*) exit 0 ;;
esac
printf 'git-stub: refusing push to %s: only refs/heads/ouro/run-* accept pushes\n' "$ref" >&2
exit 1
EOF
  chmod 0755 "$bare/hooks/update"
}

# build NAME TITLE — one bare repository with one commit on `main`, from a generated tree.
build() {
  name=$1
  title=$2
  work=$(mktemp -d)

  git init -q -b main "$work"
  cat >"$work/README.md" <<EOF
# $title

A fixture repository the e2e suite's build runner checks out (#991).
EOF
  mkdir -p "$work/src"
  printf 'int main(void) { return 0; }\n' >"$work/src/main.c"
  printf 'all:\n\t@echo built %s\n' "$name" >"$work/Makefile"

  finish "$work" "$name" "$title"
}

# build_from DIR NAME TITLE — one bare repository with one commit on `main`, from a committed tree.
build_from() {
  source=$1
  name=$2
  title=$3
  work=$(mktemp -d)

  git init -q -b main "$work"
  cp -R "$source/." "$work/"

  finish "$work" "$name" "$title"
}

build helios-bootloader "Helios bootloader"
build helios-console "Helios console"
build_from "$here/repos/acme-robotics/helios-greeter" helios-greeter "Helios greeter"
