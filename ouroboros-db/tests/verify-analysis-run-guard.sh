#!/usr/bin/env sh
#
# verify-analysis-run-guard.sh — issue #506's concurrency criterion, as a script.
#
# *"At most one `running` run per (org, repo) — enforced at the database and proven by a
# concurrent-insert test."* tests/constraints.sql shows a second running row being refused
# once the first is committed; what it cannot show is the race, where two triggers insert at
# the same moment and neither has committed yet. That needs two sessions, so this opens two
# against a database of its own, interleaves them by hand, and asserts what each is left
# holding.
#
# Four interleavings, and the third is the one that makes the first mean something:
#
#   1. **The guard holds.** A starts an analysis of a repo and has not committed. B starts
#      one of the same repo — and *waits*, because analysis_runs_one_running is a unique
#      index and B's key collides with A's uncommitted row. A commits; B wakes into the
#      unique violation and is refused. One running row.
#
#   2. **A rolled-back trigger does not block its retry.** The same race with A rolling
#      back: B is released and succeeds, so a crashed start never wedges the repository.
#
#   3. **Without the index, both get through.** The same interleaving as 1 with the index
#      dropped: B does not wait and two analyses of one repo run at once. This is the probe —
#      it is what would go green if the guard ever stopped being a database rule.
#
#   4. **And the guard is no wider than one repository.** Two analyses of two repositories in
#      one workspace start at the same time without waiting on each other.
#
# Usage:
#   ouroboros-db/tests/verify-analysis-run-guard.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-analysis-run-guard.sh --runner docker
#   ouroboros-db/tests/verify-analysis-run-guard.sh --keep       # leave the database behind
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
  printf 'verify-analysis-run-guard: %s\n' "$*" >&2
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
GUARD_DB="${DB_NAME}_analysis_guard"

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
# The database and its fixtures: one workspace, nothing running.
# ---------------------------------------------------------------------------
ORG=org-analysis-guard
REPO=acme/helios-firmware
OTHER_REPO=acme/helios-bootloader

fixtures() {
  cat <<SQL
begin;
delete from ouroboros.organization where "id" = '$ORG';
insert into ouroboros.organization ("id", "name", "slug", "createdAt")
values ('$ORG', 'Analysis Guard Works', 'analysis-guard-works', now());
commit;
SQL
}

# start_run REPO — the insert a trigger makes when it starts an analysis.
start_run() {
  printf "insert into ouroboros.analysis_runs (organization_id, repo_ref, trigger, analyzer_set) values ('%s', '%s', 'manual', '{\"label\": \"deterministic analyzers v1\", \"analyzers\": [{\"id\": \"change_point\", \"version\": 1, \"kind\": \"deterministic\"}]}');" \
    "$ORG" "$1"
}

# running REPO — how many analyses of REPO are running, committed.
running() {
  scalar "select count(*) from ouroboros.analysis_runs where organization_id = '$ORG' and repo_ref = '$1' and status = 'running';"
}

reset() {
  fixtures | sql "$GUARD_DB" > "$WORK/fixtures.out" 2>&1
  if [ "$(scalar "select count(*) from ouroboros.organization where \"id\" = '$ORG';")" != "1" ]; then
    printf '%s\n' "$(cat "$WORK/fixtures.out")" >&2
    die 2 'the fixtures did not apply'
  fi
}

printf '\nAnalysis run guard — issue #506, the concurrency criterion\n'
printf -- '--- preparing %s on %s:%s\n' "$GUARD_DB" "$DB_HOST" "$DB_PORT"

maintenance "drop database if exists $GUARD_DB with (force)" || true
maintenance "create database $GUARD_DB" ||
  die 2 "could not create $GUARD_DB — does $DB_USER hold CREATEDB?"

(cd -- "$ROOT" && OURO_DB_NAME="$GUARD_DB" "$MODULE_DIR/scripts/migrate" >/dev/null 2>&1) ||
  die 2 "could not migrate $GUARD_DB"

# ---------------------------------------------------------------------------
# 1. The guard holds — the acceptance criterion itself.
# ---------------------------------------------------------------------------
printf -- '\n--- two triggers start an analysis of one repo at once\n'
reset
session_open a
session_open b

session_send a "begin;
$(start_run "$REPO")
select 'A-started';"
await_output a 'A-started' 'the first trigger inserts its running analysis, uncommitted'

session_send b "$(start_run "$REPO")
select 'B-returned';"
await_block 'the second trigger''s insert waits on the first''s uncommitted row'
if session_saw b 'B-returned'; then
  fail 'the second insert is still waiting, not finished'
else
  pass 'the second insert is still waiting, not finished'
fi

session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first trigger commits'
await_output b 'B-returned' 'and the waiting insert is released'
check_contains "$WORK/b.out" 'analysis_runs_one_running' \
  'into the partial unique index, which refuses it'
check_equals '1' "$(running "$REPO")" 'exactly one analysis of the repo is running'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 2. A rolled-back start releases its retry.
# ---------------------------------------------------------------------------
printf -- '\n--- the first start rolls back\n'
reset
session_open a
session_open b

session_send a "begin;
$(start_run "$REPO")
select 'A-started';"
await_output a 'A-started' 'the first trigger inserts its running analysis, uncommitted'

session_send b "$(start_run "$REPO")
select 'B-returned';"
await_block 'the second trigger waits on it'

session_send a "rollback;
select 'A-rolled-back';"
await_output a 'A-rolled-back' 'the first trigger rolls back'
await_output b 'B-returned' 'and the waiting insert is released'
check_absent "$WORK/b.out" 'ERROR' 'into success — a failed start never wedges the repository'
check_equals '1' "$(running "$REPO")" 'still exactly one analysis running'

session_close a
session_close b

# ---------------------------------------------------------------------------
# 3. The probe: the same race with the index taken away.
#
# This must end *differently*. If it does not, interleaving 1 was proving something other than
# the index, and the guard would not be missed if it went.
# ---------------------------------------------------------------------------
printf -- '\n--- the same race without analysis_runs_one_running\n'
reset
maintenance_guard() { printf '%s\n' "$1" | sql "$GUARD_DB" >/dev/null 2>&1; }
maintenance_guard 'drop index ouroboros.analysis_runs_one_running;'
session_open a
session_open b

session_send a "begin;
$(start_run "$REPO")
select 'A-started';"
await_output a 'A-started' 'the first trigger inserts its running analysis, uncommitted'

session_send b "$(start_run "$REPO")
select 'B-returned';"
await_output b 'B-returned' 'the second insert is not held up'
session_send a "commit;
select 'A-committed';"
await_output a 'A-committed' 'the first trigger commits'
check_absent "$WORK/b.out" 'ERROR' 'and neither is refused'
check_equals '2' "$(running "$REPO")" 'so two analyses of one repo run at once — what the index prevents'

session_close a
session_close b
maintenance_guard "create unique index analysis_runs_one_running on ouroboros.analysis_runs (organization_id, repo_ref) where status = 'running';
delete from ouroboros.analysis_runs where organization_id = '$ORG';" || true

# ---------------------------------------------------------------------------
# 4. The guard is no wider than one repository.
# ---------------------------------------------------------------------------
printf -- '\n--- two repos, one workspace\n'
reset
session_open a
session_open b

session_send a "begin;
$(start_run "$REPO")
select 'A-held';"
await_output a 'A-held' 'one repository starts an analysis'

session_send b "begin;
$(start_run "$OTHER_REPO")
select 'B-held';"
await_output b 'B-held' 'another repository in the same workspace starts one at the same time'
await_no_block 'and neither waits on the other'

session_send a 'rollback;'
session_send b 'rollback;'
session_close a
session_close b

check_summary
