package conn

import (
	"bytes"
	"strings"
	"testing"
)

// TestNewHelloReproducesTheGoldenFrame asserts this encoder produces the committed
// fixture BYTE FOR BYTE.
//
// That is a much stronger statement than asserting the output validates. Validating
// says the frame is legal; this says it is the same frame the protocol document prints
// and the TypeScript gateway's suite reads — same fields, same order, same formatting.
// It is also the assertion that catches a struct tag typo, which a validator would
// report as a missing field somewhere else entirely.
func TestNewHelloReproducesTheGoldenFrame(t *testing.T) {
	capabilities := Capabilities{
		Docker: true, Shell: true, Ccache: true,
		CPUs: 8, MemoryMB: 16384,
	}

	for _, testCase := range []struct {
		name    string
		fixture string
		id      string
		resume  string
	}{
		{
			name:    "a first connection",
			fixture: "valid/hello.json",
			id:      "01KE7NAGMYAV6AVSA6FMTM53N1",
		},
		{
			name:    "a reconnection naming its session",
			fixture: "valid/hello-resume.json",
			id:      "01KE72Q2ZSXXHS030MNRXMF2QP",
			resume:  "sess_01KE7MV3WKAG706QMDN23AJ3BE",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			frame := NewHello(
				testCase.id, "0.1.0", "linux/arm64", "shed-pi-01", "arm-builders",
				capabilities, testCase.resume,
			)

			encoded, err := EncodeIndent(frame)
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			want := readFixture(t, testCase.fixture)
			if !bytes.Equal(encoded, want) {
				t.Errorf("the encoder does not reproduce %s.\n--- got ---\n%s\n--- want ---\n%s",
					testCase.fixture, encoded, want)
			}
		})
	}
}

// TestNewHelloAdvertisesThisBuildsRange asserts the protocol range comes from this
// package's own constants rather than from the caller.
//
// What a build can speak is a property of the build. A caller that could claim
// otherwise would be able to negotiate a line this code cannot read — and the
// negotiation would succeed, which is the worst possible outcome of a version check.
func TestNewHelloAdvertisesThisBuildsRange(t *testing.T) {
	frame := NewHello("01KE7NAGMYAV6AVSA6FMTM53N1", "9.9.9", "linux/arm64", "host", "",
		Capabilities{CPUs: 1, MemoryMB: 1024}, "")

	payload, ok := frame.Payload.(HelloPayload)
	if !ok {
		t.Fatalf("expected a HelloPayload, got %T", frame.Payload)
	}
	if payload.Agent.ProtocolMin != MinVersion || payload.Agent.ProtocolMax != Version {
		t.Errorf("expected the range %d–%d, got %d–%d",
			MinVersion, Version, payload.Agent.ProtocolMin, payload.Agent.ProtocolMax)
	}
	if frame.V != Version {
		t.Errorf("expected the frame to be written at v%d, got v%d", Version, frame.V)
	}
	// The agent's own version IS the caller's to give — it is what the build was
	// stamped with, and the Makefile is what stamps it.
	if payload.Agent.Version != "9.9.9" {
		t.Errorf("expected the caller's agent version, got %q", payload.Agent.Version)
	}
}

// TestNewHelloOmitsWhatItDoesNotKnow asserts the two optional fields are absent rather
// than empty.
//
// `"pool": ""` and no pool at all are different frames, and only one of them is legal:
// the contract bounds `pool` at one character, so an agent that sent an empty string
// would be refused for a field it was trying not to claim.
func TestNewHelloOmitsWhatItDoesNotKnow(t *testing.T) {
	frame := NewHello("01KE7NAGMYAV6AVSA6FMTM53N1", "0.1.0", "linux/arm64", "host", "",
		Capabilities{Docker: true, Shell: true, Ccache: true, CPUs: 4, MemoryMB: 8192}, "")

	encoded, err := Encode(frame)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	for _, absent := range []string{`"pool"`, `"resume"`} {
		if strings.Contains(string(encoded), absent) {
			t.Errorf("expected %s to be omitted, got %s", absent, encoded)
		}
	}
	if _, diags := Decode(encoded); len(diags) > 0 {
		t.Errorf("expected the frame to be legal, got %v", diags)
	}
}

// TestEncodeIsTheWireForm asserts the two encoders differ in exactly the documented
// way: one compact frame with no trailing newline for the socket, and an indented one
// for a human and for the fixtures.
func TestEncodeIsTheWireForm(t *testing.T) {
	frame := NewFrame("01KE7DYS9D105E77KERP5B5V43", TypeUndrain, map[string]any{})

	wire, err := Encode(frame)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if want := `{"v":1,"type":"undrain","id":"01KE7DYS9D105E77KERP5B5V43","payload":{}}`; string(wire) != want {
		t.Errorf("wire form:\n got %s\nwant %s", wire, want)
	}

	indented, err := EncodeIndent(frame)
	if err != nil {
		t.Fatalf("encode indented: %v", err)
	}
	if !bytes.HasSuffix(indented, []byte("\n")) {
		t.Error("expected the indented form to end with a newline, as the fixtures do")
	}
	if !bytes.Equal(indented, readFixture(t, "valid/undrain.json")) {
		t.Errorf("the indented form does not reproduce valid/undrain.json:\n%s", indented)
	}
}

// TestEncodeDoesNotEscapeHTML pins a detail that would otherwise be discovered by a
// TypeScript implementation refusing a frame.
//
// Go's JSON encoder escapes `<`, `>` and `&` into < and friends by default, for
// the benefit of documents embedded in HTML. A repository URL or a compiler's output
// carries all three, and a receiver comparing a re-sent frame byte for byte against the
// first copy would be comparing two different encodings of the same string.
func TestEncodeDoesNotEscapeHTML(t *testing.T) {
	frame := NewFrame("01KE7SEN831CW72GWV2HB0H4MS", TypeJobProgress, map[string]any{
		"job":   "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
		"phase": "run",
		"pct":   1,
		"note":  "a<b && c>d",
	})

	encoded, err := Encode(frame)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !strings.Contains(string(encoded), "a<b && c>d") {
		t.Errorf("expected the literal characters, got %s", encoded)
	}
	if _, diags := Decode(encoded); len(diags) > 0 {
		t.Errorf("expected the frame to be legal, got %v", diags)
	}
}
