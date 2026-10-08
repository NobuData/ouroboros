#!/usr/bin/env sh
#
# verify-copilot-sessions.sh — issue #555's two concurrency criteria, as a script.
#
# *"At most one `active` session exists per draft — enforced at the database and proven by a
# concurrent-insert test"* and *"`seq` is unique and monotonic per session; history pagination
# is stable under concurrent appends."* tests/constraints.sql shows a second active session
# refused once the first is committed, and seq counting 1, 2, 3 in one session; what it cannot
# show is the race. This opens two sessions against a database of its own and races them.
#
# Seven interleavings. The third and sixth are the probes that make the ones before them mean
# something:
#
#   1. **One active session per draft.** A starts a conversation on a draft and has not
#      committed. B starts one on the same draft — and *waits* on A's uncommitted key in
#      copilot_sessions_one_active. A commits; B is refused. One active session.
#
#   2. **A rolled-back start does not block its retry.** The same race with A rolling back: B
#      is released and succeeds.
#
#   3. **Without the index, both get through.** The same interleaving as 1 with
#      copilot_sessions_one_active dropped: B does not wait, and the draft has two active
#      conversations.
#
#   4. **Two drafts do not contend.** Conversations on two drafts start at once, neither waiting.
#
#   5. **Concurrent appends commit in seq order.** A appends a message and has not committed. B
#      appends to the same session in a transaction of its own — and waits on the session row.
#      A commits; B takes seq 2. A reader between B's allocation and B's commit sees exactly
#      [1]: nothing below the last seq it has seen can still arrive, so a page boundary never
#      moves.
#
#   6. **Without the session row's lock, the append race collides.** The same interleaving with
#      the allocator swapped for a lock-free `max + 1`: both compute seq 1 and B is refused by
#      copilot_messages_session_seq_key.
#
#   7. **A burst stays ordered and gapless.** Several clients append concurrently, each in its
#      own transactions, rolling every third one back. The committed seqs are exactly 1…N, and
#      the session's counter stands at N.
#
# Usage:
#   ouroboros-db/tests/verify-copilot-sessions.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-copilot-sessions.sh --runner docker
#   ouroboros-db/tests/verify-copilot-sessions.sh --keep       # leave the database behind
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

# Interleaving 7: how many clients, and how many appends each makes.
BURST_CLIENTS=6
BURST_APPENDS=10

die() {
  status=$1
  shift
  printf 'verify-copilot-sessions: %s\n' "$*" >&2
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
GUARD_DB="${DB_NAME}_copilot_sessions"

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

# sql, maintenance, the two sessions and the waits — shared with verify-alias-reference-guard.sh.
. "$TEST_DIR/lib/sessions.sh"

maintenance_guard() { printf '%s\n' "$1" | sql "$GUARD_DB" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# The database and its fixtures: one workspace, two drafts, and one active conversation on a
# third draft for the append races. Recreating the workspace cascades everything away.
# ---------------------------------------------------------------------------
ORG=org-copilot-sessions
DRAFT=c5550000-0000-0000-0000-000000000001
OTHER_DRAFT=c5550000-0000-0000-0000-000000000002
APPEND_DRAFT=c5550000-0000-0000-0000-000000000003
SESSION=c5550000-0000-0000-0000-000000000101

fixtures() {
  cat <<SQL
begin;
delete from ouroboros.organization where "id" = '$ORG';
insert into ouroboros.organization ("id", "name", "slug", "createdAt")
values ('$ORG', 'Copilot Sessions Works', 'copilot-sessions-works', now());
insert into ouroboros.workflows (id, organization_id, slug, name) values
  ('$DRAFT',        '$ORG', 'security-patch', 'Security patch'),
  ('$OTHER_DRAFT',  '$ORG', 'standard-fix',   'Standard fix'),
  ('$APPEND_DRAFT', '$ORG', 'nightly-sweep',  'Nightly sweep');
insert into ouroboros.copilot_sessions (id, organization_id, workflow_id, draft_name)
values ('$SESSION', '$ORG', '$APPEND_DRAFT', 'nightly-sweep');
commit;
SQL
}

# start DRAFT — the insert the copilot page makes when a conversation starts on a draft.
start() {
  printf "insert into ouroboros.copilot_sessions (organization_id, workflow_id, draft_name) values ('%s', '%s', 'security-patch');" \
    "$ORG" "$1"
}

# active DRAFT — how many conversations on DRAFT are active, committed.
active() {
  scalar "select count(*) from ouroboros.copilot_sessions where organization_id = '$ORG' and workflow_id = '$1' and status = 'active';"
}

# append — a person's message appended to the append session, letting the allocator number it.
append() {
  printf "insert into ouroboros.copilot_messages (organization_id, session_id, role, body) values ('%s', '%s', 'user', 'label security. yes.');" \
    "$ORG" "$SESSION"
}

# seqs — the committed seqs of the append session, ascending and comma-separated.
seqs() {
  scalar "select coalesce(string_agg(seq::text, ',' order by seq), '') from ouroboros.copilot_messages where session_id = '$SESSION';"
}

reset() {
  fixtures | sql "$GUARD_DB" > "$WORK/fixtures.out" 2>&1
  if [ "$(scalar "select count(*) from ouroboros.copilot_sessions where organization_id = '$ORG';")" != "1" ]; then
    printf '%s\n' "$(cat "$WORK/fixtures.out")" >&2
    die 2 'the fixtures did not apply'
  fi
}

printf '\nCopilot sessions — issue #555, the concurrency criteria\n'
printf -- '--- preparing %s on %s:%s\n' "$GUARD_DB" "$DB_HOST" "$DB_PORT"

maintenance "drop database if exists $GUARD_DB with (force)" || true
maintenance "create database $GUARD_DB" ||
  die 2 "could not create $GUARD_DB — does $DB_USER hold CREATEDB?"

(cd -- "$ROOT" && OURO_DB_NAME="$GUARD_DB" "$MODULE_DIR/scripts/migrate" >/dev/null 2>&1) ||
  die 2 "could not migrate $GUARD_DB"

# ---------------------------------------------------------------------------
# 1. One active session per draft — the acceptance criterion itself.
# ---------------------------------------------------------------------------
printf -- '\n--- two conversations start on one draft at once\n'
reset
session_open a
session_open b

session_send a "begin;
$(start "$DRAFT")
select 'A-started';"
await_output a 'A-started' 'the first conversation starts, uncommitted'

session_send b "$(start "$DRAFT")
select 'B-returned';"
await_block "the second start waits on the first one's uncommitted row"

session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first conversation commits'
await_output b 'B-returned' 'and the waiting start is released'
check_contains "$WORK/b.out" 'copilot_sessions_one_active' \
  'into the one-active-session guard'
check_equals '1' "$(active "$DRAFT")" 'exactly one conversation is active on the draft'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 2. A rolled-back start does not block its retry.
# ---------------------------------------------------------------------------
printf -- '\n--- the first start rolls back\n'
reset
session_open a
session_open b

session_send a "begin;
$(start "$DRAFT")
select 'A-started';"
await_output a 'A-started' 'the first conversation starts, uncommitted'

session_send b "$(start "$DRAFT")
select 'B-returned';"
await_block 'the second start waits on it'

session_send a "rollback;
select 'A-rolled-back';"
await_output a 'A-rolled-back' 'the first start rolls back'
await_output b 'B-returned' 'and the waiting start is released'
check_absent "$WORK/b.out" 'ERROR' 'into success — a failed start never wedges the draft'
check_equals '1' "$(active "$DRAFT")" 'still exactly one conversation active'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 3. The probe: the same race with the index taken away.
#
# This must end *differently*. If it does not, interleaving 1 was proving something other than
# the index, and the guard would not be missed if it went.
# ---------------------------------------------------------------------------
printf -- '\n--- the same race without copilot_sessions_one_active\n'
reset
maintenance_guard 'drop index ouroboros.copilot_sessions_one_active;'
session_open a
session_open b

session_send a "begin;
$(start "$DRAFT")
select 'A-started';"
await_output a 'A-started' 'the first conversation starts, uncommitted'

session_send b "$(start "$DRAFT")
select 'B-returned';"
await_output b 'B-returned' 'the second start is not held up'
session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first conversation commits'
check_absent "$WORK/b.out" 'ERROR' 'and neither is refused'
check_equals '2' "$(active "$DRAFT")" 'so two conversations edit one draft at once — what the index prevents'

session_close a
session_close b
maintenance_guard "delete from ouroboros.organization where \"id\" = '$ORG';
create unique index copilot_sessions_one_active on ouroboros.copilot_sessions (workflow_id) where status = 'active';" || true
check_equals 't' \
  "$(scalar "select count(*) = 1 from pg_indexes where schemaname = 'ouroboros' and indexname = 'copilot_sessions_one_active';")" \
  'the index is restored'

# ---------------------------------------------------------------------------
# 4. Two drafts do not contend.
# ---------------------------------------------------------------------------
printf -- '\n--- two drafts, one workspace\n'
reset
session_open a
session_open b

session_send a "begin;
$(start "$DRAFT")
select 'A-held';"
await_output a 'A-held' 'a conversation starts on one draft'

session_send b "begin;
$(start "$OTHER_DRAFT")
select 'B-held';"
await_output b 'B-held' 'another starts on a second draft at the same time'
await_no_block 'and neither waits on the other'

session_send a 'commit;'
session_send b 'commit;'
session_close a
session_close b
check_equals '1' "$(active "$DRAFT")" 'each draft has its one active conversation'
check_equals '1' "$(active "$OTHER_DRAFT")" 'the other too'

# ---------------------------------------------------------------------------
# 5. Concurrent appends commit in seq order.
# ---------------------------------------------------------------------------
printf -- '\n--- two messages appended to one conversation at once\n'
reset
session_open a
session_open b

session_send a "begin;
$(append)
select 'A-appended';"
await_output a 'A-appended' 'the first append takes its seq, uncommitted'

session_send b "begin;
$(append)
select 'B-appended';"
await_block 'the second append waits on the session row'

session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first append commits'
await_output b 'B-appended' 'and the waiting append is released'
check_equals '1' "$(seqs)" 'a reader sees seq 1 while seq 2 is still uncommitted'

session_send b "commit;
select 'B-committed';"
await_output b 'B-committed' 'the second append commits'
check_absent "$WORK/b.out" 'ERROR' 'without a collision'
check_equals '1,2' "$(seqs)" 'and lands after it — a later commit never takes a lower seq'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 6. The probe: the same append race with a lock-free `max + 1` allocator.
# ---------------------------------------------------------------------------
printf -- '\n--- the same append race without the session row lock\n'
reset
# Kept so it can be put back exactly: pg_get_functiondef is the definition the migration made.
printf '%s\n' "select pg_get_functiondef('ouroboros.copilot_messages_allocate_seq()'::regprocedure);" |
  sql "$GUARD_DB" > "$WORK/original.sql"
printf ';\n' >> "$WORK/original.sql"
maintenance_guard "create or replace function ouroboros.copilot_messages_allocate_seq()
returns trigger language plpgsql as \$\$
begin
  select coalesce(max(seq), 0) + 1 into new.seq
    from ouroboros.copilot_messages where session_id = new.session_id;
  return new;
end;
\$\$;"
session_open a
session_open b

session_send a "begin;
$(append)
select 'A-appended';"
await_output a 'A-appended' 'the first append computes its seq, uncommitted'

session_send b "$(append)
select 'B-returned';"
# B computed seq 1 too, so it waits only on A's uncommitted key — later than the session row
# would have stopped it, and with the wrong number already in hand.
await_block 'the second append waits only at the unique key, its seq already chosen'
session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first append commits'
await_output b 'B-returned' 'the second append returns'
check_contains "$WORK/b.out" 'copilot_messages_session_seq_key' \
  'refused by the unique key — both computed seq 1, which is what the session row lock prevents'
check_equals '1' "$(seqs)" 'so one of two messages was lost'

session_close a
session_close b
sql "$GUARD_DB" < "$WORK/original.sql" >/dev/null 2>&1
check_equals 't' \
  "$(scalar "select prosecdef and prosrc like '%last_seq%' from pg_proc where proname = 'copilot_messages_allocate_seq';")" \
  'the real allocator is restored'

# ---------------------------------------------------------------------------
# 7. A burst of concurrent appends, some rolled back, stays ordered and gapless.
# ---------------------------------------------------------------------------
printf -- '\n--- %s clients x %s appends, every third rolled back\n' "$BURST_CLIENTS" "$BURST_APPENDS"
reset

client=1
pids=
while [ "$client" -le "$BURST_CLIENTS" ]; do
  i=1
  : > "$WORK/burst-$client.sql"
  while [ "$i" -le "$BURST_APPENDS" ]; do
    if [ $((i % 3)) -eq 0 ]; then ending=rollback; else ending=commit; fi
    printf 'begin;\n%s\nselect pg_sleep(0.01);\n%s;\n' "$(append)" "$ending" \
      >> "$WORK/burst-$client.sql"
    i=$((i + 1))
  done
  sql "$GUARD_DB" < "$WORK/burst-$client.sql" > "$WORK/burst-$client.out" 2>&1 &
  pids="$pids $!"
  client=$((client + 1))
done
for pid in $pids; do wait "$pid" || true; done

committed_each=$((BURST_APPENDS - BURST_APPENDS / 3))
expected=$((BURST_CLIENTS * committed_each))
cat "$WORK"/burst-*.out > "$WORK/burst.out"
check_absent "$WORK/burst.out" 'ERROR' 'no concurrent append was refused'
check_equals 't' \
  "$(scalar "select array_agg(seq order by seq) = array(select generate_series(1, $expected)) from ouroboros.copilot_messages where session_id = '$SESSION';")" \
  "all $expected committed appends are numbered exactly 1…$expected — gapless despite the rollbacks"
check_equals "$expected" \
  "$(scalar "select last_seq from ouroboros.copilot_sessions where id = '$SESSION';")" \
  'and the session counter stands at the last committed seq'

check_summary
