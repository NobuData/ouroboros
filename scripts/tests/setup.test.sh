#!/usr/bin/env sh
#
# setup.test.sh — integration tests for scripts/setup.sh.
#
# Every case runs the real script with `--root` pointed at a fixture checkout built in a
# temporary directory, so nothing here touches the developer's own `.env` files — which
# is the same reason the script has that flag at all.
#
# The fixture is three templates rather than a copy of the repository's: two modules that
# both declare OURO_ENGINE_SHARED_SECRET, which is the pair whose two halves have to hold
# the same value, plus a module directory with no template that must therefore end up
# with no file. Copying the real templates would tie these tests to whatever variables
# the modules happen to read this month, and the properties being asserted are not about
# any particular variable.
#
# The last section runs against the real checkout, in --dry-run, to catch the one thing a
# fixture cannot: this repository's own templates having drifted out of the shape the
# script reads.
#
# Usage:
#   scripts/tests/setup.test.sh   # or scripts/run-tests.sh for the whole suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$SCRIPTS_DIR")
SETUP="$SCRIPTS_DIR/setup.sh"
VALIDATOR="$SCRIPTS_DIR/lib/parse-env-example.awk"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

REPO="$work/repo"

# fixture — build a clean checkout to set up.
#
# A root template carrying a database port, a connection string that repeats it, a shared
# secret and a credential no script can invent; two modules, both declaring that same
# secret; and ouroboros-web, which has no template because it reads no environment.
fixture() {
  rm -rf "$REPO"
  mkdir -p "$REPO/ouroboros-alpha" "$REPO/ouroboros-beta" "$REPO/ouroboros-web"

  cat > "$REPO/.env.example" <<'EOF'
# Ouroboros — environment template.

# Host port the database is published on.
OURO_DB_PORT=5432

# Connection string. Keep it consistent with the port above.
OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros

# Shared secret for the internal call. Both sides must carry the same value.
OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me

# A credential that has to be registered by hand.
OURO_GITHUB_CLIENT_ID=dev-github-client-id
EOF

  cat > "$REPO/ouroboros-alpha/.env.example" <<'EOF'
# The other half of the internal call.
OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me

# Log verbosity.
OURO_LOG_LEVEL=info
EOF

  cat > "$REPO/ouroboros-beta/.env.example" <<'EOF'
# Connection string.
OURO_DATABASE_URL=postgresql://ouroboros:ouroboros@localhost:5432/ouroboros

# The same secret again.
OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me
EOF
}

# run_setup ARGS… — run the script over the fixture, leaving its combined output in $out
# and the exit status in $status.
run_setup() {
  out=$("$SETUP" --root "$REPO" "$@" 2>&1)
  status=$?
}

# value_of FILE NAME — the value FILE assigns to NAME.
value_of() {
  awk -v want="$2" '
    /^[A-Z][A-Z0-9_]*=/ {
      eq = index($0, "=")
      if (substr($0, 1, eq - 1) == want) { print substr($0, eq + 1); exit }
    }
  ' "$1" 2>/dev/null
}

printf '\nsetup.sh\n\n'

# ---------------------------------------------------------------------------
# A first-time checkout
# ---------------------------------------------------------------------------

printf 'First run\n'

fixture
run_setup
check_equals 0 "$status" 'a clean checkout is set up without error'
check_exists "$REPO/.env" 'the repo-root .env is created'
check_exists "$REPO/ouroboros-alpha/.env" "ouroboros-alpha's .env is created"
check_exists "$REPO/ouroboros-beta/.env" "ouroboros-beta's .env is created"
# The module that reads no environment must not acquire a file to wonder about.
check_missing "$REPO/ouroboros-web/.env" 'a module with no template gets no .env'

check_contains "$REPO/.env" '^# Host port the database is published on\.$' \
  'the prose above each variable is kept — it is what says how to edit the file'
check_contains "$REPO/.env" '^OURO_DB_PORT=5432$' 'a value nobody overrode keeps the documented default'
check_absent "$REPO/.env" 'change-me' 'no placeholder survives into the root .env'
check_absent "$REPO/ouroboros-alpha/.env" 'change-me' "nor into a module's"

# The credential the script cannot invent is left exactly as documented, rather than
# replaced by a random value that would look configured and authenticate to nothing.
check_contains "$REPO/.env" '^OURO_GITHUB_CLIENT_ID=dev-github-client-id$' \
  'a credential that has to be registered by hand is left as the template has it'

printf '\nGenerated secrets\n'

root_secret=$(value_of "$REPO/.env" OURO_ENGINE_SHARED_SECRET)
alpha_secret=$(value_of "$REPO/ouroboros-alpha/.env" OURO_ENGINE_SHARED_SECRET)
beta_secret=$(value_of "$REPO/ouroboros-beta/.env" OURO_ENGINE_SHARED_SECRET)

# The property the whole script exists for: this secret is compared between two services,
# and two independently generated values is a stack that 401s every internal call.
check_equals "$root_secret" "$alpha_secret" 'the root and the first module share one secret'
check_equals "$root_secret" "$beta_secret" 'the root and the second module share it too'
check_matches "$root_secret" '^.{16,}$' 'the generated secret clears the 16-character minimum'
check_not_matches "$root_secret" 'change-me' 'and is not the placeholder with a suffix trimmed'
# It has to survive a `.env` unquoted: whitespace, `#` or a quote in the value would be
# read as something other than what was generated.
check_not_matches "$root_secret" '[[:space:]"'"'"'#]' 'the secret carries nothing a .env reader would mangle'

printf '\nWhat the services will read\n'

for file in "$REPO/.env" "$REPO/ouroboros-alpha/.env" "$REPO/ouroboros-beta/.env"; do
  check_run "${file#"$REPO"/} parses as the loaders read it" \
    awk -v template=0 -f "$VALIDATOR" "$file"
done

# The generated files hold signing keys, so a default umask must not publish them.
for file in "$REPO/.env" "$REPO/ouroboros-alpha/.env"; do
  mode=$(ls -l "$file" | cut -c 1-10)
  check_matches "$mode" '^-rw-------$' "${file#"$REPO"/} is created readable only by its owner"
done

# ---------------------------------------------------------------------------
# Re-running
# ---------------------------------------------------------------------------

printf '\nRe-running\n'

# An existing .env is a developer's own file: it may hold a real OAuth application or a
# password for a database somebody else runs, and none of that is recoverable from what
# is committed.
printf '\n# edited by hand\nOURO_DB_PORT=45432\n' >> "$REPO/.env"
before=$(cat "$REPO/.env")
run_setup
check_equals 0 "$status" 'a second run over a complete checkout succeeds'
check_equals "$before" "$(cat "$REPO/.env")" 'an existing .env is left byte for byte alone'
check_matches "$out" 'keep .*\.env' 'and is reported as kept rather than silently passed over'

# The case that would otherwise split a pair of secrets: one file is gone, the other still
# holds the value both sides were configured with.
rm "$REPO/ouroboros-alpha/.env"
run_setup
check_equals 0 "$status" 'a run that completes a half-configured checkout succeeds'
check_equals "$root_secret" "$(value_of "$REPO/ouroboros-alpha/.env" OURO_ENGINE_SHARED_SECRET)" \
  'the recreated file adopts the secret still in the files around it'
check_matches "$out" 'kept from a file that was already here' 'and says that it did'

printf '\n--force\n'

run_setup --force
check_equals 0 "$status" '--force succeeds'
check_absent "$REPO/.env" 'edited by hand' 'it replaces a file that was edited by hand'
check_equals "$root_secret" "$(value_of "$REPO/.env" OURO_ENGINE_SHARED_SECRET)" \
  'and still keeps the secret, because --force means rewrite, not rotate'

printf '\n--dry-run\n'

fixture
run_setup --dry-run
check_equals 0 "$status" '--dry-run succeeds'
check_missing "$REPO/.env" '--dry-run writes nothing'
check_matches "$out" 'would add' 'and reports what it would have written'

# A preview that promised a file it would then have failed to write would be worth
# nothing as a preflight, so the render and the check both happen either way.
fixture
printf '\n# A name the conventions do not allow.\nUNPREFIXED=value\n' >> "$REPO/.env.example"
run_setup --dry-run
check_equals 1 "$status" 'a template the services could not read fails the preview'
check_matches "$out" 'FAIL' 'and names the file it would have failed on'
check_missing "$REPO/.env" 'and still writes nothing'

run_setup
check_equals 1 "$status" 'the real run fails on it too'
check_missing "$REPO/.env" 'leaving no half-written file behind'

# ---------------------------------------------------------------------------
# --db-port
# ---------------------------------------------------------------------------

printf '\n--db-port\n'

fixture
run_setup --db-port 55433
check_equals 0 "$status" '--db-port succeeds'
check_equals '55433' "$(value_of "$REPO/.env" OURO_DB_PORT)" 'the published port is the one asked for'
# The two are separate variables in separate files and nothing derives one from the
# other, which is exactly why moving the port by hand goes wrong.
check_equals 'postgresql://ouroboros:ouroboros@localhost:55433/ouroboros' \
  "$(value_of "$REPO/.env" OURO_DATABASE_URL)" 'the connection string is moved with it'
check_equals 'postgresql://ouroboros:ouroboros@localhost:55433/ouroboros' \
  "$(value_of "$REPO/ouroboros-beta/.env" OURO_DATABASE_URL)" "and so is the module's copy of it"
check_contains "$REPO/.env" '^OURO_GITHUB_CLIENT_ID=dev-github-client-id$' \
  'nothing else in the file moves with the port'

# ---------------------------------------------------------------------------
# Usage errors
# ---------------------------------------------------------------------------

printf '\nUsage\n'

run_setup --db-port not-a-port
check_equals 2 "$status" 'a non-numeric --db-port is a usage error'
run_setup --nonsense
check_equals 2 "$status" 'an unknown argument is a usage error'
run_setup --db-port
check_equals 2 "$status" 'a --db-port with no value is a usage error'

out=$("$SETUP" --help 2>&1)
status=$?
check_equals 0 "$status" '--help succeeds'
check_matches "$out" '^Usage: scripts/setup\.sh' 'and prints the usage'

rm -rf "$REPO"
mkdir -p "$REPO"
run_setup
check_equals 1 "$status" 'a directory with no template at all is an error, not a silent success'
check_matches "$out" 'no \.env\.example found' 'and says so'

# ---------------------------------------------------------------------------
# This repository's own templates
# ---------------------------------------------------------------------------

# The one thing the fixture cannot answer: whether the real templates are still the shape
# this script reads. --dry-run, so a developer's own .env files are neither read for
# secrets nor written.
printf '\nThe real checkout\n'

out=$("$SETUP" --root "$REPO_ROOT" --dry-run 2>&1)
status=$?
check_equals 0 "$status" 'the committed templates render without error'
for template in "$REPO_ROOT"/.env.example "$REPO_ROOT"/ouroboros-*/.env.example; do
  [ -f "$template" ] || continue
  target=${template%.example}
  target=${target#"$REPO_ROOT"/}
  # Either verb: whether the file is reported as one to write or one to keep depends on
  # what the developer running the suite already has, and both mean it was accounted for.
  check_matches "$out" "(would add|keep) +$(printf '%s' "$target" | sed 's/\./\\./g')( |$)" \
    "$target is accounted for"
done

check_summary
