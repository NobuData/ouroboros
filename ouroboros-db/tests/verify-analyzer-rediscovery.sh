#!/usr/bin/env sh
#
# verify-analyzer-rediscovery.sh — issue #509's deepest criterion, as a script: BV.2's change-point
# analyzer, run over the seeded corpus, rediscovers the findings the seed stored.
#
# R__dev_seed_workspace_metrics_analyzer.sql plants three duration shifts in ninety days of builds
# and stores the three change-point findings mockup 18's chart draws as chips. Stored findings
# prove nothing on their own — the page would render them whether the analyzer worked or not.
# So this reads the corpus back out of the seeded database (tests/lib/analyzer-corpus.sql — the
# builds and candidate events, in the engine's `Corpus` shape), reads the stored findings, and
# runs tests/lib/rediscover.py under ouroboros-engine's own environment. That runs the shipped
# `ChangePointAnalyzer` and requires it to emit exactly what the seed stored — dates, deltas,
# medians, the ranked candidates with every score component, the evidence, the confidence and its
# basis — with each planted anchor out-ranking the near misses beside it. It then tampers one
# stored delta and requires the comparison to refuse it, so a comparison that asserts nothing
# cannot pass.
#
# **It needs the seeded database and uv.** In `ci/db` that is the second database the job
# migrates with flyway.seed.toml, after the step that installs uv and syncs ouroboros-engine;
# locally it is the compose stack's, or any database migrated with that overlay.
#
# It writes nothing: two reads, then Python over two temporary files.
#
# Usage:
#   ouroboros-db/tests/verify-analyzer-rediscovery.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-analyzer-rediscovery.sh --runner docker
#   OURO_DB_NAME=ouroboros_seed ouroboros-db/tests/verify-analyzer-rediscovery.sh
#
# Where it connects is not an argument: run.sh resolves that from ouroboros-db/.env, then
# ../.env, then its defaults, with the environment winning over all of them, and this asks it —
# as verify-constraint-probes.sh does. PGPASSWORD must be in the environment.
#
# Exit status:
#   0  the analyzer rediscovered every seeded change-point, and the control was refused
#   1  the analyzer and the seed disagree, or the comparison could not tell them apart
#   2  bad usage, no PGPASSWORD, no uv, no way to reach the database, or no seed in it

set -eu

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$MODULE_DIR")

# Pinned to the server's major version, as the ci/db steps that run the suites are.
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17-alpine}

runner=auto

die() {
  status=$1
  shift
  printf 'verify-analyzer-rediscovery: %s\n' "$*" >&2
  exit "$status"
}

while [ $# -gt 0 ]; do
  case $1 in
    --runner) [ $# -ge 2 ] || die 2 '--runner needs a value: auto, psql or docker'
              runner=$2; shift 2 ;;
    --runner=*) runner=${1#--runner=}; shift ;;
    # The header is the help text, printed to wherever the comment block ends.
    -h | --help) awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) die 2 "unknown argument: $1" ;;
  esac
done

case $runner in
  auto | psql | docker) ;;
  *) die 2 "--runner must be auto, psql or docker, not $runner" ;;
esac

[ -n "${PGPASSWORD:-}" ] || die 2 'PGPASSWORD is not set — see the header'
command -v uv >/dev/null 2>&1 || die 2 'uv is not on PATH — the analyzer runs in ouroboros-engine'"'"'s environment'

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

if [ "$runner" = auto ]; then
  if command -v psql >/dev/null 2>&1; then
    runner=psql
  elif command -v docker >/dev/null 2>&1; then
    runner=docker
  else
    die 2 'neither psql nor docker is available to talk to the database'
  fi
fi

# read_json — run the SQL on stdin and print its single unaligned, tuples-only result.
read_json() {
  case $runner in
    psql)
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -A -t -q \
        -v ON_ERROR_STOP=1 -f -
      ;;
    docker)
      docker run --rm -i --network=host \
        --env PGPASSWORD \
        "$POSTGRES_IMAGE" \
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -A -t -q \
          -v ON_ERROR_STOP=1 -f -
      ;;
  esac
}

printf '\nAnalyzer rediscovery — #509 against %s on %s:%s\n\n' "$DB_NAME" "$DB_HOST" "$DB_PORT"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

read_json < "$TEST_DIR/lib/analyzer-corpus.sql" > "$work/corpus.json" ||
  die 2 "could not read the corpus out of $DB_NAME"
[ -s "$work/corpus.json" ] ||
  die 2 "$DB_NAME holds no complete analysis run of acme-robotics/helios-firmware — migrate it with flyway.seed.toml"

# The stored change-point findings of the same run the corpus was read for.
read_json > "$work/findings.json" <<'SQL' || die 2 "could not read the stored findings out of $DB_NAME"
select coalesce(jsonb_agg(jsonb_build_object(
         'analyzer', f.analyzer, 'analyzer_version', f.analyzer_version,
         'finding_type', f.finding_type, 'subject_key', f.subject_key, 'data', f.data,
         'evidence_refs', f.evidence_refs, 'confidence', f.confidence,
         'confidence_basis', f.confidence_basis) order by f.subject_key), '[]')
  from ouroboros.analysis_findings f
 where f.finding_type = 'change_point'
   and f.run_id = (select r.id
                     from ouroboros.analysis_runs r
                     join ouroboros.organization org on org."id" = r.organization_id
                    where org."slug" = 'acme-robotics'
                      and r.repo_ref = 'acme-robotics/helios-firmware'
                      and r.status = 'complete'
                    order by r.started_at desc
                    limit 1);
SQL

uv run --quiet --project "$ROOT/ouroboros-engine" --locked \
  python "$TEST_DIR/lib/rediscover.py" "$work/corpus.json" "$work/findings.json"
