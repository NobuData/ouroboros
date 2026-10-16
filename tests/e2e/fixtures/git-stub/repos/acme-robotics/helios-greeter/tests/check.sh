#!/bin/sh
# The greeter's test — the two outputs the README promises. The exit status is the verdict:
# 0 when both match, 1 when either does not.
set -u
cd "$(dirname -- "$0")/.." || exit 1

failed=0

# check EXPECTED [ARG...] — run the greeter with ARG... and compare its one line.
check() {
  expected=$1
  shift
  actual=$(sh bin/greet "$@")
  if [ "$actual" = "$expected" ]; then
    printf 'ok   greet %s -> %s\n' "$*" "$actual"
  else
    printf 'FAIL greet %s -> %s (expected %s)\n' "$*" "$actual" "$expected"
    failed=1
  fi
}

check 'Hello, World!' World
check 'Hello, world!'

exit $failed
