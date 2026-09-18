#!/usr/bin/env sh
#
# verify-runner-protocol.sh — assert the runner protocol's three halves still agree.
#
# The protocol (issue #243) is one contract written down in three places, on purpose:
#
#   docs/RUNNER_PROTOCOL.md               the prose, the reasoning, a worked example
#   schemas/runner-protocol/v1.json       the machine-readable schema
#   schemas/runner-protocol/fixtures/     the golden documents, and expected.json:
#                                         the verdict every implementation must produce
#
# It is written that way because the two implementations are in different languages and
# different work streams — a Go agent (#244) and a TypeScript gateway (#251), plus a
# TypeScript fake agent (#255) — and neither may become the specification by being
# written first.
#
# Three files is also three places to drift, and the drift is the dangerous kind: a
# document that no longer matches the schema is the one a reader trusts, and a message
# type with no case is one both implementations are free to disagree about — which would
# show up as a PASSING suite on both sides. So the agreement is checked from the
# checkout rather than trusted:
#
#   * every message type in the schema has a section in the document, a worked example
#     in fixtures/valid/, and a case in expected.json;
#   * every example block in the document is byte-identical, whitespace aside, to the
#     fixture it names;
#   * every committed fixture is named by a case or a transcript, so a file nobody
#     asserts against cannot accumulate;
#   * every frame a transcript references exists;
#   * every diagnostic code the schema defines is documented and implemented;
#   * the published limits agree across the schema, the document and the Go constants.
#
# What it does NOT do is validate a fixture against the schema — that needs a JSON
# Schema engine, and it is what each implementation's own suite does
# (ouroboros-runner/internal/conn/protocol_test.go today). This answers the question
# that is invisible until it is wrong: whether the three halves are still describing the
# same protocol.
#
# Deliberately dependency-free POSIX shell, matching the repo's other verify-* scripts.
#
# Usage:
#   scripts/verify-runner-protocol.sh              # run from anywhere
#   scripts/verify-runner-protocol.sh --root DIR   # check DIR instead (used by the tests)
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
      [ $# -ge 2 ] || { printf 'verify-runner-protocol: --root needs a directory\n' >&2; exit 2; }
      ROOT=$(cd -- "$2" && pwd)
      shift 2
      ;;
    -h | --help)
      sed -n '2,47p' "$0" | cut -c 3-
      exit 0
      ;;
    *)
      printf 'verify-runner-protocol: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# The assertion harness, shared with the repo's other verify-* scripts.
. "$SCRIPT_DIR/lib/checks.sh"

DOC=docs/RUNNER_PROTOCOL.md
SCHEMA=schemas/runner-protocol/v1.json
FIXTURES=schemas/runner-protocol/fixtures
EXPECTED="$FIXTURES/expected.json"
MODULE=ouroboros-runner
GO_PROTOCOL="$MODULE/internal/conn/protocol.go"

printf '\nRunner protocol — %s\n\n' "$ROOT"

# ---------------------------------------------------------------------------
# The three halves exist at all
# ---------------------------------------------------------------------------

printf 'The contract\n'
check_exists "$DOC" "$DOC exists"
check_exists "$SCHEMA" "$SCHEMA exists"
check_exists "$EXPECTED" "$EXPECTED exists"
check_exists "$FIXTURES/valid" "$FIXTURES/valid/ exists"
check_exists "$FIXTURES/invalid" "$FIXTURES/invalid/ exists"
check_exists "$FIXTURES/sessions" "$FIXTURES/sessions/ exists"

# A published artifact carries an $id, which is what makes it citable from outside this
# repository at all (docs/CONVENTIONS.md § 1, schemas/README.md).
check_contains "$SCHEMA" '"\$id": "https://ouroboros\.build/schemas/runner-protocol/v1\.json"' \
  'the schema publishes its $id'
check_contains "$SCHEMA" '"\$schema": "https://json-schema\.org/draft/2020-12/schema"' \
  'the schema declares JSON Schema 2020-12'

# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------

# protocol_types — the message type enum, one per line, from the schema's own
# `properties.type`.
#
# The schema is the source for the list rather than the document or the fixture
# directory, because it is the half a machine reads: a type that exists in prose and not
# here is a type no validator has ever heard of.
protocol_types() {
  awk '
    /^    "type": \{/ { inside = 1; next }
    inside && /^    \}/ { inside = 0 }
    inside && match($0, /"[a-z]+(\.[a-z]+)?"/) {
      token = substr($0, RSTART + 1, RLENGTH - 2)
      if (token != "enum" && token != "description") print token
    }
  ' "$SCHEMA" 2>/dev/null || true
}

# diagnostic_codes — the rejection codes the schema defines, one per line.
diagnostic_codes() {
  awk '
    /^    "diagnostic_codes": \{/ { inside = 1; next }
    inside && /^    \}/ { inside = 0 }
    inside && match($0, /"(envelope|payload)\.[a-z._]+"/) {
      print substr($0, RSTART + 1, RLENGTH - 2)
    }
  ' "$SCHEMA" 2>/dev/null || true
}

# published_limit NAME — the value of one entry in the schema's `$defs/limits` const.
published_limit() {
  awk -v want="$1" '
    /^    "limits": \{/ { inside = 1 }
    inside && /^    \}/ { inside = 0 }
    inside && $0 ~ ("\"" want "\": ") {
      value = $0
      sub(/^.*: */, "", value)
      sub(/,?[[:space:]]*$/, "", value)
      print value
      exit
    }
  ' "$SCHEMA" 2>/dev/null || true
}

# go_constant NAME — the value of an untyped constant in the Go protocol package.
go_constant() {
  awk -v want="$1" '
    $1 == want && $2 == "=" { print $3; exit }
  ' "$GO_PROTOCOL" 2>/dev/null || true
}

# doc_example HEADING — the first fenced json block under a `#### ` heading.
#
# It stops at the next `#### ` or `## ` heading, so a section with no block of its own
# reports nothing rather than borrowing the next section's.
doc_example() {
  awk -v heading="$1" '
    $0 == heading { found = 1; next }
    found && (/^#### / || /^## /) { exit }
    found && $0 == "```json" { inblock = 1; next }
    inblock && $0 == "```" { exit }
    inblock { print }
  ' "$DOC" 2>/dev/null || true
}

# squash — read stdin and print it with every space, tab and newline removed.
#
# The comparison is whitespace-insensitive on purpose: the document indents its fenced
# blocks exactly as the fixture is committed, and a check that also asserted the
# indentation would fail on a reflow that changed nothing about the contract.
squash() {
  tr -d ' \t\n'
}

# slug TYPE — the fixture filename stem for a message type: `job.offer` is
# `job-offer.json`, because a dot in a filename reads as an extension.
slug() {
  printf '%s\n' "$1" | tr '.' '-'
}

TYPES=$(protocol_types)
CODES=$(diagnostic_codes)

# ---------------------------------------------------------------------------
# Every message type is described three times
# ---------------------------------------------------------------------------

printf '\nMessage types\n'
# A parser that silently returned nothing would make every loop below vacuous, and a
# report of zero failures over zero types reads exactly like a passing one.
type_count=$(printf '%s\n' "$TYPES" | grep -c . || true)
check_matches "$type_count" '^[1-9][0-9]*$' 'the schema enumerates its message types'

for message_type in $TYPES; do
  stem=$(slug "$message_type")
  fixture="valid/$stem.json"
  heading="#### \`$message_type\`"

  # The document. A type with no section is a type whose reasoning was never written
  # down, and reasoning is the half a second implementer cannot reconstruct.
  if grep -Fqx -- "$heading" "$DOC"; then
    pass "$DOC documents $message_type"
  else
    fail "$DOC documents $message_type (no \`$heading\` heading)"
  fi

  # The worked example.
  check_exists "$FIXTURES/$fixture" "$message_type has a worked example ($fixture)"

  # The verdict. This is the one that stops two implementations quietly disagreeing:
  # expected.json is what both of them assert against.
  if grep -Fq "\"$fixture\"" "$EXPECTED"; then
    pass "$EXPECTED holds a case for $message_type"
  else
    fail "$EXPECTED holds a case for $message_type (nothing names $fixture)"
  fi

  # The Go side. A type in the schema that the agent has no constant for is a frame it
  # would reject as unknown — the same outcome as the type not existing, reached by a route
  # nobody would think to look at.
  if grep -Fq "Type = \"$message_type\"" "$GO_PROTOCOL"; then
    pass "$GO_PROTOCOL carries a constant for $message_type"
  else
    fail "$GO_PROTOCOL carries a constant for $message_type (nothing declares it)"
  fi

  # …and the example in the document is the example in the fixture.
  if [ -f "$FIXTURES/$fixture" ]; then
    documented=$(doc_example "$heading" | squash)
    committed=$(squash < "$FIXTURES/$fixture")
    if [ -z "$documented" ]; then
      fail "$DOC prints the $message_type example (no json block under $heading)"
    elif [ "$documented" = "$committed" ]; then
      pass "$DOC prints the committed $message_type example"
    else
      fail "$DOC prints the committed $message_type example (the block under $heading has drifted from $fixture)"
    fi
  fi
done

# ---------------------------------------------------------------------------
# Every fixture is asserted against
# ---------------------------------------------------------------------------

# The mirror image of the checks above, and it is not redundant. Those ask whether the
# contract covers the protocol; this asks whether anything in the fixture set is
# unreferenced — a document nobody asserts against is a document that can say anything,
# and it looks exactly like coverage.

printf '\nFixture coverage\n'
for directory in valid invalid; do
  for path in "$FIXTURES/$directory"/*.json; do
    [ -f "$path" ] || continue
    name="$directory/$(basename -- "$path")"
    if grep -Fq "\"$name\"" "$EXPECTED"; then
      pass "$EXPECTED names $name"
    else
      fail "$EXPECTED names $name (a fixture nothing asserts against)"
    fi
  done
done

for path in "$FIXTURES/sessions"/*.json; do
  [ -f "$path" ] || continue
  name="sessions/$(basename -- "$path")"
  if grep -Fq "\"$name\"" "$EXPECTED"; then
    pass "$EXPECTED names $name"
  else
    fail "$EXPECTED names $name (a transcript nothing replays)"
  fi

  # A transcript's frames are paths into the fixture set rather than inline copies, so
  # that a transcript cannot drift from the message it replays. That only holds if every
  # path resolves.
  for frame in $(sed -n 's/.*"message": "\([^"]*\)".*/\1/p' "$path"); do
    check_exists "$FIXTURES/$frame" "$name replays a frame that exists ($frame)"
  done
done

# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

printf '\nDiagnostic codes\n'
code_count=$(printf '%s\n' "$CODES" | grep -c . || true)
check_matches "$code_count" '^[1-9][0-9]*$' 'the schema defines its rejection codes'

for code in $CODES; do
  # The document's table is where a second implementation reads what a code MEANS; the
  # Go constants are one implementation of it. A code in the schema and nowhere else is
  # a rejection nobody can produce.
  if grep -Fq -- "$code" "$DOC"; then
    pass "$DOC documents $code"
  else
    fail "$DOC documents $code (the diagnostics table does not name it)"
  fi
  if grep -Fq "\"$code\"" "$GO_PROTOCOL"; then
    pass "$GO_PROTOCOL implements $code"
  else
    fail "$GO_PROTOCOL implements $code (no constant carries it)"
  fi
done

# ---------------------------------------------------------------------------
# The published limits
# ---------------------------------------------------------------------------

# The ceilings are published as NUMBERS in the schema precisely so that both
# implementations construct their boundary cases from one source instead of each copying
# a figure out of a document (expected.json says so, and it is why the two over-limit
# cases are unit tests rather than 44KB fixtures). A copy that is trusted is a copy that
# drifts, so each is checked here too.

printf '\nPublished limits\n'
for pair in protocol:Version envelope_max_bytes:EnvelopeMaxBytes \
  log_chunk_max_bytes:LogChunkMaxBytes log_chunk_max_base64_chars:LogChunkMaxBase64Chars; do
  limit=${pair%:*}
  constant=${pair#*:}

  published=$(published_limit "$limit")
  check_matches "$published" '^[0-9]+$' "the schema publishes $limit"
  check_equals "$published" "$(go_constant "$constant")" \
    "$constant is the $limit the schema publishes"
done

# The document quotes two of them in prose, where a reader will believe them.
check_contains "$DOC" '65536' "$DOC states the frame ceiling"
check_contains "$DOC" '32768' "$DOC states the log chunk ceiling"
check_contains "$DOC" '43692' "$DOC states what that is on the wire"

# ---------------------------------------------------------------------------
# The document's own shape
# ---------------------------------------------------------------------------

printf '\nDocument\n'
# The four things the issue asks this document to settle, each of which a reader has to
# be able to find. They are sections rather than sentences because each one is an
# agreement between two implementations, not a remark.
check_contains "$DOC" '^#+ .*[Ee]nvelope' 'the envelope has a section'
# The `-ing` is deliberate: `[Vv]ersion` alone is satisfied by this document's own title,
# so a check written that way would pass a document that had lost the section entirely.
check_contains "$DOC" '^#+ .*[Vv]ersioning' 'versioning and the floor have a section'
check_contains "$DOC" '^#+ .*[Mm]essages' 'the message reference has a section'
check_contains "$DOC" '^#+ .*[Ii]dempotenc' 'resume and idempotency have a section'
check_contains "$DOC" '^#+ .*[Dd]iagnostics' 'the diagnostics contract has a section'
check_contains "$DOC" '^#+ .*[Kk]eeping this document true' 'the maintenance rule has a section'

# An unclosed fence swallows the rest of the page into a code block — and this document
# is mostly fenced blocks.
fences=$(grep -c '^```' "$DOC" 2>/dev/null || true)
if [ "$((${fences:-0} % 2))" -eq 0 ]; then
  pass 'every code fence is closed'
else
  fail "every code fence is closed (odd number of fences: $fences)"
fi

# The envelope is frozen, and the document has to say so in as many words: it is the one
# rule a future version of this protocol cannot renegotiate.
check_contains "$DOC" '[Tt]he envelope is frozen' 'the document states that the envelope is frozen'

# Every relative link resolves and every anchor names a real heading. Shared with the
# repo's other document checks, so all of them hold links to one standard.
check_markdown_links "$DOC"

check_summary
