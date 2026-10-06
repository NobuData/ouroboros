#!/usr/bin/env sh
#
# verify-investigation-seq.sh — issue #608's sequence criterion, as a script.
#
# *"The per-org sequence yields gapless `RS-###` ids under concurrent creation — proven by a
# concurrency test, not by inspection."* tests/constraints.sql shows the allocator counting from
# 1 per workspace, returning a rolled-back number and never reusing a deleted one, but it is one
# session and cannot race itself. This opens sessions against a database of its own and races
# them.
#
# Five interleavings, and the third is the one that makes the first mean something:
#
#   1. **Concurrent creates serialise.** A creates an investigation and has not committed. B
#      creates one in the same workspace — and *waits*, on the workspace's counter row. A
#      commits; B wakes, reads A's number and takes the next. RS-001 and RS-002, no error.
#
#   2. **A rolled-back create leaves no gap.** The same race with A rolling back: B is released
#      and takes RS-001 — the number A gave back.
#
#   3. **Without the counter row, the race collides.** The same interleaving as 1 with the
#      allocator swapped for a lock-free `max + 1`: both compute RS-001 and B is refused by the
#      unique key. This is the probe — it is what would go green if the allocator ever stopped
#      serialising on the counter.
#
#   4. **Workspaces do not contend.** Two creates in two workspaces at once, neither waiting.
#
#   5. **A burst stays gapless.** Several clients create investigations concurrently, each in
#      its own transactions, rolling every third one back. The committed numbers are exactly
#      1…N.
#
# Usage:
#   ouroboros-db/tests/verify-investigation-seq.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-investigation-seq.sh --runner docker
#   ouroboros-db/tests/verify-investigation-seq.sh --keep       # leave the database behind
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

# Interleaving 5: how many clients, and how many creates each makes.
BURST_CLIENTS=6
BURST_CREATES=10

die() {
  status=$1
  shift
  printf 'verify-investigation-seq: %s\n' "$*" >&2
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
GUARD_DB="${DB_NAME}_investigation_seq"

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

# ---------------------------------------------------------------------------
# The database and its fixtures: two workspaces, no investigations. Recreating a workspace
# deletes its investigations and its counter (cascade) and re-seeds its four kinds (V106's
# organization trigger), so every interleaving starts from RS-001.
# ---------------------------------------------------------------------------
ORG=org-investigation-seq
OTHER_ORG=org-investigation-seq-2

fixtures() {
  cat <<SQL
begin;
delete from ouroboros.organization where "id" in ('$ORG', '$OTHER_ORG');
insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('$ORG',       'Sequence Works', 'sequence-works',   now()),
  ('$OTHER_ORG', 'Sequence Two',   'sequence-two',     now());
commit;
SQL
}

# create ORG — the insert the composer's Start investigation makes, letting the allocator choose.
create() {
  printf "insert into ouroboros.investigations (organization_id, kind_id, question, depth, tools_enabled) select '%s', id, 'Why does the altimeter spike?', 'quick', '[\"web\"]' from ouroboros.investigation_kinds where organization_id = '%s' and slug = 'bug_root_cause';" \
    "$1" "$1"
}

# seqs ORG — the committed numbers of ORG, ascending and comma-separated.
seqs() {
  scalar "select coalesce(string_agg(seq::text, ',' order by seq), '') from ouroboros.investigations where organization_id = '$1';"
}

reset() {
  fixtures | sql "$GUARD_DB" > "$WORK/fixtures.out" 2>&1
  if [ "$(scalar "select count(*) from ouroboros.investigation_kinds where organization_id = '$ORG';")" != "4" ]; then
    printf '%s\n' "$(cat "$WORK/fixtures.out")" >&2
    die 2 'the fixtures did not apply'
  fi
}

printf '\nInvestigation sequence — issue #608, the concurrency criterion\n'
printf -- '--- preparing %s on %s:%s\n' "$GUARD_DB" "$DB_HOST" "$DB_PORT"

maintenance "drop database if exists $GUARD_DB with (force)" || true
maintenance "create database $GUARD_DB" ||
  die 2 "could not create $GUARD_DB — does $DB_USER hold CREATEDB?"

(cd -- "$ROOT" && OURO_DB_NAME="$GUARD_DB" "$MODULE_DIR/scripts/migrate" >/dev/null 2>&1) ||
  die 2 "could not migrate $GUARD_DB"

maintenance_guard() { printf '%s\n' "$1" | sql "$GUARD_DB" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# 1. Concurrent creates serialise — the acceptance criterion itself.
# ---------------------------------------------------------------------------
printf -- '\n--- two people start an investigation in one workspace at once\n'
reset
session_open a
session_open b

session_send a "begin;
$(create "$ORG")
select 'A-created';"
await_output a 'A-created' 'the first create allocates its number, uncommitted'

session_send b "$(create "$ORG")
select 'B-returned';"
await_block "the second create waits on the workspace's counter row"

session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first create commits'
await_output b 'B-returned' 'and the waiting create is released'
check_absent "$WORK/b.out" 'ERROR' 'into success, not a collision'
check_equals '1,2' "$(seqs "$ORG")" 'RS-001 and RS-002 — consecutive, no gap'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 2. A rolled-back create returns its number.
# ---------------------------------------------------------------------------
printf -- '\n--- the first create rolls back\n'
reset
session_open a
session_open b

session_send a "begin;
$(create "$ORG")
select 'A-created';"
await_output a 'A-created' 'the first create allocates its number, uncommitted'

session_send b "$(create "$ORG")
select 'B-returned';"
await_block 'the second create waits on it'

session_send a "rollback;
select 'A-rolled-back';"
await_output a 'A-rolled-back' 'the first create rolls back'
await_output b 'B-returned' 'and the waiting create is released'
check_absent "$WORK/b.out" 'ERROR' 'into success'
check_equals '1' "$(seqs "$ORG")" 'and takes RS-001 — the rolled-back number, so no gap is left'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 3. The probe: the same race with a lock-free `max + 1` allocator.
#
# This must end *differently*. If it does not, interleaving 1 was proving something other than
# the counter row, and the allocator would not be missed if it stopped serialising.
# ---------------------------------------------------------------------------
printf -- '\n--- the same race without the counter row\n'
reset
# Kept so it can be put back exactly: pg_get_functiondef is the definition the migration made.
printf '%s\n' "select pg_get_functiondef('ouroboros.investigations_allocate_seq()'::regprocedure);" |
  sql "$GUARD_DB" > "$WORK/original.sql"
printf ';\n' >> "$WORK/original.sql"
maintenance_guard "create or replace function ouroboros.investigations_allocate_seq()
returns trigger language plpgsql as \$\$
begin
  if new.seq is null then
    select coalesce(max(seq), 0) + 1 into new.seq
      from ouroboros.investigations where organization_id = new.organization_id;
  end if;
  return new;
end;
\$\$;"
session_open a
session_open b

session_send a "begin;
$(create "$ORG")
select 'A-created';"
await_output a 'A-created' 'the first create computes its number, uncommitted'

session_send b "$(create "$ORG")
select 'B-returned';"
# B computed RS-001 too, so it now waits on A's uncommitted key in the unique index — later
# than the counter row would have stopped it, and with the wrong number already in hand.
await_block 'the second create waits only at the unique key, its number already chosen'
session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first create commits'
await_output b 'B-returned' 'the second create returns'
check_contains "$WORK/b.out" 'investigations_organization_seq_key' \
  'refused by the unique key — both computed RS-001, which is what the counter row prevents'
check_equals '1' "$(seqs "$ORG")" 'so only one of two people got an investigation'

session_close a
session_close b
sql "$GUARD_DB" < "$WORK/original.sql" >/dev/null 2>&1
check_equals 't' \
  "$(scalar "select prosrc like '%investigation_seq_counters%' from pg_proc where proname = 'investigations_allocate_seq';")" \
  'the real allocator is restored'

# ---------------------------------------------------------------------------
# 4. Workspaces do not contend.
# ---------------------------------------------------------------------------
printf -- '\n--- two workspaces at once\n'
reset
session_open a
session_open b

session_send a "begin;
$(create "$ORG")
select 'A-held';"
await_output a 'A-held' 'one workspace starts an investigation'

session_send b "begin;
$(create "$OTHER_ORG")
select 'B-held';"
await_output b 'B-held' 'another workspace starts one at the same time'
await_no_block 'and neither waits on the other'

session_send a 'commit;'
session_send b 'commit;'
session_close a
session_close b
check_equals '1' "$(seqs "$ORG")" 'each workspace has its own RS-001'
check_equals '1' "$(seqs "$OTHER_ORG")" 'in the other workspace too'

# ---------------------------------------------------------------------------
# 5. A burst of concurrent creates, some rolled back, stays gapless.
# ---------------------------------------------------------------------------
printf -- '\n--- %s clients x %s creates, every third rolled back\n' "$BURST_CLIENTS" "$BURST_CREATES"
reset

client=1
pids=
while [ "$client" -le "$BURST_CLIENTS" ]; do
  i=1
  : > "$WORK/burst-$client.sql"
  while [ "$i" -le "$BURST_CREATES" ]; do
    if [ $((i % 3)) -eq 0 ]; then ending=rollback; else ending=commit; fi
    printf 'begin;\n%s\nselect pg_sleep(0.01);\n%s;\n' "$(create "$ORG")" "$ending" \
      >> "$WORK/burst-$client.sql"
    i=$((i + 1))
  done
  sql "$GUARD_DB" < "$WORK/burst-$client.sql" > "$WORK/burst-$client.out" 2>&1 &
  pids="$pids $!"
  client=$((client + 1))
done
for pid in $pids; do wait "$pid" || true; done

committed_each=$((BURST_CREATES - BURST_CREATES / 3))
expected=$((BURST_CLIENTS * committed_each))
cat "$WORK"/burst-*.out > "$WORK/burst.out"
check_absent "$WORK/burst.out" 'ERROR' 'no concurrent create was refused'
check_equals "$expected" \
  "$(scalar "select count(*) from ouroboros.investigations where organization_id = '$ORG';")" \
  "all $expected committed creates landed"
check_equals 't' \
  "$(scalar "select array_agg(seq order by seq) = array(select generate_series(1, $expected)) from ouroboros.investigations where organization_id = '$ORG';")" \
  "their numbers are exactly RS-001…RS-$(printf '%03d' "$expected") — gapless despite the rollbacks"
check_equals "$expected" \
  "$(scalar "select last_seq from ouroboros.investigation_seq_counters where organization_id = '$ORG';")" \
  'and the counter stands at the last committed number'

check_summary
