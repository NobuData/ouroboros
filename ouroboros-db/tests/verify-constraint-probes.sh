#!/usr/bin/env sh
#
# verify-constraint-probes.sh — issue #69's second acceptance criterion, as a script, with
# issue #221's *"CI probes verified red when a constraint is dropped"* and issue #193's
# *"dropping any single routing invariant turns it red"* beside it.
#
# tests/constraints.sql asserts what the schema refuses. A green run of it does not prove
# those assertions are load-bearing: a file that asserted nothing at all would be exactly
# as green, and so would one whose probes had quietly drifted off the constraints they
# were written for. The two are indistinguishable from the outside. The only way to tell
# them apart is to drop a rule on purpose and check that the right probe goes red for the
# right reason.
#
# So for each row of the tables below this breaks one rule — of the dashboard read-model, of
# the provider tables mockup 07's cards are drawn from, or of the routing invariants mockup
# 06's resolution is written against — runs the whole of
# constraints.sql against the mutated schema, requires it to **fail**, and
# requires the failure to name the assertion that was supposed to catch it — not merely to
# carry a non-zero status. A probe that goes red for the wrong reason is a probe that is
# not watching what its comment says it is, and a bare exit code cannot tell the
# difference.
#
# The mutations are #69's scope, one per rule it names:
#
#   F.6 scope bullet                             mutation
#   ------------------------------------------   ------------------------------------------
#   status & effort vocabularies reject          drop runs_status
#   an unknown value                             drop queue_items_effort
#   a terminal run carries finished_at           drop runs_terminal_finished_at
#   queue position uniqueness per organization   drop queue_items_organization_position_key
#     (and the natural key beside it)            drop queue_items_organization_issue_key
#   token_usage_daily sums match the fixtures    rewrite the view's tokens_total sum
#     (and the UTC day they are grouped by)      rewrite the view's UTC day expression
#   workspace_settings one row per organization  drop workspace_settings_pkey
#
# The two view rewrites are here because the fourth bullet is the one rule of the five that
# is not a constraint: `token_usage_daily` is arithmetic, so no `drop constraint` can
# falsify it. They take the view's *current* definition from the catalogue and swap one
# expression inside it, so they cannot rot into testing a view this schema no longer has —
# if the expression they aim at is gone, they raise rather than silently mutating nothing.
#
# #221 (AC.6) adds the provider half, one mutation per rule its scope names:
#
#   AC.6 scope bullet                            mutation
#   ------------------------------------------   ------------------------------------------
#   a monthly cap cannot be negative             drop provider_connections_monthly_cap_nonnegative
#   (connection, model_id) is unique, so         drop provider_models_connection_model_key
#     re-running discovery upserts
#   the enable switch and the health status      alter enabled drop not null
#     are two closed vocabularies                drop provider_connections_status
#   added_by names somebody who exists           drop provider_connections_added_by_fk
#
# `enabled` is a boolean, so its "vocabulary" is the pair a `not null` leaves it with: the
# mutation that widens it is dropping that, and the probe is the assertion that a third
# state is refused. `provider_connections_status` is V015's constraint rather than V017's,
# probed here because AC.6 is where the two columns became a pair a card has to tell apart —
# and the assertion that catches it is the one V015's section already carried.
#
# #193 (Y.5) adds the routing half, and it is the half with the sharpest argument for being
# here: Z.1's resolution (#194) does not re-validate any of these — it is written against
# them — so a rule that quietly stopped existing would be caught by nothing until a route
# lost its primary hop in production. One mutation per invariant that ticket's scope names:
#
#   Y.5 scope bullet                             mutation
#   ------------------------------------------   ------------------------------------------
#   hop position uniqueness                      drop route_hops_route_position_key
#   hop position density                         rewrite route_chain_intact()'s density test
#   one route per task kind                      drop routes_task_kind_key
#   FK restrict: an alias a hop names            re-add route_hops_alias_fk as cascade
#   FK restrict: a provider an alias names       re-add model_aliases_provider_fk as cascade
#   rule `then`-shape checks                     drop escalation_rule_then_shape
#   provider kind vocabulary                     drop provider_connections_kind
#   floor-index bound                            rewrite route_chain_intact()'s floor test
#
# The two foreign keys are relaxed rather than dropped, because `restrict` → `cascade` is the
# refactor that really happens and it leaves the constraint's *name* exactly where it was: a
# mutation that dropped them outright would be caught by the cross-workspace probes several
# hundred assertions earlier and would never reach the deletion rule it is aimed at. Both fail
# open when relaxed — the delete succeeds and takes the dependent rows with it — which is
# precisely the class of regression a green suite cannot see.
#
# The two chain rules are rewritten rather than dropped for the same reason `token_usage_daily`
# is: one constraint trigger carries three rules — never empty, dense from 1, floor within the
# chain — so dropping it would falsify all three at once and the first assertion to notice
# would be whichever came first in the file, not the one whose invariant was removed. Each
# rewrite swaps a single test in `route_chain_intact()` for `false` and leaves the rest of the
# function as the migration wrote it, so each probe answers for its own rule. Like the view
# rewrites, they read the current definition from the catalogue and raise if the expression
# they aim at is not in it.
#
# `provider_connections_status` is not repeated here: #221's row above already drops it, and
# the assertion that catches it is the same one Y.5's scope names.
#
# Usage:
#   ouroboros-db/tests/verify-constraint-probes.sh              # against OURO_DB_*'s server
#   ouroboros-db/tests/verify-constraint-probes.sh --runner docker
#   ouroboros-db/tests/verify-constraint-probes.sh --keep       # leave the databases behind
#
# Where it connects is not an argument: run.sh already resolves that from ouroboros-db/.env,
# then ../.env, then its defaults, with the environment winning over all of them, and this
# asks it rather than parsing those files a second time. The password is the one thing it
# does not print — deliberately, so no credential passes through a pipe — so PGPASSWORD
# must be in the environment, exactly as it must be for the psql command
# ouroboros-db/README.md documents.
#
# Exit status:
#   0  every probe went red, naming its own assertion
#   1  at least one probe stayed green, or went red for a reason it did not name — that
#      probe is asserting nothing
#   2  bad usage, no PGPASSWORD, or no way to reach the database

set -eu

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$MODULE_DIR")

# The repo's shared assertion harness, so a failure here reads like a failure anywhere
# else in the repository.
. "$ROOT/scripts/lib/checks.sh"

# The client is pinned to the server's major version rather than taken from whatever the
# machine happens to carry — the same argument, and the same image, as the step in
# .github/workflows/db.yml that runs constraints.sql unmutated.
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17-alpine}

runner=auto
keep=0

die() {
  status=$1
  shift
  printf 'verify-constraint-probes: %s\n' "$*" >&2
  exit "$status"
}

while [ $# -gt 0 ]; do
  case $1 in
    --runner) [ $# -ge 2 ] || die 2 '--runner needs a value: auto, psql or docker'
              runner=$2; shift 2 ;;
    --runner=*) runner=${1#--runner=}; shift ;;
    --keep) keep=1; shift ;;
    # The header is the help text, printed to wherever the comment block ends rather than
    # to a line number a later edit would leave pointing into the code.
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

# The template every probe is run against a copy of, and the copy itself. Named after the
# database run.sh resolved, so two servers being worked on at once cannot collide.
TEMPLATE_DB="${DB_NAME}_probes"
PROBE_DB="${DB_NAME}_probe_run"

if [ "$runner" = auto ]; then
  if command -v psql >/dev/null 2>&1; then
    runner=psql
  elif command -v docker >/dev/null 2>&1; then
    runner=docker
  else
    die 2 'neither psql nor docker is available to talk to the database'
  fi
fi

# constraints.sql is read by the client, so where it is depends on which client: the
# container sees the tests directory mounted, and a psql on this machine sees the checkout.
if [ "$runner" = docker ]; then
  CONSTRAINTS=/tests/constraints.sql
else
  CONSTRAINTS="$TEST_DIR/constraints.sql"
fi

# sql DBNAME — run the SQL on stdin against DBNAME, printing whatever the server says.
#
# ON_ERROR_STOP is what turns the first violated assertion into a non-zero exit, which is
# the whole mechanism this script reads.
sql() {
  case $runner in
    psql)
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 -f -
      ;;
    docker)
      docker run --rm -i --network=host \
        --env PGPASSWORD \
        --volume "$TEST_DIR:/tests:ro" \
        "$POSTGRES_IMAGE" \
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 -f -
      ;;
  esac
}

# maintenance SQL — run one statement against the maintenance database.
#
# `create database` and `drop database` cannot run inside a transaction block and cannot
# run from inside the database they name, which is what this connection is for.
maintenance() { printf '%s\n' "$1" | sql postgres >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# The template, and why the probes do not run against the migrated database itself.
#
# Every mutation below is made inside a transaction that is never committed, so nothing it
# does outlives the session either way — the rollback at the foot of constraints.sql undoes
# an undetected mutation, and an aborted session undoes a detected one. Correctness does
# not need a copy.
#
# Determinism does. constraints.sql carries plan assertions, and a plan is chosen from the
# catalogue's statistics rather than from the schema: V005's pair-lookup assertion picks
# between two indexes that cost the same at fixture size, and its answer changes once
# autovacuum has recorded the fixture tables as empty — which happens on any database the
# suite has already been run against and left dead rows in. Running the suite nine times in
# a row is exactly the way to meet that, and a probe that went red because the planner
# changed its mind would be reported here as a probe doing its job.
#
# So each run gets a copy of a template that was migrated and never read from, where those
# statistics are always the ones a freshly migrated database has. The migration is the
# module's own `scripts/migrate`, so the schema under test is the schema a developer gets.
#
# (The pair-lookup assertion's fragility is real, and it is not this script's to fix — it
# belongs to V005's section and predates the read-model. It is recorded here because it is
# the reason this template exists.)
# ---------------------------------------------------------------------------
cleanup() {
  [ "$keep" -eq 1 ] && return 0
  maintenance "drop database if exists $PROBE_DB with (force)" || true
  maintenance "drop database if exists $TEMPLATE_DB with (force)" || true
}
trap cleanup EXIT HUP INT TERM

printf '\nConstraint probes — #69 acceptance criterion 2, #221 provider rules, #193 routing\n'
printf -- '--- preparing %s on %s:%s\n' "$TEMPLATE_DB" "$DB_HOST" "$DB_PORT"

maintenance "drop database if exists $TEMPLATE_DB with (force)" || true
maintenance "create database $TEMPLATE_DB" ||
  die 2 "could not create $TEMPLATE_DB — does $DB_USER hold CREATEDB?"

(cd -- "$ROOT" && OURO_DB_NAME="$TEMPLATE_DB" "$MODULE_DIR/scripts/migrate" >/dev/null 2>&1) ||
  die 2 "could not migrate $TEMPLATE_DB"

LOG_DIR=$(mktemp -d)

# run_suite MUTATION LOG — copy the template, apply MUTATION, run constraints.sql against
# it, and leave the transcript in LOG. Prints nothing; the caller reads the exit status.
#
# The mutation and the suite are one session and one transaction: `begin` here, the
# mutation, then constraints.sql included into it. Its own `begin` is a no-op that warns,
# and its closing `rollback` — or the abort a failed assertion causes — is what puts the
# dropped rule back. An empty MUTATION is the control.
run_suite() {
  suite_mutation=$1
  suite_log=$2

  maintenance "drop database if exists $PROBE_DB with (force)" || true
  maintenance "create database $PROBE_DB template $TEMPLATE_DB" ||
    die 2 "could not copy $TEMPLATE_DB into $PROBE_DB"

  suite_status=0
  {
    printf 'begin;\n'
    printf '%s\n' "$suite_mutation"
    printf '\\i %s\n' "$CONSTRAINTS"
  } | sql "$PROBE_DB" >"$suite_log" 2>&1 || suite_status=$?

  return "$suite_status"
}

# expect_red LABEL MARKER MUTATION — the assertion this script exists to make.
#
# MARKER is what makes it "for the right reason": it is the text of the assertion that
# must be the one to fail, matched as an extended regular expression against the
# transcript. Without it a suite that fell over on the mutation statement itself — a
# constraint renamed, a typo — would read as a probe doing its job.
expect_red() {
  red_label=$1
  red_marker=$2
  red_mutation=$3
  red_log="$LOG_DIR/$(printf '%s' "$red_label" | tr -c 'a-zA-Z0-9' '-').log"

  printf '\n--- %s\n' "$red_label"

  red_status=0
  run_suite "$red_mutation" "$red_log" || red_status=$?

  if [ "$red_status" -eq 0 ]; then
    fail "constraints.sql fails when $red_label (it passed — that probe asserts nothing)"
    return 0
  fi
  pass "constraints.sql fails when $red_label"

  if grep -Eq -- "$red_marker" "$red_log"; then
    pass "and names the assertion that caught it"
  else
    fail "and names the assertion that caught it (nothing matching \"$red_marker\" in $red_log)"
  fi
}

# rewrite_view EXPRESSION REPLACEMENT — SQL that swaps one expression inside
# token_usage_daily, leaving the rest of the view exactly as the migration wrote it.
#
# The definition is read back from the catalogue rather than restated here, so this cannot
# drift into replacing a view the schema no longer has; if EXPRESSION is not in it, that is
# raised rather than passed over, and the probe below reports a mutation that did nothing.
# EXPRESSION is PostgreSQL's own normalisation of the migration's text — `\sv` prints it.
rewrite_view() {
  cat <<SQL
set local search_path = ouroboros, public;
do \$mutate\$
declare
  def text;
begin
  def := pg_get_viewdef('ouroboros.token_usage_daily'::regclass);
  if position('$1' in def) = 0 then
    raise exception 'token_usage_daily no longer contains [$1]';
  end if;
  execute 'create or replace view ouroboros.token_usage_daily with (security_invoker = true) as '
       || replace(def, '$1', '$2');
end
\$mutate\$;
set local search_path = "\$user", public;
SQL
}

# rewrite_chain_rule TEST REPLACEMENT — SQL that swaps one test inside
# ouroboros.route_chain_intact(), leaving the rest of the function exactly as V016 wrote it.
#
# The sibling of rewrite_view, and here for the same reason it is: that trigger carries three
# separate rules, so no `drop` can falsify one of them on its own. Swapping a single condition
# for `false` leaves the other two enforcing, which is what lets each routing probe below
# answer for its own invariant rather than for whichever assertion the file reaches first.
#
# The definition is read back from the catalogue rather than restated here, so this cannot
# drift into rewriting a function the schema no longer has; if TEST is not in it, that is
# raised rather than passed over. TEST is the migration's own text — `\sf` prints it.
rewrite_chain_rule() {
  cat <<SQL
do \$mutate\$
declare
  def text;
begin
  def := pg_get_functiondef('ouroboros.route_chain_intact()'::regprocedure);
  if position('$1' in def) = 0 then
    raise exception 'route_chain_intact() no longer contains [$1]';
  end if;
  execute replace(def, '$1', 'false');
end
\$mutate\$;
SQL
}

# ---------------------------------------------------------------------------
# The control. Everything below reads a red run as evidence, which is worth nothing unless
# a green one is available in the first place — this is #69's *first* acceptance criterion,
# and it is also what separates "the probe caught the mutation" from "the suite cannot pass
# on this server at all".
# ---------------------------------------------------------------------------
printf -- '\n--- unmutated, the suite must pass\n'
control_status=0
run_suite '' "$LOG_DIR/control.log" || control_status=$?
if [ "$control_status" -eq 0 ]; then
  pass 'constraints.sql passes against the schema as migrated'
else
  fail 'constraints.sql passes against the schema as migrated (it did not)'
  printf '\n%s\n' "$(tail -n 20 "$LOG_DIR/control.log")" >&2
  printf '\nNothing below this can mean anything while the control is red.\n' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# The vocabularies (#69: "runs.status and queue_items.effort CHECK vocabularies reject
# unknown values"). Everything downstream partitions rows by these columns, so a value
# outside them is a row that renders in no card at all.
# ---------------------------------------------------------------------------
expect_red 'runs.status accepts anything' \
  'runs\.status rejects a value outside the six F2 names' \
  'alter table ouroboros.runs drop constraint runs_status;'

expect_red 'queue_items.effort accepts anything' \
  'queue_items\.effort rejects a sixth size' \
  'alter table ouroboros.queue_items drop constraint queue_items_effort;'

# ---------------------------------------------------------------------------
# The lifecycle rule (#69: "terminal run without finished_at is rejected"). The status is
# what puts a run in the recently-closed card and finished_at is when that happened, so
# either half without the other is a contradiction the Cycle column renders.
# ---------------------------------------------------------------------------
expect_red 'a terminal run needs no finish time' \
  'a terminal run must carry finished_at' \
  'alter table ouroboros.runs drop constraint runs_terminal_finished_at;'

# ---------------------------------------------------------------------------
# The queue's order (#69: "queue_items position uniqueness per organization is enforced").
#
# The position key is deferred, and constraints.sql probes it by asking for the check early
# — `set constraints … immediate` — inside the statement it expects to be refused. Dropped,
# that statement cannot name its constraint, so the suite goes red on the missing object
# rather than on the accepted row. Both are the probe noticing and both name the key, which
# is why the marker matches either: the alternation is two real presentations of one
# mutation, not a hedge.
# ---------------------------------------------------------------------------
expect_red 'two queue items may share a position' \
  'two queue items cannot share a position in one workspace|constraint "queue_items_organization_position_key" does not exist' \
  'alter table ouroboros.queue_items drop constraint queue_items_organization_position_key;'

expect_red 'an issue may be queued twice' \
  'the same issue cannot be queued twice in one workspace' \
  'alter table ouroboros.queue_items drop constraint queue_items_organization_issue_key;'

# ---------------------------------------------------------------------------
# The ledger's arithmetic (#69: "token_usage_daily sums match the inserted fixtures").
#
# Not a constraint, so not a drop: the rollup is a view, and the way it goes wrong is a sum
# over the wrong expression or a day resolved in the wrong zone. Both are silent — they
# render as a plausible number on the card rather than as an error — which is precisely why
# the fixtures assert the arithmetic and why those assertions are worth proving live.
# ---------------------------------------------------------------------------
expect_red 'tokens_total counts only the prompt' \
  "the provider's two calls are summed into one row, in every column" \
  "$(rewrite_view 'sum((tokens_in + tokens_out))' 'sum(tokens_in)')"

expect_red 'the day is the session zone, not UTC' \
  'a session fourteen hours ahead of UTC reads the same day out of the rollup' \
  "$(rewrite_view "(occurred_at AT TIME ZONE ''utc''::text)" '(occurred_at)')"

# ---------------------------------------------------------------------------
# The settings row (#69: "workspace_settings enforces one row per organization"). It is
# also what the auto-merge upsert conflicts on, so without it two concurrent PATCHes leave
# the workspace holding two answers.
# ---------------------------------------------------------------------------
expect_red 'a workspace may hold two settings rows' \
  'a second settings row for the same workspace is refused' \
  'alter table ouroboros.workspace_settings drop constraint workspace_settings_pkey;'

# ---------------------------------------------------------------------------
# The provider cards' rules (#221: "cap non-negative, unique models, enabled/status
# vocabularies, added_by FK integrity").
#
# Each of the four is something a card reads directly, and each fails quietly rather than
# loudly if its rule goes: a negative cap draws a meter already past its limit, a duplicated
# discovery doubles every chip, a switch with a third state is a switch the card cannot
# draw, and an attribution to nobody prints a meta row with a blank in it.
# ---------------------------------------------------------------------------
expect_red 'a monthly cap may be negative' \
  'a negative monthly cap is refused' \
  'alter table ouroboros.provider_connections
     drop constraint provider_connections_monthly_cap_nonnegative;'

# Dropping the unique key also drops the index the upsert conflicts on, so the suite may
# report either the accepted duplicate or the `on conflict` that can no longer name a
# constraint. Both are this probe noticing, which is why the marker matches either — the
# same alternation, for the same reason, as the queue's deferred position key above.
expect_red 'a connection may list one model twice' \
  'one connection cannot list the same model twice|no unique or exclusion constraint matching the ON CONFLICT specification' \
  'alter table ouroboros.provider_models
     drop constraint provider_models_connection_model_key;'

expect_red 'the enable switch has a third state' \
  'the enable switch has no third state' \
  'alter table ouroboros.provider_connections alter column enabled drop not null;'

expect_red 'provider_connections.status accepts anything' \
  'a status outside the four is refused' \
  'alter table ouroboros.provider_connections drop constraint provider_connections_status;'

expect_red 'a provider may be added by nobody' \
  'a connection cannot be attributed to a person who does not exist' \
  'alter table ouroboros.provider_connections
     drop constraint provider_connections_added_by_fk;'

# ---------------------------------------------------------------------------
# The routing invariants (#193: hop density and uniqueness, one route per kind, the two FK
# restricts, the rule `then` shapes, the provider vocabularies, the floor-index bound).
#
# Each of these is something `resolve()` assumes rather than checks, and each fails *quietly*
# rather than loudly if its rule goes: a chain numbered 1, 2, 5 makes "fail instead of
# degrading below fallback 2" mean nothing, a second route for a kind makes resolution's
# question have two answers, a relaxed restrict empties chains from a page that never
# mentions them, and a rule whose action nothing validates is one the engine reads and cannot
# act on.
# ---------------------------------------------------------------------------

# Seven of the eight markers below are the whole of the assertion's failure line, constraint
# name included: #193 carries `must_reject`'s expected name into its *accepted* message, so a
# rule that stopped existing now reports both the guarantee and the object it lived in — and
# matching on both is what proves this probe is watching the constraint its label names rather
# than a rule that happens to read the same way.
#
# Dropping the deferred position key means the probe's `set constraints … immediate` can no
# longer name it, so the suite reports the missing object rather than the accepted duplicate.
# Both are the probe noticing — the same alternation, for the same reason, as the queue's
# deferred position key above.
expect_red 'two hops may share a place in one chain' \
  'two hops cannot claim the same place in one chain|constraint "route_hops_route_position_key" does not exist' \
  'alter table ouroboros.route_hops drop constraint route_hops_route_position_key;'

expect_red 'a chain may be numbered 1, 2, 5' \
  'removing a hop from the middle of a chain leaves a gap, and a gap is refused .*route_hops_chain_intact did not fire' \
  "$(rewrite_chain_rule 'lowest <> 1 or highest <> hop_count')"

expect_red 'a floor may point past the end of its chain' \
  'a floor past the end of the chain can never fire, so it is refused rather than stored .*routes_chain_intact did not fire' \
  "$(rewrite_chain_rule 'floor_at is not null and floor_at > hop_count')"

expect_red 'a task kind may have two routes' \
  'a task kind has exactly one route .*routes_task_kind_key did not fire' \
  'alter table ouroboros.routes drop constraint routes_task_kind_key;'

expect_red 'retiring an alias shortens the chains that name it' \
  'an alias that a chain names cannot be retired out from under it .*route_hops_alias_fk did not fire' \
  'alter table ouroboros.route_hops drop constraint route_hops_alias_fk;
   alter table ouroboros.route_hops add constraint route_hops_alias_fk
     foreign key (organization_id, model_alias_id)
     references ouroboros.model_aliases (organization_id, id) on delete cascade;'

expect_red 'deleting a provider deletes the aliases that name it' \
  'a connection with dependent aliases cannot be deleted .*model_aliases_provider_fk did not fire' \
  'alter table ouroboros.model_aliases drop constraint model_aliases_provider_fk;
   alter table ouroboros.model_aliases add constraint model_aliases_provider_fk
     foreign key (organization_id, provider_connection_id)
     references ouroboros.provider_connections (organization_id, id) on delete cascade;'

expect_red 'a rule may name any action at all' \
  'an action key outside the three cannot be stored .*escalation_rule_then_shape did not fire' \
  'alter domain ouroboros.escalation_rule_then drop constraint escalation_rule_then_shape;'

expect_red 'provider_connections.kind accepts anything' \
  'a provider kind outside the six is refused .*provider_connections_kind did not fire' \
  'alter table ouroboros.provider_connections drop constraint provider_connections_kind;'

printf '\n'
if check_summary; then
  rm -rf "$LOG_DIR"
  exit 0
fi

printf '\nThe transcripts are in %s\n' "$LOG_DIR" >&2
exit 1
