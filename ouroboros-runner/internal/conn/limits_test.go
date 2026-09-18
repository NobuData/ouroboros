package conn

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The limits, and the two boundary cases no committed fixture carries.
//
// The constants in protocol.go are a COPY of numbers published in
// schemas/runner-protocol/v1.json. A copy that is trusted is a copy that drifts, so it
// is checked: the schema is the contract, and this suite fails when the Go side stops
// agreeing with it.
//
// The two over-limit cases are constructed here rather than committed, because a
// fixture for either would be tens of kilobytes of filler in git for one assertion.
// expected.json records that decision so the TypeScript implementations ([#251], [#255])
// build the same cases from the same published numbers instead of discovering the gap.
//
// [#251]: https://github.com/NobuData/ouroboros/issues/251
// [#255]: https://github.com/NobuData/ouroboros/issues/255

// schemaPath is the published contract, relative to this package.
const schemaPath = "../../../schemas/runner-protocol/v1.json"

// TestLimitsMatchTheSchema asserts every constant against `$defs/limits` in v1.json.
func TestLimitsMatchTheSchema(t *testing.T) {
	raw, err := os.ReadFile(filepath.FromSlash(schemaPath))
	if err != nil {
		t.Fatalf("read the published schema: %v", err)
	}

	var schema struct {
		Defs struct {
			Limits struct {
				Const map[string]int `json:"const"`
			} `json:"limits"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatalf("parse the published schema: %v", err)
	}

	published := schema.Defs.Limits.Const
	if len(published) == 0 {
		t.Fatal("the schema publishes no $defs/limits — the constants here have nothing to agree with")
	}

	for name, want := range map[string]int{
		"protocol":                   Version,
		"envelope_max_bytes":         EnvelopeMaxBytes,
		"log_chunk_max_bytes":        LogChunkMaxBytes,
		"log_chunk_max_base64_chars": LogChunkMaxBase64Chars,
	} {
		got, present := published[name]
		if !present {
			t.Errorf("the schema does not publish %s", name)
			continue
		}
		if got != want {
			t.Errorf("%s: the schema says %d, this package says %d", name, got, want)
		}
	}

	// Every published limit has to be checked by something, or a fourth one could be
	// added to the schema and go unnoticed here.
	if len(published) != 4 {
		t.Errorf("the schema publishes %d limits; this suite checks 4", len(published))
	}

	// The base64 figure is derived, not chosen, and the derivation is the part worth
	// pinning: four characters per three bytes, rounded up.
	if want := (LogChunkMaxBytes + 2) / 3 * 4; LogChunkMaxBase64Chars != want {
		t.Errorf("LogChunkMaxBase64Chars is %d; base64 of %d bytes is %d characters",
			LogChunkMaxBase64Chars, LogChunkMaxBytes, want)
	}
}

// TestLogChunkAtTheCap asserts the exact boundary from both sides: a chunk of exactly
// LogChunkMaxBytes decoded bytes is legal, and one byte more is not.
//
// The cap is on DECODED bytes, which is why it cannot be left to the schema's maxLength
// alone: 43692 base64 characters can carry 32769 bytes, one over the ceiling, so a
// receiver that checked only the wire length would accept an over-size chunk.
func TestLogChunkAtTheCap(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		bytes int
		valid bool
	}{
		{"one byte under the cap", LogChunkMaxBytes - 1, true},
		{"exactly at the cap", LogChunkMaxBytes, true},
		{"one byte over the cap", LogChunkMaxBytes + 1, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			frame := logChunkOf(t, strings.Repeat("x", testCase.bytes))
			_, diags := Decode(frame)

			if testCase.valid {
				if len(diags) > 0 {
					t.Fatalf("expected a %d-byte chunk to be legal, got %v", testCase.bytes, diags)
				}
				return
			}
			if len(diags) != 1 ||
				diags[0].Code != CodePayloadFieldRange ||
				diags[0].Path != "/payload/data" {
				t.Fatalf("expected one payload.field.range at /payload/data, got %v", diags)
			}
		})
	}
}

// TestFrameOverTheEnvelopeCeiling asserts a frame larger than EnvelopeMaxBytes is
// refused as malformed — before it is parsed, because the point of a ceiling is to
// bound the work a stranger can ask for.
//
// It also asserts the encoder's half: the agent refuses to produce such a frame in the
// first place, which is what puts the error on the side that knows what it was trying
// to send.
func TestFrameOverTheEnvelopeCeiling(t *testing.T) {
	// Base64 keeps this inside the chunk cap while the frame as a whole goes over the
	// envelope one, so the diagnostic is unambiguously about the frame's size.
	oversize := logChunkOf(t, strings.Repeat("y", LogChunkMaxBytes))
	padding := strings.Repeat(" ", EnvelopeMaxBytes)
	_, diags := Decode(append(oversize, padding...))

	if len(diags) != 1 || diags[0].Code != CodeEnvelopeMalformed || diags[0].Path != "" {
		t.Fatalf("expected one envelope.malformed at the root, got %v", diags)
	}

	huge := NewFrame("01KE7NV941ZNP3TRSPXQNGK4QG", TypeJobProgress, map[string]string{
		"note": strings.Repeat("z", EnvelopeMaxBytes),
	})
	if _, err := Encode(huge); err == nil {
		t.Error("expected the encoder to refuse a frame over the ceiling")
	}
}

// logChunkOf is a legal log.chunk frame carrying the given payload bytes, base64
// encoded — the one message whose size rule needs a frame built to order.
func logChunkOf(t *testing.T, data string) []byte {
	t.Helper()

	frame := NewFrame("01KE7NV941ZNP3TRSPXQNGK4QG", TypeLogChunk, map[string]any{
		"job":           "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
		"seq":           0,
		"stream":        "stdout",
		"encoding":      "base64",
		"data":          base64.StdEncoding.EncodeToString([]byte(data)),
		"dropped_bytes": 0,
	})
	encoded, err := Encode(frame)
	if err != nil {
		// Encode refuses a frame over the envelope ceiling, which a chunk at the cap is
		// not: 32768 bytes is 43692 characters, well inside 65536.
		t.Fatalf("encode a %d-byte chunk: %v", len(data), err)
	}
	return encoded
}
