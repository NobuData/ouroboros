#!/usr/bin/env sh
#
# verify-settings-invariants.sh — issue #484's (BQ.5) red/green criterion, as a script.
#
# tests/settings-invariants.sql asserts that the settings rows a database holds satisfy the
# invariants mockup 17's Settings page trusts, and against R__dev_seed_workspace_settings.sql it is
# green. A green run proves nothing about whether it *would* go red: a file asserting nothing is
# exactly as green. #484's acceptance criterion is *"every probe is verified red-then-green (each
# fails when its invariant is deliberately broken)"*. So this breaks each rule in the seeded
# database, writes the row the rule was there to stop, runs the suite over it, and requires it to
# **fail naming the invariant the plant violates**.
#
#   plant                                              marker (the invariant the failure names)
#   -------------------------------------------------  ------------------------------------------
#   policy versions lose their immutability trigger    org_policy_versions_immutable
#   policy v7 is rewritten without a core rule          org_policy_versions_envelope
#   the policy pointer is moved back to v6              org_policies_current_is_latest
#   can_approve_loops may be null                       member_capabilities_explicit
#   can_approve_loops defaults to true                  member_capabilities_explicit
#   a new service account defaults to api.read          service_accounts_least_privilege
#   the audit tier is cut to 30 days                    retention_policies_floor
#   the SIEM signing key is stored in the clear         webhook_keys_sealed
#   a webhook table grows a plaintext key column        webhook_keys_sealed
#   devops-bot's key is stored as itself                service_tokens_hash_only
#   the release bot is sent an audit event              webhook_deliveries_family_subscribed
#   the PagerDuty route reads as delivering             notification_routes_lock_derived
#   an audit line names a runner that does not exist    settings_audit_subjects_resolve
#
# The schema side of those rules is proven load-bearing by tests/verify-constraint-probes.sh;
# this is the *seeded* side, which that script cannot reach — constraints.sql clears every
# workspace before it starts, so a row planted under it is gone before any assertion reads it.
# The JSON Schema half of policy conformance is ci/db's org-policy-schema step over the same rows.
#
# **It needs the seeded database**, and says so rather than going red for the wrong reason: every
# plant names a row R__dev_seed_workspace_settings.sql writes. In `ci/db` that is the second
# database the job migrates with flyway.seed.toml; locally it is the compose stack's.
#
# It writes nothing that outlives a session. Each plant and the suite run in one transaction that
# is never committed: a detected plant aborts it, and an undetected one reaches the suite's own
# `rollback`. The dropped rules and disabled triggers come back the same way.
#
# Usage:
#   ouroboros-db/tests/verify-settings-invariants.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-settings-invariants.sh --runner docker
#   OURO_DB_NAME=ouroboros_seed ouroboros-db/tests/verify-settings-invariants.sh
#
# Where it connects is not an argument: run.sh already resolves that from ouroboros-db/.env, then
# ../.env, then its defaults, with the environment winning over all of them, and this asks it — as
# verify-constraint-probes.sh does. PGPASSWORD must be in the environment.
#
# Exit status:
#   0  the seeded database is green, and every plant turned it red naming its invariant
#   1  the seeded database is red, or a plant stayed green or went red naming something else
#   2  bad usage, no PGPASSWORD, no way to reach the database, or a database with no seed in it

set -eu

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$MODULE_DIR")

# The repo's shared assertion harness, so a failure here reads like a failure anywhere else.
. "$ROOT/scripts/lib/checks.sh"

# Pinned to the server's major version, as the ci/db steps that run the suites unmutated are.
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17-alpine}

runner=auto

# The workspace every plant writes into, and the seeded rows the plants rewrite.
SEED_ORG=5eed0001-0000-4000-8000-000000000001
SIEM_ENDPOINT=5eed0076-0000-4000-8000-000000000001
RELEASE_ENDPOINT=5eed0076-0000-4000-8000-000000000002
SERVICE_KEY=5eed0072-0000-4000-8000-000000000001

die() {
  status=$1
  shift
  printf 'verify-settings-invariants: %s\n' "$*" >&2
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

# The suite is read by the client, so where it is depends on which client.
if [ "$runner" = docker ]; then
  SUITE=/tests/settings-invariants.sql
else
  SUITE="$TEST_DIR/settings-invariants.sql"
fi

# sql — run the SQL on stdin against the target database, printing whatever the server says.
# ON_ERROR_STOP turns the first violated assertion into a non-zero exit.
sql() {
  case $runner in
    psql)
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -
      ;;
    docker)
      docker run --rm -i --network=host \
        --env PGPASSWORD \
        --volume "$TEST_DIR:/tests:ro" \
        "$POSTGRES_IMAGE" \
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -
      ;;
  esac
}

printf '\nSettings invariants — #484 red on planted data, against %s on %s:%s\n' \
  "$DB_NAME" "$DB_HOST" "$DB_PORT"

# ---------------------------------------------------------------------------
# The seed has to be there, or every plant fails on its own statement.
# ---------------------------------------------------------------------------
# Labelled rather than parsed out of psql's table layout, so the answer is one grep whatever the
# client's formatting defaults are. Seven is the settings seed's published policy versions.
seeded=$(printf "select 'seeded-versions=' || count(*) from ouroboros.org_policy_versions where organization_id = '%s';\n" \
           "$SEED_ORG" | sql 2>&1) ||
  die 2 "could not query $DB_NAME: $seeded"
printf '%s\n' "$seeded" | grep -q 'seeded-versions=7$' ||
  die 2 "$DB_NAME does not hold the settings seed (#484) — migrate it with flyway.seed.toml"

LOG_DIR=$(mktemp -d)

# run_suite PLANT LOG — plant, then run settings-invariants.sql, in one session and one
# transaction, leaving the transcript in LOG. The suite's own `begin` is a no-op that warns; an
# abort or its closing `rollback` takes the plant back out. An empty PLANT is the control.
run_suite() {
  suite_status=0
  {
    printf 'begin;\n'
    printf '%s\n' "$1"
    printf '\\i %s\n' "$SUITE"
  } | sql >"$2" 2>&1 || suite_status=$?
  return "$suite_status"
}

# The control. A suite that is red before anything is planted would make every plant below look
# caught, so it has to be green first — which is also #484's *"green"* half.
printf '\n--- nothing planted\n'
control_log="$LOG_DIR/control.log"
if run_suite '' "$control_log"; then
  pass 'settings-invariants.sql is green against the seeded database'
else
  fail "settings-invariants.sql is green against the seeded database (see $control_log)"
  printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
  exit 1
fi

# expect_red LABEL MARKER PLANT — the assertion this script exists to make.
#
# MARKER is the invariant's name and the opening of its stored-row assertion, matched as an
# extended regular expression against the transcript. Without it a plant that failed on its own
# statement — a seed id that moved, a rule renamed — would read as an invariant doing its job, and
# a plant caught only by the catalogue half would not prove the row half reads anything.
expect_red() {
  red_label=$1
  red_marker=$2
  red_log="$LOG_DIR/$(printf '%s' "$red_label" | tr -c 'a-zA-Z0-9' '-').log"

  printf '\n--- %s\n' "$red_label"

  red_status=0
  run_suite "$3" "$red_log" || red_status=$?

  if [ "$red_status" -eq 0 ]; then
    fail "settings-invariants.sql fails when $red_label (it passed — that invariant asserts nothing)"
    return 0
  fi
  pass "settings-invariants.sql fails when $red_label"

  if grep -Eq -- "FAILED: $red_marker" "$red_log"; then
    pass 'and names the invariant it violates'
  else
    fail "and names the invariant it violates (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# ---------------------------------------------------------------------------
# Rules the schema states — drop the rule, then write the row it refused.
# ---------------------------------------------------------------------------
expect_red 'policy versions lose their immutability trigger' \
  'org_policy_versions_immutable: an UPDATE' \
  "drop trigger org_policy_versions_immutable on ouroboros.org_policy_versions;"

expect_red 'policy v7 is rewritten without a core rule' \
  'org_policy_versions_envelope: every stored' \
  "alter table ouroboros.org_policy_versions disable trigger org_policy_versions_immutable;
   alter table ouroboros.org_policy_versions drop constraint org_policy_versions_core_rules;
   update ouroboros.org_policy_versions set document = document - 'dry_run_new_repos'
    where organization_id = '$SEED_ORG' and version = 7;
   alter table ouroboros.org_policy_versions enable trigger org_policy_versions_immutable;"

expect_red 'the policy pointer is moved back to v6' \
  'org_policies_current_is_latest: every policy' \
  "drop trigger org_policies_current_is_latest on ouroboros.org_policies;
   update ouroboros.org_policies set current_version = 6 where organization_id = '$SEED_ORG';"

expect_red 'can_approve_loops may be null' \
  'member_capabilities_explicit: can_approve_loops' \
  "alter table ouroboros.member_capabilities alter column can_approve_loops drop not null;"

expect_red 'can_approve_loops defaults to true' \
  'member_capabilities_explicit: can_approve_loops' \
  "alter table ouroboros.member_capabilities alter column can_approve_loops set default true;"

expect_red 'a new service account defaults to api.read' \
  'service_accounts_least_privilege: a new' \
  "alter table ouroboros.service_accounts alter column scopes set default '[\"api.read\"]'::jsonb;"

expect_red 'the audit tier is cut to 30 days' \
  'retention_policies_floor: every stored' \
  "alter table ouroboros.retention_policies drop constraint retention_policies_days_floor;
   update ouroboros.retention_policies set days = 30
    where organization_id = '$SEED_ORG' and data_class = 'audit';"

expect_red 'the SIEM signing key is stored in the clear' \
  'webhook_keys_sealed: every stored' \
  "alter table ouroboros.webhook_endpoints drop constraint webhook_endpoints_hmac_key_envelope;
   update ouroboros.webhook_endpoints set hmac_key_sealed = 'whsec_plaintext-signing-key'
    where id = '$SIEM_ENDPOINT';"

expect_red 'a webhook table grows a plaintext key column' \
  'webhook_keys_sealed: every stored' \
  "alter table ouroboros.webhook_endpoints add column signing_secret text;"

expect_red 'devops-bot'"'"'s key is stored as itself' \
  'service_tokens_hash_only: every stored' \
  "alter table ouroboros.service_tokens drop constraint service_tokens_hash_hex;
   update ouroboros.service_tokens set token_hash = 'orb_svc_plaintext' where id = '$SERVICE_KEY';"

expect_red 'the release bot is sent an audit event' \
  'webhook_deliveries_family_subscribed: every stored' \
  "drop trigger webhook_deliveries_family_subscribed on ouroboros.webhook_deliveries;
   update ouroboros.webhook_deliveries set event_type = 'audit.provider.rotated'
    where endpoint_id = '$RELEASE_ENDPOINT' and status = 'failed';"

# ---------------------------------------------------------------------------
# Rules the rows carry — the schema accepts these writes, which is the point.
# ---------------------------------------------------------------------------
expect_red 'the PagerDuty route reads as delivering' \
  'notification_routes_lock_derived: only email' \
  "create or replace view ouroboros.notification_routes_effective with (security_invoker = true) as
   select r.organization_id, r.kind, r.channel, r.config, r.enabled,
          null::text as locked_reason, false as locked, r.enabled as delivering,
          r.updated_by, r.updated_at
     from ouroboros.notification_routes r;
   update ouroboros.notification_routes set enabled = true
    where organization_id = '$SEED_ORG' and kind = 'loop_failures';"

expect_red 'an audit line names a runner that does not exist' \
  'settings_audit_subjects_resolve: every seeded' \
  "insert into ouroboros.audit_events (id, organization_id, action, subject_type, subject_id)
     values ('5eed0074-0000-4000-8000-000000000099', '$SEED_ORG', 'runner.marked_offline', 'runner',
             '5eed0025-0000-4000-8000-000000000999');"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
