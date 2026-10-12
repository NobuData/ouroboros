#!/usr/bin/env sh
#
# verify-chat-connection-guard.sh — issue #531's concurrency criterion, as a script.
#
# *"At most one `active` Slack connection exists per org — enforced at the database and proven
# by a concurrent-insert test."* tests/constraints.sql shows a second active Slack connection
# being refused once the first is committed; what it cannot show is the race, where two installs
# of two Slack workspaces land at the same moment and neither has committed yet. That needs two
# sessions, so this opens two against a database of its own, interleaves them by hand, and
# asserts what each is left holding.
#
# Five interleavings, and the third is the one that makes the first mean something:
#
#   1. **The guard holds.** A installs a Slack workspace and has not committed. B installs
#      another for the same org — and *waits*, because chat_connections_one_active_slack is a
#      unique index and B's key collides with A's uncommitted row. A commits; B wakes into the
#      unique violation and is refused. One active connection.
#
#   2. **A rolled-back install does not block its retry.** The same race with A rolling back:
#      B is released and succeeds, so a failed install never wedges the org.
#
#   3. **Without the index, both get through.** The same interleaving as 1 with the index
#      dropped: B does not wait and the org has two active Slack connections. This is the
#      probe — it is what would go green if the guard ever stopped being a database rule.
#
#   4. **The guard is no wider than one org.** Two orgs install at the same time without
#      waiting on each other.
#
#   5. **And no wider than Slack.** A `teams` install for the same org neither waits on an
#      uncommitted Slack install nor is refused: the reserved platform is storable and counted
#      by nothing.
#
# Usage:
#   ouroboros-db/tests/verify-chat-connection-guard.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-chat-connection-guard.sh --runner docker
#   ouroboros-db/tests/verify-chat-connection-guard.sh --keep       # leave the database behind
#
# Where it connects and the credential it needs come from the same place, and for the same
# reasons, as verify-alias-reference-guard.sh: `run.sh --print-target`, and PGPASSWORD.
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

# How long any wait may take before it is called a failure — see verify-alias-reference-guard.sh.
TIMEOUT_SECONDS=30

die() {
  status=$1
  shift
  printf 'verify-chat-connection-guard: %s\n' "$*" >&2
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

target=$(cd -- "$ROOT" && "$MODULE_DIR/run.sh" --print-target) ||
  die 2 'run.sh could not work out which database to use'

field() { printf '%s\n' "$target" | awk -v k="$1" '$1 == k { print $2 }'; }

DB_HOST=$(field host)
DB_PORT=$(field port)
DB_NAME=$(field name)
DB_USER=$(field user)

# Its own database: the sessions have to commit to race, and nothing they commit may reach a
# database anybody else is using.
GUARD_DB="${DB_NAME}_chat_guard"

if [ "$runner" = auto ]; then
  if command -v psql >/dev/null 2>&1; then
    runner=psql
  elif command -v docker >/dev/null 2>&1; then
    runner=docker
  else
    die 2 'neither psql nor docker is available to talk to the database'
  fi
fi

WORK=$(mktemp -d)

cleanup() {
  session_close a 2>/dev/null || true
  session_close b 2>/dev/null || true
  rm -rf "$WORK"
  if [ "$keep" -eq 1 ]; then
    return 0
  fi
  maintenance "drop database if exists $GUARD_DB with (force)" || true
}
trap cleanup EXIT HUP INT TERM

# sql, maintenance, the two sessions and the waits — shared with verify-analysis-run-guard.sh.
. "$TEST_DIR/lib/sessions.sh"

# ---------------------------------------------------------------------------
# The database and its fixtures: two orgs, nothing installed.
# ---------------------------------------------------------------------------
ORG=org-chat-guard
OTHER_ORG=org-chat-guard-two
SEALED=ouro.v1.1.bm9uY2U.Y2lwaGVydGV4dA

fixtures() {
  cat <<SQL
begin;
delete from ouroboros.organization where "id" in ('$ORG', '$OTHER_ORG');
insert into ouroboros.organization ("id", "name", "slug", "createdAt")
values ('$ORG', 'Chat Guard Works', 'chat-guard-works', now()),
       ('$OTHER_ORG', 'Chat Guard Two', 'chat-guard-two', now());
commit;
SQL
}

# install ORG PLATFORM WORKSPACE — the insert an install makes: an active connection, its token sealed.
install() {
  printf "insert into ouroboros.chat_connections (organization_id, platform, workspace_id, workspace_name, bot_token_sealed) values ('%s', '%s', '%s', '%s', '%s');" \
    "$1" "$2" "$3" "$3" "$SEALED"
}

# active ORG PLATFORM — how many active connections ORG has on PLATFORM, committed.
active() {
  scalar "select count(*) from ouroboros.chat_connections where organization_id = '$1' and platform = '$2' and status = 'active';"
}

reset() {
  fixtures | sql "$GUARD_DB" > "$WORK/fixtures.out" 2>&1
  if [ "$(scalar "select count(*) from ouroboros.organization where \"id\" in ('$ORG', '$OTHER_ORG');")" != "2" ]; then
    printf '%s\n' "$(cat "$WORK/fixtures.out")" >&2
    die 2 'the fixtures did not apply'
  fi
}

printf '\nChat connection guard — issue #531, the concurrency criterion\n'
printf -- '--- preparing %s on %s:%s\n' "$GUARD_DB" "$DB_HOST" "$DB_PORT"

maintenance "drop database if exists $GUARD_DB with (force)" || true
maintenance "create database $GUARD_DB" ||
  die 2 "could not create $GUARD_DB — does $DB_USER hold CREATEDB?"

(cd -- "$ROOT" && OURO_DB_NAME="$GUARD_DB" "$MODULE_DIR/scripts/migrate" >/dev/null 2>&1) ||
  die 2 "could not migrate $GUARD_DB"

# ---------------------------------------------------------------------------
# 1. The guard holds — the acceptance criterion itself.
# ---------------------------------------------------------------------------
printf -- '\n--- two Slack workspaces are installed for one org at once\n'
reset
session_open a
session_open b

session_send a "begin;
$(install "$ORG" slack T0FIRST)
select 'A-installed';"
await_output a 'A-installed' 'the first install inserts its active connection, uncommitted'

session_send b "$(install "$ORG" slack T0SECOND)
select 'B-returned';"
await_block 'the second install''s insert waits on the first''s uncommitted row'
if session_saw b 'B-returned'; then
  fail 'the second insert is still waiting, not finished'
else
  pass 'the second insert is still waiting, not finished'
fi

session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first install commits'
await_output b 'B-returned' 'and the waiting insert is released'
check_contains "$WORK/b.out" 'chat_connections_one_active_slack' \
  'into the partial unique index, which refuses it'
check_equals '1' "$(active "$ORG" slack)" 'exactly one Slack connection of the org is active'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 2. A rolled-back install releases its retry.
# ---------------------------------------------------------------------------
printf -- '\n--- the first install rolls back\n'
reset
session_open a
session_open b

session_send a "begin;
$(install "$ORG" slack T0FIRST)
select 'A-installed';"
await_output a 'A-installed' 'the first install inserts its active connection, uncommitted'

session_send b "$(install "$ORG" slack T0SECOND)
select 'B-returned';"
await_block 'the second install waits on it'

session_send a "rollback;
select 'A-rolled-back';"
await_output a 'A-rolled-back' 'the first install rolls back'
await_output b 'B-returned' 'and the waiting insert is released'
check_absent "$WORK/b.out" 'ERROR' 'into success — a failed install never wedges the org'
check_equals '1' "$(active "$ORG" slack)" 'still exactly one active Slack connection'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 3. The probe: the same race with the index taken away.
#
# This must end *differently*. If it does not, interleaving 1 was proving something other than
# the index, and the guard would not be missed if it went.
# ---------------------------------------------------------------------------
printf -- '\n--- the same race without chat_connections_one_active_slack\n'
reset
maintenance_guard() { printf '%s\n' "$1" | sql "$GUARD_DB" >/dev/null 2>&1; }
maintenance_guard 'drop index ouroboros.chat_connections_one_active_slack;'
session_open a
session_open b

session_send a "begin;
$(install "$ORG" slack T0FIRST)
select 'A-installed';"
await_output a 'A-installed' 'the first install inserts its active connection, uncommitted'

session_send b "$(install "$ORG" slack T0SECOND)
select 'B-returned';"
await_output b 'B-returned' 'the second insert is not held up'
session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first install commits'
check_absent "$WORK/b.out" 'ERROR' 'and neither is refused'
check_equals '2' "$(active "$ORG" slack)" 'so one org has two active Slack connections — what the index prevents'

session_close a
session_close b
maintenance_guard "delete from ouroboros.chat_connections where organization_id = '$ORG';
create unique index chat_connections_one_active_slack on ouroboros.chat_connections (organization_id) where platform = 'slack' and status = 'active';" || true
check_equals '1' \
  "$(scalar "select count(*) from pg_indexes where schemaname = 'ouroboros' and indexname = 'chat_connections_one_active_slack';")" \
  'the index is put back for the interleavings that follow'

# ---------------------------------------------------------------------------
# 4. The guard is no wider than one org.
# ---------------------------------------------------------------------------
printf -- '\n--- two orgs install at once\n'
reset
session_open a
session_open b

session_send a "begin;
$(install "$ORG" slack T0FIRST)
select 'A-held';"
await_output a 'A-held' 'one org installs a Slack workspace'

session_send b "begin;
$(install "$OTHER_ORG" slack T0FIRST)
select 'B-held';"
await_output b 'B-held' 'another org installs one at the same time — the same Slack workspace, even'
await_no_block 'and neither waits on the other'

session_send a 'rollback;'
session_send b 'rollback;'
session_close a
session_close b

# ---------------------------------------------------------------------------
# 5. And no wider than Slack: teams is storable and counted by nothing.
# ---------------------------------------------------------------------------
printf -- '\n--- a teams install beside an uncommitted Slack one\n'
reset
session_open a
session_open b

session_send a "begin;
$(install "$ORG" slack T0FIRST)
select 'A-held';"
await_output a 'A-held' 'the org installs a Slack workspace, uncommitted'

session_send b "$(install "$ORG" teams 19:tenant-one)
$(install "$ORG" teams 19:tenant-two)
select 'B-returned';"
await_output b 'B-returned' 'two teams installs for the same org do not wait on it'
check_absent "$WORK/b.out" 'ERROR' 'and neither is refused'

session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the Slack install commits'
check_equals '1' "$(active "$ORG" slack)" 'the org has its one active Slack connection'
check_equals '2' "$(active "$ORG" teams)" 'and its teams rows are stored, outside the rule'

session_close a
session_close b

check_summary
