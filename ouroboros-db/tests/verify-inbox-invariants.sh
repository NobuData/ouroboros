#!/usr/bin/env sh
#
# verify-inbox-invariants.sh — issue #460's (BM.4) red/green criterion, as a script.
#
# tests/inbox-invariants.sql asserts that the decision rows a database holds satisfy the invariants
# mockup 16's Needs-You inbox trusts, and against R__dev_seed_workspace_triage_inbox.sql it is
# green. A green run proves nothing about whether it *would* go red: a file asserting nothing is
# exactly as green. #460's acceptance criterion is *"ci/db probes fail red when a vocabulary value,
# constraint or the metric oracle is broken"*. So this breaks each rule in the seeded database, or
# plants the drifted row it was there to stop, runs the suite over it, and requires it to **fail
# naming the invariant the plant violates**.
#
#   plant                                              marker (the invariant the failure names)
#   -------------------------------------------------  ------------------------------------------
#   a channel joins the vocabulary with no seeded row  decision_vocabularies_seeded
#   a kind is declared and no card exercises it         decision_vocabularies_seeded
#   the idempotency key is dropped                      decision_items_idempotent
#   an item is answered twice                           decision_resolutions_one_per_item
#   the resolution is keyed by more than its item       decision_resolutions_one_per_item
#   a token may be stored as itself                     action_tokens_hash_only
#   two tokens may share a digest                       action_tokens_hash_only
#   the token table grows a plaintext column            action_tokens_hash_only
#   an allow-once grant may cover boot/**               guardrail_exceptions_scoped
#   the TTL ceiling on a grant is lifted                guardrail_exceptions_scoped
#   an answer time is stored rather than computed       decision_metrics_oracle
#   the median answer drifts by five seconds            decision_metrics_oracle
#   a fourth card opens with no answer this week        decision_metrics_oracle
#   a card's ticket ref dangles                         inbox_refs_resolve
#   PR #504's diff stat moves under the merge card      merge_card_matches_pr
#   loop #1844's stop is cleared by a later pass        allow_once_has_stop
#   the snooze has already run out                      pill_excludes_snoozed
#
# The schema side of those rules is proven load-bearing by tests/verify-constraint-probes.sh;
# this is the *seeded* side, which that script cannot reach — constraints.sql clears every
# workspace before it starts, so a row planted under it is gone before any assertion reads it.
#
# **It needs the seeded database**, and says so rather than going red for the wrong reason: every
# plant names a row R__dev_seed_workspace_triage_inbox.sql writes. In `ci/db` that is the second
# database the job migrates with flyway.seed.toml; locally it is the compose stack's.
#
# It writes nothing that outlives a session. Each plant and the suite run in one transaction that
# is never committed: a detected plant aborts it, and an undetected one reaches the suite's own
# `rollback`. The dropped rules and disabled triggers come back the same way.
#
# Usage:
#   ouroboros-db/tests/verify-inbox-invariants.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-inbox-invariants.sh --runner docker
#   OURO_DB_NAME=ouroboros_seed ouroboros-db/tests/verify-inbox-invariants.sh
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

# The workspace every plant writes into, and the seeded rows the plants rewrite: the allow-once
# card, two of the week's answers (the policy one and the median one), the snoozed card and PR #504.
SEED_ORG=5eed0001-0000-4000-8000-000000000001
ALLOW_ONCE_CARD=5eed0082-0000-4000-8000-000000000002
MEDIAN_ANSWER=5eed0082-0000-4000-8000-000000000102
FIRST_ANSWER=5eed0082-0000-4000-8000-000000000101
SNOOZED_CARD=5eed0082-0000-4000-8000-000000000201
PR_504=5eed007c-0000-4000-8000-000000000504

die() {
  status=$1
  shift
  printf 'verify-inbox-invariants: %s\n' "$*" >&2
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
  SUITE=/tests/inbox-invariants.sql
else
  SUITE="$TEST_DIR/inbox-invariants.sql"
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

printf '\nInbox invariants — #460 red on planted data, against %s on %s:%s\n' \
  "$DB_NAME" "$DB_HOST" "$DB_PORT"

# ---------------------------------------------------------------------------
# The seed has to be there, or every plant fails on its own statement.
# ---------------------------------------------------------------------------
# Labelled rather than parsed out of psql's table layout, so the answer is one grep whatever the
# client's formatting defaults are. Sixteen is the inbox seed's decision items.
seeded=$(printf "select 'seeded-items=' || count(*) from ouroboros.decision_items where organization_id = '%s' and id::text like '5eed0082-%%';\n" \
           "$SEED_ORG" | sql 2>&1) ||
  die 2 "could not query $DB_NAME: $seeded"
printf '%s\n' "$seeded" | grep -q 'seeded-items=16$' ||
  die 2 "$DB_NAME does not hold the inbox seed (#460) — migrate it with flyway.seed.toml"

LOG_DIR=$(mktemp -d)

# run_suite PLANT LOG — plant, then run inbox-invariants.sql, in one session and one
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
# caught, so it has to be green first — which is also #460's *"green"* half.
printf '\n--- nothing planted\n'
control_log="$LOG_DIR/control.log"
if run_suite '' "$control_log"; then
  pass 'inbox-invariants.sql is green against the seeded database'
else
  fail "inbox-invariants.sql is green against the seeded database (see $control_log)"
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
    fail "inbox-invariants.sql fails when $red_label (it passed — that invariant asserts nothing)"
    return 0
  fi
  pass "inbox-invariants.sql fails when $red_label"

  if grep -Eq -- "FAILED: $red_marker" "$red_log"; then
    pass 'and names the invariant it violates'
  else
    fail "and names the invariant it violates (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# ---------------------------------------------------------------------------
# Rules the schema states — drop or widen the rule, then write the row it refused.
# ---------------------------------------------------------------------------
expect_red 'a channel joins the vocabulary with no seeded row' \
  'decision_vocabularies_seeded: every status' \
  "alter table ouroboros.decision_resolutions drop constraint decision_resolutions_channel;
   alter table ouroboros.decision_resolutions add constraint decision_resolutions_channel
     check (channel in ('web', 'email', 'github', 'slack', 'push', 'api', 'sms'));"

expect_red 'a kind is declared and no card exercises it' \
  'decision_vocabularies_seeded: every declared' \
  "insert into ouroboros.decision_kinds
     (kind_id, version, severity_default, question_template, why_template, payload_schema, actions,
      resolution_semantics, ref_shape, escalation_window, merge_class)
   select 'custom:v460-unseeded', 1, severity_default, question_template, why_template,
          payload_schema, actions, resolution_semantics, ref_shape, escalation_window, merge_class
     from ouroboros.decision_kinds where kind_id = 'fact_review' and version = 1;"

expect_red 'the idempotency key is dropped' \
  'decision_items_idempotent: a second' \
  "alter table ouroboros.decision_items drop constraint decision_items_idempotency_key;"

expect_red 'an item is answered twice' \
  'decision_resolutions_one_per_item: every resolved' \
  "alter table ouroboros.decision_resolutions drop constraint decision_resolutions_pkey;
   alter table ouroboros.decision_resolutions disable trigger decision_resolutions_item_open;
   insert into ouroboros.decision_resolutions
   select * from ouroboros.decision_resolutions where item_id = '$MEDIAN_ANSWER';"

expect_red 'the resolution is keyed by more than its item' \
  'decision_resolutions_one_per_item: the resolution' \
  "alter table ouroboros.decision_resolutions drop constraint decision_resolutions_pkey;
   alter table ouroboros.decision_resolutions add primary key (item_id, resolved_at);"

expect_red 'a token may be stored as itself' \
  'action_tokens_hash_only: a token written' \
  "alter table ouroboros.action_tokens drop constraint action_tokens_hash_hex;"

expect_red 'two tokens may share a digest' \
  'action_tokens_hash_only: two tokens' \
  "alter table ouroboros.action_tokens drop constraint action_tokens_hash_unique;"

expect_red 'the token table grows a plaintext column' \
  'action_tokens_hash_only: a token is stored' \
  "alter table ouroboros.action_tokens add column raw_token text;"

expect_red 'an allow-once grant may cover boot/**' \
  'guardrail_exceptions_scoped: Allow once' \
  "alter table ouroboros.guardrail_exceptions drop constraint guardrail_exceptions_path_glob_narrow;"

expect_red 'the TTL ceiling on a grant is lifted' \
  'guardrail_exceptions_scoped: a grant outliving' \
  "alter table ouroboros.guardrail_exceptions disable trigger guardrail_exceptions_granted;"

# ---------------------------------------------------------------------------
# Rows that drift — the schema would refuse most of these, so its guard is switched off for the
# one write, which is the point: these probes read the rows, not the rules.
# ---------------------------------------------------------------------------
expect_red 'an answer time is stored rather than computed' \
  'decision_metrics_oracle: decision_metrics_weekly equals' \
  "alter table ouroboros.decision_resolutions disable trigger decision_resolutions_immutable;
   update ouroboros.decision_resolutions set answer_latency = answer_latency + interval '30 seconds'
    where item_id = '$FIRST_ANSWER';"

expect_red 'the median answer drifts by five seconds' \
  'decision_metrics_oracle: the seeded week' \
  "alter table ouroboros.decision_resolutions disable trigger decision_resolutions_immutable;
   update ouroboros.decision_resolutions
      set resolved_at = resolved_at + interval '5 seconds',
          answer_latency = answer_latency + interval '5 seconds'
    where item_id = '$MEDIAN_ANSWER';"

expect_red 'a fourth card opens with no answer this week' \
  'decision_metrics_oracle: the head' \
  "select ouroboros.decision_item_emit(
            '$SEED_ORG', 'fact_review',
            '{\"reason\": \"awaiting review\", \"text\": \"PID gains live in config/control.yaml\",
              \"provenance_line\": \"observed in loop #1847\"}', '[]', 'facts', 'v460-plant:fourth');"

expect_red 'a card'"'"'s ticket ref dangles' \
  'inbox_refs_resolve: every ref' \
  "alter table ouroboros.decision_items disable trigger decision_items_refs_resolve;
   update ouroboros.decision_items
      set refs = jsonb_build_array(jsonb_build_object('type', 'ticket',
                   'id', '5eed0079-0000-4000-8000-000000000999', 'label', 'issue #999'))
    where id = '$MEDIAN_ANSWER';"

expect_red 'PR #504'"'"'s diff stat moves under the merge card' \
  'merge_card_matches_pr: the merge card' \
  "update ouroboros.pull_requests set additions = additions + 1 where id = '$PR_504';"

expect_red 'loop #1844'"'"'s stop is cleared by a later pass' \
  'allow_once_has_stop: the open' \
  "insert into ouroboros.guardrail_evaluations (run_id, \"check\", verdict, change_set_seq, evaluated_at)
   select (refs -> 0 ->> 'id')::uuid, 'allowed_paths', 'pass', 2, now()
     from ouroboros.decision_items where id = '$ALLOW_ONCE_CARD';"

expect_red 'the snooze has already run out' \
  'pill_excludes_snoozed: the pill' \
  "update ouroboros.decision_items set snoozed_until = now() - interval '1 minute'
    where id = '$SNOOZED_CARD';"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
