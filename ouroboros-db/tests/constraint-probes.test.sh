#!/usr/bin/env sh
#
# constraint-probes.test.sh — tests for tests/verify-constraint-probes.sh.
#
# The script itself needs a migrated PostgreSQL, so what it does to a schema is asserted
# where a database exists: the `ci/db` step that runs it. Its scope is #69's dashboard
# read-model, #221's provider tables, #193's routing invariants and #583's registry rules,
# and every constraint any of the four names is checked below against the migrations that
# create it. What is asserted here is everything it decides *before* it connects — the
# arguments it accepts,
# the ones it refuses, and its refusal to reach for a database with no password in the
# environment — so the module's suite keeps covering it without a daemon or a network.
#
# The second half reads the committed script and the workflow that runs it, and asserts the
# pair agree: a probe added to the script and never wired into CI is a probe nothing runs,
# which is the same failure mode the script exists to catch one level down.
#
# Usage:
#   ouroboros-db/tests/constraint-probes.test.sh   # this file alone
#   scripts/run-tests.sh ouroboros-db/tests        # the module's suite
#   scripts/run-tests.sh                           # every suite in the repository
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
SCRIPTS_DIR="$REPO_ROOT/scripts"

. "$SCRIPTS_DIR/lib/checks.sh"

PROBES="$TEST_DIR/verify-constraint-probes.sh"
WORKFLOW="$REPO_ROOT/.github/workflows/db.yml"

# run_probes [ARG...] — run the script with no password in the environment, leaving its
# combined output in $out and its exit status in $status.
#
# PGPASSWORD is unset rather than blanked, because "no password" is the state a developer
# who has not exported one is in, and it is the gate every case below stops at or before.
# Nothing here can therefore reach a database, whatever the machine happens to be running.
run_probes() {
  out=$(env -u PGPASSWORD "$PROBES" "$@" 2>&1)
  status=$?
}

printf '\nverify-constraint-probes.sh — usage and refusals\n'

check_executable "$PROBES" 'verify-constraint-probes.sh is executable'

# --help is answered before anything else is decided, so it works on a machine with no
# database, no password and no Docker — which is the machine somebody reading it is on.
run_probes --help
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'acceptance criterion' '--help explains what the script is for'
check_matches "$out" 'PGPASSWORD' '--help says which credential it needs'

# An argument it does not know is a mistake worth stopping for: silently ignoring one is
# how a --runner typo turns into a run that quietly used the wrong client.
run_probes --no-such-flag
check_equals 2 "$status" 'an unknown argument exits 2'
check_matches "$out" 'unknown argument' 'and says which argument it did not know'

run_probes --runner bogus
check_equals 2 "$status" 'an unknown runner exits 2'
check_matches "$out" 'auto, psql or docker' 'and names the runners there are'

run_probes --runner
check_equals 2 "$status" '--runner with no value exits 2'

# The gate that matters most: with no password the script must stop with a message naming
# what is missing, rather than attempting a connection that fails somewhere less legible.
run_probes
check_equals 2 "$status" 'no PGPASSWORD exits 2'
check_matches "$out" 'PGPASSWORD' 'and names the variable that would fix it'

printf '\nThe script and the job that runs it\n'

# Every mutation is a dropped constraint or a rewritten view expression, and each one has
# to name a rule that exists — a probe aimed at a constraint the migrations no longer
# create would report a green suite as a caught mutation. The migrations are the authority,
# so each name is checked against them.
for probe_constraint in \
  runs_status \
  runs_terminal_finished_at \
  queue_items_effort \
  queue_items_organization_position_key \
  queue_items_organization_issue_key \
  provider_connections_monthly_cap_nonnegative \
  provider_connections_status \
  provider_connections_added_by_fk \
  provider_models_connection_model_key \
  route_hops_route_position_key \
  routes_task_kind_key \
  route_hops_alias_fk \
  model_aliases_provider_fk \
  escalation_rule_then_shape \
  provider_connections_kind \
  model_aliases_unbound_disabled \
  model_aliases_params_known \
  model_aliases_restrictions_known \
  model_aliases_organization_alias_key \
  model_prices_token_requires_amounts \
  model_prices_free_amounts_zero \
  model_prices_metered_amounts_absent \
  model_prices_source_matches_owner \
  model_prices_match_key \
  alias_reference_kind_known
do
  check_contains "$PROBES" "drop constraint $probe_constraint" \
    "the suite mutates $probe_constraint"
  if grep -rqE "constraint $probe_constraint\b" "$MODULE_DIR/migrations"; then
    pass "and a migration creates $probe_constraint"
  else
    fail "and a migration creates $probe_constraint (no migration names it)"
  fi
done

# `workspace_settings_pkey` is PostgreSQL's own name for the primary key V011 declares
# inline, so it appears in no migration text — the constraint is asserted by the column
# that carries it instead.
check_contains "$PROBES" 'drop constraint workspace_settings_pkey' \
  'the suite mutates workspace_settings_pkey'
check_contains "$MODULE_DIR/migrations/V011__workspace_settings.sql" \
  'organization_id .*primary key' \
  'and V011 declares that primary key'

# `enabled` is a boolean, so the rule that gives it two states and not three is its
# `not null` — which has no name to drop. The mutation widens the column instead, and the
# migration that declares it is what this checks against.
check_contains "$PROBES" 'alter column enabled drop not null' \
  'the suite widens the enable switch'
check_contains "$MODULE_DIR/migrations/V017__provider_extensions_model_catalog.sql" \
  'enabled +boolean +not null default true' \
  'and V017 declares it as a switch with two positions'

# The two view rewrites cover the one scope bullet that is arithmetic rather than a
# constraint, so neither can be expressed as a drop.
check_contains "$PROBES" 'rewrite_view' 'the suite rewrites token_usage_daily'
check_contains "$MODULE_DIR/migrations/V010__dashboard_usage.sql" \
  'create view ouroboros.token_usage_daily' \
  'and V010 is where that view is created'

# The routing chain rules (#193) are the other shape a drop cannot express, for the opposite
# reason: one constraint trigger carries three rules, so dropping it falsifies all three and
# no probe can then answer for its own. The rewrites swap one test at a time, which only means
# anything while the function is still the one V016 wrote and still the one both triggers run.
check_contains "$PROBES" 'rewrite_chain_rule' 'the suite rewrites route_chain_intact()'
check_contains "$PROBES" 'lowest <> 1 or highest <> hop_count' \
  'and aims one rewrite at the density rule'
check_contains "$PROBES" 'floor_at is not null and floor_at > hop_count' \
  'and the other at the floor-index bound'
for chain_rule_test in \
  'lowest <> 1 or highest <> hop_count' \
  'floor_at is not null and floor_at > hop_count'
do
  check_contains "$MODULE_DIR/migrations/V016__task_kinds_routes_hops.sql" \
    "$chain_rule_test" "and V016 is where [$chain_rule_test] is written"
done
check_contains "$MODULE_DIR/migrations/V016__task_kinds_routes_hops.sql" \
  'create constraint trigger route_hops_chain_intact' \
  'and V016 arms it on route_hops'
check_contains "$MODULE_DIR/migrations/V016__task_kinds_routes_hops.sql" \
  'create constraint trigger routes_chain_intact' \
  'and on routes'

# The two routing foreign keys are relaxed rather than dropped — `restrict` → `cascade` is the
# refactor worth probing for, and a drop would be caught by an unrelated probe hundreds of
# assertions earlier. So the mutation has to *re-add* each one, and what makes that a mutation
# at all is that the migration declares the opposite.
for restrict_fk in route_hops_alias_fk model_aliases_provider_fk
do
  if grep -A4 -- "add constraint $restrict_fk" "$PROBES" | grep -q 'on delete cascade'; then
    pass "the suite re-adds $restrict_fk as a cascade rather than leaving it dropped"
  else
    fail "the suite re-adds $restrict_fk as a cascade rather than leaving it dropped (it does not)"
  fi
  if grep -rl -- "constraint $restrict_fk" "$MODULE_DIR/migrations" |
       xargs grep -A4 -- "constraint $restrict_fk" | grep -q 'on delete restrict'; then
    pass "and the migration that declares it says restrict"
  else
    fail "and the migration that declares it says restrict (it does not)"
  fi
done

# `alias_reference_kind_known` is a domain constraint rather than a table one, so the loop
# above found it by name but not by the statement that has to drop it. `alter table` on a
# domain is a syntax error, and a mutation that cannot be applied reports as a probe that
# caught nothing.
if grep -q 'alter domain ouroboros.alias_reference_kind drop constraint alias_reference_kind_known' \
     "$PROBES"; then
  pass 'the reference-kind vocabulary is dropped with alter domain, which is what it lives on'
else
  fail 'the reference-kind vocabulary is dropped with alter domain, which is what it lives on (it is not)'
fi
check_contains "$MODULE_DIR/migrations/V023__alias_reference_index.sql" \
  'create domain ouroboros.alias_reference_kind' \
  'and V023 is where that domain is created'

# The price key is relaxed rather than dropped, for the reason the two routing foreign keys
# are: `nulls not distinct` is the whole of the rule for bundled rows, dropping the modifier
# is the edit that really happens, and it leaves the constraint's name exactly where it was.
# So the mutation has to *re-add* the key, and what makes that a mutation at all is that the
# migration declares the modifier the re-add leaves off.
if grep -A2 -- 'add constraint model_prices_match_key' "$PROBES" |
     grep -q 'unique (organization_id, match_provider_kind, match_model, source)'; then
  pass 'the suite re-adds model_prices_match_key with nulls distinct rather than leaving it dropped'
else
  fail 'the suite re-adds model_prices_match_key with nulls distinct rather than leaving it dropped (it does not)'
fi
if grep -A2 -- 'add constraint model_prices_match_key' "$PROBES" | grep -q 'nulls not distinct'; then
  fail 'and the re-added key really is the relaxed one (it still says nulls not distinct)'
else
  pass 'and the re-added key really is the relaxed one'
fi
check_contains "$MODULE_DIR/migrations/V012__model_prices.sql" \
  'unique nulls not distinct \(organization_id, match_provider_kind, match_model, source\)' \
  'and V012 declares it with nulls not distinct'

# And the half of #193 that lives in constraints.sql: the invariants named there have to be
# the invariants the mutations above drop, or the two halves are watching different rules.
CONSTRAINTS="$TEST_DIR/constraints.sql"
for named_invariant in \
  route_hops_route_position_key \
  route_chain_intact \
  routes_task_kind_key \
  routes_floor_hop_index_positive \
  route_hops_alias_fk \
  model_aliases_provider_fk \
  escalation_rule_then_shape \
  escalation_rule_when_grammar \
  provider_connections_kind
do
  check_contains "$CONSTRAINTS" "$named_invariant" \
    "constraints.sql names $named_invariant among the routing invariants"
done

# The same half of #583, which lives one file further out. CG.5's assertions are
# lib/registry-invariants.sql rather than a section of constraints.sql, because they run in
# two places — see that file's header — so this is where the two halves are checked to be
# about the same rules.
REGISTRY="$TEST_DIR/lib/registry-invariants.sql"

check_exists "$REGISTRY" 'the registry invariants have a file of their own'

for registry_invariant in \
  model_aliases_unbound_disabled \
  model_aliases_params_known \
  model_aliases_restrictions_known \
  model_aliases_organization_alias_key \
  model_prices_token_requires_amounts \
  model_prices_free_amounts_zero \
  model_prices_metered_amounts_absent \
  model_prices_source_matches_owner \
  model_prices_match_key \
  alias_reference_kind_known \
  model_aliases_provider_fk \
  route_hops_alias_fk
do
  check_contains "$REGISTRY" "$registry_invariant" \
    "the registry probes name $registry_invariant"
done

# Both ways in. Included, it is CG.5's section of constraints.sql and every runner that file
# already has reaches it; through its own suite it is what `ci/db` points at the seeded
# database. A fragment wired into neither is a file nothing runs.
check_contains "$CONSTRAINTS" 'ir lib/registry-invariants\.sql' \
  'constraints.sql includes the registry probes as its CG.5 section'
check_contains "$TEST_DIR/registry-invariants.sql" 'ir lib/registry-invariants\.sql' \
  'and the standalone suite includes the same file rather than a second copy'
check_contains "$TEST_DIR/registry-invariants.sql" 'ir lib/assert\.sql' \
  'and brings the assertion helpers with it, since it owns the session'

# The fragment must carry neither, or including it into a transaction that is already open
# would end that transaction early and redefine helpers that are already there.
if grep -qE '^(begin|commit|rollback);' "$REGISTRY"; then
  fail 'the registry probes leave transaction control to whichever suite includes them'
else
  pass 'the registry probes leave transaction control to whichever suite includes them'
fi

# A probe suite that CI does not run is a probe suite nobody runs.
check_contains "$WORKFLOW" 'verify-constraint-probes.sh' \
  'ci/db runs the probe verification'
check_contains "$WORKFLOW" 'registry-invariants.sql' \
  'and runs the registry probes against the seeded database'

check_summary
