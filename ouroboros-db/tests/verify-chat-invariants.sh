#!/usr/bin/env sh
#
# verify-chat-invariants.sh — issue #534's (BY.4) red/green criterion, as a script.
#
# tests/chat-invariants.sql asserts that the chat rows a database holds satisfy the invariants
# mockup 19's seeded page trusts, and against R__dev_seed_workspace_triage_slack.sql it is green.
# A green run proves nothing about whether it *would* go red, and #534 asks for every probe
# **verified red-then-green**. So this breaks each rule in the seeded database, or plants the row
# it was there to stop, runs the suite over it, and requires it to **fail naming the invariant**.
#
#   plant                                              marker (the invariant the failure names)
#   -------------------------------------------------  ------------------------------------------
#   the platform vocabulary grows a value              platform_status_vocabularies
#   the status vocabulary grows a value                platform_status_vocabularies
#   the message-kind vocabulary grows a value          message_command_vocabularies
#   the command-outcome vocabulary grows a value       message_command_vocabularies
#   the one-active-connection index is dropped         single_active_connection
#   a second active Slack connection is stored         single_active_connection
#   the dedupe key is dropped                          dedupe_digest_unique
#   a card is published twice in one hour              dedupe_digest_unique
#   a platform user is linked to two members           link_unique_platform_user
#   a member is given two platform identities          link_unique_member
#   the on-call rule is switched off                   on_call_linked
#   someone with a revoked link is put on call         on_call_linked
#   a card names a run that does not exist             refs_resolve
#   the header's member count drifts                   header_from_connection
#   a bot token is stored in the clear                 token_sealed
#   the resolved card loses its edit                   resolved_card_fixture
#   the revoked link is erased                         links_seeded
#   a seeded command forgets who it acted as           command_invoker_recorded
#   the stage-transition route is switched on          stage_transitions_off
#
# **It needs the seeded database**, and says so rather than going red for the wrong reason. In
# `ci/db` that is the second database the job migrates with flyway.seed.toml.
#
#   PGPASSWORD=ouroboros ouroboros-db/tests/verify-chat-invariants.sh [--runner auto|psql|docker]
#
# Every plant runs inside a transaction that is rolled back.
#
# Exit status: 0 green and every plant red / 1 an assertion failed / 2 could not run.

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

# The seeded rows the plants rewrite or stand beside.
CONNECTION=5eed009c-0000-4000-8000-000000000001
LOOPS_CHANNEL=5eed009c-0000-4000-8000-0000000000a1
KEN_LINK=5eed009c-0000-4000-8000-000000000301
REVOKED_LINK=5eed009c-0000-4000-8000-000000000303
COMPLETION_CARD=5eed009c-0000-4000-8000-000000000101
RESOLVED_CARD=5eed009c-0000-4000-8000-000000000103
STATUS_COMMAND=5eed009c-0000-4000-8000-000000000201
SEALED=ouro.v1.1.ZGV2LXNlZWQtbm9uY2U.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1ib3QtdG9rZW4

die() {
  status=$1
  shift
  printf 'verify-chat-invariants: %s\n' "$*" >&2
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
  SUITE=/tests/chat-invariants.sql
else
  SUITE="$TEST_DIR/chat-invariants.sql"
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

printf '\nChat invariants — #534 red on planted data, against %s on %s:%s\n' \
  "$DB_NAME" "$DB_HOST" "$DB_PORT"

# ---------------------------------------------------------------------------
# The seed has to be there, or every plant fails on its own statement.
# ---------------------------------------------------------------------------
# Labelled rather than parsed out of psql's table layout, so the answer is one grep whatever the
# client's formatting defaults are. Seven is the chat seed's messages.
seeded=$(printf "select 'seeded-messages=' || count(*) from ouroboros.chat_messages where id::text like '5eed009c-%%';\n" | sql 2>&1) ||
  die 2 "could not query $DB_NAME: $seeded"
printf '%s\n' "$seeded" | grep -q 'seeded-messages=7$' ||
  die 2 "$DB_NAME does not hold the chat seed (#534) — migrate it with flyway.seed.toml"

LOG_DIR=$(mktemp -d)

# run_suite PLANT LOG — plant, then run chat-invariants.sql, in one session and one
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
# caught, so it has to be green first — which is also the criterion's *green* half.
printf '\n--- nothing planted\n'
control_log="$LOG_DIR/control.log"
if run_suite '' "$control_log"; then
  pass 'chat-invariants.sql is green against the seeded database'
else
  fail "chat-invariants.sql is green against the seeded database (see $control_log)"
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
    fail "chat-invariants.sql fails when $red_label (it passed — that invariant asserts nothing)"
    return 0
  fi
  pass "chat-invariants.sql fails when $red_label"

  if grep -Eq -- "FAILED: $red_marker" "$red_log"; then
    pass 'and names the invariant it violates'
  else
    fail "and names the invariant it violates (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# ---------------------------------------------------------------------------
# Rules the schema states — drop or widen the rule, then write the row it refused.
# ---------------------------------------------------------------------------
#
# Where a plant drops an index and stores the row it refused, an index of the same name is put
# back on other columns: the catalogue half of the probe then passes, and it is the *row* half
# that has to catch the plant. `set constraints all immediate` first, because PostgreSQL will not
# alter a table that still has deferred foreign-key checks queued from the insert.
expect_red 'the platform vocabulary grows a value' \
  'platform_status_vocabularies: a connection' \
  "alter table ouroboros.chat_connections drop constraint chat_connections_platform_known;
   alter table ouroboros.chat_connections add constraint chat_connections_platform_known
     check (platform in ('slack', 'teams', 'discord'));"

expect_red 'the status vocabulary grows a value' \
  'platform_status_vocabularies: a connection' \
  "alter table ouroboros.chat_connections drop constraint chat_connections_status_known;
   alter table ouroboros.chat_connections add constraint chat_connections_status_known
     check (status in ('active', 'revoked', 'error', 'paused'));"

expect_red 'the message-kind vocabulary grows a value' \
  'message_command_vocabularies: a message' \
  "alter table ouroboros.chat_messages drop constraint chat_messages_kind_known;
   alter table ouroboros.chat_messages add constraint chat_messages_kind_known
     check (kind in ('decision_card', 'event_card', 'command_reply', 'system_line', 'reaction'));"

expect_red 'the command-outcome vocabulary grows a value' \
  'message_command_vocabularies: a message' \
  "alter table ouroboros.chat_commands drop constraint chat_commands_outcome_known;
   alter table ouroboros.chat_commands add constraint chat_commands_outcome_known
     check (outcome in ('ok', 'error', 'denied', 'unlinked', 'async_pending', 'timeout'));"

expect_red 'the one-active-connection index is dropped' \
  'single_active_connection: a workspace' \
  "drop index ouroboros.chat_connections_one_active_slack;"

expect_red 'a second active Slack connection is stored' \
  'single_active_connection: a workspace' \
  "drop index ouroboros.chat_connections_one_active_slack;
   insert into ouroboros.chat_connections (organization_id, platform, workspace_id, workspace_name, bot_token_sealed)
   select organization_id, 'slack', 'T0PLANTED', 'planted', '$SEALED'
     from ouroboros.chat_connections where id = '$CONNECTION';
   create unique index chat_connections_one_active_slack on ouroboros.chat_connections (workspace_id)
    where platform = 'slack' and status = 'active';"

expect_red 'the dedupe key is dropped' \
  'dedupe_digest_unique: no two' \
  "drop index ouroboros.chat_messages_dedupe_key;"

expect_red 'a card is published twice in one hour' \
  'dedupe_digest_unique: no two' \
  "drop index ouroboros.chat_messages_dedupe_key;
   insert into ouroboros.chat_messages (organization_id, channel_id, kind, card_kind, refs, payload_digest, posted_at)
   select organization_id, channel_id, kind, card_kind, refs, payload_digest, posted_at + interval '1 minute'
     from ouroboros.chat_messages where id = '$COMPLETION_CARD';
   create unique index chat_messages_dedupe_key on ouroboros.chat_messages (id, payload_digest, dedupe_bucket);"

expect_red 'a platform user is linked to two members' \
  'link_unique_platform_user: a platform user' \
  "drop index ouroboros.chat_identity_links_platform_user_key;
   insert into ouroboros.chat_identity_links (organization_id, connection_id, platform_user_id, member_id, state, verified_via, linked_at)
   select link.organization_id, link.connection_id, link.platform_user_id, other.member_id, 'linked', 'admin_assigned', now()
     from ouroboros.chat_identity_links link
     join ouroboros.chat_identity_links other on other.id = '$REVOKED_LINK'
    where link.id = '$KEN_LINK';
   set constraints all immediate;
   create unique index chat_identity_links_platform_user_key on ouroboros.chat_identity_links (id)
    where state <> 'revoked';"

expect_red 'a member is given two platform identities' \
  'link_unique_member: a member' \
  "drop index ouroboros.chat_identity_links_member_key;
   insert into ouroboros.chat_identity_links (organization_id, connection_id, platform_user_id, member_id, state, verified_via, linked_at)
   select organization_id, connection_id, 'U07KENAGAIN', member_id, 'linked', 'admin_assigned', now()
     from ouroboros.chat_identity_links where id = '$KEN_LINK';
   set constraints all immediate;
   create unique index chat_identity_links_member_key on ouroboros.chat_identity_links (id)
    where state <> 'revoked' and member_id is not null;"

expect_red 'the on-call rule is switched off' \
  'on_call_linked: every active' \
  "alter table ouroboros.on_call_assignments disable trigger on_call_assignments_designee_linked;"

expect_red 'someone with a revoked link is put on call' \
  'on_call_linked: every active' \
  "alter table ouroboros.on_call_assignments disable trigger on_call_assignments_designee_linked;
   insert into ouroboros.on_call_assignments (organization_id, member_id, scope)
   select organization_id, member_id, 'rotation:planted'
     from ouroboros.chat_identity_links where id = '$REVOKED_LINK';
   set constraints all immediate;
   alter table ouroboros.on_call_assignments enable trigger on_call_assignments_designee_linked;"

expect_red 'a card names a run that does not exist' \
  'refs_resolve: every ref' \
  "alter table ouroboros.chat_messages disable trigger chat_messages_refs_resolve;
   update ouroboros.chat_messages
      set refs = '[{\"type\": \"run\", \"id\": \"00000000-0000-4000-8000-000000000000\", \"label\": \"loop #0\"}]'
    where id = '$COMPLETION_CARD';
   alter table ouroboros.chat_messages enable trigger chat_messages_refs_resolve;"

# ---------------------------------------------------------------------------
# What the page is drawn from — change the seeded row and the fixture is gone.
# ---------------------------------------------------------------------------
expect_red 'the header'"'"'s member count drifts' \
  'header_from_connection: #ouroboros-loops' \
  "update ouroboros.chat_channels set member_count = 25 where id = '$LOOPS_CHANNEL';"

expect_red 'a bot token is stored in the clear' \
  'token_sealed: every stored' \
  "alter table ouroboros.chat_connections drop constraint chat_connections_bot_token_sealed;
   update ouroboros.chat_connections set bot_token_sealed = 'planted-plaintext-token' where id = '$CONNECTION';
   alter table ouroboros.chat_connections add constraint chat_connections_bot_token_sealed
     check (bot_token_sealed is not null) not valid;"

expect_red 'the resolved card loses its edit' \
  'resolved_card_fixture: the question card' \
  "update ouroboros.chat_messages set edited_at = null where id = '$RESOLVED_CARD';"

expect_red 'the revoked link is erased' \
  'links_seeded: Ken and Maya' \
  "delete from ouroboros.chat_identity_links where id = '$REVOKED_LINK';"

expect_red 'a seeded command forgets who it acted as' \
  'command_invoker_recorded: every Slack command' \
  "update ouroboros.chat_commands set invoker_user_id = null where id = '$STATUS_COMMAND';"

expect_red 'the stage-transition route is switched on' \
  'stage_transitions_off: the every-stage-transition' \
  "update ouroboros.notification_routes set enabled = true where kind = 'custom:stage-transitions';"

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
