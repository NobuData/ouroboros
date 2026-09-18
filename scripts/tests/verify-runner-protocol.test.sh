#!/usr/bin/env sh
#
# verify-runner-protocol.test.sh — integration tests for
# scripts/verify-runner-protocol.sh.
#
# The script is run against synthetic trees rather than this checkout, so the tests pin
# the contract independently of the files that currently satisfy it: the fixture is a
# minimal protocol — two message types, two diagnostic codes, one transcript — that
# passes every check, and each case copies it, breaks exactly one thing, and asserts that
# the matching check, and the run, fails.
#
# Two message types is enough, and that is the point of the fixture being small. What the
# script under test asserts is not the *content* of the protocol but whether its three
# halves agree, and a tree with two types exercises every one of those assertions as well
# as a tree with fifteen would — while making each mutation obvious.
#
# The committed protocol is exercised once at the end, which is what proves the checks and
# the real contract agree.
#
# Usage:
#   scripts/tests/verify-runner-protocol.test.sh   # or scripts/run-tests.sh for the suite
#
# Exit status: 0 all assertions passed / 1 at least one failed.

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPTS_DIR=$(dirname -- "$TEST_DIR")
ROOT=$(dirname -- "$SCRIPTS_DIR")
VERIFY="$SCRIPTS_DIR/verify-runner-protocol.sh"

. "$SCRIPTS_DIR/lib/checks.sh"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# make_fixture DIR — write a tree that satisfies every check.
make_fixture() {
  fixture=$1
  mkdir -p "$fixture/docs" \
    "$fixture/schemas/runner-protocol/fixtures/valid" \
    "$fixture/schemas/runner-protocol/fixtures/invalid" \
    "$fixture/schemas/runner-protocol/fixtures/sessions" \
    "$fixture/ouroboros-runner/internal/conn"

  # The schema. Its shape matters to the script in four places: the $id and $schema it
  # publishes, the `properties.type` enum the loops walk, the diagnostic codes, and the
  # `$defs/limits` const the Go constants are compared against. The indentation is part
  # of the contract with the awk readers, and is the real file's.
  cat > "$fixture/schemas/runner-protocol/v1.json" <<'JSON'
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ouroboros.build/schemas/runner-protocol/v1.json",
  "title": "Fixture runner protocol, version 1",
  "type": "object",
  "additionalProperties": false,
  "required": ["v", "type", "id", "payload"],

  "properties": {
    "v": {
      "description": "The protocol line.",
      "type": "integer",
      "const": 1
    },
    "type": {
      "description": "Which message this is.",
      "enum": [
        "hello",
        "bye"
      ]
    },
    "id": { "type": "string" },
    "payload": { "type": "object" }
  },

  "$defs": {
    "limits": {
      "description": "The ceilings this line fixes.",
      "type": "object",
      "const": {
        "protocol": 1,
        "envelope_max_bytes": 65536,
        "log_chunk_max_bytes": 32768,
        "log_chunk_max_base64_chars": 43692
      }
    },

    "diagnostic_codes": {
      "description": "Every rejection this contract can produce.",
      "enum": [
        "envelope.malformed",
        "payload.field.missing"
      ]
    }
  }
}
JSON

  # The two worked examples, and the one document that breaks a rule.
  cat > "$fixture/schemas/runner-protocol/fixtures/valid/hello.json" <<'JSON'
{
  "v": 1,
  "type": "hello",
  "id": "01KE7NAGMYAV6AVSA6FMTM53N1",
  "payload": {
    "hostname": "shed-pi-01"
  }
}
JSON

  cat > "$fixture/schemas/runner-protocol/fixtures/valid/bye.json" <<'JSON'
{
  "v": 1,
  "type": "bye",
  "id": "01KE7NVHQKN0VNYD8VHZNH826Z",
  "payload": {
    "reason": "shutdown"
  }
}
JSON

  cat > "$fixture/schemas/runner-protocol/fixtures/invalid/hello-hostname-missing.json" <<'JSON'
{
  "v": 1,
  "type": "hello",
  "id": "01KE7NAGMYAV6AVSA6FMTM53N1",
  "payload": {}
}
JSON

  # A transcript, whose frames are paths into the fixture set rather than inline copies.
  cat > "$fixture/schemas/runner-protocol/fixtures/sessions/enroll.json" <<'JSON'
{
  "about": ["Connect, then close."],
  "frames": [
    { "from": "agent", "message": "valid/hello.json" },
    { "from": "agent", "message": "valid/bye.json" },
    { "event": "disconnect" }
  ]
}
JSON

  cat > "$fixture/schemas/runner-protocol/fixtures/expected.json" <<'JSON'
{
  "about": ["The parity contract for the fixture protocol."],
  "cases": [
    {
      "name": "hello",
      "document": "valid/hello.json",
      "valid": true,
      "diagnostics": []
    },
    {
      "name": "bye",
      "document": "valid/bye.json",
      "valid": true,
      "diagnostics": []
    },
    {
      "name": "hello-hostname-missing",
      "document": "invalid/hello-hostname-missing.json",
      "valid": false,
      "diagnostics": [{ "code": "payload.field.missing", "path": "/payload/hostname" }]
    }
  ],
  "transcripts": [
    {
      "name": "enroll",
      "document": "sessions/enroll.json",
      "duplicate_terminals": 0
    }
  ]
}
JSON

  # The Go side: the type constants, the code constants and the limits, in the shapes the
  # awk readers expect. Nothing here compiles — what is asserted is agreement, and the
  # module's own suite is what asserts behaviour.
  cat > "$fixture/ouroboros-runner/internal/conn/protocol.go" <<'GO'
package conn

const (
	Version                = 1
	MinVersion             = 1
	EnvelopeMaxBytes       = 65536
	LogChunkMaxBytes       = 32768
	LogChunkMaxBase64Chars = 43692
)

type Type string

const (
	TypeHello Type = "hello"
	TypeBye   Type = "bye"
)

const (
	CodeEnvelopeMalformed   = "envelope.malformed"
	CodePayloadFieldMissing = "payload.field.missing"
)
GO

  # The document. Every required section, a `#### ` section per message type whose first
  # fenced json block is the committed fixture, both codes, all three limits, the frozen
  # sentence, and no broken link.
  {
    cat <<'DOC'
# Runner protocol, version 1

> The fixture contract.

## 1. The envelope

The envelope is frozen. Four keys, and a frame over 65536 bytes is not a frame.

## 2. Versioning, and the version floor

The gateway may refuse an agent below a floor.

## 3. The messages

#### `hello`

The first frame.

DOC
    printf '```json\n'
    cat "$fixture/schemas/runner-protocol/fixtures/valid/hello.json"
    printf '```\n\n'
    cat <<'DOC'
#### `bye`

The orderly close.

DOC
    printf '```json\n'
    cat "$fixture/schemas/runner-protocol/fixtures/valid/bye.json"
    printf '```\n\n'
    cat <<'DOC'
## 4. Reconnect, resume and idempotency

A terminal frame is re-sent byte for byte and deduplicated by id.

## 5. Diagnostics

| Code | Means |
|---|---|
| `envelope.malformed` | Not a JSON object |
| `payload.field.missing` | A required payload field is absent |

A log chunk carries at most 32768 decoded bytes, which is 43692 base64 characters.

## 6. Keeping this document true

[`v1.json`](../schemas/runner-protocol/v1.json) is the other half.
DOC
  } > "$fixture/docs/RUNNER_PROTOCOL.md"
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

printf '\nverify-runner-protocol.sh\n\n'

# ---------------------------------------------------------------------------
# The passing baseline
# ---------------------------------------------------------------------------

printf 'A conforming tree\n'

good="$work/good"
make_fixture "$good"
run_verify "$good"
check_equals 0 "$status" 'a conforming tree passes'
check_matches "$out" '0 failed' 'a conforming tree reports no failures'
check_matches "$out" 'Runner protocol' 'the report names what it checked'
# The loops are only meaningful if the schema reader found something, and a report over
# zero types would read exactly like a passing one.
check_matches "$out" 'enumerates its message types' 'the schema reader found the type enum'

# ---------------------------------------------------------------------------
# The three halves have to be there at all
# ---------------------------------------------------------------------------

printf '\nMissing halves\n'

check_break 'a missing document is reported' \
  'RUNNER_PROTOCOL\.md exists' \
  'rm "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a missing schema is reported' \
  'v1\.json exists' \
  'rm "$root/schemas/runner-protocol/v1.json"'

check_break 'a missing parity contract is reported' \
  'expected\.json exists' \
  'rm "$root/schemas/runner-protocol/fixtures/expected.json"'

check_break 'a missing transcript directory is reported' \
  'sessions/ exists' \
  'rm -r "$root/schemas/runner-protocol/fixtures/sessions"'

# Matched by the URL rather than by the key, so the mutation carries no `$` for the
# test's own shell to expand.
check_break 'a schema with no $id is reported' \
  'publishes its .id' \
  'sed -i "\\|ouroboros.build/schemas/runner-protocol/v1.json|d" "$root/schemas/runner-protocol/v1.json"'

check_break 'a schema that does not declare its dialect is reported' \
  'declares JSON Schema 2020-12' \
  'sed -i "s|json-schema.org/draft/2020-12/schema|json-schema.org/draft-07/schema|" "$root/schemas/runner-protocol/v1.json"'

check_break 'a schema whose type enum cannot be read is reported' \
  'enumerates its message types' \
  'sed -i "s|^    \"type\": {|    \"kind\": {|" "$root/schemas/runner-protocol/v1.json"'

# ---------------------------------------------------------------------------
# Every message type, described three times
# ---------------------------------------------------------------------------

# This is the group the whole script exists for. A message type that is missing any one of
# its three descriptions is a type both implementations are free to disagree about — and it
# would show up as a *passing* suite on both sides, because neither has anything to assert.

printf '\nIncompletely described message types\n'

check_break 'a type the document never documents is reported' \
  'documents bye' \
  'sed -i "s|^#### .bye.$|#### other|" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a type with no worked example is reported' \
  'has a worked example' \
  'rm "$root/schemas/runner-protocol/fixtures/valid/bye.json"'

check_break 'a type with no case in the parity contract is reported' \
  'holds a case for bye' \
  'sed -i "s|valid/bye.json|valid/other.json|" "$root/schemas/runner-protocol/fixtures/expected.json"'

check_break 'a type the agent has no constant for is reported' \
  'carries a constant for bye' \
  'sed -i "s|TypeBye   Type = \"bye\"|TypeBye   Type = \"farewell\"|" "$root/ouroboros-runner/internal/conn/protocol.go"'

check_break 'a documented type with no example block is reported' \
  'prints the bye example' \
  'sed -i "/^#### .bye.$/,/^## /{/^\`\`\`/d;/^  /d;/^{/d;/^}/d}" "$root/docs/RUNNER_PROTOCOL.md"'

# The drift that matters most, and the one a reader would never catch: the document and the
# fixture both exist, both look right, and they are not the same frame. The document is the
# one somebody trusts.
check_break 'a document whose example has drifted from the fixture is reported' \
  'prints the committed hello example' \
  'sed -i "s|\"shed-pi-01\"|\"some-other-host\"|" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a fixture edited without the document is reported' \
  'prints the committed hello example' \
  'sed -i "s|\"shed-pi-01\"|\"some-other-host\"|" "$root/schemas/runner-protocol/fixtures/valid/hello.json"'

# ---------------------------------------------------------------------------
# Fixture coverage, the other way round
# ---------------------------------------------------------------------------

printf '\nUnasserted fixtures\n'

check_break 'a valid fixture nothing asserts against is reported' \
  'names valid/orphan\.json' \
  'cp "$root/schemas/runner-protocol/fixtures/valid/hello.json" "$root/schemas/runner-protocol/fixtures/valid/orphan.json"'

check_break 'an invalid fixture nothing asserts against is reported' \
  'names invalid/orphan\.json' \
  'cp "$root/schemas/runner-protocol/fixtures/invalid/hello-hostname-missing.json" "$root/schemas/runner-protocol/fixtures/invalid/orphan.json"'

check_break 'a transcript nothing replays is reported' \
  'names sessions/orphan\.json' \
  'cp "$root/schemas/runner-protocol/fixtures/sessions/enroll.json" "$root/schemas/runner-protocol/fixtures/sessions/orphan.json"'

check_break 'a transcript naming a frame that does not exist is reported' \
  'replays a frame that exists' \
  'sed -i "s|valid/bye.json|valid/gone.json|" "$root/schemas/runner-protocol/fixtures/sessions/enroll.json"'

# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

printf '\nUndocumented and unimplemented codes\n'

check_break 'a code the document never explains is reported' \
  'documents payload\.field\.missing' \
  'sed -i "/payload.field.missing/d" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a code no implementation can produce is reported' \
  'implements payload\.field\.missing' \
  'sed -i "/CodePayloadFieldMissing/d" "$root/ouroboros-runner/internal/conn/protocol.go"'

# ---------------------------------------------------------------------------
# The published limits
# ---------------------------------------------------------------------------

# The limits are published as numbers so that both implementations build their boundary
# cases from one source rather than each copying a figure out of a document. A copy that is
# trusted is a copy that drifts, which is what these assert.

printf '\nDrifted limits\n'

check_break 'a Go constant that has drifted from the schema is reported' \
  'LogChunkMaxBytes is the log_chunk_max_bytes' \
  'sed -i "s|LogChunkMaxBytes       = 32768|LogChunkMaxBytes       = 16384|" "$root/ouroboros-runner/internal/conn/protocol.go"'

check_break 'a schema limit the Go side never read is reported' \
  'the schema publishes envelope_max_bytes' \
  'sed -i "/\"envelope_max_bytes\":/d" "$root/schemas/runner-protocol/v1.json"'

check_break 'a frame ceiling the document does not state is reported' \
  'states the frame ceiling' \
  'sed -i "s|65536|the ceiling|" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a chunk ceiling the document does not state is reported' \
  'states the log chunk ceiling' \
  'sed -i "s|32768|lots|" "$root/docs/RUNNER_PROTOCOL.md"'

# ---------------------------------------------------------------------------
# The document's own shape
# ---------------------------------------------------------------------------

printf '\nDocument violations\n'

check_break 'a document with no envelope section is reported' \
  'the envelope has a section' \
  'sed -i "s|^## 1. The envelope$|## 1. The outer bit|" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a document that never settles versioning is reported' \
  'versioning and the floor have a section' \
  'sed -i "s|^## 2. Versioning, and the version floor$|## 2. Other matters|" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a document with no resume semantics is reported' \
  'resume and idempotency have a section' \
  'sed -i "s|^## 4. Reconnect, resume and idempotency$|## 4. Reconnecting|" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a document with no maintenance rule is reported' \
  'the maintenance rule has a section' \
  'sed -i "s|^## 6. Keeping this document true$|## 6. Notes|" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'an unclosed code fence is reported' \
  'every code fence is closed' \
  'printf "%s\n" "\`\`\`json" >> "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a document that stops calling the envelope frozen is reported' \
  'envelope is frozen' \
  'sed -i "s|The envelope is frozen.|The envelope may grow.|" "$root/docs/RUNNER_PROTOCOL.md"'

check_break 'a broken link is reported' \
  'link to \.\./schemas/runner-protocol/v9\.json resolves' \
  'sed -i "s|runner-protocol/v1.json)|runner-protocol/v9.json)|" "$root/docs/RUNNER_PROTOCOL.md"'

# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

printf '\nCommand line\n'

out=$("$VERIFY" --help 2>&1)
check_equals 0 "$?" '--help exits zero'
check_matches "$out" 'verify-runner-protocol' '--help prints the usage'

"$VERIFY" --nonsense >/dev/null 2>&1
check_equals 2 "$?" 'an unknown argument exits 2'

"$VERIFY" --root >/dev/null 2>&1
check_equals 2 "$?" '--root without a directory exits 2'

# ---------------------------------------------------------------------------
# This checkout
# ---------------------------------------------------------------------------

# The committed protocol, which is what proves the checks above and the real contract
# agree rather than merely being self-consistent.

printf '\nThis checkout\n'

run_verify "$ROOT"
check_equals 0 "$status" 'the committed protocol satisfies every check'

check_summary
