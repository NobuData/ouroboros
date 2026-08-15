#!/usr/bin/env sh
#
# price-catalog.test.sh — tests for the bundled price catalog: the verb
# scripts/price-catalog.mjs, the vendored extract it renders from, and the generated
# migration that applies it (#580).
#
# Decision R4 makes pricing *data in the repository* — a pinned, vendored snapshot rather
# than a call to somebody's API on the render path — and that decision is only worth
# anything if three properties hold, all of which are file properties and none of which
# needs a database:
#
#   * the generated migration is what the extract renders, so a hand-edited price cannot
#     ship (`--check`, which is the same command ci/db runs);
#   * the extract says where it came from, precisely enough to fetch again — a commit sha,
#     a date, a licence, and the transform that produced it;
#   * nothing in either file reaches a network at migration time.
#
# Whether the catalog *applies* correctly — idempotently, sweeping the previous snapshot,
# never touching an override — is asserted against a real PostgreSQL by
# tests/constraints.sql, the same division of labour as betterauth-schema.test.sh and
# seed.test.sh. `--vendor` is not exercised here at all: it is the one mode that downloads
# anything, and a test suite that needed GitHub to be up would fail for reasons that have
# nothing to do with this repository.
#
# Usage:
#   ouroboros-db/tests/price-catalog.test.sh    # this file alone
#   scripts/run-tests.sh ouroboros-db/tests     # the module's suite
#   scripts/run-tests.sh                        # every suite in the repository
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")
SCRIPTS_DIR="$REPO_ROOT/scripts"

. "$SCRIPTS_DIR/lib/checks.sh"

VERB="$MODULE_DIR/scripts/price-catalog.mjs"
EXTRACT="$MODULE_DIR/catalog/litellm-model-prices.json"
LICENCE="$MODULE_DIR/catalog/LICENSE.litellm"
CATALOG_MIGRATION="$MODULE_DIR/migrations/R__model_price_catalog.sql"
SCHEMA_MIGRATION="$MODULE_DIR/migrations/V012__model_prices.sql"
README="$MODULE_DIR/README.md"

printf '\nouroboros-db — the bundled model price catalog\n\n'

# ---------------------------------------------------------------------------
# The verb
# ---------------------------------------------------------------------------

printf 'The verb\n'

check_exists "$VERB" 'scripts/price-catalog.mjs exists'
check_executable "$VERB" 'and is executable, like the module'"'"'s other scripts'
check_contains "$VERB" '^#!/usr/bin/env node$' 'and says what runs it'

# The three modes, each of which has to keep its name: the README documents them, the
# generated migration's header tells a developer to type two of them, and ci/db runs the
# third.
for mode in check write vendor; do
  check_contains "$VERB" "\"--$mode\"" "the verb accepts --$mode"
done

# --help prints the header, and a bare invocation is a usage error rather than a silent
# default — the same contract betterauth-schema.mjs keeps, and for the same reason: the
# default here would either rewrite a migration or reach the network.
help_output=$(node "$VERB" --help 2>&1)
check_matches "$help_output" 'price-catalog.mjs' '--help prints the header'
check_matches "$help_output" 'no network access at runtime' 'which states the rule the whole design rests on'

node "$VERB" >/dev/null 2>&1
check_equals '2' "$?" 'and a bare invocation is a usage error rather than a default action'

node "$VERB" --nonsense >/dev/null 2>&1
check_equals '2' "$?" 'an unknown argument is refused'

node "$VERB" --check --commit deadbeef >/dev/null 2>&1
check_equals '2' "$?" 'and --commit is refused anywhere but --vendor, where it pins the snapshot'

# Only --vendor may fetch. If `fetch` ever appears in a code path the other two modes
# reach, a migration-time download is one refactor away — so the rule is asserted on the
# file rather than trusted to the reader.
check_contains "$VERB" 'async function vendor' 'the network is reached from one function'
check_absent "$VERB" 'function renderMigration.*fetch' 'and the rendering path does not call it'

# ---------------------------------------------------------------------------
# The vendored extract
# ---------------------------------------------------------------------------

printf '\nThe vendored extract\n'

check_exists "$EXTRACT" 'catalog/litellm-model-prices.json is committed, so a migration needs no network'
check_exists "$LICENCE" 'and the licence it came under is committed beside it'
check_contains "$LICENCE" 'MIT License' 'which is MIT, as the migration header claims'

check_run 'the extract is valid JSON' node -e "JSON.parse(require('fs').readFileSync('$EXTRACT','utf8'))"

# Provenance, field by field, because "pinned" is the whole claim: a snapshot that cannot
# be fetched again is not a pin, it is a copy of unknown age.
provenance=$(node -e "
  const {provenance} = JSON.parse(require('fs').readFileSync('$EXTRACT', 'utf8'));
  console.log([provenance.repository, provenance.commit, provenance.commit_date,
               provenance.catalog_version, provenance.transform].join(' '));
")
check_matches "$provenance" 'BerriAI/litellm' 'the extract names the repository it came from'
check_matches "$provenance" '[0-9a-f]{40}' 'and the full commit it was taken at'
check_matches "$provenance" '[0-9]{4}-[0-9]{2}-[0-9]{2}T' 'and when that commit was made'
check_matches "$provenance" '[0-9]{4}-[0-9]{2}-[0-9]{2}\+litellm\.[0-9a-f]{7}' 'and the catalog_version every row it renders is stamped with'
check_matches "$provenance" 'price-catalog\.mjs' 'and the transform that produced it'

# ---------------------------------------------------------------------------
# The generated migration
# ---------------------------------------------------------------------------

printf '\nThe generated migration\n'

check_exists "$CATALOG_MIGRATION" 'migrations/R__model_price_catalog.sql is committed'
check_contains "$CATALOG_MIGRATION" 'Generated. Do not edit' 'and says it is generated'
check_contains "$CATALOG_MIGRATION" 'price-catalog\.mjs --write' 'and how to re-render it'
check_contains "$CATALOG_MIGRATION" '[0-9a-f]{40}' 'and records the pinned upstream commit'
check_contains "$CATALOG_MIGRATION" 'licensed MIT' 'and the licence it is used under'
check_contains "$CATALOG_MIGRATION" 'select ouroboros\.import_model_price_catalog\(' 'and consists of the import call V012 defines'

# The one thing a generated SQL file must not contain. `${…}` is a Flyway placeholder:
# with substitution on — which flyway.toml states explicitly — a model identifier
# containing one would be replaced, or would fail the migration outright.
check_absent "$CATALOG_MIGRATION" '\$\{' 'and carries no ${…}, which Flyway would substitute'

# The acceptance criterion, and the same command ci/db runs: the committed migration is
# what the committed extract renders. It catches a hand-edited price, and an extract that
# moved without being re-rendered.
check_run 'the committed migration is exactly what the extract renders (--check)' \
  node "$VERB" --check

# What it calls has to exist, and to be versioned rather than generated: the logic lives in
# V012 so a snapshot bump is a diff of numbers.
check_exists "$SCHEMA_MIGRATION" 'V012__model_prices.sql is what defines the function it calls'
check_contains "$SCHEMA_MIGRATION" 'create function ouroboros\.import_model_price_catalog' 'and creates it'
check_contains "$SCHEMA_MIGRATION" 'create function ouroboros\.model_price' 'and the lookup the read path resolves prices through'

# Repeatable, and named to say so. A `V###` here would apply once and never see a newer
# snapshot; the name is also what orders it, and Flyway applies repeatable migrations after
# every versioned one, so V012 exists by the time this runs.
check_matches "$(basename "$CATALOG_MIGRATION")" '^R__[a-z0-9_]+\.sql$' 'it is a repeatable migration, named by the rule flyway.toml enforces'

# ---------------------------------------------------------------------------
# The documentation
# ---------------------------------------------------------------------------

printf '\nThe documentation\n'

check_contains "$README" 'price-catalog\.mjs' 'the README documents the verb'
check_contains "$README" 'model_prices' 'and the table it fills'

check_summary
