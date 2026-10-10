#!/usr/bin/env sh
#
# seed.test.sh — tests for the development seeds: migrations/R__dev_seed.sql,
# migrations/R__dev_seed_audit.sql, migrations/R__dev_seed_dashboard.sql,
# migrations/R__dev_seed_farm.sql, migrations/R__dev_seed_intake.sql,
# migrations/R__dev_seed_onboarding.sql,
# migrations/R__dev_seed_providers.sql, migrations/R__dev_seed_research.sql,
# migrations/R__dev_seed_workspace_copilot.sql, migrations/R__dev_seed_workspace_research.sql,
# migrations/R__dev_seed_routing.sql,
# migrations/R__dev_seed_sources.sql, migrations/R__dev_seed_ticket_planning.sql,
# migrations/R__dev_seed_workflows.sql, migrations/R__dev_seed_workspace_interventions.sql,
# migrations/R__dev_seed_workspace_knowledge.sql, migrations/R__dev_seed_workspace_metrics.sql,
# migrations/R__dev_seed_workspace_metrics_analyzer.sql,
# migrations/R__dev_seed_workspace_settings.sql,
# migrations/R__dev_seed_workspace_triage_inbox.sql, and the
# configuration that decides whether they do anything.
#
# The seeds are the migrations in this module that must behave differently in two places,
# so the properties worth testing are the ones that keep those two apart: that a
# production run resolves the guard to `false`, that only the development stack and a
# deliberate `--config` resolve it to `true`, and that every statement in either file is
# behind that guard and can be applied twice.
#
# There are ten files because they answer different questions — R__dev_seed.sql (#23) is
# *who exists*, R__dev_seed_dashboard.sql (#68) is *what the loop has done*,
# R__dev_seed_intake.sql (#103) is *what it has an opinion about next*,
# R__dev_seed_providers.sql (#221) is *what it is allowed to call*,
# R__dev_seed_routing.sql (#192) is *how it decides which one to call*,
# R__dev_seed_audit.sql (#225) is *who touched the keys*, R__dev_seed_sources.sql (#138) is
# *where the work comes from*, R__dev_seed_test_results.sql (#328) is *what the builds proved*,
# R__dev_seed_ticket_planning.sql (#275) is *the work and the
# plan over it*, R__dev_seed_verification.sql (#356) is *what the PR has to show before it
# merges*, R__dev_seed_workflows.sql (#136) is *what it does with it*,
# R__dev_seed_workspace_knowledge.sql (#409) is *what it has learned*, and
# R__dev_seed_onboarding.sql (#383) is *where a team starts*,
# R__dev_seed_workspace_interventions.sql (#434) is *where people still had to step in*,
# R__dev_seed_workspace_metrics.sql (#436) is *what it all added up to*,
# R__dev_seed_workspace_metrics_analyzer.sql (#509) is *what it could have done better*,
# R__dev_seed_workspace_settings.sql (#484) is *who may do what, and where the record goes*,
# R__dev_seed_workspace_triage_inbox.sql (#460) is *what is waiting on a person*,
# R__dev_seed_research.sql (#609) is *what it found out, and from where*,
# R__dev_seed_workspace_research.sql (#613) is *the rest of what research knows — the quarter, the
# rivals, the watch and the roadmap*,
# R__dev_seed_workspace_copilot.sql (#558) is *what the copilot drafted, and what its dry run said* — and the
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
FARM_SEED="$MODULE_DIR/migrations/R__dev_seed_farm.sql"
SOURCES_SEED="$MODULE_DIR/migrations/R__dev_seed_sources.sql"
RUN_CONSOLE_SEED="$MODULE_DIR/migrations/R__dev_seed_run_console.sql"
TEST_RESULTS_SEED="$MODULE_DIR/migrations/R__dev_seed_test_results.sql"
VERIFICATION_SEED="$MODULE_DIR/migrations/R__dev_seed_verification.sql"
PLANNING_SEED="$MODULE_DIR/migrations/R__dev_seed_ticket_planning.sql"
WORKFLOWS_SEED="$MODULE_DIR/migrations/R__dev_seed_workflows.sql"
KNOWLEDGE_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_knowledge.sql"
ONBOARDING_SEED="$MODULE_DIR/migrations/R__dev_seed_onboarding.sql"
INTERVENTIONS_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_interventions.sql"
METRICS_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_metrics.sql"
ANALYZER_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_metrics_analyzer.sql"
SETTINGS_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_settings.sql"
INBOX_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_triage_inbox.sql"
RESEARCH_SEED="$MODULE_DIR/migrations/R__dev_seed_research.sql"
COPILOT_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_copilot.sql"
WORKSPACE_RESEARCH_SEED="$MODULE_DIR/migrations/R__dev_seed_workspace_research.sql"
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
FARM_BODY="$work/seed-body-farm.sql"
SOURCES_BODY="$work/seed-body-sources.sql"
RUN_CONSOLE_BODY="$work/seed-body-run-console.sql"
TEST_RESULTS_BODY="$work/seed-body-test-results.sql"
VERIFICATION_BODY="$work/seed-body-verification.sql"
PLANNING_BODY="$work/seed-body-ticket-planning.sql"
WORKFLOWS_BODY="$work/seed-body-workflows.sql"
KNOWLEDGE_BODY="$work/seed-body-workspace-knowledge.sql"
ONBOARDING_BODY="$work/seed-body-onboarding.sql"
INTERVENTIONS_BODY="$work/seed-body-workspace-interventions.sql"
METRICS_BODY="$work/seed-body-workspace-metrics.sql"
ANALYZER_BODY="$work/seed-body-workspace-metrics-analyzer.sql"
SETTINGS_BODY="$work/seed-body-workspace-settings.sql"
INBOX_BODY="$work/seed-body-workspace-triage-inbox.sql"
RESEARCH_BODY="$work/seed-body-research.sql"
COPILOT_BODY="$work/seed-body-workspace-copilot.sql"
WORKSPACE_RESEARCH_BODY="$work/seed-body-workspace-research.sql"
seed_body "$SEED" "$BODY"
seed_body "$DASHBOARD_SEED" "$DASHBOARD_BODY"
seed_body "$INTAKE_SEED" "$INTAKE_BODY"
seed_body "$PROVIDERS_SEED" "$PROVIDERS_BODY"
seed_body "$ROUTING_SEED" "$ROUTING_BODY"
seed_body "$AUDIT_SEED" "$AUDIT_BODY"
seed_body "$FARM_SEED" "$FARM_BODY"
seed_body "$SOURCES_SEED" "$SOURCES_BODY"
seed_body "$RUN_CONSOLE_SEED" "$RUN_CONSOLE_BODY"
seed_body "$TEST_RESULTS_SEED" "$TEST_RESULTS_BODY"
seed_body "$VERIFICATION_SEED" "$VERIFICATION_BODY"
seed_body "$PLANNING_SEED" "$PLANNING_BODY"
seed_body "$WORKFLOWS_SEED" "$WORKFLOWS_BODY"
seed_body "$KNOWLEDGE_SEED" "$KNOWLEDGE_BODY"
seed_body "$ONBOARDING_SEED" "$ONBOARDING_BODY"
seed_body "$INTERVENTIONS_SEED" "$INTERVENTIONS_BODY"
seed_body "$METRICS_SEED" "$METRICS_BODY"
seed_body "$ANALYZER_SEED" "$ANALYZER_BODY"
seed_body "$SETTINGS_SEED" "$SETTINGS_BODY"
seed_body "$INBOX_SEED" "$INBOX_BODY"
seed_body "$RESEARCH_SEED" "$RESEARCH_BODY"
seed_body "$COPILOT_SEED" "$COPILOT_BODY"
seed_body "$WORKSPACE_RESEARCH_SEED" "$WORKSPACE_RESEARCH_BODY"

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
check_exists "$FARM_SEED" 'migrations/R__dev_seed_farm.sql exists'
check_exists "$SOURCES_SEED" 'migrations/R__dev_seed_sources.sql exists'
check_exists "$RUN_CONSOLE_SEED" 'migrations/R__dev_seed_run_console.sql exists'
check_exists "$TEST_RESULTS_SEED" 'migrations/R__dev_seed_test_results.sql exists'
check_exists "$VERIFICATION_SEED" 'migrations/R__dev_seed_verification.sql exists'
check_exists "$PLANNING_SEED" 'migrations/R__dev_seed_ticket_planning.sql exists'
check_exists "$WORKFLOWS_SEED" 'migrations/R__dev_seed_workflows.sql exists'
check_exists "$KNOWLEDGE_SEED" 'migrations/R__dev_seed_workspace_knowledge.sql exists'
check_exists "$ONBOARDING_SEED" 'migrations/R__dev_seed_onboarding.sql exists'
check_exists "$INTERVENTIONS_SEED" 'migrations/R__dev_seed_workspace_interventions.sql exists'
check_exists "$METRICS_SEED" 'migrations/R__dev_seed_workspace_metrics.sql exists'
check_exists "$ANALYZER_SEED" 'migrations/R__dev_seed_workspace_metrics_analyzer.sql exists'
check_exists "$SETTINGS_SEED" 'migrations/R__dev_seed_workspace_settings.sql exists'
check_exists "$INBOX_SEED" 'migrations/R__dev_seed_workspace_triage_inbox.sql exists'
check_exists "$RESEARCH_SEED" 'migrations/R__dev_seed_research.sql exists'
check_exists "$COPILOT_SEED" 'migrations/R__dev_seed_workspace_copilot.sql exists'
check_exists "$WORKSPACE_RESEARCH_SEED" 'migrations/R__dev_seed_workspace_research.sql exists'

# Repeatable, not versioned. A seed that grows with the product would otherwise become a
# chain of V### files that can never be re-run — README.md § Migration rules, rule 3.
for seed_file in "$SEED" "$AUDIT_SEED" "$DASHBOARD_SEED" "$FARM_SEED" "$INTAKE_SEED" \
                 "$PROVIDERS_SEED" "$ROUTING_SEED" "$RUN_CONSOLE_SEED" "$SOURCES_SEED" \
                 "$TEST_RESULTS_SEED" "$PLANNING_SEED" "$VERIFICATION_SEED" "$WORKFLOWS_SEED" \
                 "$KNOWLEDGE_SEED" "$ONBOARDING_SEED" "$INTERVENTIONS_SEED" "$METRICS_SEED" \
                 "$ANALYZER_SEED" "$SETTINGS_SEED" "$INBOX_SEED" "$RESEARCH_SEED" "$COPILOT_SEED" \
                 "$WORKSPACE_RESEARCH_SEED"; do
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
farm_description=$(basename -- "$FARM_SEED" .sql)
farm_description=${farm_description#R__}
sources_description=$(basename -- "$SOURCES_SEED" .sql)
sources_description=${sources_description#R__}
run_console_description=$(basename -- "$RUN_CONSOLE_SEED" .sql)
run_console_description=${run_console_description#R__}
test_results_description=$(basename -- "$TEST_RESULTS_SEED" .sql)
test_results_description=${test_results_description#R__}
verification_description=$(basename -- "$VERIFICATION_SEED" .sql)
verification_description=${verification_description#R__}
planning_description=$(basename -- "$PLANNING_SEED" .sql)
planning_description=${planning_description#R__}
workflows_description=$(basename -- "$WORKFLOWS_SEED" .sql)
workflows_description=${workflows_description#R__}
knowledge_description=$(basename -- "$KNOWLEDGE_SEED" .sql)
knowledge_description=${knowledge_description#R__}
onboarding_description=$(basename -- "$ONBOARDING_SEED" .sql)
onboarding_description=${onboarding_description#R__}
interventions_description=$(basename -- "$INTERVENTIONS_SEED" .sql)
interventions_description=${interventions_description#R__}
metrics_description=$(basename -- "$METRICS_SEED" .sql)
metrics_description=${metrics_description#R__}
analyzer_description=$(basename -- "$ANALYZER_SEED" .sql)
analyzer_description=${analyzer_description#R__}
settings_description=$(basename -- "$SETTINGS_SEED" .sql)
settings_description=${settings_description#R__}
inbox_description=$(basename -- "$INBOX_SEED" .sql)
inbox_description=${inbox_description#R__}
research_description=$(basename -- "$RESEARCH_SEED" .sql)
research_description=${research_description#R__}
copilot_description=$(basename -- "$COPILOT_SEED" .sql)
copilot_description=${copilot_description#R__}
workspace_research_description=$(basename -- "$WORKSPACE_RESEARCH_SEED" .sql)
workspace_research_description=${workspace_research_description#R__}

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
#
# The run-console seed (#302) **must** sort after three of them, and does: it finds the
# workspace by slug in the first, the run `#482` by issue number in the dashboard seed, and the
# build job it points `runs.reserved_build_job_id` at by number in the farm seed. On a database
# migrated from empty, `dev_seed_run_console` sorting before any of the three would leave the
# console's every join finding nothing — and Flyway re-applies a repeatable migration only when
# its checksum changes, so the second `migrate` would not put it right. `run_console` rather
# than `console` is what puts it after `routing`, and the whole order is asserted below.
#
# The test-results seed (#328) **must** sort after the dashboard seed, whose runs `#479` and
# `#482` every attempt hangs off, and after the first, for the workspace and for Ken; it joins to
# nothing else. `dev_seed_test_results` sorts after `dev_seed_sources` and before
# `dev_seed_ticket_planning`, which is after both of its parents; `results` alone would too, and
# `test_results` is the name the domain uses everywhere else.
#
# The verification seed (#356) **must** sort after the planning seed, whose canonical ticket
# `#482` and GitHub source the PR closes and is mirrored from, and after the test-results seed,
# whose Builds 1–3 its Build 4 copies and its revision 1 cites — and through those after the
# dashboard, farm and run-console seeds it also reads. `dev_seed_verification` sorts after
# `dev_seed_ticket_planning` and before `dev_seed_workflows`, which it does not need; `pr` would
# sort before `providers`, and every join in it would find nothing on a database migrated from
# empty.
#
# The knowledge seed (#409) **must** sort after every seed it reads: its playbooks pin the workflows seed's versions,
# its facts cite the planning seed's tickets and the verification seed's PR, and its injection
# records hang off the dashboard, run-console and intake seeds' runs, stages and estimates. It is
# named `workspace_knowledge` for exactly that — `dev_seed_knowledge` would sort before
# `dev_seed_providers`, and every join in it would find nothing on a database migrated from empty.
#
# The interventions seed (#434) **must** sort after the dashboard seed, whose runs every record it
# writes hangs off, and after the test-results seed, whose `#482` waiver it re-categorizes — and
# after the base seed for its people. It is named `workspace_interventions` for that:
# `dev_seed_interventions` would sort before `dev_seed_test_results`, and on a database migrated
# from empty the waiver it corrects would not exist yet. It sorts straight before the knowledge
# seed, which reads nothing of it.
#
# The insights seed (#436) **must** sort after every seed whose rows it reads or counts: the
# farm's jobs, the test plane's attempts, the sources seed's GitHub source and #434's events — the
# last of which the interventions seed writes only after the test-results seed. It is named
# `workspace_metrics` for that, and sorts last: `dev_seed_workspace_insights` would sort before
# `dev_seed_workspace_interventions`, and on a database migrated from empty its intervention
# history would count no events.
#
# The Build Analyzer seed (#509) **must** sort after the insights seed, and is named
# `workspace_metrics_analyzer` for exactly that: its builds *are* that seed's ledger of extra
# builds, made rows, and the ledger's history is computed from the farm's jobs — so on a database
# migrated from empty, sorting earlier would count every one of them twice. It also reads the farm,
# workflows, planning, verification and interventions seeds' rows, all of which sort before it.
#
# The settings seed (#484) **must** sort after every seed whose rows its audit lines name: the
# verification seed's PR #514 revision, the providers seed's Anthropic connection, the dashboard
# seed's run #471 and the farm seed's forge-03 — every line's time is read off its subject. It is
# named `workspace_settings` for that, and sorts last: `dev_seed_settings` would sort before
# `dev_seed_sources`, and on a database migrated from empty its audit card would hold nothing.
#
# The inbox seed (#460) **must** sort after the settings seed, whose published policy versions its
# auto-accept names, and through it after every seed whose rows its cards are about: the dashboard's
# loops, the intake mirror, the verification seed's PR #514, the knowledge seed's proposed fact and
# the insights seed's rollup it amends. It is named `workspace_triage_inbox` for that —
# `dev_seed_inbox` would sort before `dev_seed_intake`, and every card would find nothing.
#
# The onboarding seed (#383) **must** sort after two of them: the first, for Ken, and the intake
# seed, whose nine issues and their estimates it copies into its own workspace by query — on a
# database migrated from empty, sorting before `dev_seed_intake` would mirror nothing and leave
# the wizard with no ticket to pick. `dev_seed_onboarding` sorts sixth, straight after it. It
# reads no other seed: its workspace is its own.
#
# The rest of mockup 22's seed (#613) **must** sort after the research seed, whose RS-127 its matrix
# is about, the sources seed, whose GitHub source its tickets are filed through, the farm seed,
# whose jobs its bisects name, and the test-results seed, whose failing HIL measurement is RS-121's
# evidence. It is named `workspace_research` for that: `dev_seed_research_more` would sort before
# `dev_seed_sources` and file its tickets through nothing.
#
# The research seed (#609) only needs to sort after the first: RS-127 finds its workspace by slug
# and Ken by email, and its gap_analysis kind is the one V106 gives every workspace when it is
# created. `dev_seed_research` sorts after `dev_seed_providers` and before `dev_seed_routing`,
# neither of which it reads.
#
# The farm seed (#249) sorts fourth and only needs to sort after the first: every row it writes
# finds the workspace by slug, a person by email and a repository by name, and V040's tables are
# the first of their domain. `dev_seed_farm` does that; `farm_dev_seed`, which reads better,
# would sort before `dev_seed` and every join in it would find nothing on a database migrated
# from empty.
check_equals "$(printf '%s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s' "$base_description" "$audit_description" "$dashboard_description" "$farm_description" "$intake_description" "$onboarding_description" "$providers_description" "$research_description" "$routing_description" "$run_console_description" "$sources_description" "$test_results_description" "$planning_description" "$verification_description" "$workflows_description" "$copilot_description" "$interventions_description" "$knowledge_description" "$metrics_description" "$analyzer_description" "$workspace_research_description" "$settings_description" "$inbox_description")" \
  "$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$base_description" "$audit_description" "$dashboard_description" "$farm_description" "$intake_description" "$onboarding_description" "$providers_description" "$research_description" "$routing_description" "$run_console_description" "$sources_description" "$test_results_description" "$planning_description" "$verification_description" "$workflows_description" "$copilot_description" "$interventions_description" "$knowledge_description" "$metrics_description" "$analyzer_description" "$workspace_research_description" "$settings_description" "$inbox_description" |
     LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" \
  'the twenty-three seeds sort in the order their rows depend on, so Flyway applies them in it'

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
for seed_file in "$SEED" "$AUDIT_SEED" "$DASHBOARD_SEED" "$FARM_SEED" "$INTAKE_SEED" \
                 "$PROVIDERS_SEED" "$ROUTING_SEED" "$RUN_CONSOLE_SEED" "$SOURCES_SEED" \
                 "$TEST_RESULTS_SEED" "$PLANNING_SEED" "$VERIFICATION_SEED" "$WORKFLOWS_SEED" \
                 "$KNOWLEDGE_SEED" "$ONBOARDING_SEED" "$INTERVENTIONS_SEED" "$METRICS_SEED" \
                 "$ANALYZER_SEED" "$SETTINGS_SEED" "$INBOX_SEED" "$RESEARCH_SEED" "$COPILOT_SEED" \
                 "$WORKSPACE_RESEARCH_SEED"; do
  name=$(basename -- "$seed_file")
  body=$BODY
  [ "$seed_file" = "$AUDIT_SEED" ] && body=$AUDIT_BODY
  [ "$seed_file" = "$DASHBOARD_SEED" ] && body=$DASHBOARD_BODY
  [ "$seed_file" = "$FARM_SEED" ] && body=$FARM_BODY
  [ "$seed_file" = "$INTAKE_SEED" ] && body=$INTAKE_BODY
  [ "$seed_file" = "$PROVIDERS_SEED" ] && body=$PROVIDERS_BODY
  [ "$seed_file" = "$ROUTING_SEED" ] && body=$ROUTING_BODY
  [ "$seed_file" = "$RUN_CONSOLE_SEED" ] && body=$RUN_CONSOLE_BODY
  [ "$seed_file" = "$SOURCES_SEED" ] && body=$SOURCES_BODY
  [ "$seed_file" = "$TEST_RESULTS_SEED" ] && body=$TEST_RESULTS_BODY
  [ "$seed_file" = "$VERIFICATION_SEED" ] && body=$VERIFICATION_BODY
  [ "$seed_file" = "$PLANNING_SEED" ] && body=$PLANNING_BODY
  [ "$seed_file" = "$WORKFLOWS_SEED" ] && body=$WORKFLOWS_BODY
  [ "$seed_file" = "$KNOWLEDGE_SEED" ] && body=$KNOWLEDGE_BODY
  [ "$seed_file" = "$ONBOARDING_SEED" ] && body=$ONBOARDING_BODY
  [ "$seed_file" = "$INTERVENTIONS_SEED" ] && body=$INTERVENTIONS_BODY
  [ "$seed_file" = "$METRICS_SEED" ] && body=$METRICS_BODY
  [ "$seed_file" = "$ANALYZER_SEED" ] && body=$ANALYZER_BODY
  [ "$seed_file" = "$SETTINGS_SEED" ] && body=$SETTINGS_BODY
  [ "$seed_file" = "$INBOX_SEED" ] && body=$INBOX_BODY
  [ "$seed_file" = "$RESEARCH_SEED" ] && body=$RESEARCH_BODY
  [ "$seed_file" = "$COPILOT_SEED" ] && body=$COPILOT_BODY
  [ "$seed_file" = "$WORKSPACE_RESEARCH_SEED" ] && body=$WORKSPACE_RESEARCH_BODY

  inserts=$(count_lines '^insert into ouroboros\.' "$body")
  updates=$(count_lines '^update ouroboros\.' "$body")
  # A fill through the schema's own writer function — `select count(…) as <name>` over a lateral
  # call — is a statement too, and needs the guard like any other. R__dev_seed_workspace_metrics.sql
  # grades its merges through #435's record_estimate_outcome() this way rather than restating it.
  fills=$(count_lines '^select count\([a-z_.]+\) as [a-z_]+$' "$body")
  statements=$((inserts + updates + fills))
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
  #
  # The run-console seed is the one file that must contain the letters `secret`, and it is
  # worth being exact about rather than exempting: `guardrail_evaluations."check"` has a value
  # spelled `secrets` — the card's third row, *Secrets scan clean* — so the word is a
  # vocabulary term the schema closed and not a value anybody wrote. The rule is therefore
  # tightened for that file instead of dropped: every occurrence must be the check name, so a
  # `secret_key` or an `api_secret` added later still fails here.
  #
  # The verification seed (#356) is the second, for the same kind of reason: it reads that check
  # by name, and V056's gate vocabulary spells the scan gate `secrets_license`. Every occurrence
  # there must be one of those two, counted as occurrences rather than lines.
  for secret in secret api_key; do
    if [ "$seed_file" = "$RUN_CONSOLE_SEED" ] && [ "$secret" = secret ]; then
      check_equals "$(grep -Eoc "'secrets'" "$body" || true)" \
                   "$(grep -Eoc 'secret' "$body" || true)" \
                   "$name says secret only as the guardrail check named 'secrets'"
      continue
    fi
    # The inbox seed (#460) mirrors PR #504's gate set, so it says the scan gate's name too.
    if [ "$seed_file" = "$INBOX_SEED" ] && [ "$secret" = secret ]; then
      check_equals "$(grep -Eo "'secrets_license'" "$body" | wc -l | tr -d ' ')" \
                   "$(grep -Eo 'secret' "$body" | wc -l | tr -d ' ')" \
                   "$name says secret only as the gate 'secrets_license'"
      continue
    fi
    if [ "$seed_file" = "$VERIFICATION_SEED" ] && [ "$secret" = secret ]; then
      check_equals "$(grep -Eo "'secrets'|'secrets_license'" "$body" | wc -l | tr -d ' ')" \
                   "$(grep -Eo 'secret' "$body" | wc -l | tr -d ' ')" \
                   "$name says secret only as the guardrail check 'secrets' and the gate 'secrets_license'"
      continue
    fi
    # The onboarding seed (#383) is the third: the protected-paths rule pack says why it
    # suggested `keys/**` — *key and secret material* — and the seeded row carries the pack's
    # evidence as the pack wrote it. Every occurrence must be that reason.
    if [ "$seed_file" = "$ONBOARDING_SEED" ] && [ "$secret" = secret ]; then
      check_equals "$(grep -Eo '"why": "key and secret material"' "$body" | wc -l | tr -d ' ')" \
                   "$(grep -Eo 'secret' "$body" | wc -l | tr -d ' ')" \
                   "$name says secret only as the protected-paths pack's reason for keys/**"
      continue
    fi
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

# Ids are computed rather than written out — there are ninety-seven of them and a list of
# ninety-seven literals is a list nobody proof-reads — so what this asserts is that every
# one is still built from a `5eed…` prefix and a value the file names. Four prefixes, one
# per table, which is what lets a run, a queue item, a usage event and a stage of a run be
# told apart on sight in a log or a URL. `gen_random_uuid` is refused for both seeds by the
# loop above, which is the other half of the same property.
for prefix in '5eed0009' '5eed000a' '5eed000b' '5eed000c'; do
  check_contains "$DASHBOARD_BODY" "'$prefix-0000-4000-8000-'" \
    "the dashboard seed builds its ids from the $prefix… prefix"
done

# Every row this seed writes belongs to one of the five tables the read-model is — the four
# of #64–#67 and the stage history #298 added beside them — and to no other. A seed that
# grew an insert into `organization` or `github_repos` would be writing the other seed's
# rows from the wrong file, and the two would then have to agree.
#
# `LC_ALL=C sort`, like the later seeds' checks: the C collation puts `run_stages` before
# `runs`, and a locale that folds the underscore away puts it after — so an unqualified
# `sort` here would pass on one machine and fail on the next.
dashboard_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$DASHBOARD_BODY" |
  sed 's/^insert into ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'queue_items run_stages runs token_usage workspace_settings ' "$dashboard_tables" \
  'the dashboard seed writes the five read-model tables and nothing else'

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
# R__dev_seed_farm.sql — the machines, and the builds they ran
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_farm.sql — the build farm\n'

# Seven prefixes, one per table, which is what lets a pool, a runner, a token, a window, a job,
# a log chunk and a certificate be told apart on sight in a log or a URL. `gen_random_uuid` is
# refused for every seed by the loop above, which is the other half of the same property.
#
# `farm_authorities` has none and needs none: its primary key is the workspace, so there is no
# id for a prefix to distinguish.
for prefix in '5eed0024' '5eed0025' '5eed0026' '5eed0027' '5eed0028' '5eed0029' '5eed002a'; do
  check_contains "$FARM_BODY" "'$prefix-0000-4000-8000-'" \
    "the farm seed builds its ids from the $prefix… prefix"
done

# Every row this seed writes belongs to V040's six tables or V041's two, and to no others. A
# farm seed that grew an insert into `runs` would be writing the dashboard seed's rows from the
# wrong file, and the two would then have to agree about the loop.
farm_tables=$(grep -Eo '^insert into ouroboros\.[a-z_]+' "$FARM_BODY" |
  sed 's/^insert into ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'build_jobs build_log_chunks enrollment_tokens farm_authorities runner_certificates runner_pool_windows runner_pools runners ' \
  "$farm_tables" \
  'the farm seed writes V040 s six tables and V041 s two, and nothing else'

# Parents by natural key, never by naming an id a second time — the workspace by slug, the
# people by email, the repositories by name.
check_absent "$FARM_BODY" '5eed0001-0000-4000-8000' \
  'the farm seed names no id from another seed — it joins by slug, email and name'

# **Every instant is relative to now().** The stat row's "today" and "last week" are windows
# over these rows, so a literal date would be right on the day it was typed and would put half
# the fixture in the wrong window on every day after.
check_absent "$FARM_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the farm seed carries no literal date — every instant is derived from now()'
check_contains "$FARM_BODY" "date_trunc\('day', now\(\)\)" \
  'and today is anchored to the current UTC day rather than to a fixed offset from it'

# **`run_id` is decision B6, and the seed is where it is observable.** A *dispatched* MVP build
# belongs to no loop, so no statement here may attribute one — AJ.3 (#265) is what fills the
# column in for a build that actually ran.
#
# Narrowed by #302 rather than dropped. `#483` is `#482`'s **reservation** on `forge-02`, the
# row mockup 10's *forge-02 reserved* is drawn from and the other half of
# `runs.reserved_build_job_id` (V047), and a reservation is not a dispatch. So the rule is now
# that exactly one statement writes the column, and the check counts rather than forbids: a
# second job quietly acquiring a loop still fails here, which is the regression the original
# line was protecting against. What the row *is* — queued, on the branch, pointed back at from
# the run — is asserted in tests/seed.sql, where the rows can be read.
check_equals 1 "$(grep -Ec 'run_id' "$FARM_BODY" || true)" \
  'exactly one line of the farm seed names run_id — a second job acquiring a loop fails here (B6)'
check_contains "$FARM_BODY" 'runner_id, run_id, github_repo_id' \
  'and it is the reservation statement s column list, so the one exception is the one row'

# The figures the page prints are aggregates over these rows, so none of them may appear as a
# literal in a statement. `23`, `78`, `4m 12s` and `38` are computed in tests/seed.sql; a
# stored one would be a number the product remembered rather than counted.
for figure in '4m 12s' 'builds today' 'clean ·' 'hit rate'; do
  check_absent "$FARM_BODY" "$figure" \
    "the farm seed stores no rendered figure ($figure) — every one of them is computed"
done

# **Every secret here is an envelope.** V040's and V041's CHECKs refuse anything else outright;
# this is the half that keeps a plaintext out of the file, and it also asserts the four are
# distinct — one envelope written twice would be one secret in two places.
#
# Four since #250: two enrollment tokens, `anvil-mac`'s bearer secret, and the farm CA's private
# key. The last is the one that matters most and is checked by name below as well, because a CA
# key in the clear is the single worst row this repository could ship.
farm_envelopes=$(grep -Eoc "'ouro\.v1\.[0-9]+\." "$FARM_BODY" || true)
check_equals 4 "$(printf '%s' "$farm_envelopes" | tr -d ' ')" \
  'the farm seed seals both enrollment tokens, the bearer secret and the CA key'
check_equals 4 "$(grep -Eo "'ouro\.v1\.[^']+'" "$FARM_BODY" | sort -u | wc -l | tr -d ' ')" \
  'and they are four distinct envelopes, one per secret'
check_absent "$FARM_BODY" 'orb_enroll' \
  'and the plaintext shape the mockup masks appears nowhere in a statement'

# **No private key material of any kind, real or placeholder.** The CA's public certificate is
# a PEM block with a placeholder body and is meant to be here; a `PRIVATE KEY` block would mean
# somebody had generated a real authority inside a migration — identical in every developer's
# database and one accident away from production.
for block in 'PRIVATE KEY' 'BEGIN EC PARAMETERS'; do
  check_absent "$FARM_BODY" "$block" \
    "the farm seed carries no $block block — a CA generated in a migration is a key nobody controls"
done

# **The one statement with a `not exists` guard, and the reason it needs one.** The log-chunk
# insert fires V040's cap trigger, which updates the job's running byte total *before*
# PostgreSQL can detect the conflict — so `on conflict do nothing` alone would let a second
# `migrate` count every chunk's bytes twice. The guard is what makes the second pass a no-op,
# and tests/seed.sql is where the totals are checked.
check_equals 1 "$(count_lines 'not exists \(select 1 from ouroboros\.build_log_chunks' "$FARM_BODY")" \
  'the log-chunk insert carries a not-exists guard, because its BEFORE trigger runs first'
check_absent "$FARM_BODY" 'byte_start' \
  'and it writes no byte_start — the cap trigger assigns it from the job s own running total'

# Both statuses the fleet needs a fixture for. `bearer_fallback` is what AI.2 (#257) renders as
# degraded, and `removed` is the runner every count of the fleet has to exclude; neither exists
# in the mockup's five rows, and both have to exist in the data.
for state in 'bearer_fallback' 'removed'; do
  check_contains "$FARM_BODY" "'$state'" \
    "the farm seed carries a $state runner, which the mockup s five rows do not show"
done

# ---------------------------------------------------------------------------
# R__dev_seed_run_console.sql — mockup 10's run console (#302)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_run_console.sql — the run console\n'

# Five prefixes, one per table, so a transcript entry, a changed file, a commit, a usage row
# and a verdict are told apart on sight in a log or a URL.
for prefix in '5eed002b' '5eed002c' '5eed002d' '5eed002e' '5eed002f'; do
  check_contains "$RUN_CONSOLE_BODY" "'$prefix-0000-4000-8000-'" \
    "the run-console seed builds its ids from the $prefix… prefix"
done

# **The watermark is written before the transcript, and that ordering is a rule rather than a
# habit** (decision R4). `runs_simulated_is_fixed()` refuses to move `runs.simulated` once the
# run has written an entry, so a later edit that moved the update below the insert would not
# merely seed a transcript without a watermark — it would fail the migration. Asserted here so
# the reason is recorded where the edit would be made, rather than only in the error.
simulated_line=$(grep -n '^       simulated            = true,$' "$RUN_CONSOLE_BODY" | cut -d: -f1 | head -1)
transcript_line=$(grep -n '^insert into ouroboros\.run_events' "$RUN_CONSOLE_BODY" | cut -d: -f1 | head -1)
check_matches "$simulated_line" '^[0-9]+$' 'the run-console seed sets runs.simulated (R4)'
check_equals 'before' \
  "$([ -n "$simulated_line" ] && [ -n "$transcript_line" ] && [ "$simulated_line" -lt "$transcript_line" ] && echo before || echo after)" \
  'and sets it before the first transcript entry, which is the only order the schema allows'

# **The trigger side-effect guard**, for R__dev_seed_farm.sql's log-chunk reason: the transcript
# insert fires a `before` trigger that moves `runs.event_seq` and `runs.event_bytes`, and a
# `before` trigger runs whether or not `on conflict` then discards the row. Without the guard a
# second `migrate` would leave the run claiming a transcript twice the length of the one it has.
check_contains "$RUN_CONSOLE_BODY" 'not exists \(select 1 from ouroboros\.run_events existing' \
  'the transcript insert is guarded by not exists, so re-applying it does not double the run s counters'

# **The order the entries are inserted in is load-bearing** (#262's lesson, one table over): the
# trigger numbers rows as they reach it, so an unordered insert would give the mockup's nine
# instants sequence numbers that disagree with their own clocks.
check_contains "$RUN_CONSOLE_BODY" '^ order by entry\.seq$' \
  'and it orders its entries, because the database numbers them in the order they arrive'

# Every instant is an offset into the run rather than an offset from this migration's `now()`,
# which is what makes the page's own arithmetic exact rather than approximately right — two
# seeds are two transactions, and their `now()`s differ by however long the run between them
# took. A literal date would be worse again: right on the day it was typed and wrong after.
check_absent "$RUN_CONSOLE_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the run-console seed carries no literal date'
check_absent "$RUN_CONSOLE_BODY" 'now\(\) - make_interval' \
  'and no instant is measured back from this migration s own now()'
check_contains "$RUN_CONSOLE_BODY" 'run\.started_at \+ make_interval' \
  'every instant is an offset into the run, so the transcript spans the same 10m 08s at any hour'

# The figures the page prints are divisions, so none of them may appear as a literal: `212k`
# is a sum of four rows, `$1.14` a sum of four amounts, and `53%`, `46%` and `74%` are what the
# three meters compute from those and from the policies the other seeds already wrote.
for computed in '212000' '400000' '250' "'74'"; do
  check_absent "$RUN_CONSOLE_BODY" "$computed" \
    "the run-console seed stores no $computed — the meters divide what the rows and the policies hold"
done

# ---------------------------------------------------------------------------
# R__dev_seed_test_results.sql — mockup 11's test results (#328)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_test_results.sql — the test results\n'

# Eight prefixes, one per table, so an attempt, a suite, a case, a measurement, an occurrence, a
# score, a classification and an artifact are told apart on sight in a log or a URL.
for prefix in '5eed0031' '5eed0032' '5eed0033' '5eed0034' '5eed0035' '5eed0036' '5eed0037' '5eed0038'; do
  check_contains "$TEST_RESULTS_BODY" "'$prefix" \
    "the test-results seed builds its ids from the $prefix… prefix"
done

# The tables mockup 11 is drawn from, and no others. In particular not `runs` — #68 owns `#482`
# and `#479`, and a second insert of either would be two files describing one loop — and not
# `build_jobs`: decision B6 keeps loop attribution off dispatched jobs.
test_results_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$TEST_RESULTS_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'failure_classifications flake_scores hil_measurements run_pr_intents test_artifacts test_case_history test_cases test_runs test_suites ' \
  "$test_results_tables" \
  'the test-results seed writes the nine results tables and nothing else'

# Every instant is an offset into the run, for #302's reason — and the retention dates with them,
# which is the criterion that the artifacts card stays coherent whenever the seed is applied.
check_absent "$TEST_RESULTS_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the test-results seed carries no literal date'
check_absent "$TEST_RESULTS_BODY" 'now\(\)' \
  'and reads no clock of its own — every instant is measured from the run'
check_contains "$TEST_RESULTS_BODY" 'run\.started_at \+ make_interval' \
  'every attempt starts at an offset into its run'
check_contains "$TEST_RESULTS_BODY" "make_interval\(secs => a\.secs_in\) \+ interval '30 days'" \
  'and every artifact is retained 30 days from its own upload'

# **Derived numbers derive.** The totals are recounted from V051's counting views, the verdict is
# `hil_verdict()`'s, the comparative is left to V053's trigger, and the flake state is AS.3's
# formula — so none of the figures the page prints may appear in the file as a literal.
check_contains "$TEST_RESULTS_BODY" 'from ouroboros\.test_suite_counts_computed' \
  'suite totals are recounted from the cases'
check_contains "$TEST_RESULTS_BODY" 'from ouroboros\.test_run_counts_computed' \
  'and so are the attempts'
check_contains "$TEST_RESULTS_BODY" 'ouroboros\.hil_verdict\(' \
  'every verdict is the verdict function'"'"'s'
check_contains "$TEST_RESULTS_BODY" 'ouroboros\.flake_state_next\(' \
  'and the flake state is the formula'"'"'s'
for computed in "'pass'" "'fail'" "'watching'" '0\.5028' '87\.4' '86\.8' 'was 37'; do
  check_absent "$TEST_RESULTS_BODY" "$computed" \
    "the test-results seed stores no $computed — it is computed from the rows"
done

# The comparative is composed from earlier attempts' rows as each is written, so the measurements
# go in in attempt order — the same lesson #262 and #302 wrote down for ordered inserts.
check_contains "$TEST_RESULTS_BODY" '^ order by m\.attempt, m\.n$' \
  'the measurements are inserted in attempt order, so each build'"'"'s comparative sees the ones before it'

# ---------------------------------------------------------------------------
# R__dev_seed_verification.sql — mockup 12's PR verification (#356)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_verification.sql — the PR verification page\n'

# Nine prefixes of its own, one per PR table, so a waiver, a PR, a revision, a gate, a verdict, a
# criterion, a citation, a thread entry and a plan are told apart on sight. Build 4 and the farm
# jobs reuse #328's and the farm seed's, because they are more rows of those seeds' kinds.
for prefix in '5eed0039' '5eed003a' '5eed003b' '5eed003c' '5eed003d' '5eed003e' '5eed003f' \
              '5eed0040' '5eed0041' '5eed0031' '5eed0034' '5eed0028' '5eed0029' '5eed002e'; do
  check_contains "$VERIFICATION_BODY" "'$prefix" \
    "the verification seed builds its ids from the $prefix… prefix"
done

# The tables mockup 12 is drawn from, and the four AS tables and two farm tables Build 4 and the
# Build gate need — and not `runs`: #68 owns `#482`.
verification_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$VERIFICATION_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'build_jobs build_log_chunks flake_scores hil_measurements pr_criteria pr_criteria_evidence pr_gate_definitions pr_gate_results pr_merge_plans pr_revisions pr_thread_entries pr_waivers pull_requests test_case_history test_cases test_runs test_suites token_usage ' \
  "$verification_tables" \
  'the verification seed writes the PR tables, Build 4'"'"'s, the two farm tables and the ledger, and nothing else'

# Every instant is an offset into the run, for #302's reason. The one clock read is #302's UTC-day
# clamp on the ledger rows.
check_absent "$VERIFICATION_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the verification seed carries no literal date'
check_equals '1' "$(grep -Eo 'now\(\)' "$VERIFICATION_BODY" | wc -l | tr -d ' ')" \
  'and reads the clock once'
check_contains "$VERIFICATION_BODY" "date_trunc\('day', now\(\) at time zone 'utc'\)" \
  'which is the UTC-day clamp on the ledger rows'
check_contains "$VERIFICATION_BODY" 'run\.started_at \+ make_interval' \
  'every other instant is an offset into the run'

# The PR's sync stamp (V066, #370) is absent from the file entirely, for the sources seed's
# reason: no sync has run against #514, so the page's sync-lag banner says so rather than
# reading a stamp the seed made up.
check_absent "$VERIFICATION_BODY" 'synced_at' \
  'the verification seed writes no synced_at, because no sync has run against PR #514'

# **Derived numbers derive.** The aggregate is V056's function's, the head's counts are the
# snapshot's sum, the snapshot is the console's change-set, the gate lines are composed from the
# rows they cite, the message is V058's template, and Build 4's figures are #328's recipes — so
# none of the figures the page prints may appear in the file as a literal.
check_contains "$VERIFICATION_BODY" 'from ouroboros\.run_files f' \
  'the files snapshot is built from the console'"'"'s change-set'
check_contains "$VERIFICATION_BODY" 'jsonb_array_elements\(rev\.files\)' \
  'and the PR'"'"'s counts are summed from it'
check_contains "$VERIFICATION_BODY" 'from ouroboros\.test_run_counts_computed' \
  'Build 4'"'"'s totals are recounted from its cases'
check_contains "$VERIFICATION_BODY" 'ouroboros\.hil_verdict\(' \
  'its verdicts are the verdict function'"'"'s'
check_contains "$VERIFICATION_BODY" 'ouroboros\.flake_state_next\(' \
  'and the telemetry case is re-scored by the formula'
check_contains "$VERIFICATION_BODY" 'null,$' \
  'the merge plan'"'"'s message is written null, for V058'"'"'s template to fill'
for computed in "'5 / 7'" '5 of 7' '\+68' '−15' '63/63' 'after attempt 4' '1\.7%' '2\.4%' \
                '43\.5%' '284' '1\.52' 'Closes #482' 'was 2\.4'; do
  check_absent "$VERIFICATION_BODY" "$computed" \
    "the verification seed stores no $computed — it is computed from the rows"
done

# Decision R4: both model-authored thread entries wear the watermark, and it follows from the
# author kind rather than being typed beside each row.
check_contains "$VERIFICATION_BODY" "entry\.author_kind = 'model'," \
  'a thread entry is simulated exactly when a model wrote it'

# The comparative and the log chunks' byte offsets are assigned as rows arrive, so both inserts
# are ordered — #262's and #302's lesson.
check_contains "$VERIFICATION_BODY" '^ order by m\.n$' \
  'Build 4'"'"'s measurements are inserted in order'
check_contains "$VERIFICATION_BODY" '^ order by job\.number$' \
  'and so are the farm jobs'"'"' log chunks'
check_contains "$VERIFICATION_BODY" 'not exists \(select 1 from ouroboros\.build_log_chunks existing' \
  'which carry the farm seed'"'"'s guard, because their trigger moves the byte count before a conflict'

# ---------------------------------------------------------------------------
# R__dev_seed_workspace_knowledge.sql — mockup 14's Knowledge page (#409)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workspace_knowledge.sql — the Knowledge page\n'

# Seven prefixes of its own, one per knowledge table, and #68's run prefix for the five older
# launches, which are more of #68's kind of row.
for prefix in '5eed0042' '5eed0043' '5eed0044' '5eed0045' '5eed0046' '5eed0047' '5eed0048' \
              '5eed0009'; do
  check_contains "$KNOWLEDGE_BODY" "'$prefix" \
    "the knowledge seed builds its ids from the $prefix… prefix"
done

# The knowledge tables, and `runs` — five inserted launches and twenty-one tagged ones. Nothing
# else: the audit rows are V071's trigger's to write, never this file's.
knowledge_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$KNOWLEDGE_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'context_injections env_recipes fact_anchors facts playbooks runs skill_versions skills ' \
  "$knowledge_tables" \
  'the knowledge seed writes the knowledge tables and the launches, and nothing else'
check_absent "$KNOWLEDGE_BODY" 'fact_transitions \(' \
  'and never writes the fact audit itself'

# The one update of another seed's rows sets `playbook_id` and nothing else.
check_equals '1' "$(grep -Ec '^   set playbook_id = playbook\.id$' "$KNOWLEDGE_BODY" || true)" \
  'the only change to #68''s runs is the launch linkage'

# Every instant is relative to the clock, for #68's reason.
check_absent "$KNOWLEDGE_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the knowledge seed carries no literal date'

# **Usage is counted, never written.** The expiry snapshot is a `count(*)` over the injection
# records in the statement that expires the fact, and none of the page's figures appears as a
# literal: `48×`, `12×` and `31×` are counts, `61%` is 11 of 18, `run 9×`/`14×`/`3×` are launches.
check_contains "$KNOWLEDGE_BODY" '^       previous_use_count = \(select count\(\*\)$' \
  'the expiry snapshot is counted from the injection records'
for computed in '\b48\b' '\b31\b' '61%' '\b0\.61\b' 'used [0-9]' 'run [0-9]+×' '[0-9]+×'; do
  check_absent "$KNOWLEDGE_BODY" "$computed" \
    "the knowledge seed stores no $computed — it is counted from the rows"
done

# The locked, tinted and tagged rows are columns, and the facts are born proposed: V071 refuses
# anything else, and an insert that tried would fail the seed rather than this check — so this
# asserts the file never tries.
check_absent "$KNOWLEDGE_BODY" "'confirmed', *'" \
  'no fact is inserted confirmed — each is confirmed by an update, which the audit records'

# The version inserts carry the workflows seed's guard, because both next-version triggers raise
# before a conflict is looked for.
check_equals '2' "$(grep -Ec '^                      and prior\.version >= seed\.version\)$|^                    and prior\.version >= seed\.version\)$' "$KNOWLEDGE_BODY" || true)" \
  'both version inserts are guarded by "a version at or above this one exists"'

# ---------------------------------------------------------------------------
# R__dev_seed_onboarding.sql — mockup 13's mid-wizard moment (#383)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_onboarding.sql — the onboarding workspace\n'

# Thirteen prefixes of its own, one per table it writes — the workspace's census rows included,
# so no count another seed's assertions make over its prefix is moved by this file.
for prefix in '5eed0049' '5eed004a' '5eed004b' '5eed004c' '5eed004d' '5eed004e' '5eed004f' \
              '5eed0050' '5eed0051' '5eed0052' '5eed0053' '5eed0054' '5eed0055'; do
  check_contains "$ONBOARDING_BODY" "'$prefix-0000-4000-8000-" \
    "the onboarding seed builds its ids from the $prefix… prefix"
done

# The tables a workspace mid-wizard is made of, and nothing else. No update: every row is this
# seed's own, so there is nothing of another seed's to move.
onboarding_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$ONBOARDING_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'github_issues github_orgs github_repos issue_estimates member onboarding_state org_policies organization protected_path_policies repo_detection_scans repo_detections runs ticket_sources tickets ' \
  "$onboarding_tables" \
  'the onboarding seed writes its workspace, the wizard, the scan, the policy and the three loops — and nothing else'
check_equals 0 "$(count_lines '^update ' "$ONBOARDING_BODY")" \
  'and updates nothing'

# **No step status is seeded** (#383's second acceptance criterion, decision O1). The wizard row
# is written with the five columns the wizard owns — its lifecycle flags are left to their
# defaults — and the word `step` appears in no statement, as a column or as a value.
check_contains "$ONBOARDING_BODY" '^    \(id, organization_id, repo_ref, selected_template, picked_ticket_id\)$' \
  'the wizard row is written with exactly its id, workspace, repository, template and ticket'
check_absent "$ONBOARDING_BODY" 'step' \
  'the onboarding seed writes no step — the rail is derived from the subsystem rows'
for lifecycle in dismissed completed_at bypassed_at; do
  check_absent "$ONBOARDING_BODY" "$lifecycle" \
    "the onboarding seed leaves $lifecycle at its default — not dismissed, completed or bypassed"
done

# Step 3 is *active* and step 4 *todo* because of what is absent, so the absences are asserted:
# no workflow (instantiated or otherwise) and no queue item is written.
check_absent "$ONBOARDING_BODY" 'ouroboros\.(workflows|workflow_versions|queue_items)' \
  'the onboarding seed creates no workflow and queues nothing'

# **The lock is counted, never flagged.** The tiles are V068's shipped rows — the seed writes no
# template and no override — and what makes Deep refactor locked is three merged runs, not a
# stored figure or a rule of the seed's own.
check_absent "$ONBOARDING_BODY" 'workflow_templates' \
  'the onboarding seed writes no template: the four tiles ship with V068'
check_absent "$ONBOARDING_BODY" 'merged_loops|unlock|locked' \
  'and no lock, unlock rule or merged-loop figure — the lock is merged_loop_count() over the runs'
check_equals 3 "$(grep -Ec "^         \([123], [0-9]+, '[^']+', +[0-9]+, [0-9]+, [0-9]+\),?$" "$ONBOARDING_BODY" || true)" \
  'three runs are seeded'
check_contains "$ONBOARDING_BODY" "^       seed\.loop_seq, 'docs-loop', 'ollama/qwen3-coder', 'merged',$" \
  'every one of them merged'

# **#488 is copied from the intake seed, not restated** (the fifth criterion). The issues and
# their estimates are read out of R__dev_seed_intake.sql's rows by its id prefix, so neither the
# title nor the XS chip nor the docs-loop suggestion is a literal here.
check_contains "$ONBOARDING_BODY" '^  from ouroboros\.github_issues source$' \
  'the mirrored issues are read from the intake seed'"'"'s rows'
check_equals 2 "$(grep -Ec "like '5eed0018-%'\$" "$ONBOARDING_BODY" || true)" \
  'both copies are scoped to the intake seed'"'"'s own ids'
for restated in 'Typo sweep' "'xs'" 'good-first-issue' 'est_tokens'; do
  check_absent "$ONBOARDING_BODY" "$restated" \
    "the onboarding seed does not restate #488's $restated — it is read from the intake seed"
done
check_contains "$ONBOARDING_BODY" '^                      and prior\.version >= source\.version\)$' \
  'the estimate copy carries the intake seed'"'"'s guard, because the version trigger raises before a conflict'

# The scan is thirty-eight seconds of data, its six rows are all `detected`, and nothing claims
# a measurement the product has not taken (decision O2).
check_equals 1 "$(grep -Ec '38000' "$ONBOARDING_BODY" || true)" \
  'the scan duration is written once, as 38000 ms'
check_equals 6 "$(grep -Ec "^         \([1-6], '(language|build|devcontainer|tests|protected_paths|conventions)', '(ok|warn)'," "$ONBOARDING_BODY" || true)" \
  'six detection rows, one per card row'
check_absent "$ONBOARDING_BODY" 'measured|env ready|snapshotted' \
  'no row is labelled measured and none claims a boot time'
check_absent "$ONBOARDING_BODY" 'installed_at' \
  'no GitHub App installation is claimed'

# The one credential is an envelope, as R__dev_seed_sources.sql's are.
check_equals 1 "$(grep -Eoc "'ouro\.v1\.[0-9]+\." "$ONBOARDING_BODY" || true)" \
  'the onboarding seed writes exactly one sealed credential, for its GitHub source'

# Every instant is relative to the clock, for #68's reason.
check_absent "$ONBOARDING_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the onboarding seed carries no literal date'

# Parents are found by natural key, never by restating another seed's id.
check_absent "$ONBOARDING_BODY" '5eed0001-0000-4000-8000|5eed0003-0000-4000-8000' \
  'the workspace is found by slug and Ken by email, not by the base seed'"'"'s ids'

# ---------------------------------------------------------------------------
# R__dev_seed_workspace_interventions.sql — mockup 15's "where loops still need humans" (#434)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workspace_interventions.sql — the interventions\n'

for prefix in '5eed0056' '5eed0057' '5eed0058' '5eed0059' '5eed005a' '5eed005b' '5eed005c' \
              '5eed005d'; do
  check_contains "$INTERVENTIONS_BODY" "'$prefix-0000-4000-8000-" \
    "the interventions seed builds its ids from the $prefix… prefix"
done

# Source records, one vote, one override and the one event it corrects — never a run, and never
# a metric row: the rollup computes those.
interventions_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$INTERVENTIONS_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'failure_classifications guardrail_evaluations intervention_events intervention_overrides test_cases test_runs test_suites ' \
  "$interventions_tables" \
  'the interventions seed writes source records, the vote, the override and its event — and nothing else'

# The causes are the rules': the only cause the file names as a value is the person's correction.
check_equals 1 "$(grep -Ec "cause_origin = 'human'" "$INTERVENTIONS_BODY" || true)" \
  'the interventions seed types one human cause, through the override, and leaves every other cause to the rules'
check_absent "$INTERVENTIONS_BODY" 'cause_origin = .rule.,' \
  'and never writes a rule-origin cause itself'

check_absent "$INTERVENTIONS_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the interventions seed carries no literal date — every detection is relative to its run'
check_absent "$INTERVENTIONS_BODY" 'insert into ouroboros\.runs' \
  'the interventions seed adds no run'

# ---------------------------------------------------------------------------
# R__dev_seed_workspace_metrics.sql — mockup 15's Insights page as rollup history (#436)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workspace_metrics.sql — the insights history\n'

for prefix in '5eed005e' '5eed005f' '5eed0060' '5eed0061'; do
  check_contains "$METRICS_BODY" "'$prefix-0000-4000-8000-" \
    "the insights seed builds its ids from the $prefix… prefix"
done

# The graded loops' four tables, the rollup grain and its bookkeeping — and no update of anybody
# else's row. In particular no flake score (the flaky card reads the test plane's) and no
# intervention event (the cause bars count #434's).
metrics_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$METRICS_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'issue_estimates metric_daily metric_rollup_state pull_requests runs tickets ' \
  "$metrics_tables" \
  'the insights seed writes the graded loops, the rollup history and its bookkeeping — and nothing else'
check_equals 0 "$(count_lines '^update ' "$METRICS_BODY")" 'and updates nothing'

# The grades are #435's fill, not rows typed here.
check_contains "$METRICS_BODY" 'ouroboros\.record_estimate_outcome\(pr\.organization_id, pr\.id\)' \
  'the calibration grades are written by record_estimate_outcome(), the fill #435 ships'

# **Components are seeded, values computed** — #436's "no value is seeded directly". Every rate's
# value is its numerator over its denominator in the statement, and every median's is
# percentile_cont over the samples the row carries.
check_contains "$METRICS_BODY" '100\.0 \* l\.autonomous / l\.closed, l\.autonomous, l\.closed' \
  'the merge rate''s value is computed from its components'
check_contains "$METRICS_BODY" '100\.0 \* l\.untouched / l\.merged, l\.untouched, l\.merged' \
  'and so is the merged-untouched rate'
check_contains "$METRICS_BODY" 'percentile_cont\(0\.5\) within group \(order by c\.ms\)' \
  'and the cycle median is the median of the samples it carries'
for figure in '\b92\b' '\b187\b' '\b228\b' '\b412\b' '\b377\b' '\b26430\b' '1\.87' '0\.41' \
              '\b126000000\b' '0\.12' '91\.5'; do
  check_absent "$METRICS_BODY" "$figure" \
    "the insights seed stores no $figure — the page's figures are computed from components"
done

# The two registry entries a day cannot hold are not written per day (V078, #435).
check_absent "$METRICS_BODY" "'cost_per_merged_pr'" 'cost per merged PR is left to the window'
check_absent "$METRICS_BODY" "'estimate_within_band" 'calibration is read from the grades, not stored per day'

# Every day is relative to the clock, for #68's reason.
check_absent "$METRICS_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the insights seed carries no literal date — every day is relative to now()'

# Parents by natural key, never by restating another seed's id.
check_absent "$METRICS_BODY" '5eed0001-0000-4000-8000|5eed001a-0000-4000-8000|5eed0006-0000-4000-8000' \
  'the workspace, the GitHub source and the repository are found by natural key'

# ---------------------------------------------------------------------------
# R__dev_seed_workspace_metrics_analyzer.sql — mockup 18's Build Analyzer (#509)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workspace_metrics_analyzer.sql — the Build Analyzer\n'

for prefix in '5eed0062' '5eed0063' '5eed0064' '5eed0065' '5eed0066' '5eed0067' '5eed0068' \
              '5eed0069' '5eed006a' '5eed006b' '5eed006c' '5eed006d' '5eed006e'; do
  check_contains "$ANALYZER_BODY" "'$prefix-0000-4000-8000-" \
    "the analyzer seed builds its ids from the $prefix… prefix"
done

# The corpus and the analysis domain, the planning batch its tickets are drafted into, the
# waivers and the apply records — and no row of any other seed rewritten. Its updates move its
# own runs, suggestions and measurements through their lifecycles, which is the only way V080,
# V081 and V085 let them be written.
analyzer_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$ANALYZER_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'analysis_findings analysis_runs analysis_schedules analysis_suggestion_findings analysis_suggestions audit_events build_jobs build_log_chunks draft_batches issue_estimates metric_daily metric_rollup_state pr_waivers runs suggestion_measurements ticket_drafts ' \
  "$analyzer_tables" \
  'the analyzer seed writes the corpus (its older loops and its duration series included), the analysis rows, its batch, its waivers and its apply records — and nothing else'

# **The strip is counted** (#510): the page's manifest takes its loops and log lines from the
# rows, so neither figure is written into it.
check_absent "$ANALYZER_BODY" "'loops', 312|'log_lines', 4100000" \
  'the page run'"'"'s manifest counts its loops and log lines rather than storing them'
check_contains "$ANALYZER_BODY" "'log_lines', counted\.log_lines" \
  'its log lines are the sum of the jobs'"'"' counted lines'

# The verdicts and the factor are V085's, through its own function and writer; identities V081's.
check_contains "$ANALYZER_BODY" 'ouroboros\.suggestion_measurement_verdict\(' \
  'each verdict is suggestion_measurement_verdict()'"'"'s arithmetic, not a word typed here'
check_contains "$ANALYZER_BODY" 'ouroboros\.recalibrate_analyzer\(' \
  'and the calibration factors are recalibrate_analyzer()'"'"'s'
check_contains "$ANALYZER_BODY" 'ouroboros\.analysis_suggestion_identity\(' \
  'every suggestion identity is derived from its findings, never typed'

# **The figures are computed.** Every number the page prints that a pattern analyzer finds is an
# aggregate over the corpus in the statement that stores it, so none may appear as a literal.
for figure in '1,?284' '0\.072' '7\.2' '\b430\b' '0\.205' '0\.82\b' '0\.31\b' '\b214\b' \
              '\b2160\b' '1\.5 days'; do
  check_absent "$ANALYZER_BODY" "$figure" \
    "the analyzer seed stores no $figure — the page's figures are computed from the corpus"
done

# No `$` without a model (decision A3): the runs name no LLM analyzer and store no cost.
check_absent "$ANALYZER_BODY" 'llm_cost_cents' 'the analyzer seed never writes an LLM cost'
check_absent "$ANALYZER_BODY" "'llm'|\"llm\"" 'and names no LLM analyzer'

# Every day is relative to the clock, for #68's reason.
check_absent "$ANALYZER_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" \
  'the analyzer seed carries no literal date — every day is relative to now()'

# Parents by natural key, never by restating another seed's id.
check_absent "$ANALYZER_BODY" '5eed0001-0000-4000-8000|5eed0006-0000-4000-8000|5eed0024-0000-4000-8000|5eed0025-0000-4000-8000' \
  'the workspace, the repository, the pools and the runners are found by natural key'

# Findings and suggestions are written only into a running run, and each run is completed after
# them — which is what makes a second application write nothing, since V081's write guard would
# refuse a finding into a completed run before `on conflict` could skip it.
check_equals 2 "$(grep -Ec "^   set status = 'complete', finished_at = started_at \+ interval" "$ANALYZER_BODY" || true)" \
  'each run is completed by one statement, after its findings'
check_equals 9 "$(grep -Ec "and r\.status = 'running'$" "$ANALYZER_BODY" || true)" \
  'and every statement writing its findings or suggestions reads the run only while it is running'

# ---------------------------------------------------------------------------
# R__dev_seed_workspace_settings.sql — mockup 17's Settings page (#484)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workspace_settings.sql — the Settings page\n'

for prefix in '5eed0071' '5eed0072' '5eed0073' '5eed0074' '5eed0076' '5eed0077' '5eed0078'; do
  check_contains "$SETTINGS_BODY" "'$prefix-0000-4000-8000-" \
    "the settings seed builds its ids from the $prefix… prefix"
done

# The administration state and the audit lines over it — and no row of any other seed. In
# particular no `pr_waivers` row: V079 makes every waiver an intervention, and one more would move
# mockup 15's cause bars. Its one update moves its own policy pointer.
settings_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$SETTINGS_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'audit_events invitation member_capabilities notification_routes org_policies org_policy_versions retention_policies service_accounts service_tokens webhook_deliveries webhook_endpoints ' \
  "$settings_tables" \
  'the settings seed writes the policy, members, audit lines, retention, webhooks and routes — and nothing else'

# **Truth is derived, not seeded.** No Slack anything (mockup 19 is not built), no needs-you DM
# (it needs Slack), and no stored lock reason, count or tick for the page to read back.
check_absent "$SETTINGS_BODY" "'slack'|'needs_you_dm'" \
  'the settings seed connects no Slack and routes no needs-you DM — this deployment has neither'
check_absent "$SETTINGS_BODY" 'connect PagerDuty first|locked_reason' \
  'the PagerDuty lock is derived by notification_routes_effective, never stored'
check_absent "$SETTINGS_BODY" "'2 active'|'4 connected'|'retained 400d'" \
  'no card figure is stored as a literal'

# **No secret material**: every key column is an envelope or a digest with no known input, and
# no BetterAuth session — whose token is a live bearer value — is written.
check_equals "$(grep -Eo "'ouro\.v1\.1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'" "$SETTINGS_BODY" | wc -l | tr -d ' ')" 3 \
  'the two signing keys and the service-key hint are sealed envelopes'
for envelope in $(grep -Eo "'ouro\.v1\.1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'" "$SETTINGS_BODY" | tr -d "'"); do
  decoded=$(printf '%s' "${envelope##*.}" | tr '_-' '/+' | awk '{ n = length($0) % 4; if (n) $0 = $0 substr("==", 1, 4 - n); print }' | base64 -d 2>/dev/null)
  check_matches "$decoded" '^dev-seed-value-not-a-real-' "an envelope's body says it opens nothing ($decoded)"
done
check_contains "$SETTINGS_BODY" "repeat\('5eed', 16\)" \
  'the service key is a digest of no known input — no string a person could type authenticates'
check_absent "$SETTINGS_BODY" 'ouroboros\.session|orb_svc_|whsec_' \
  'and no session, no service key and no signing key is ever written in the clear'

# Parents by natural key, never by restating another seed's id.
check_absent "$SETTINGS_BODY" '5eed0001-0000-4000-8000|5eed0003-0000-4000-8000|5eed0009-0000-4000-8000|5eed000c-0000-4000-8000|5eed0025-0000-4000-8000|5eed003b-0000-4000-8000' \
  'the workspace, the people, run #471, the Anthropic key, forge-03 and PR #514 rev 2 are found by natural key'

# The version trigger raises before a conflict is looked for, so the history insert is guarded.
check_contains "$SETTINGS_BODY" 'where prior\.organization_id = org\."id"' \
  'the policy history is written only into a workspace that has none, so a second application is a no-op'

# ---------------------------------------------------------------------------
# R__dev_seed_workspace_triage_inbox.sql — mockup 16's Needs-You inbox (#460)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workspace_triage_inbox.sql — the Needs-You inbox\n'

for prefix in 5eed0079 5eed007a 5eed007b 5eed007c 5eed007d 5eed007e 5eed007f 5eed0080 5eed0081 \
              5eed0082 5eed0083; do
  check_contains "$INBOX_BODY" "'$prefix-0000-4000-8000-" \
    "the inbox seed builds its ids from the $prefix… prefix"
done

# The inbox and what its cards needed to point at — and no row the inbox could not explain. In
# particular no `pr_waivers` row and no hand-written intervention: V079 derives the one intervention
# the protected-path stop is. Its updates set PR #504's counts and criteria, and bring the insights
# rollup and its tooltip to the intervention that stop raised.
inbox_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$INBOX_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'decision_items decision_resolutions guardrail_evaluations metric_daily pr_criteria pr_criteria_evidence pr_gate_definitions pr_gate_results pr_revisions pull_requests run_blocks run_files tickets ' \
  "$inbox_tables" \
  'the inbox seed writes the cards, answers, blocks, the stop, PR #504 and the tickets — and amends only the rollup'
check_absent "$INBOX_BODY" 'pr_waivers|intervention_events \(' \
  'and writes no waiver and no intervention of its own'

# **Every figure is computed.** The card's checks, diff stat and matrix are read off PR #504's rows;
# the stat card's median, longest wait and the head's estimate are never stated.
# (`'all ✓'` is in it once, as the word the matrix computes to, and `180` is one answer's latency.)
check_absent "$INBOX_BODY" "'13/13'|214|'41s'|'6m'|interval '90 seconds'|'checks_passed', [0-9]|'files', [0-9]" \
  'no card figure is stored as a literal — the merge card reads PR #504, the stat card reads the rows'
check_contains "$INBOX_BODY" 'pr_gate_results_latest' 'the merge card counts the gates the verification page counts'
check_contains "$INBOX_BODY" "now\(\) - interval '8 minutes'" 'the cards'"'"' ages are relative to the load, not dates'
check_absent "$INBOX_BODY" "'20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]" 'and no date is written anywhere'

# Parents by natural key, never by restating another seed's id.
check_absent "$INBOX_BODY" "'5eed00[0-6][0-9a-f]-0000-4000-8000-" \
  'every row of another seed — loops, tickets, PR #514, the fact, the policy — is found by natural key'

# The answers and the snooze are guarded beyond the conflict clause: an answered item refuses a
# second answer before a conflict is looked for, and a snooze is a function call.
check_contains "$INBOX_BODY" 'not exists \(select 1 from ouroboros\.decision_resolutions r where r\.item_id = item\.id\)' \
  'an answered item is never answered again on a second application'
check_contains "$INBOX_BODY" 'not exists \(select 1 from ouroboros\.decision_snooze_events e where e\.item_id = item\.id\)' \
  'and the snooze is recorded once'

# ---------------------------------------------------------------------------
# R__dev_seed_research.sql — mockup 22's RS-127 and its citation ledger (#609)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_research.sql — RS-127, its ledger and its brief\n'

for prefix in 5eed0084 5eed0085 5eed0086 5eed0087; do
  check_contains "$RESEARCH_BODY" "'$prefix-0000-4000-8000-" \
    "the research seed builds its ids from the $prefix… prefix"
done

# The investigation, its ledger, its brief and the brief's claims and citations — nothing else.
research_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$RESEARCH_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'brief_claim_sources brief_claims briefs investigations source_records ' \
  "$research_tables" \
  'the research seed writes RS-127, its sources, its brief, the claims and their citations — and nothing else'

# Parents by natural key, never by restating another seed's id.
check_absent "$RESEARCH_BODY" "'5eed00[0-7][0-9a-f]-0000-4000-8000-" \
  'the workspace and Ken are found by natural key'

# V108 checks a cite number and a brief version before a conflict is looked for, so the ledger and
# the brief are written only into an investigation that has none.
check_contains "$RESEARCH_BODY" 'not exists \(select 1 from ouroboros\.source_records s where s\.investigation_id = inv\.id\)' \
  'the ledger is written only into an investigation that has none, so a second application is a no-op'
check_contains "$RESEARCH_BODY" 'not exists \(select 1 from ouroboros\.briefs b where b\.investigation_id = inv\.id\)' \
  'and so is the brief'

# The card's count is the rows, and the filler is honest about being filler.
check_absent "$RESEARCH_BODY" "'44 sources'|'SOURCES — 44 CITED'" \
  'no card figure is stored as a literal — 44 sources is counted'
check_absent "$RESEARCH_BODY" 'placeholder' \
  'the ledger has no placeholders left — #613 seeded the 39 unfeatured sources'

# RS-127's estimate (#622): stored with the calibration that produced it, written into an existing
# RS-127 only when it has none, and reconciled by V109's one writer rather than by a hand-made row.
check_contains "$RESEARCH_BODY" 'estimate_calibration_version = 1' \
  "RS-127's estimate names calibration v1"
check_contains "$RESEARCH_BODY" 'and inv\.estimate is null' \
  'the estimate is given only to an RS-127 that has none'
check_contains "$RESEARCH_BODY" 'cross join lateral ouroboros\.record_investigation_estimate_outcome\(' \
  'the estimate-vs-actuals outcome is recorded by record_investigation_estimate_outcome()'
check_absent "$RESEARCH_BODY" 'insert into ouroboros\.investigation_estimate_outcomes' \
  'and never inserted by hand'

# ---------------------------------------------------------------------------
# R__dev_seed_workspace_copilot.sql — mockup 20's copilot page over the shared universe (#558)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workspace_copilot.sql — the session, the v0.3 draft, the dry run and its suggestions\n'

for prefix in 5eed0088 5eed0089 5eed008a 5eed008b 5eed008c 5eed008d; do
  check_contains "$COPILOT_BODY" "'$prefix-0000-4000-8000-" \
    "the copilot seed builds its ids from the $prefix… prefix"
done

copilot_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$COPILOT_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'copilot_messages copilot_sessions dry_run_artifacts dry_run_stages dry_run_suggestions dry_runs review_replay_pairs tickets workflows ' \
  "$copilot_tables" \
  'the copilot seed writes the ticket twin, the workflow, the conversation, the dry run, the replays and the suggestions — and nothing else'

# The draft is written by V110's one writer, never by inserting operations, and each batch only at
# the revision before it — so a second application applies nothing.
check_absent "$COPILOT_BODY" '^insert into ouroboros\.(draft_operations|workflow_versions)' \
  'the draft is built through apply_draft_batch(), not by writing the log or the draft directly'
for rev in 0 1 2; do
  check_contains "$COPILOT_BODY" "and wf\.draft_rev = $rev" "batch $((rev + 1)) is applied only at draft_rev $rev"
done

# #489 is the intake mirror's, copied — never invented.
check_contains "$COPILOT_BODY" 'join ouroboros\.github_issues mirror on mirror\.github_repo_id = repo\.id and mirror\.number = 489' \
  "#489's canonical twin is copied from the intake mirror"
check_absent "$COPILOT_BODY" "'5eed00[0-7][0-9a-f]-0000-4000-8000-" \
  'the workspace, Ken and every other seed''s rows are found by natural key'

# Rows a trigger refuses a second time are guarded beyond the conflict clause.
check_contains "$COPILOT_BODY" 'and s\.last_seq = 0' 'messages are written only into an empty session'
check_contains "$COPILOT_BODY" "and r\.status = 'running'" "stages and the diff are written only into a running dry run"

# W7's unresolved references are seeded unresolved.
check_contains "$COPILOT_BODY" '"skill": "advisory-db"' 'analyze loads skill:advisory-db, which no skill names'
check_contains "$COPILOT_BODY" '"inherit_task": "exploit-verify"' 'exploit-verify routes by a task kind the catalog does not have'

# ---------------------------------------------------------------------------
# R__dev_seed_workspace_research.sql — the rest of mockup 22 (#613)
# ---------------------------------------------------------------------------

printf '\nR__dev_seed_workspace_research.sql — the quarter, the matrix, the rivals, the watch and the roadmap\n'

for prefix in 5eed008e 5eed008f 5eed0090 5eed0091 5eed0092 5eed0093 5eed0094 5eed0095 5eed0096 5eed0097 5eed0098 5eed0099 5eed009a; do
  check_contains "$WORKSPACE_RESEARCH_BODY" "'$prefix-0000-4000-8000-" \
    "the research workspace seed builds its ids from the $prefix… prefix"
done

workspace_research_tables=$(grep -Eo '^(insert into|update) ouroboros\.[a-z_]+' "$WORKSPACE_RESEARCH_BODY" |
  sed -E 's/^(insert into|update) ouroboros\.//' | LC_ALL=C sort -u | tr '\n' ' ')
check_equals 'brief_claim_sources brief_claims briefs capability_matrices competitor_snapshots competitor_watches competitors doc_suggestions document_import_items document_imports draft_batches investigations issue_estimates matrix_cell_sources matrix_cells matrix_rows pull_requests regression_baselines regression_watch_items roadmap_doc_versions roadmap_docs source_records ticket_drafts ticket_sources tickets ' \
  "$workspace_research_tables" \
  'the research workspace seed writes the research domain, the tickets, drafts and PR it points at, and the history index''s Support source and churn import (#618) — and nothing else'

# Rows whose BEFORE INSERT triggers allocate or check a sequence are written only where none exist.
check_contains "$WORKSPACE_RESEARCH_BODY" 'not exists \(select 1 from ouroboros\.investigations x' \
  'investigations are written only under numbers the workspace has not used'
check_contains "$WORKSPACE_RESEARCH_BODY" 'not exists \(select 1 from ouroboros\.source_records s where s\.investigation_id = inv\.id\)' \
  'each ledger is written only into an investigation that has none'
check_contains "$WORKSPACE_RESEARCH_BODY" 'not exists \(select 1 from ouroboros\.briefs x where x\.investigation_id = inv\.id\)' \
  'and each brief'
check_contains "$WORKSPACE_RESEARCH_BODY" 'not exists \(select 1 from ouroboros\.issue_estimates x where x\.ticket_id = ticket\.id\)' \
  'and each estimate'
check_contains "$WORKSPACE_RESEARCH_BODY" 'not exists \(select 1 from ouroboros\.roadmap_doc_versions v where v\.doc_id = doc\.id\)' \
  'and the roadmap version'

# The watch items move through V115's lifecycle one guarded step at a time.
for step in "and status = 'detected'" "and item.status = 'bisecting'" "and item.status = 'bisected'" \
            "and status = 'fix_drafted'" "and status = 'fix_running'"; do
  check_contains "$WORKSPACE_RESEARCH_BODY" "$step" "a watch item moves only from the state its step expects ($step)"
done

# The card's numbers are the rows'.
check_absent "$WORKSPACE_RESEARCH_BODY" "'4 active|'23 this quarter|'312 sources|'6 issues|'4 rivals watched" \
  'no card figure is stored as a literal — every count is computed'
check_absent "$WORKSPACE_RESEARCH_BODY" "'5eed00[0-7][0-9a-f]-0000-4000-8000-|'5eed008[4-7a-d]-0000-4000-8000-" \
  'every other seed''s rows are found by natural key'

# The history index's corpus (#618): a second, paused tracker and an imported set.
check_contains "$WORKSPACE_RESEARCH_BODY" "'custom', 'Support', '\{\}'::jsonb," \
  'the Support source is a custom-kind second tracker'
check_contains "$WORKSPACE_RESEARCH_BODY" "'support', 'churn-2026-q2'," \
  'the churn interviews are imported at issue-index://support/churn-2026-q2'
check_absent "$WORKSPACE_RESEARCH_BODY" "'3,412|'312 issues|'9 of 14'" \
  'no index count is stored as a literal'

# No live run: the workspace's three are mockup 02's.
check_absent "$WORKSPACE_RESEARCH_BODY" '^insert into ouroboros\.runs' \
  'the seed starts no loop — `3 loops live` stays mockup 02''s'

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
check_contains "$README" 'R__dev_seed_farm\.sql' 'README.md documents the farm seed'
check_contains "$README" 'R__dev_seed_run_console\.sql' 'README.md documents the run-console seed'
check_contains "$README" 'R__dev_seed_test_results\.sql' 'README.md documents the test-results seed'
check_contains "$README" 'R__dev_seed_verification\.sql' 'README.md documents the verification seed'
check_contains "$README" 'R__dev_seed_workspace_knowledge\.sql' 'README.md documents the knowledge seed'
check_contains "$README" 'R__dev_seed_onboarding\.sql' 'README.md documents the onboarding seed'
check_contains "$README" 'R__dev_seed_workspace_interventions\.sql' 'README.md documents the interventions seed'
check_contains "$README" 'R__dev_seed_workspace_metrics\.sql' 'README.md documents the insights seed'
check_contains "$README" 'R__dev_seed_workspace_metrics_analyzer\.sql' 'README.md documents the Build Analyzer seed'
check_contains "$README" 'R__dev_seed_workspace_settings\.sql' 'README.md documents the settings seed'
check_contains "$README" 'R__dev_seed_workspace_triage_inbox\.sql' 'README.md documents the inbox seed'
check_contains "$README" 'R__dev_seed_research\.sql' 'README.md documents the research seed'
check_contains "$README" 'R__dev_seed_workspace_copilot\.sql' 'README.md documents the copilot seed'
check_contains "$README" 'R__dev_seed_workspace_research\.sql' 'README.md documents the research workspace seed'
check_contains "$README" 'acme-onboarding' 'README.md names the onboarding workspace a developer will find'
check_contains "$README" 'resolution_snapshots' 'README.md documents the snapshot table the routing seed fills for mockup 21'
check_contains "$README" 'V024' 'README.md documents the migration that adds it'
check_contains "$README" 'flyway\.seed\.toml' 'README.md documents the overlay that enables it'
check_contains "$README" 'acme-robotics' 'README.md names the demo tenant a developer will find'
check_contains "$README" 'tests/seed\.sql' 'README.md says how to assert the seeded content'

check_summary
