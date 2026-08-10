#!/usr/bin/env sh
#
# verify-architecture.sh — assert the architecture document established by issue #12.
#
# docs/ARCHITECTURE.md describes the shape of the system: the modules, the ports, the
# boundaries, the environment registry. Prose goes stale quietly, so the parts of it a
# script can hold to account are held to account here: that the required sections exist,
# that the diagrams are fenced as `mermaid` so GitHub renders them, that the port map
# names every service with its port, that all four architectural invariants are stated,
# that every relative link resolves to something in the checkout and every in-document
# anchor to a real heading, and — the acceptance criterion of #12 — that the document and
# .env.example declare exactly the same set of OURO_* variables.
#
# The last check runs in both directions on purpose. A variable in the template that the
# document omits is one a developer cannot understand; a variable in the document that the
# template omits is one they cannot set. Unprefixed platform standards (PORT, NODE_ENV)
# are documented but not declared in the template, so only OURO_* names are compared.
#
# It reads files and starts nothing, matching the repo's other verify-* scripts, so it
# runs identically on a laptop and in CI with no install step.
#
# Usage:
#   scripts/verify-architecture.sh              # run from anywhere; resolves the repo root
#   scripts/verify-architecture.sh --root DIR   # check DIR instead (used by the tests)
#
# Exit status:
#   0  every check passed
#   1  at least one check failed (each failure is printed with its reason)

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")

while [ $# -gt 0 ]; do
  case $1 in
    --root)
      [ $# -ge 2 ] || { printf 'verify-architecture: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$2" && pwd)
      shift 2
      ;;
    -h | --help)
      sed -n '2,27p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'verify-architecture: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# The assertion harness, shared with the repo's other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

DOC=docs/ARCHITECTURE.md
ENV_EXAMPLE=.env.example
PARSER="$SCRIPT_DIR/lib/parse-env-example.awk"

printf '\nArchitecture documentation — %s\n\n' "$ROOT"

# ---------------------------------------------------------------------------
# The document and its sections
# ---------------------------------------------------------------------------

printf 'Document\n'
check_exists "$DOC" "$DOC exists"
check_contains "$DOC" '^# .*[Aa]rchitecture' "$DOC opens with an architecture title"

printf '\nRequired sections\n'
# Matched on their subject rather than their number, so the document can be renumbered
# without the contract moving. Each one answers a question #12 asked the document to
# answer, in the order the issue asked it.
check_contains "$DOC" '^#+ .*[Ss]ystem at a glance' 'the system diagram has a section'
check_contains "$DOC" '^#+ .*[Mm]odules' 'module responsibilities have a section'
check_contains "$DOC" '^#+ .*[Rr]equest paths' 'the request paths have a section'
check_contains "$DOC" '^#+ .*[Aa]uthentication' 'the auth and session flow has a section'
check_contains "$DOC" '^#+ .*[Cc]ontracts' 'the API contracts have a section'
check_contains "$DOC" '^#+ .*[Cc]onfiguration' 'the environment registry has a section'
check_contains "$DOC" '^#+ .*[Ee]nvironments' 'the environments have a section'
check_contains "$DOC" '^#+ .*[Ii]nvariants' 'the architectural invariants have a section'
check_contains "$DOC" '^#+ .*[Tt]rust boundaries' 'the trust boundaries have a section'
check_contains "$DOC" '^#+ .*[Kk]eeping this document true' 'the maintenance rule has a section'

# The OpenAPI contract flow is decision D4 and the reason the UI has no hand-written
# types; naming it is what makes the section traceable back to the decision.
check_contains "$DOC" 'OpenAPI' 'the contract section names OpenAPI'
check_contains "$DOC" 'openapi\.json' 'the contract section names the exported spec'

# ---------------------------------------------------------------------------
# Diagrams
# ---------------------------------------------------------------------------

printf '\nDiagrams\n'
# GitHub renders a fenced block only when it is tagged `mermaid`, so an untagged diagram
# ships as unreadable source — which is the failure mode this catches.
mermaid_blocks=$(grep -c '^```mermaid$' "$DOC" 2>/dev/null || true)
if [ "${mermaid_blocks:-0}" -gt 0 ]; then
  pass "$DOC carries $mermaid_blocks mermaid diagram(s)"
else
  fail "$DOC carries at least one mermaid diagram (none found)"
fi

# An unclosed fence swallows the rest of the page into a code block.
fences=$(grep -c '^```' "$DOC" 2>/dev/null || true)
if [ "$((${fences:-0} % 2))" -eq 0 ]; then
  pass 'every code fence is closed'
else
  fail "every code fence is closed (odd number of fences: $fences)"
fi

# ---------------------------------------------------------------------------
# Port map
# ---------------------------------------------------------------------------

printf '\nPort map\n'
# The development defaults from docs/CONVENTIONS.md § 4. A module and its port have to
# appear on the same line, which is what a table row is.
for pair in ouroboros-ui:3000 ouroboros-rest:4000 ouroboros-engine:8000 ouroboros-db:5432; do
  module=${pair%:*}
  port=${pair#*:}
  check_contains "$DOC" "$module.*$port" "the port map gives $module port $port"
done
# PORT is the one variable that is deliberately unprefixed, so the document has to say so.
check_contains "$DOC" 'PORT' 'the port map names the unprefixed PORT variable'

# ---------------------------------------------------------------------------
# Environment registry
# ---------------------------------------------------------------------------

printf '\nEnvironment registry\n'
check_exists "$ENV_EXAMPLE" "$ENV_EXAMPLE exists"

# Declared names, one per line. Empty when the template is missing or invalid, in which
# case every documented variable is reported as undeclared — which is the honest result.
declared=$(awk -f "$PARSER" "$ENV_EXAMPLE" 2>/dev/null | cut -f 1 | grep '^OURO_' | sort -u || true)
documented=$(grep -oE 'OURO_[A-Z0-9_]+' "$DOC" 2>/dev/null | sort -u || true)

for name in $declared; do
  if printf '%s\n' "$documented" | grep -qx -- "$name"; then
    pass "$DOC documents $name"
  else
    fail "$DOC documents $name (declared in $ENV_EXAMPLE, undocumented)"
  fi
done

for name in $documented; do
  if printf '%s\n' "$declared" | grep -qx -- "$name"; then
    pass "$ENV_EXAMPLE declares the documented $name"
  else
    fail "$ENV_EXAMPLE declares the documented $name (documented, undeclared)"
  fi
done

# ---------------------------------------------------------------------------
# Architectural invariants
# ---------------------------------------------------------------------------

printf '\nArchitectural invariants\n'
# The four properties of docs/CONVENTIONS.md § 10. This document is where a change to one
# of them has to be argued, so all four have to be written down here to be argued with.
check_contains "$DOC" '[Tt]he UI never touches the database or the engine' \
  'invariant 1 — the UI never touches the database or the engine'
check_contains "$DOC" '[Ff]lyway owns all DDL' \
  'invariant 2 — Flyway owns all DDL'
check_contains "$DOC" '[Tt]he engine is internal' \
  'invariant 3 — the engine is internal'
check_contains "$DOC" '[Tt]enancy is enforced in one place' \
  'invariant 4 — tenancy is enforced in one place'

# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------

printf '\nLinks\n'
# Every relative link resolves to something in the checkout and every anchor to a real
# heading; external links are left to the internet. Shared with the repo's other document
# checks, so both hold links to the same standard.
check_markdown_links "$DOC"

check_summary
