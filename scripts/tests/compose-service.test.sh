#!/usr/bin/env sh
#
# compose-service.test.sh — unit tests for scripts/lib/compose-service.awk.
#
# The extractor is what makes a check about one service a check about *that* service, so
# the cases that matter most are the ones where a naive grep would have been satisfied by
# a neighbour: a `ports:` two services down, a key of the same name under `networks:`, a
# block that ends where the next service begins. The last case runs it over the
# repository's real compose file, so the committed stack can never drift out of the shape
# this parses.
#
# Usage:
#   scripts/tests/compose-service.test.sh   # or scripts/run-tests.sh for the whole suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$SCRIPTS_DIR")
EXTRACT="$SCRIPTS_DIR/lib/compose-service.awk"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# The shapes this has to get right, in one file: two services with the same keys, a
# comment that would satisfy a grep, a service name repeated under another top-level key,
# and a block that runs to the end of the file.
FIXTURE="$work/compose.yml"
cat > "$FIXTURE" <<'YAML'
# A stack.
name: fixture

services:
  db:
    image: postgres:17-alpine
    ports:
      - "127.0.0.1:5432:5432"    # loopback only

  engine:
    build:
      context: ./ouroboros-engine
    # It publishes no ports: that is the boundary.
    environment:
      OURO_LOG_LEVEL: ${OURO_LOG_LEVEL:-info}
    profiles:
      - full

  ui:
    network_mode: "service:rest"
    profiles:
      - full

networks:
  ui:
    driver: bridge
YAML

# run_extract SERVICE [FILE] — extract, leaving stdout in $out, stderr in $err, status in
# $status.
run_extract() {
  out=$(awk -v service="$1" -f "$EXTRACT" "${2:-$FIXTURE}" 2> "$work/stderr")
  status=$?
  err=$(cat "$work/stderr")
}

printf '\ncompose-service.awk\n\n'

printf 'Extraction\n'

run_extract db
check_equals 0 "$status" 'a service that is there is extracted'
check_matches "$out" '^  db:$' "the block opens with the service's own header line"
check_matches "$out" '^    image: postgres:17-alpine$' 'its settings are emitted verbatim'
check_matches "$out" '^      - "127\.0\.0\.1:5432:5432"$' 'a trailing comment is stripped from a value'
check_not_matches "$out" 'loopback only' 'and the comment text does not survive into the output'
check_not_matches "$out" 'engine' 'the block ends where the next service begins'

run_extract engine
check_equals 0 "$status" 'a service in the middle of the file is extracted'
check_matches "$out" '^      context: \./ouroboros-engine$' 'a nested mapping is kept'
# The case the whole file exists for: `ports:` appears in this compose file, and this
# service does not declare one. A grep over the file cannot tell those apart.
check_not_matches "$out" '^ *ports:' 'the ports of a sibling service do not leak into this block'
check_not_matches "$out" 'publishes no ports' 'nor does a comment that mentions them'

run_extract ui
check_equals 0 "$status" 'the last service in the block is extracted'
check_matches "$out" '^    network_mode: "service:rest"$' 'its settings are emitted'
# `ui:` is also a key under `networks:`. Only the one inside `services:` is a service.
check_not_matches "$out" 'driver: bridge' 'a same-named key under another top-level block is not part of it'

printf '\nRefusals\n'

run_extract absent
check_equals 1 "$status" 'a service that is not there fails'
check_equals '' "$out" 'and prints no block, so an absence cannot read as a satisfied assertion'
check_matches "$err" 'no service named absent' 'the reason names the service'

out=$(awk -f "$EXTRACT" "$FIXTURE" 2> "$work/stderr")
status=$?
err=$(cat "$work/stderr")
check_equals 1 "$status" 'a run with no -v service= fails'
check_equals '' "$out" 'and prints nothing'
check_matches "$err" 'pass -v service=NAME' 'the reason says what was missing'

printf 'services:\n  db:\n    image: postgres\n  db:\n    image: mysql\n' > "$work/dup.yml"
run_extract db "$work/dup.yml"
check_equals 1 "$status" 'a service declared twice fails rather than emitting one of them'
check_matches "$err" 'declared twice' 'the reason says which problem it was'

printf 'name: nothing\nvolumes:\n  data:\n' > "$work/none.yml"
run_extract db "$work/none.yml"
check_equals 1 "$status" 'a file with no services block fails'

printf '\nThe repository stack\n'

for service in db flyway engine rest ui; do
  run_extract "$service" "$ROOT/docker-compose.yml"
  check_equals 0 "$status" "docker-compose.yml's $service service parses"
  check_matches "$out" "^  $service:\$" "and opens with the $service header"
done

check_summary
