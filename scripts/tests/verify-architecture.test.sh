#!/usr/bin/env sh
#
# verify-architecture.test.sh — integration tests for scripts/verify-architecture.sh.
#
# The script is run against synthetic repository trees rather than this checkout, so the
# tests pin the contract independently of the document that currently satisfies it: the
# fixture is a minimal tree that passes every check, and each case copies it, breaks
# exactly one thing, and asserts that the matching check — and the run — fails.
#
# The committed docs/ARCHITECTURE.md is exercised once at the end, which is what proves
# the two agree.
#
# Usage:
#   scripts/tests/verify-architecture.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
VERIFY="$SCRIPTS_DIR/verify-architecture.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# make_fixture DIR — write a repository tree that satisfies every check.
#
# Deliberately the smallest document that can: one of each required section, one mermaid
# diagram, the four ports, the four invariants, two environment variables, and one link of
# every kind the verifier distinguishes.
make_fixture() {
  fixture=$1
  mkdir -p "$fixture/docs"

  cat > "$fixture/docs/ARCHITECTURE.md" <<'DOC'
# Fixture — architecture

Conventions live in [CONVENTIONS.md](CONVENTIONS.md); the entry point is the
[root README](../README.md). The rules are in [the invariants](#invariants), and
[an external page](https://example.com/nothing-here) is nobody's business but its own.

## The system at a glance

```mermaid
flowchart LR
    UI --> REST --> DB
```

| Service | Port |
|---|---|
| `ouroboros-ui` | 3000 |
| `ouroboros-rest` | 4000 |
| `ouroboros-engine` | 8000 |
| `ouroboros-db` | 5432 |

Every service reads its listen port from the unprefixed PORT.

## Modules

One paragraph per module.

## Request paths

How a request travels.

## Authentication, sessions and tenant context

How signing in works.

## The API contracts

Generated from OpenAPI; the exported openapi.json is committed.

## Configuration

| Variable | Purpose |
|---|---|
| `OURO_DB_USER` | The role that owns the database |
| `OURO_LOG_LEVEL` | Log verbosity |

## Environments

Local development, CI, deployment.

## Invariants

1. The UI never touches the database or the engine.
2. Flyway owns all DDL.
3. The engine is internal.
4. Tenancy is enforced in one place.

## Trust boundaries

What crosses which boundary.

## Keeping this document true

A change to the system updates this document.
DOC

  cat > "$fixture/docs/CONVENTIONS.md" <<'DOC'
# Fixture conventions
DOC

  cat > "$fixture/README.md" <<'DOC'
# Fixture
DOC

  cat > "$fixture/.env.example" <<'ENV'
# The role that owns the database.
OURO_DB_USER=ouroboros

# Log verbosity.
OURO_LOG_LEVEL=info
ENV
}

# run_verify DIR [ARG...] — run the script, leaving combined output in $out and the exit
# status in $status.
run_verify() {
  out=$("$VERIFY" --root "$@" 2>&1)
  status=$?
}

# check_break DESCRIPTION PATTERN MUTATION — build a fresh fixture in $root, apply the
# MUTATION snippet to it, and assert the run fails reporting PATTERN.
check_break() {
  description=$1
  pattern=$2
  mutation=$3

  root="$work/case"
  rm -rf "$root"
  make_fixture "$root"
  eval "$mutation"

  run_verify "$root"
  if [ "$status" -ne 0 ] && printf '%s\n' "$out" | grep -Eq -- "^  FAIL .*$pattern"; then
    pass "$description"
  else
    fail "$description (status $status, no FAIL matching /$pattern/)"
  fi
}

printf '\nverify-architecture.sh\n\n'

# ---------------------------------------------------------------------------
# The passing baseline
# ---------------------------------------------------------------------------

printf 'A conforming tree\n'

good="$work/good"
make_fixture "$good"
run_verify "$good"
check_equals 0 "$status" 'a conforming tree passes'
check_matches "$out" '0 failed' 'a conforming tree reports no failures'
check_matches "$out" 'Architecture documentation' 'the report names what it checked'
# An external link is somebody else's uptime problem, so it must not be resolved as a
# path — the fixture's points at one that does not exist, and the run still passes.
if printf '%s\n' "$out" | grep -q 'example\.com'; then
  fail 'an external link is not checked as a file (it was)'
else
  pass 'an external link is not checked as a file'
fi

# ---------------------------------------------------------------------------
# The document and its sections
# ---------------------------------------------------------------------------

printf '\nDocument violations\n'

check_break 'a missing document is reported' \
  'docs/ARCHITECTURE\.md exists' \
  'rm "$root/docs/ARCHITECTURE.md"'

check_break 'a document without an architecture title is reported' \
  'opens with an architecture title' \
  'sed -i "1s|.*|# Fixture|" "$root/docs/ARCHITECTURE.md"'

check_break 'a missing system diagram section is reported' \
  'the system diagram has a section' \
  'sed -i "s|^## The system at a glance|## Overview|" "$root/docs/ARCHITECTURE.md"'

check_break 'a missing auth section is reported' \
  'the auth and session flow has a section' \
  'sed -i "s|^## Authentication.*|## Sign-in|" "$root/docs/ARCHITECTURE.md"'

check_break 'a missing trust-boundary section is reported' \
  'the trust boundaries have a section' \
  'sed -i "s|^## Trust boundaries|## Security|" "$root/docs/ARCHITECTURE.md"'

check_break 'a missing maintenance section is reported' \
  'the maintenance rule has a section' \
  'sed -i "s|^## Keeping this document true|## Notes|" "$root/docs/ARCHITECTURE.md"'

check_break 'a contract section that never names the exported spec is reported' \
  'names the exported spec' \
  'sed -i "s|openapi\.json|the spec|" "$root/docs/ARCHITECTURE.md"'

# ---------------------------------------------------------------------------
# Diagrams
# ---------------------------------------------------------------------------

printf '\nDiagram violations\n'

check_break 'a diagram that is not tagged mermaid is reported' \
  'carries at least one mermaid diagram' \
  'sed -i "s|^\`\`\`mermaid$|\`\`\`|" "$root/docs/ARCHITECTURE.md"'

check_break 'an unclosed code fence is reported' \
  'every code fence is closed' \
  'printf "\n\`\`\`\nunterminated\n" >> "$root/docs/ARCHITECTURE.md"'

# ---------------------------------------------------------------------------
# Port map
# ---------------------------------------------------------------------------

printf '\nPort map violations\n'

check_break 'a missing engine port is reported' \
  'gives ouroboros-engine port 8000' \
  'sed -i "/ouroboros-engine/d" "$root/docs/ARCHITECTURE.md"'

check_break 'a port that has drifted from the conventions is reported' \
  'gives ouroboros-rest port 4000' \
  'sed -i "/ouroboros-rest/s@4000@4100@" "$root/docs/ARCHITECTURE.md"'

check_break 'a document that never mentions the unprefixed PORT is reported' \
  'names the unprefixed PORT variable' \
  'sed -i "/unprefixed PORT/d" "$root/docs/ARCHITECTURE.md"'

# ---------------------------------------------------------------------------
# Environment registry
# ---------------------------------------------------------------------------

printf '\nEnvironment registry violations\n'

check_break 'a missing template is reported' \
  '\.env\.example exists' \
  'rm "$root/.env.example"'

check_break 'a variable the template declares but the document omits is reported' \
  'documents OURO_SESSION_SECRET' \
  'printf "\n# The session signing key.\nOURO_SESSION_SECRET=dev-secret\n" >> "$root/.env.example"'

check_break 'a variable the document invents is reported' \
  'declares the documented OURO_PHANTOM_URL' \
  'printf "\nSet OURO_PHANTOM_URL to nothing at all.\n" >> "$root/docs/ARCHITECTURE.md"'

check_break 'a template that does not parse is reported' \
  'declares the documented OURO_DB_USER' \
  'printf "OURO_DB_USER=twice\n" >> "$root/.env.example"'

# ---------------------------------------------------------------------------
# Architectural invariants
# ---------------------------------------------------------------------------

printf '\nInvariant violations\n'

check_break 'a dropped UI-boundary invariant is reported' \
  'invariant 1' \
  'sed -i "/never touches the database/d" "$root/docs/ARCHITECTURE.md"'

check_break 'a dropped DDL-ownership invariant is reported' \
  'invariant 2' \
  'sed -i "/Flyway owns all DDL/d" "$root/docs/ARCHITECTURE.md"'

check_break 'a dropped engine-is-internal invariant is reported' \
  'invariant 3' \
  'sed -i "/The engine is internal/d" "$root/docs/ARCHITECTURE.md"'

check_break 'a dropped tenancy invariant is reported' \
  'invariant 4' \
  'sed -i "/Tenancy is enforced in one place/d" "$root/docs/ARCHITECTURE.md"'

# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------

printf '\nLink violations\n'

check_break 'a link to a file that does not exist is reported' \
  'the link to MISSING\.md resolves' \
  'sed -i "s|(CONVENTIONS\.md)|(MISSING.md)|" "$root/docs/ARCHITECTURE.md"'

check_break 'a link to a deleted file is reported' \
  'the link to \.\./README\.md resolves' \
  'rm "$root/README.md"'

check_break 'an anchor with no matching heading is reported' \
  'the anchor #nowhere resolves to a heading' \
  'sed -i "s|(#invariants)|(#nowhere)|" "$root/docs/ARCHITECTURE.md"'

# A `#` inside a fenced block is a comment, not a heading, so it must not satisfy an
# anchor — which is what makes the fence tracking in the slug reader load-bearing.
check_break 'an anchor pointing into a code block is reported' \
  'the anchor #not-a-heading resolves to a heading' \
  'printf "\n[link](#not-a-heading)\n\n\`\`\`sh\n# Not a heading\n\`\`\`\n" >> "$root/docs/ARCHITECTURE.md"'

# An anchor carried by a file link is stripped before the file is checked, so a valid
# file with a section reference still passes.
root="$work/anchored"
rm -rf "$root"
make_fixture "$root"
sed -i "s|(CONVENTIONS\.md)|(CONVENTIONS.md#some-section)|" "$root/docs/ARCHITECTURE.md"
run_verify "$root"
check_equals 0 "$status" 'a file link carrying an anchor resolves to the file'

# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

printf '\nCommand line\n'

out=$("$VERIFY" --help 2>&1)
status=$?
check_equals 0 "$status" '--help exits zero'
check_matches "$out" 'Usage:' '--help prints the usage'

out=$("$VERIFY" --nonsense 2>&1)
status=$?
check_equals 2 "$status" 'an unknown argument exits 2'

out=$("$VERIFY" --root 2>&1)
status=$?
check_equals 2 "$status" '--root without a directory exits 2'

# ---------------------------------------------------------------------------
# This repository
# ---------------------------------------------------------------------------

printf '\nThis checkout\n'

REPO_ROOT=$(dirname -- "$SCRIPTS_DIR")
run_verify "$REPO_ROOT"
check_equals 0 "$status" 'the committed tree satisfies every check'
check_matches "$out" 'documents OURO_DATABASE_URL' 'the committed registry covers the real template'

check_summary
