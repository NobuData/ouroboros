#!/usr/bin/env sh
#
# verify-alias-reference-guard.sh — issue #581's concurrency criterion, as a script.
#
# *"A concurrent route save during a delete transaction cannot produce an orphaned
# reference — proven by a concurrency test."* Nothing in tests/constraints.sql can prove
# that: it is one psql session inside one transaction, and a race needs two. So this opens
# two sessions against a database of its own, interleaves them by hand, and asserts what
# each one is left holding.
#
# Three interleavings, and the second is the one that makes the first mean something:
#
#   1. **The guard holds.** A takes ouroboros.alias_reference_guard() on an unreferenced
#      alias and is told there are no references. B then tries to save a route hop naming
#      that alias — and *waits*, because the guard locked the alias FOR UPDATE and a hop
#      insert needs FOR KEY SHARE on the same row. A deletes and commits; B wakes into a
#      foreign key that no longer has a target and is refused. No orphan, and — the part
#      that matters for CH.1 (#584) — the list A was given was still true when A acted on it.
#
#   2. **Without the lock, that list goes stale.** The same interleaving with a plain
#      `select … from ouroboros.alias_references` in place of the guard: B does not wait,
#      B commits, and A's delete is refused by route_hops_alias_fk. Still no orphan — the
#      foreign key is not optional — but A was told the delete was safe and then failed on a
#      referential error naming a constraint, which is a 500 where the user was owed a 409
#      naming the route. This is the probe: it is what would go green if the guard stopped
#      taking a lock, and a guard nothing distinguishes from a bare count is not a guard.
#
#   3. **And the lock is no wider than it needs to be.** Two guards on two different aliases
#      of one workspace do not wait on each other, so guarding is not a workspace-wide
#      serialisation point.
#
# Usage:
#   ouroboros-db/tests/verify-alias-reference-guard.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-alias-reference-guard.sh --runner docker
#   ouroboros-db/tests/verify-alias-reference-guard.sh --keep       # leave the database behind
#
# Where it connects is not an argument, and PGPASSWORD must be in the environment — both for
# the reasons verify-constraint-probes.sh gives in its own header, and through the same
# `run.sh --print-target`, so the two scripts cannot disagree about which database is meant.
#
# Exit status:
#   0  every interleaving ended the way it must
#   1  at least one did not
#   2  bad usage, no PGPASSWORD, or no way to reach the database

set -eu

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$MODULE_DIR")

. "$ROOT/scripts/lib/checks.sh"

POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17-alpine}

runner=auto
keep=0

# How long any wait below may take before it is called a failure. Generous, because a
# loaded CI runner is slow and a wrong answer here is a flake rather than a finding; every
# wait that ends early ends as soon as the condition holds, so the number costs nothing
# when things work.
TIMEOUT_SECONDS=30

die() {
  status=$1
  shift
  printf 'verify-alias-reference-guard: %s\n' "$*" >&2
  exit "$status"
}

while [ $# -gt 0 ]; do
  case $1 in
    --runner) [ $# -ge 2 ] || die 2 '--runner needs a value: auto, psql or docker'
              runner=$2; shift 2 ;;
    --runner=*) runner=${1#--runner=}; shift ;;
    --keep) keep=1; shift ;;
    -h | --help) awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) die 2 "unknown argument: $1" ;;
  esac
done

case $runner in
  auto | psql | docker) ;;
  *) die 2 "--runner must be auto, psql or docker, not $runner" ;;
esac

[ -n "${PGPASSWORD:-}" ] || die 2 'PGPASSWORD is not set — see the header'

# ---------------------------------------------------------------------------
# Where to connect, asked of the script that already knows.
# ---------------------------------------------------------------------------
target=$(cd -- "$ROOT" && "$MODULE_DIR/run.sh" --print-target) ||
  die 2 'run.sh could not work out which database to use'

field() { printf '%s\n' "$target" | awk -v k="$1" '$1 == k { print $2 }'; }

DB_HOST=$(field host)
DB_PORT=$(field port)
DB_NAME=$(field name)
DB_USER=$(field user)

# Its own database, for the reason the fixtures are committed rather than rolled back: two
# sessions cannot see each other's uncommitted rows, so this suite has to leave rows behind
# while it runs. Nothing it writes may reach a database anybody else is using.
GUARD_DB="${DB_NAME}_guard"

if [ "$runner" = auto ]; then
  if command -v psql >/dev/null 2>&1; then
    runner=psql
  elif command -v docker >/dev/null 2>&1; then
    runner=docker
  else
    die 2 'neither psql nor docker is available to talk to the database'
  fi
fi

# sql DBNAME — run the SQL on stdin against DBNAME as a one-shot session.
#
# Deliberately without ON_ERROR_STOP: several statements below are *expected* to be
# refused, and what is asserted is the refusal rather than the exit status.
sql() {
  case $runner in
    psql)
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$1" -X -q -A -t -f -
      ;;
    docker)
      docker run --rm -i --network=host --env PGPASSWORD "$POSTGRES_IMAGE" \
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$1" -X -q -A -t -f -
      ;;
  esac
}

maintenance() { printf '%s\n' "$1" | sql postgres >/dev/null 2>&1; }

WORK=$(mktemp -d)

cleanup() {
  # The sessions first: a psql still holding a transaction open would keep a lock on rows
  # in a database the next line is about to drop.
  session_close a 2>/dev/null || true
  session_close b 2>/dev/null || true
  rm -rf "$WORK"
  if [ "$keep" -eq 1 ]; then
    return 0
  fi
  maintenance "drop database if exists $GUARD_DB with (force)" || true
}
trap cleanup EXIT HUP INT TERM

# ---------------------------------------------------------------------------
# Two sessions that stay open.
#
# A psql reading from a named pipe is a session that lives until the pipe is closed, which
# is what lets a statement be sent, its effect observed, and the transaction left open
# while the other session is driven. Its transcript accumulates in a file, so waiting for a
# statement to finish is waiting for its marker to appear there — and a statement that is
# *blocked* is exactly one whose marker does not.
#
# Session A holds file descriptor 7 and session B holds 8. Fixed descriptors rather than a
# lookup because POSIX shell has no arrays and two is all this needs.
# ---------------------------------------------------------------------------

SESSION_A_PID=
SESSION_B_PID=

# session_open NAME — start a session reading from WORK/NAME.in, transcribing to WORK/NAME.out.
session_open() {
  rm -f "$WORK/$1.in"
  mkfifo "$WORK/$1.in"
  : > "$WORK/$1.out"

  # Started before the writing end is opened: opening a fifo for reading blocks until a
  # writer arrives and vice versa, so the two `exec`s below are what let each other through.
  #
  # The `exec 7>&- 8>&-` inside the subshell is load-bearing rather than tidy. A background
  # command inherits every descriptor the shell has open, so without it session B's psql
  # holds a *writing* end of session A's pipe — and A then never sees the EOF that closing
  # descriptor 7 is supposed to be, so session_close waits for a process that has no reason
  # to exit. It is `exec` inside a subshell rather than a `7>&-` redirection on the command,
  # because a redirection attached to a shell *function* is undone when the function
  # returns, and `sql` is one.
  ( exec 7>&- 8>&-; sql "$GUARD_DB" ) < "$WORK/$1.in" > "$WORK/$1.out" 2>&1 &

  case $1 in
    a) SESSION_A_PID=$!; exec 7> "$WORK/a.in" ;;
    b) SESSION_B_PID=$!; exec 8> "$WORK/b.in" ;;
  esac
}

# session_send NAME SQL — write one or more statements into a session.
session_send() {
  case $1 in
    a) printf '%s\n' "$2" >&7 ;;
    b) printf '%s\n' "$2" >&8 ;;
  esac
}

# session_close NAME — close the writing end, which is the session's EOF, and wait for the
# session to actually go.
#
# Waited on rather than left to exit on its own, because the next interleaving reuses the
# name: a psql still holding its transaction open would keep a lock on the very rows the
# next fixture reset is about to replace, and a transcript still being written would be
# truncated out from under it.
session_close() {
  case $1 in
    a) [ -n "$SESSION_A_PID" ] || return 0
       exec 7>&-; wait "$SESSION_A_PID" 2>/dev/null || true; SESSION_A_PID= ;;
    b) [ -n "$SESSION_B_PID" ] || return 0
       exec 8>&-; wait "$SESSION_B_PID" 2>/dev/null || true; SESSION_B_PID= ;;
  esac
}

# session_saw NAME PATTERN — whether a session's transcript matches an extended regex yet.
session_saw() { grep -Eq -- "$2" "$WORK/$1.out"; }

# await_output NAME PATTERN DESCRIPTION — wait for a statement to finish, then assert it did.
#
# Every statement below is followed by a `select 'marker'`, so its marker appearing is the
# statement having run to completion — and the marker *not* appearing within the timeout is
# the statement being blocked, which two of the three interleavings assert on purpose.
await_output() {
  await_left=$TIMEOUT_SECONDS
  while [ "$await_left" -gt 0 ]; do
    if session_saw "$1" "$2"; then
      pass "$3"
      return 0
    fi
    sleep 1
    await_left=$((await_left - 1))
  done
  fail "$3 (nothing matching \"$2\" in session $1 after ${TIMEOUT_SECONDS}s)"
}

# waiting_sessions — how many connections to this database are stuck behind a lock.
waiting_sessions() {
  printf "select count(*) from pg_stat_activity where datname = '%s' and wait_event_type = 'Lock';\n" \
    "$GUARD_DB" | sql "$GUARD_DB" | tr -d '[:space:]'
}

# await_block DESCRIPTION — wait until exactly one session is waiting on a lock.
#
# The positive half of the criterion, and it is asserted from PostgreSQL's own view rather
# than inferred from a marker that has not arrived: "the statement has not finished" and
# "the statement is waiting for a lock" are different claims, and only the second one says
# the guard did anything.
await_block() {
  block_left=$TIMEOUT_SECONDS
  while [ "$block_left" -gt 0 ]; do
    if [ "$(waiting_sessions)" = "1" ]; then
      pass "$1"
      return 0
    fi
    sleep 1
    block_left=$((block_left - 1))
  done
  fail "$1 (no session was waiting on a lock after ${TIMEOUT_SECONDS}s)"
}

# await_no_block DESCRIPTION — assert nothing is waiting on a lock right now.
await_no_block() {
  if [ "$(waiting_sessions)" = "0" ]; then
    pass "$1"
  else
    fail "$1 (a session is waiting on a lock)"
  fi
}

# scalar SQL — one value, read on a connection of its own.
scalar() { printf '%s\n' "$1" | sql "$GUARD_DB" | tr -d '[:space:]'; }

# ---------------------------------------------------------------------------
# The database and its fixtures.
#
# One workspace, three aliases and one route whose chain is a single hop. The aliases are
# **unbound** — V019 made `provider_connection_id` nullable and requires such a row to be
# disabled — which is what lets this file build a routing fixture without a provider
# connection, a credential envelope or a person to have added one. None of that is what is
# under test here.
#
# `anchor` is hop 1 and exists so the route has a chain at all: V016's route_chain_intact()
# refuses a route with no hops, so a fixture route cannot be committed empty and the hop
# under test has to be a *second* hop rather than a first.
# ---------------------------------------------------------------------------
ORG=org-guard
ALIAS_GUARDED=c0000000-0000-4000-8000-000000000002
ALIAS_NEIGHBOUR=c0000000-0000-4000-8000-000000000003
ROUTE=c0000000-0000-4000-8000-000000000021
NEW_HOP=c0000000-0000-4000-8000-000000000032

fixtures() {
  cat <<SQL
begin;
delete from ouroboros.organization where "id" = '$ORG';
insert into ouroboros.organization ("id", "name", "slug", "createdAt")
values ('$ORG', 'Guard Works', 'guard-works', now());

insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id, enabled)
values ('c0000000-0000-4000-8000-000000000001', '$ORG', 'anchor',    null, 'anchor-model',    false),
       ('$ALIAS_GUARDED',                       '$ORG', 'guarded',   null, 'guarded-model',   false),
       ('$ALIAS_NEIGHBOUR',                     '$ORG', 'neighbour', null, 'neighbour-model', false);

insert into ouroboros.task_kinds (id, organization_id, name, description, sort_order)
values ('c0000000-0000-4000-8000-000000000011', '$ORG', 'implement', 'writes the code', 1);

insert into ouroboros.routes (id, organization_id, task_kind_id, tag)
values ('$ROUTE', '$ORG', 'c0000000-0000-4000-8000-000000000011', 'guard-primary');

insert into ouroboros.route_hops (id, organization_id, route_id, position, model_alias_id)
values ('c0000000-0000-4000-8000-000000000031', '$ORG', '$ROUTE', 1,
        'c0000000-0000-4000-8000-000000000001')
SQL
}

# The hop a concurrent *Save routes* would write — a second fallback naming the alias the
# other session is in the middle of deleting.
route_save() {
  printf "insert into ouroboros.route_hops (id, organization_id, route_id, position, model_alias_id) values ('%s', '%s', '%s', 2, '%s');" \
    "$NEW_HOP" "$ORG" "$ROUTE" "$ALIAS_GUARDED"
}

printf '\nAlias reference guard — issue #581, the concurrency criterion\n'
printf -- '--- preparing %s on %s:%s\n' "$GUARD_DB" "$DB_HOST" "$DB_PORT"

maintenance "drop database if exists $GUARD_DB with (force)" || true
maintenance "create database $GUARD_DB" ||
  die 2 "could not create $GUARD_DB — does $DB_USER hold CREATEDB?"

(cd -- "$ROOT" && OURO_DB_NAME="$GUARD_DB" "$MODULE_DIR/scripts/migrate" >/dev/null 2>&1) ||
  die 2 "could not migrate $GUARD_DB"

# reset — put the fixtures back, whatever the last interleaving did to them.
reset() {
  {
    fixtures
    printf ';\ncommit;\n'
  } | sql "$GUARD_DB" > "$WORK/fixtures.out" 2>&1

  if [ "$(scalar "select count(*) from ouroboros.model_aliases where organization_id = '$ORG';")" != "3" ]; then
    printf '%s\n' "$(cat "$WORK/fixtures.out")" >&2
    die 2 'the fixtures did not apply'
  fi
}

# ---------------------------------------------------------------------------
# 1. The guard holds — the acceptance criterion itself.
# ---------------------------------------------------------------------------
printf -- '\n--- a route save during a guarded delete\n'
reset
session_open a
session_open b

session_send a "begin;
select 'A-refs=' || count(*) from ouroboros.alias_reference_guard('$ORG', '$ALIAS_GUARDED');"
await_output a 'A-refs=' 'the guard answers inside the deleting transaction'
check_contains "$WORK/a.out" 'A-refs=0' 'and reports an unreferenced alias as unreferenced'

session_send b "$(route_save)
select 'B-save-returned';"
await_block 'a concurrent route save naming that alias waits for the guard'
if session_saw b 'B-save-returned'; then
  fail 'the route save is still waiting, not finished'
else
  pass 'the route save is still waiting, not finished'
fi

session_send a "delete from ouroboros.model_aliases where organization_id = '$ORG' and id = '$ALIAS_GUARDED';
commit;
select 'A-committed';"
await_output a 'A-committed' 'the delete the guard cleared goes through'
await_output b 'B-save-returned' 'and the waiting route save is released'

check_contains "$WORK/b.out" 'route_hops_alias_fk' \
  'which then meets the foreign key against a committed delete and is refused'
check_equals '0' "$(scalar "select count(*) from ouroboros.route_hops where model_alias_id = '$ALIAS_GUARDED';")" \
  'no hop is left referencing the deleted alias'
check_equals '0' "$(scalar "select count(*) from ouroboros.model_aliases where id = '$ALIAS_GUARDED';")" \
  'and the alias is gone — the delete was not silently undone either'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 2. The probe: the same interleaving with the lock taken away.
#
# This is the run that must end *differently*. If it does not, the guard's FOR UPDATE is
# doing nothing and interleaving 1 above was proving the foreign key rather than the guard.
# ---------------------------------------------------------------------------
printf -- '\n--- the same race, read through the bare view instead of the guard\n'
reset
session_open a
session_open b

session_send a "begin;
select 'A-refs=' || count(*) from ouroboros.alias_references where organization_id = '$ORG' and alias_id = '$ALIAS_GUARDED';"
await_output a 'A-refs=0' 'an unlocked read gives the same answer the guard did'

session_send b "$(route_save)
select 'B-save-returned';"
await_output b 'B-save-returned' 'and the concurrent route save is not held up by it'
check_absent "$WORK/b.out" 'ERROR' 'the route save succeeds'

# The marker is after the `rollback` rather than after the `delete`, and that is a property
# of the failure being asserted: the delete raises, which leaves the session's transaction
# aborted, and PostgreSQL refuses every statement in an aborted transaction until it ends. A
# marker between the two would never arrive — which is itself the evidence, but evidence a
# reader would have to reconstruct from a timeout.
session_send a "delete from ouroboros.model_aliases where organization_id = '$ORG' and id = '$ALIAS_GUARDED';
rollback;
select 'A-delete-returned';"
await_output a 'A-delete-returned' 'the delete the unlocked read cleared is attempted, and does not go through'
check_contains "$WORK/a.out" 'route_hops_alias_fk' \
  'and is refused by the foreign key — a referential error where a designed refusal was owed'
check_equals '1' "$(scalar "select count(*) from ouroboros.model_aliases where id = '$ALIAS_GUARDED';")" \
  'so the alias survives: still no orphan, and still no answer anybody can render'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 3. The lock is no wider than the alias it is about.
# ---------------------------------------------------------------------------
printf -- '\n--- two guards, two aliases, one workspace\n'
reset
session_open a
session_open b

session_send a "begin;
select 'A-guarded' from ouroboros.alias_reference_guard('$ORG', '$ALIAS_GUARDED') limit 1;
select 'A-held';"
await_output a 'A-held' 'one alias is guarded'

session_send b "begin;
select 'B-guarded' from ouroboros.alias_reference_guard('$ORG', '$ALIAS_NEIGHBOUR') limit 1;
select 'B-held';"
await_output b 'B-held' 'another alias in the same workspace is guarded at the same time'
await_no_block 'and neither waits on the other'

session_send a 'rollback;'
session_send b 'rollback;'
session_close a
session_close b

check_summary
