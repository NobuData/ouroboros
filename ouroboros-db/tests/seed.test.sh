#!/usr/bin/env sh
#
# seed.test.sh — tests for the development seeds: migrations/R__dev_seed.sql,
# migrations/R__dev_seed_audit.sql, migrations/R__dev_seed_dashboard.sql,
# migrations/R__dev_seed_intake.sql, migrations/R__dev_seed_providers.sql,
# migrations/R__dev_seed_routing.sql, migrations/R__dev_seed_sources.sql,
# migrations/R__dev_seed_ticket_planning.sql, migrations/R__dev_seed_workflows.sql, and the
# configuration that decides whether they do anything.
#
# The seeds are the migrations in this module that must behave differently in two places,
# so the properties worth testing are the ones that keep those two apart: that a
# production run resolves the guard to `false`, that only the development stack and a
# deliberate `--config` resolve it to `true`, and that every statement in either file is
# behind that guard and can be applied twice.
#
# There are nine files because they answer different questions — R__dev_seed.sql (#23) is
# *who exists*, R__dev_seed_dashboard.sql (#68) is *what the loop has done*,
# R__dev_seed_intake.sql (#103) is *what it has an opinion about next*,
# R__dev_seed_providers.sql (#221) is *what it is allowed to call*,
# R__dev_seed_routing.sql (#192) is *how it decides which one to call*,
# R__dev_seed_audit.sql (#225) is *who touched the keys*, R__dev_seed_sources.sql (#138) is
# *where the work comes from*, R__dev_seed_ticket_planning.sql (#275) is *the work and the
# plan over it*, and R__dev_seed_workflows.sql (#136) is *what it does with it* — and the
# structural rules below are asserted over all of them, in a loop, so that a tenth seed
# inherits them by being added to the one list at the top.
#
# All of it is a file read plus the stubbed runners tests/lib/fixture.sh provides, so
# this needs no database, no Docker and no network — the same contract as
# scripts.test.sh. What a real PostgreSQL then holds is tests/seed.sql, which is where
# the seed's *content* is asserted; nothing here can see a row.
#
# Usage:
#   ouroboros-db/tests/seed.test.sh         # this file alone
#   scripts/run-tests.sh ouroboros-db/tests # the module's suite
#   scripts/run-tests.sh                    # every suite in the repository
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
SCRIPTS_DIR="$REPO_ROOT/scripts"

. "$SCRIPTS_DIR/lib/checks.sh"
. "$TEST_DIR/lib/fixture.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

STUB_LOG="$work/stub.log"
export STUB_LOG

fixture_stubs "$work"

base="$work/base"
fixture_module "$base"
BIN="$base/ouroboros-db/scripts"

SEED="$MODULE_DIR/migrations/R__dev_seed.sql"
DASHBOARD_SEED="$MODULE_DIR/migrations/R__dev_seed_dashboard.sql"
INTAKE_SEED="$MODULE_DIR/migrations/R__dev_seed_intake.sql"
PROVIDERS_SEED="$MODULE_DIR/migrations/R__dev_seed_providers.sql"
ROUTING_SEED="$MODULE_DIR/migrations/R__dev_seed_routing.sql"
AUDIT_SEED="$MODULE_DIR/migrations/R__dev_seed_audit.sql"
SOURCES_SEED="$MODULE_DIR/migrations/R__dev_seed_sources.sql"
PLANNING_SEED="$MODULE_DIR/migrations/R__dev_seed_ticket_planning.sql"
WORKFLOWS_SEED="$MODULE_DIR/migrations/R__dev_seed_workflows.sql"
CONFIG="$MODULE_DIR/flyway.toml"
SEED_CONFIG="$MODULE_DIR/flyway.seed.toml"
DEV_CONFIG="$MODULE_DIR/flyway.dev.toml"
COMPOSE="$REPO_ROOT/docker-compose.yml"
PROJECT=/flyway/project

# run_script NAME [ARG...] — run one wrapper from the fixture with both runners
# available, leaving its combined output in $out and its exit status in $status.
run_script() {
  script_name=$1
  shift
  : > "$STUB_LOG"
  out=$(PATH="$work/both" "$BIN/$script_name" "$@" </dev/null 2>&1)
  status=$?
}

# A seed with its commentary removed. Every assertion about what a migration *does* reads
# this rather than the file: the headers explain the guard, name the ids and state that no
# credential is seeded, so a grep for any of those over the whole file would be answered by
# the prose that promises them.
#
#   seed_body FILE OUT — write FILE's statements, without comment lines, to OUT.
seed_body() {
  grep -Ev '^[[:space:]]*--' "$1" > "$2" 2>/dev/null || :
}

BODY="$work/seed-body.sql"
DASHBOARD_BODY="$work/seed-body-dashboard.sql"
INTAKE_BODY="$work/seed-body-intake.sql"
PROVIDERS_BODY="$work/seed-body-providers.sql"
ROUTING_BODY="$work/seed-body-routing.sql"
AUDIT_BODY="$work/seed-body-audit.sql"
SOURCES_BODY="$work/seed-body-sources.sql"
PLANNING_BODY="$work/seed-body-ticket-planning.sql"
WORKFLOWS_BODY="$work/seed-body-workflows.sql"
seed_body "$SEED" "$BODY"
seed_body "$DASHBOARD_SEED" "$DASHBOARD_BODY"
seed_body "$INTAKE_SEED" "$INTAKE_BODY"
seed_body "$PROVIDERS_SEED" "$PROVIDERS_BODY"
seed_body "$ROUTING_SEED" "$ROUTING_BODY"
seed_body "$AUDIT_SEED" "$AUDIT_BODY"
seed_body "$SOURCES_SEED" "$SOURCES_BODY"
seed_body "$PLANNING_SEED" "$PLANNING_BODY"
seed_body "$WORKFLOWS_SEED" "$WORKFLOWS_BODY"

# count_lines PATTERN [FILE] — how many lines of a seed's SQL match an extended regex.
# Defaults to R__dev_seed.sql, which is what the assertions written before there was a
# second seed all mean.
count_lines() {
  grep -Ec -- "$1" "${2:-$BODY}" 2>/dev/null || true
}

printf '\nouroboros-db — the development seeds\n\n'

# ---------------------------------------------------------------------------
# The migrations
# ---------------------------------------------------------------------------

printf 'The migrations\n'

check_exists "$SEED" 'migrations/R__dev_seed.sql exists'
check_exists "$DASHBOARD_SEED" 'migrations/R__dev_seed_dashboard.sql exists'
check_exists "$INTAKE_SEED" 'migrations/R__dev_seed_intake.sql exists'
check_exists "$PROVIDERS_SEED" 'migrations/R__dev_seed_providers.sql exists'
check_exists "$ROUTING_SEED" 'migrations/R__dev_seed_routing.sql exists'
check_exists "$AUDIT_SEED" 'migrations/R__dev_seed_audit.sql exists'
check_exists "$SOURCES_SEED" 'migrations/R__dev_seed_sources.sql exists'
check_exists "$PLANNING_SEED" 'migrations/R__dev_seed_ticket_planning.sql exists'
check_exists "$WORKFLOWS_SEED" 'migrations/R__dev_seed_workflows.sql exists'

# Repeatable, not versioned. A seed that grows with the product would otherwise become a
# chain of V### files that can never be re-run — README.md § Migration rules, rule 3.
for seed_file in "$SEED" "$AUDIT_SEED" "$DASHBOARD_SEED" "$INTAKE_SEED" \
                 "$PROVIDERS_SEED" "$ROUTING_SEED" "$SOURCES_SEED" "$PLANNING_SEED" \
                 "$WORKFLOWS_SEED"; do
  check_matches "$(basename -- "$seed_file")" '^R__[a-z0-9_]+\.sql$' \
    "$(basename -- "$seed_file") is a repeatable migration, so it re-applies when it changes"
done

# **The order the two are applied in, which is a correctness property and not a style.**
#
# Flyway applies repeatable migrations after every versioned one, in the order of their
# *descriptions*. Every row the dashboard seed writes finds its parent by natural key — the
# organization by slug, a repository by name — so it has to run after the seed that creates
# them. `dev_seed` sorts before `dev_seed_dashboard`; `dashboard_dev_seed`, which is the
# name #68's diagram suggests, would sort before `dev_seed` instead, and on a database
# migrated from empty every join would find nothing, every insert would insert nothing, and
# a second `migrate` would not put it right — Flyway re-applies a repeatable migration only
# when its checksum changes. So the ordering is asserted here, where a rename fails the
# pull request rather than the dashboard.
base_description=$(basename -- "$SEED" .sql)
base_description=${base_description#R__}
dashboard_description=$(basename -- "$DASHBOARD_SEED" .sql)
dashboard_description=${dashboard_description#R__}
intake_description=$(basename -- "$INTAKE_SEED" .sql)
intake_description=${intake_description#R__}
providers_description=$(basename -- "$PROVIDERS_SEED" .sql)
providers_description=${providers_description#R__}
routing_description=$(basename -- "$ROUTING_SEED" .sql)
routing_description=${routing_description#R__}
audit_description=$(basename -- "$AUDIT_SEED" .sql)
audit_description=${audit_description#R__}
sources_description=$(basename -- "$SOURCES_SEED" .sql)
sources_description=${sources_description#R__}
planning_description=$(basename -- "$PLANNING_SEED" .sql)
planning_description=${planning_description#R__}
workflows_description=$(basename -- "$WORKFLOWS_SEED" .sql)
workflows_description=${workflows_description#R__}

# The providers seed hangs off the first one too — it finds the workspace by slug and Ken
# by email — and the routing seed hangs off the providers one, since every alias binds to a
# connection by kind and name. The intake seed hangs off the first as well, for its
# repository, and its own second statement hangs off its first — the estimates find their
# issue by number in the repository the same file mirrored a moment earlier. So the whole
# order is asserted rather than the first pair of it, and a rename that reshuffled any of
# the six fails here.
#
# The audit seed sorts second, before the providers one it writes events *about*, and that
# is the one place in this list where the order does not matter: `audit_events.subject_id`
# is deliberately non-referential, so that seed names its connections by literal uuid and
# has nothing to join to. It is still asserted, because a seed added later between them
# would inherit the position without inheriting the argument.
#
# The sources seed (#138) sorts after those, and only needs to: it hangs off the first seed
# for its workspace and off nothing else, because V030's two tables are the first of their
# domain. The planning seed (#275) **must** sort after it, and is named `ticket_planning`
# rather than `planning` for exactly that: every ticket and the batch hang off the GitHub
# source, and `dev_seed_planning` would sort before `dev_seed_sources` and join to nothing on a
# database migrated from empty. The workflows seed (#136) sorts last and hangs off the first seed twice — the
# workspace by slug and the publishers by email — and off nothing else; its own three
# statements depend on *each other* in file order, which is the ordering a single file gets
# for free and its header explains.
check_equals "$(printf '%s %s %s %s %s %s %s %s %s' "$base_description" "$audit_description" "$dashboard_description" "$intake_description" "$providers_description" "$routing_description" "$sources_description" "$planning_description" "$workflows_description")" \
  "$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$base_description" "$audit_description" "$dashboard_description" "$intake_description" "$providers_description" "$routing_description" "$sources_description" "$planning_description" "$workflows_description" |
     LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" \
  'the nine seeds sort in the order their rows depend on, so Flyway applies them in it'

# Every statement is guarded, and every statement can be applied twice. Counted rather
# than spot-checked: the failure this catches is a *new* statement added later without
# one of the two, which no fixed set of patterns would see.
#
# `on conflict` takes an optional arbiter because one statement needs it: `queue_items`
# carries a deferrable unique key, and PostgreSQL refuses a targetless `on conflict` on
# such a table outright. Naming the primary key is what that statement does instead, and it
# is still the "applied twice writes nothing" rule this check exists for.
#
# **An `update` counts as a statement and not as an insert**, which is the shape
# R__dev_seed_workflows.sql needs (#136): `workflows.current_version` points into
# `workflow_versions`, so the pointer cannot be written until the version it names exists and
# a third statement moves it. There is no `on conflict` on an update, so what is counted is
# the guard — every statement has one — while the conflict clause is counted against the
# inserts alone. What makes such an update idempotent is asserted where it lives, in that
# seed's own section below.
for seed_file in "$SEED" "$AUDIT_SEED" "$DASHBOARD_SEED" "$INTAKE_SEED" \
                 "$PROVIDERS_SEED" "$ROUTING_SEED" "$SOURCES_SEED" "$PLANNING_SEED" \
                 "$WORKFLOWS_SEED"; do
  name=$(basename -- "$seed_file")
  body=$BODY
  [ "$seed_file" = "$AUDIT_SEED" ] && body=$AUDIT_BODY
  [ "$seed_file" = "$DASHBOARD_SEED" ] && body=$DASHBOARD_BODY
  [ "$seed_file" = "$INTAKE_SEED" ] && body=$INTAKE_BODY
  [ "$seed_file" = "$PROVIDERS_SEED" ] && body=$PROVIDERS_BODY
  [ "$seed_file" = "$ROUTING_SEED" ] && body=$ROUTING_BODY
  [ "$seed_file" = "$SOURCES_SEED" ] && body=$SOURCES_BODY
  [ "$seed_file" = "$PLANNING_SEED" ] && body=$PLANNING_BODY
  [ "$seed_file" = "$WORKFLOWS_SEED" ] && body=$WORKFLOWS_BODY

  inserts=$(count_lines '^insert into ouroboros\.' "$body")
  updates=$(count_lines '^update ouroboros\.' "$body")
  statements=$((inserts + updates))
  guards=$(count_lines '^ *(where|and) \$\{ouro_dev_seed\};?$' "$body")
  conflicts=$(count_lines '^on conflict( \([a-z_]+\))? do nothing;$' "$body")

  check_matches "$inserts" '^[1-9][0-9]*$' "$name inserts something"
  check_equals "$statements" "$guards" "every statement in $name is behind the \${ouro_dev_seed} guard"
  check_equals "$inserts" "$conflicts" "every insert in $name ends \`on conflict do nothing\`"

  # Deterministic ids are what let a test, a URL or a fixture name a seeded row. A
  # generated one would differ per machine and per reset.
  check_absent "$body" 'gen_random_uuid' "$name generates no ids"

  # The seed writes to the product's tables and to nothing else — not to Flyway's own
  # history, not to a table another module owns.
  check_equals "$inserts" "$(count_lines '^insert into ' "$body")" \
    "$name writes only into the ouroboros schema"
  check_equals "$updates" "$(count_lines '^update ' "$body")" \
    "$name updates nothing outside it either"
  check_absent "$body" 'flyway_schema_history' \
    "$name does not touch Flyway's history table"

  # A seed is where a credential is most tempting to put and least likely to be noticed.
  for secret in secret api_key; do
    check_absent "$body" "$secret" "$name writes no $secret"
  done
done

printf '\nR__dev_seed.sql — the workspaces\n'

check_contains "$BODY" '5eed0001-0000-4000-8000-000000000001' \
  'the demo organization has the documented id'

# Twenty-six rows, twenty-six ids, all of them recognisable on sight. Distinct ids are
# counted rather than occurrences: an id reused between two tables would still satisfy a
# total, and would give two different rows the same name in every log and URL that
# carries one. (The BetterAuth tables hold them as text; the shape is the same.)
seed_ids=$(grep -Eo "'5eed[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}'" "$BODY" | sort -u | wc -l)
check_equals 26 "$(printf '%s' "$seed_ids" | tr -d ' ')" \
  'the seed uses twenty-six distinct 5eed… ids, one per row it creates'

# The `account` table *can* hold the library's encrypted tokens, and this seed
# deliberately writes none of those columns (tests/seed.sql asserts the rows stay null);
# this asserts no statement here even names one, whatever the schema grows. It is this
# file's rule rather than every seed's: the dashboard seed writes `token_usage`, where
# "token" is a unit of work a model consumed and not a credential.
check_absent "$BODY" 'token' 'the seed writes no token'

# The one credential the seed *is* allowed to write (#709): the three password hashes
# behind the documented development password, and nothing that merely resembles one.
# Exactly three values in scrypt's `salt:key` shape — 32 hex chars, a colon, 128 — and
# every mention of the password column is one of those literals landing in it. The
# plaintext lives in documentation, never in a statement, so a database seeded from
# this file holds only what BetterAuth's verifier needs.
hashes=$(grep -Eoc "'[0-9a-f]{32}:[0-9a-f]{128}'" "$BODY" || true)
check_equals 3 "$(printf '%s' "$hashes" | tr -d ' ')" \
  'the seed writes exactly three password hashes, one per demo person'
check_absent "$BODY" 'ouroboros-dev-password' \
  'the development password appears in documentation, never in SQL'

# ---------------------------------------------------------------------------
# R__dev_seed_dashboard.sql — the dashboard read-model
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_dashboard.sql — the dashboard\n'

# Ids are computed rather than written out — there are seventy-seven of them and a list of
# seventy-seven literals is a list nobody proof-reads — so what this asserts is that every
# one is still built from a `5eed…` prefix and a value the file names. Three prefixes, one
# per table, which is what lets a run, a queue item and a usage event be told apart on
# sight in a log or a URL. `gen_random_uuid` is refused for both seeds by the loop above,
# which is the other half of the same property.
for prefix in '5eed0009' '5eed000a' '5eed000b'; do
  check_contains "$DASHBOARD_BODY" "'$prefix-0000-4000-8000-'" \
    "the dashboard seed builds its ids from the $prefix… prefix"
done

# Every row this seed writes belongs to one of the four tables the read-model is, and to
# no other. A seed that grew an insert into `organization` or `github_repos` would be
# writing the other seed's rows from the wrong file, and the two would then have to agree.
dashboard_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$DASHBOARD_BODY" |
  sed 's/^insert into ouroboros\.//' | sort -u | tr '\n' ' ')
check_equals 'queue_items runs token_usage workspace_settings ' "$dashboard_tables" \
  'the dashboard seed writes the four read-model tables and nothing else'

# The parents are found by natural key, never by naming an id a second time — which is
# what makes the seed converge on a database somebody has edited instead of failing on a
# foreign key. The organization is reached by slug in every statement.
check_absent "$DASHBOARD_BODY" '5eed0001-0000-4000-8000' \
  'the dashboard seed names no id from the other seed — it joins by slug and by name'

# Every window is relative to `now()`, which is the acceptance criterion "the today and
# 7-day math always holds": a literal timestamp would be correct on the day it was written
# and would fall out of the seven-day window the week after.
check_absent "$DASHBOARD_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the dashboard seed carries no literal date — every window is relative to now()'

# ---------------------------------------------------------------------------
# R__dev_seed_intake.sql — mockup 03's backlog
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_intake.sql — the backlog\n'

# Two prefixes, one per table: a mirrored issue and an estimate of it are told apart on
# sight. Both are computed from the prefix and the issue's own number, which is why the
# prefix is what gets asserted.
for prefix in '5eed0018' '5eed0019'; do
  check_contains "$INTAKE_BODY" "'$prefix-0000-4000-8000-'" \
    "the intake seed builds its ids from the $prefix… prefix"
done

# The two tables mockup 03 is drawn from, and no third. `queue_items` in particular is
# **not** here, and that is the acceptance criterion rather than tidiness: DASH-F.5 (#68)
# owns the twelve queue rows and its *Queued issues* stat counts them, so a thirteenth
# written from this file would break mockup 02 to decorate mockup 03. The queued pill is a
# presentation over rows that already exist — cross-referenced, not duplicated.
intake_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$INTAKE_BODY" |
  sed 's/^insert into ouroboros\.//' | sort -u | tr '\n' ' ')
check_equals 'github_issues issue_estimates ' "$intake_tables" \
  'the intake seed writes the mirrored issues and their estimates, and nothing else'

# Parents by natural key, exactly as the other later seeds do — the workspace by slug, the
# repository by name, and an issue by its number within that repository.
for foreign_prefix in '5eed0001-0000-4000-8000' '5eed0005-0000-4000-8000' \
                      '5eed0006-0000-4000-8000' '5eed000a-0000-4000-8000'; do
  check_absent "$INTAKE_BODY" "$foreign_prefix" \
    "the intake seed names no $foreign_prefix… id from another seed — it joins by natural key"
done

# Every instant is relative to `now()`, which is what keeps the panel's *opened 2d ago* and
# the trace's *2m ago* true however long after this file was written the stack is brought
# up. A literal date would be right on the day it was typed and wrong on every day after.
check_absent "$INTAKE_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the intake seed carries no literal date — every instant is relative to now()'

# **Decision K10, as a property of the file.** The provenance is `heuristic-v0` on every
# estimate and the trace claims nothing else: `tokens_used` is a rule engine's zero, and
# `signals` is empty because no knowledge layer has retrieved anything yet. The mockup's
# trace line names another estimator, a token count and three signals, and seeding any of
# them would be a screen showing a provenance no component produced — which is precisely
# what K10 forbids and what O.4's seeds will be able to supply honestly.
check_contains "$INTAKE_BODY" "'estimator',   'heuristic-v0'" \
  'every seeded estimate names heuristic-v0 as its estimator (decision K10)'
check_contains "$INTAKE_BODY" "'signals',     '\[\]'::jsonb" \
  'and claims no signal, because there is no knowledge layer to have produced one'
for fabricated in '41k' 'claude-sonnet-5 · ' 'similar closed issues' 'driver map' \
                  'test index'; do
  check_absent "$INTAKE_BODY" "$fabricated" \
    "the intake seed fabricates no trace copy — $fabricated is the mockup's, not a row's"
done

# **The head counts are computed, so the file may not contain them.** "9 open issues. 7
# already sized." is two aggregates over these rows, and the mockup's own 42/38 is a
# backlog forty-two deep that this fixture is not. A literal of either would be a number
# the product remembered rather than counted, and M.1's meta would then be untested
# against it.
for rendered in '42 open' '38 already' '9 open issues' '7 already sized'; do
  check_absent "$INTAKE_BODY" "$rendered" \
    "the intake seed stores no head count — $rendered is computed by M.1"
done

# The estimates cannot lean on `on conflict do nothing` alone, and the file must say so in
# SQL rather than only in prose: `issue_estimates` carries a BEFORE INSERT trigger
# (`issue_estimate_version_monotonic`, V026) that raises before any conflict is resolved,
# so a second application would fail the migration outright. The `not exists` predicate is
# the trigger's own rule evaluated a step earlier — and it is what makes the seed decline,
# rather than fail, on a database somebody has estimated by hand.
intake_version_guards=$(count_lines 'prior\.version >= seed\.version' "$INTAKE_BODY")
check_equals 2 "$(printf '%s' "$intake_version_guards" | tr -d ' ')" \
  'both estimate statements guard the monotonicity trigger, which fires before on conflict can skip a row'

# ---------------------------------------------------------------------------
# R__dev_seed_providers.sql — mockup 07's five cards
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_providers.sql — the providers\n'

# Three prefixes again, one per table: a connection, a discovered model and a spend event
# are told apart on sight. The connections are five literals; the other twenty-two ids are
# built from a prefix and an ordinal, which is why the prefix is what gets asserted.
for prefix in '5eed000c' '5eed000d' '5eed000e'; do
  check_contains "$PROVIDERS_BODY" "$prefix-0000-4000-8000-" \
    "the providers seed builds its ids from the $prefix… prefix"
done

# The three tables mockup 07 is drawn from, and no fourth. An insert into `model_aliases`
# here would be Y.4's (#192) rows written from the wrong file, and the two would then have
# to agree about which of them owns the routing fixture.
providers_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$PROVIDERS_BODY" |
  sed 's/^insert into ouroboros\.//' | sort -u | tr '\n' ' ')
check_equals 'provider_connections provider_models token_usage ' "$providers_tables" \
  'the providers seed writes the connections, their catalog and their spend, and nothing else'

# Parents by natural key, exactly as the dashboard seed does — the workspace by slug, Ken
# by email, a connection by its kind and name.
check_absent "$PROVIDERS_BODY" '5eed0001-0000-4000-8000' \
  'the providers seed names no id from the other seeds — it joins by slug, email and kind'
check_absent "$PROVIDERS_BODY" '5eed000b-0000-4000-8000' \
  'and no usage id from the dashboard seed, whose rows it only has to avoid colliding with'

# **The one seed here that carries literal dates, and exactly five of them.** *Added by Ken
# · 2026-06-12* is a date the card prints, so it cannot move with the stack's clock; every
# other timestamp in the file is relative to `now()`, because *last used 3m ago* and the
# calendar-month window are only true measured from it.
providers_dates=$(grep -Eoc "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9] " "$PROVIDERS_BODY" || true)
check_equals 5 "$(printf '%s' "$providers_dates" | tr -d ' ')" \
  'the providers seed carries five literal dates, one per card meta row, and no sixth'

# The credentials are envelopes and nothing else: three `ouro.v1.…` values, and not one
# string shaped like the vendor keys mockup 07 masks. The column's CHECK (V015) refuses a
# plaintext outright; this is the half that keeps one out of the file in the first place.
providers_envelopes=$(grep -Eoc "'ouro\.v1\.[0-9]+\." "$PROVIDERS_BODY" || true)
check_equals 3 "$(printf '%s' "$providers_envelopes" | tr -d ' ')" \
  'the providers seed seals three credentials and leaves the two local connections without one'
for shape in 'sk-ant' 'ghu_' 'key_cur'; do
  check_absent "$PROVIDERS_BODY" "$shape" \
    "the providers seed carries nothing shaped like a $shape… credential"
done

# ---------------------------------------------------------------------------
# R__dev_seed_routing.sql — mockup 06's routing screen
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_routing.sql — the routing\n'

# Eight prefixes, one per table: an alias, a task kind, a route, a hop, a rule, a routed
# call, a price override and a resolution snapshot are told apart on sight. Only the usage
# ids are computed from an ordinal — there are 370 of them — which is why the prefix is what
# gets asserted for all eight.
for prefix in '5eed000f' '5eed0010' '5eed0011' '5eed0012' '5eed0013' '5eed0014' \
              '5eed0016' '5eed0017'; do
  check_contains "$ROUTING_BODY" "$prefix-0000-4000-8000-" \
    "the routing seed builds its ids from the $prefix… prefix"
done

# The six tables mockup 06 is drawn from plus the two mockup 21 adds over them (#582), and no
# ninth. `provider_connections` in particular is *not* here: the health strip's five chips
# are #221's rows, and a second file writing them would give the two seeds a card each to
# disagree about — which is also why the registry's aliases are *this* file's rows rather
# than a sixth seed's.
routing_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$ROUTING_BODY" |
  sed 's/^insert into ouroboros\.//' | sort -u | tr '\n' ' ')
check_equals 'escalation_rules model_aliases model_prices resolution_snapshots route_hops routes task_kinds token_usage ' \
  "$routing_tables" \
  'the routing seed writes the aliases, kinds, routes, hops, rules, their usage, the one price override and the one snapshot, and nothing else'

# Parents by natural key, exactly as the other three do — the workspace by slug, Ken by
# email, a connection by kind and name, a kind by name, an alias by alias, and run #482 by
# its issue number.
for foreign_prefix in '5eed0001-0000-4000-8000' '5eed0009-0000-4000-8000' \
                      '5eed000b-0000-4000-8000' '5eed000c-0000-4000-8000' \
                      '5eed000d-0000-4000-8000' '5eed000e-0000-4000-8000'; do
  check_absent "$ROUTING_BODY" "$foreign_prefix" \
    "the routing seed names no $foreign_prefix… id from another seed — it joins by natural key"
done

# Every window is relative to `now()`, which is the acceptance criterion "stats recompute
# stably relative to now() — the seed still reproduces the mockup a month later". A literal
# timestamp would fall out of the thirty-day window the matrix reads and take every figure
# on the screen with it.
check_absent "$ROUTING_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the routing seed carries no literal date — every window is relative to now()'

# **Decision M7, as a property of the file.** None of the figures mockup 06 renders may
# appear in a statement, because every one of them is an aggregate: `$0.87` is the mean of
# fifteen costs, `41.0s` the median of fifteen latencies, `$412.80` a sum across three seeds
# and `31%` a ratio of two sums. A literal here would be a number the product remembered
# rather than computed, and the stats service would then be untested against it.
#
# The costs the file *does* carry are per-call cents — `87.0000` is one call's centre, not
# `$0.87` — and the latencies are per-call milliseconds. Neither is a figure the screen
# prints, which is exactly the distinction being asserted.
for rendered in '412\.80' '96\.40' '54\.10' '0\.87' '0\.31' '0\.22' '0\.12' '0\.04' \
                '41\.0s' '17\.4s' '12\.6s' '9\.8s' '6\.3s' '3\.1s' '1\.2s' '0\.8s' '31%'; do
  check_absent "$ROUTING_BODY" "$rendered" \
    "the routing seed stores no rendered figure — $(printf '%s' "$rendered" | tr -d '\\') is computed"
done

# **Mockup 21's cells are derived, and the file proves it by not containing them (#582).**
# The chips, the health word, the price cells and the counts are each a derivation over rows
# this file writes — CH.2 over `params`, CH.5 over the connection's status, CH.3 over the
# catalog, V023's view over the hops — and a seed that stored the rendered text beside the
# structure would let the registry pass its parity test while the derivation was broken.
for rendered in 'max thinking' '400k' 'std thinking' 'temp 0' '8k out' 'ctx 32k' \
                'review vote only' 'batch ok' 'degraded' 'no key' 'seat-based' \
                'usage-based' '15 · 75' '4 routes' '0 routes'; do
  check_absent "$ROUTING_BODY" "$rendered" \
    "the routing seed stores no registry cell — $rendered is derived"
done

# The one credential-adjacent literal, and it is a suffix: run #482's snapshot carries the
# masked tail mockup 21 prints, exactly once, and nothing shaped like the key it is the tail
# of — the same three shapes the providers seed is held to.
check_equals 1 "$(grep -c "'Xq4A'" "$ROUTING_BODY" | tr -d ' ')" \
  'the routing seed carries the masked key suffix once, for the snapshot, and no second time'
for shape in 'sk-ant' 'ghu_' 'key_cur'; do
  check_absent "$ROUTING_BODY" "$shape" \
    "the routing seed carries nothing shaped like a $shape… credential"
done

# ---------------------------------------------------------------------------
# The guard is off by default
# ---------------------------------------------------------------------------

printf '\nThe guard is off by default\n'

# The production position. flyway.toml is what scripts/migrate, CI, and any migration
# run against a database that is not a developer's own read.
check_contains "$CONFIG" '^\[flyway\.placeholders\]$' \
  'flyway.toml declares the placeholders section'
check_contains "$CONFIG" '^ouro_dev_seed = "false"$' \
  'flyway.toml resolves the seed guard to false, so a production run seeds nothing'
check_absent "$CONFIG" '^ouro_dev_seed = "true"$' 'and never to true'

# With substitution off the guard would reach PostgreSQL as literal text. Stated in
# flyway.toml rather than left to Flyway's default because this migration depends on it.
check_contains "$CONFIG" '^placeholderReplacement = true$' \
  'flyway.toml substitutes placeholders, which is what makes the guard a guard'

# The overlay is the only thing that turns it on, and it turns on nothing else — least of
# all `clean`, which is flyway.dev.toml's business and no part of seeding.
check_exists "$SEED_CONFIG" 'flyway.seed.toml exists'
check_contains "$SEED_CONFIG" '^ouro_dev_seed = "true"$' 'flyway.seed.toml is what enables the seed'
check_absent "$SEED_CONFIG" '^cleanDisabled' 'flyway.seed.toml does not touch cleanDisabled'
check_absent "$SEED_CONFIG" '^locations' 'flyway.seed.toml does not move the migrations'
for secret in url user password; do
  check_absent "$SEED_CONFIG" "^$secret = " "flyway.seed.toml carries no $secret"
done

# The two overlays stay separate: folding the seed into flyway.dev.toml would have given
# the compose stack a `clean` it must not have, and folding `clean` in here would have
# given it to anyone who wanted seed data.
check_absent "$DEV_CONFIG" 'ouro_dev_seed' 'flyway.dev.toml is not a way to get seed data'
check_absent "$SEED_CONFIG" '^cleanDisabled = false$' 'and clean-dev is not a side effect of seeding'

# ---------------------------------------------------------------------------
# Who turns it on
# ---------------------------------------------------------------------------

printf '\nWho turns it on\n'

# The development stack, which is a laptop by definition: it publishes a well-known
# password on loopback and its data is disposable.
check_contains "$COMPOSE" "^      - \\./ouroboros-db/flyway\\.seed\\.toml:$PROJECT/flyway\\.seed\\.toml:ro\$" \
  'the compose stack mounts the seed overlay, read-only'
check_contains "$COMPOSE" \
  "^      - -configFiles=$PROJECT/flyway\\.toml,$PROJECT/flyway\\.seed\\.toml\$" \
  'and names both files, because -configFiles replaces the auto-loaded one'

# …and nothing else does. A wrapper that quietly layered the overlay would make every
# database anyone migrates a development database.
for name in migrate info validate clean-dev; do
  check_absent "$MODULE_DIR/scripts/$name" 'flyway\.seed\.toml' \
    "scripts/$name never loads the seed overlay by itself"
done

run_script migrate --dry-run
check_equals 0 "$status" 'scripts/migrate dry-runs'
check_not_matches "$out" 'flyway\.(seed|dev)\.toml' \
  'and by default reaches for no overlay at all'

# The deliberate way in, for a database the stack does not own — a PostgreSQL installed
# on the machine, a scratch database. It is one flag and it has to be typed.
run_script migrate --config flyway.seed.toml --dry-run
check_equals 0 "$status" 'scripts/migrate --config flyway.seed.toml dry-runs'
check_matches "$out" 'configFiles=[^ ]*/flyway\.toml,[^ ]*/flyway\.seed\.toml ' \
  'and layers the seed overlay over flyway.toml'
check_matches "$out" ' migrate$' 'and still runs migrate'

# ---------------------------------------------------------------------------
# R__dev_seed_sources.sql — where the work comes from
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_sources.sql — the ticket sources\n'

# One prefix, because there is one table. Both ids are literals rather than computed — there
# are two of them — so the prefix is asserted the way every other seed's is.
check_contains "$SOURCES_BODY" '5eed001a-0000-4000-8000-' \
  'the sources seed builds its ids from the 5eed001a… prefix'

# **The one table, and this is the assertion that keeps the seed honest.** V030 created
# `tickets` as well, and an insert into it here would put mockup 03's nine issues in two
# places — R__dev_seed_intake.sql already seeds them into `github_issues`, which is what the
# backlog reads until Q.3 (#140) cuts it over. The copy nothing renders is the copy that
# drifts, so the restraint is asserted rather than left to the header that argues for it.
sources_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$SOURCES_BODY" |
  sed 's/^insert into ouroboros\.//' | sort -u | tr '\n' ' ')
check_equals 'ticket_sources ' "$sources_tables" \
  'the sources seed writes the sources and deliberately not the canonical tickets'

# Both kinds, because one of them would prove nothing. A lone `github` row is a source
# neutrality claim nobody can check; the `jira` row is what makes the development stack hold
# a tracker with no repository in it.
for kind in "'github'" "'jira'"; do
  check_contains "$SOURCES_BODY" "$kind" \
    "the sources seed configures a $kind source, so two kinds coexist in the dev stack"
done

# Parents by natural key, exactly as the other seeds do — the workspace by slug.
check_absent "$SOURCES_BODY" '5eed0001-0000-4000-8000' \
  'the sources seed names no id from another seed — it joins the workspace by slug'

# Every timestamp is left to the column defaults or to a sync that has not run, so there is
# no literal date to fall out of date. `synced_at` and `sync_cursor` are absent from the
# statement entirely, which is what makes the freshness tag honest on a seeded database.
check_absent "$SOURCES_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the sources seed carries no literal date — nothing here claims a poll happened'
for stamp in 'synced_at' 'sync_cursor'; do
  check_absent "$SOURCES_BODY" "$stamp" \
    "the sources seed writes no $stamp, because no sync has run against either source"
done

# The credential is an envelope and nothing else: one `ouro.v1.…` value per source — the
# Jira one written twice, in the insert and in the update that connects a source seeded
# before #275 — and not a single string shaped like a tracker token. V030's CHECK refuses a
# plaintext outright; this is the half that keeps one out of the file.
sources_envelopes=$(grep -Eoc "'ouro\.v1\.[0-9]+\." "$SOURCES_BODY" || true)
check_equals 3 "$(printf '%s' "$sources_envelopes" | tr -d ' ')" \
  'the sources seed seals both credentials, the Jira one repeated by the update that connects it'
check_equals 2 "$(grep -Eo "'ouro\.v1\.[^']+'" "$SOURCES_BODY" | sort -u | wc -l | tr -d ' ')" \
  'and they are two distinct envelopes, one per source'

# **The update only moves the row the earlier seed left.** Matching on the id alone would
# overwrite a Jira credential somebody pasted in by hand; matching on the paused,
# un-credentialed shape is what makes it a convergence step rather than an overwrite, and what
# makes a second application match nothing.
check_equals 1 "$(count_lines '^update ouroboros\.ticket_sources$' "$SOURCES_BODY")" \
  'the sources seed has exactly one update, on ticket_sources'
check_contains "$SOURCES_BODY" "^   and status = 'paused'\$" \
  'and it matches only a source still paused'
check_contains "$SOURCES_BODY" '^   and credentials_encrypted is null$' \
  'with no credential — the earlier seeded shape, and nothing a person configured'
for shape in 'ghp_' 'github_pat' 'glpat-' 'ATATT'; do
  check_absent "$SOURCES_BODY" "$shape" \
    "the sources seed carries nothing shaped like a $shape… credential"
done

# ---------------------------------------------------------------------------
# R__dev_seed_ticket_planning.sql — mockup 09's planning page
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_ticket_planning.sql — the planning page\n'

# Seven prefixes, one per table, each computed from a value the row already names.
for prefix in '5eed001d' '5eed001e' '5eed001f' '5eed0020' '5eed0021' '5eed0022' '5eed0023'; do
  check_contains "$PLANNING_BODY" "'$prefix-0000-4000-8000-" \
    "the planning seed builds its ids from the $prefix… prefix"
done

# The seven tables the page reads, and no eighth. Three absences are the point: no
# `ticket_sources` (the sources seed owns them, and Linear's absence is a rendered state), no
# `epic_mirrors` (nothing has been pushed), and no `model_prices` (the `$` is priced by rates
# that already exist, not by rows written to make it appear).
planning_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$PLANNING_BODY" |
  sed 's/^insert into ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'draft_batches epic_tickets issue_estimates planning_epics ticket_dependencies ticket_drafts tickets ' \
  "$planning_tables" \
  'the planning seed writes the backlog, its edges, the lanes, and the sized batch — and nothing else'
check_absent "$PLANNING_BODY" "'linear'" \
  'the planning seed names no Linear source, whose absence is what renders connect ↗'

# Parents from other seeds by natural key only — the workspace by slug, the source by kind
# and name.
for foreign_prefix in '5eed0001-0000-4000-8000' '5eed001a-0000-4000-8000' \
                      '5eed0018-0000-4000-8000' '5eed0019-0000-4000-8000'; do
  check_absent "$PLANNING_BODY" "$foreign_prefix" \
    "the planning seed names no $foreign_prefix… id from another seed — it joins by natural key"
done

# **Every number is computed, so the file may not contain one the page prints.** Each of these
# is an aggregate over the rows — a literal would be a figure the product remembered.
for rendered in '42 open' '38/42' '42 issues' 'Blocked' 'Stale' '12 issues' '8 done' \
                '3 days' '\$14' '1400' '4320' 'Q3–Q4'; do
  check_absent "$PLANNING_BODY" "$rendered" \
    "the planning seed stores no rendered figure — $rendered is computed"
done

# **The gantt cannot rot.** No literal date anywhere, and the months are offsets from the
# current one — which is what keeps TODAY in the second column however long after this was
# written the stack comes up.
check_absent "$PLANNING_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the planning seed carries no literal date — every instant and month is relative to now()'
check_contains "$PLANNING_BODY" "date_trunc\('month', now\(\)\) \+ make_interval\(months => seed\.start_offset\)" \
  'and each lane starts at an offset from the current month'

# The lanes' sort-order key is deferrable, and PostgreSQL refuses a targetless `on conflict`
# on such a table — so this insert names its arbiter, as the dashboard seed's queue rows do.
check_contains "$PLANNING_BODY" '^on conflict \(id\) do nothing;$' \
  'the epics insert names its arbiter, because the sort-order key is deferrable'

# Decision K10 and N3, as in the intake seed: the drafts are sized through the one estimates
# table, by `heuristic-v0`, with no tokens spent and no signal claimed.
check_contains "$PLANNING_BODY" "'estimator',   'heuristic-v0'" \
  'every draft estimate names heuristic-v0 as its estimator (decision K10)'
check_contains "$PLANNING_BODY" "'signals',     '\[\]'::jsonb" \
  'and claims no signal'
check_contains "$PLANNING_BODY" '\(id, draft_id, version,' \
  'and sizes the drafts through issue_estimates.draft_id (decision N3), not a table of its own'

# The BEFORE trigger V034 put on draft estimates raises before `on conflict` can skip a row, so
# the insert carries the trigger's own rule as a `not exists`.
check_equals 1 "$(count_lines 'prior\.version >= seed\.version' "$PLANNING_BODY")" \
  'the draft estimates guard the monotonicity trigger, which fires before on conflict can skip a row'

# ---------------------------------------------------------------------------
# R__dev_seed_workflows.sql — mockup 04's studio
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workflows.sql — the workflows\n'

# Two prefixes, because there are two tables, and both ids are computed from an ordinal and a
# version rather than written out nineteen times — the dashboard seed's idiom, and as
# deterministic as a literal.
check_contains "$WORKFLOWS_BODY" '5eed001b-0000-4000-8000-' \
  'the workflows seed builds its entity ids from the 5eed001b… prefix'
check_contains "$WORKFLOWS_BODY" '5eed001c-0000-4000-8000-' \
  'and its version ids from the 5eed001c… one, so the two tables are told apart on sight'

# The two tables, and nothing else. V029 is the whole of this seed's schema.
workflows_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$WORKFLOWS_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'workflow_versions workflows ' "$workflows_tables" \
  'the workflows seed writes the two tables V029 added and no third'

# **The update is the one statement in any seed that is not an insert, and this is what makes
# it idempotent.** Without `is distinct from` a second application would match all five rows,
# change nothing in them, and still move `updated_at` through `workflows_touch_updated_at` —
# which is precisely the "applied twice writes nothing" rule the loop above enforces on the
# inserts. There is one update and it carries the clause.
check_equals 1 "$(count_lines '^update ouroboros\.' "$WORKFLOWS_BODY")" \
  'the workflows seed has exactly one update — the pointer the two tables'"'"' cycle forces out of the insert'
check_contains "$WORKFLOWS_BODY" 'current_version is distinct from' \
  'and it only writes a pointer that is actually moving, so a second pass does not even touch a timestamp'

# **The guard `on conflict do nothing` cannot provide.** `workflow_version_next` is a BEFORE
# trigger, so on a second application it raises before PostgreSQL looks at the conflicting
# key — the same trap R__dev_seed_intake.sql hit with `issue_estimates_version_monotonic`. The
# `not exists` is what makes a re-applied seed a no-op rather than a failed `migrate`.
check_contains "$WORKFLOWS_BODY" 'not exists \(select 1' \
  'the versions insert holds the density trigger off a row that already exists'
check_contains "$WORKFLOWS_BODY" 'order by seed\.slug, seed\.version' \
  'and offers the versions in ascending order, because that trigger checks each row as it is written'

# Parents by natural key, as every other seed does: the workspace by slug and the publishers
# by email. No id from another seed appears.
check_absent "$WORKFLOWS_BODY" '5eed0001-0000-4000-8000' \
  'the workflows seed names no workspace id — it joins acme-robotics by slug'
check_absent "$WORKFLOWS_BODY" '5eed0003-0000-4000-8000' \
  'and no person id — it joins the publishers by email'

# Every instant is relative to now(), so the history stays plausible however long after the
# seed was written the stack is brought up — and *Last edited 2h ago* stays two hours.
check_absent "$WORKFLOWS_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the workflows seed carries no literal date; every stamp is an interval before now()'

# The six documents, each under its own dollar-quoted tag. Named here as well as in
# ouroboros-rest's dsl.seed.spec.ts, which is what validates them: a document *renamed* would
# leave that spec asserting nothing about it, and this is the half of the pair that can see a
# tag disappear without a database or a validator.
for tag in standard_fix_v14 standard_fix_v1 feature_loop_v1 deps_refresh_v1 docs_loop_v1 \
           hotfix_p0_v1; do
  check_equals 2 "$(count_lines "\\\$$tag\\\$" "$WORKFLOWS_BODY")" \
    "the $tag document is written once, opened and closed by its own tag"
done

# And the canvas says where it came from. The migration cannot read a file, so v14 is written
# out in it and the drift is closed the other way — by a spec that compares the two.
check_contains "$WORKFLOWS_SEED" 'schemas/workflow-dsl/fixtures/valid/standard-fix\.json' \
  'the seed says which committed fixture its v14 canvas is a copy of'
check_contains "$WORKFLOWS_SEED" 'schemas/workflow-dsl/v1\.json' \
  'and which schema every definition in it is written against'

# ---------------------------------------------------------------------------
# The documentation the seed is only usable through
# ---------------------------------------------------------------------------

printf '\nDocumentation\n'

README="$MODULE_DIR/README.md"
check_contains "$README" 'R__dev_seed\.sql' 'README.md documents the seed migration'
check_contains "$README" 'R__dev_seed_dashboard\.sql' 'README.md documents the dashboard seed'
check_contains "$README" 'R__dev_seed_intake\.sql' 'README.md documents the intake seed'
check_contains "$README" 'R__dev_seed_providers\.sql' 'README.md documents the providers seed'
check_contains "$README" 'R__dev_seed_routing\.sql' 'README.md documents the routing seed'
check_contains "$README" 'R__dev_seed_audit\.sql' 'README.md documents the audit seed'
check_contains "$README" 'R__dev_seed_sources\.sql' 'README.md documents the sources seed'
check_contains "$README" 'R__dev_seed_ticket_planning\.sql' 'README.md documents the planning seed'
check_contains "$README" 'R__dev_seed_workflows\.sql' 'README.md documents the workflows seed'
check_contains "$README" 'resolution_snapshots' 'README.md documents the snapshot table the routing seed fills for mockup 21'
check_contains "$README" 'V024' 'README.md documents the migration that adds it'
check_contains "$README" 'flyway\.seed\.toml' 'README.md documents the overlay that enables it'
check_contains "$README" 'acme-robotics' 'README.md names the demo tenant a developer will find'
check_contains "$README" 'tests/seed\.sql' 'README.md says how to assert the seeded content'

check_summary
