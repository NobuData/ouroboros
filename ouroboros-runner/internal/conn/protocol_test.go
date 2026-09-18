package conn

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The parity suite: this package against
// schemas/runner-protocol/fixtures/expected.json.
//
// It is the reason the fixtures exist. The gateway is TypeScript and is written by
// another work stream against the same file ([#251], and the fake agent that drives its
// suite, [#255]); neither imports the other, and neither is the specification. What
// makes them agree is that both assert against these bytes — so a rule added to one and
// forgotten in the other fails in the half that forgot it, on the pull request that
// forgot it.
//
// The suite reads the fixtures out of the repository rather than embedding them. An
// embedded copy is a second copy, and a second copy is the drift this whole arrangement
// exists to prevent.
//
// [#251]: https://github.com/NobuData/ouroboros/issues/251
// [#255]: https://github.com/NobuData/ouroboros/issues/255

// fixtureRoot is schemas/runner-protocol/fixtures/, relative to this package.
const fixtureRoot = "../../../schemas/runner-protocol/fixtures"

// expectation is one case of the parity contract.
type expectation struct {
	Name        string       `json:"name"`
	About       string       `json:"about"`
	Document    string       `json:"document"`
	Valid       bool         `json:"valid"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

// transcript is one recorded session, and what replaying it has to produce.
type transcript struct {
	Name               string `json:"name"`
	About              string `json:"about"`
	Document           string `json:"document"`
	DuplicateTerminals int    `json:"duplicate_terminals"`
}

// contract is expected.json.
type contract struct {
	Cases       []expectation `json:"cases"`
	Transcripts []transcript  `json:"transcripts"`
}

// frames is one sessions/*.json transcript: an ordered list of frames, each naming a
// fixture, with `disconnect` events where the socket died.
type frames struct {
	Frames []struct {
		From    string `json:"from"`
		Message string `json:"message"`
		Event   string `json:"event"`
	} `json:"frames"`
}

// loadContract reads expected.json, failing the suite rather than skipping if it is not
// there. A parity suite that silently passes when it cannot find the contract is worse
// than no parity suite, because it reports green.
func loadContract(t *testing.T) contract {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join(fixtureRoot, "expected.json"))
	if err != nil {
		t.Fatalf("read the parity contract: %v", err)
	}
	var parsed contract
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("parse the parity contract: %v", err)
	}
	if len(parsed.Cases) == 0 {
		t.Fatal("the parity contract holds no cases")
	}
	return parsed
}

// readFixture reads one document named by the contract, relative to the fixture root.
func readFixture(t *testing.T, name string) []byte {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join(fixtureRoot, name))
	if err != nil {
		t.Fatalf("read the fixture %s: %v", name, err)
	}
	return raw
}

// TestParity is the contract itself: every case, decoded, and its diagnostics compared
// to the recorded ones exactly — same codes, same paths, same order.
func TestParity(t *testing.T) {
	for _, testCase := range loadContract(t).Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			_, diags := Decode(readFixture(t, testCase.Document))

			if testCase.Valid != (len(diags) == 0) {
				t.Errorf("%s: expected valid=%t, got %d diagnostic(s): %v",
					testCase.About, testCase.Valid, len(diags), diags)
			}

			if len(diags) != len(testCase.Diagnostics) {
				t.Fatalf("expected %d diagnostic(s), got %d: %v",
					len(testCase.Diagnostics), len(diags), diags)
			}
			for i, want := range testCase.Diagnostics {
				if diags[i] != want {
					t.Errorf("diagnostic %d: expected %s at %q, got %s at %q",
						i, want.Code, want.Path, diags[i].Code, diags[i].Path)
				}
			}
		})
	}
}

// TestValidMatchesDecode asserts the convenience verdict agrees with the full walk on
// every case. Two ways of answering one question is two ways of being wrong.
func TestValidMatchesDecode(t *testing.T) {
	for _, testCase := range loadContract(t).Cases {
		raw := readFixture(t, testCase.Document)
		if got := Valid(raw); got != testCase.Valid {
			t.Errorf("%s: Valid returned %t, the contract says %t", testCase.Name, got, testCase.Valid)
		}
	}
}

// TestDecodeReturnsTheEnvelopeForAPayloadError asserts the documented asymmetry: an
// envelope error yields no envelope, because there is nothing safe to say about the
// frame, while a payload error yields the envelope AND the diagnostics — a receiver
// logging what kind of frame was wrong needs its type.
func TestDecodeReturnsTheEnvelopeForAPayloadError(t *testing.T) {
	env, diags := Decode(readFixture(t, "invalid/heartbeat-state-enum.json"))
	if len(diags) == 0 {
		t.Fatal("expected the payload error to be reported")
	}
	if env == nil {
		t.Fatal("expected the envelope of a frame whose payload was wrong")
	}
	if env.Type != TypeHeartbeat || env.V != Version {
		t.Errorf("expected a v%d heartbeat envelope, got v%d %s", Version, env.V, env.Type)
	}

	env, diags = Decode(readFixture(t, "invalid/envelope-type-unknown.json"))
	if len(diags) == 0 {
		t.Fatal("expected the envelope error to be reported")
	}
	if env != nil {
		t.Errorf("expected no envelope for a frame whose envelope was wrong, got %+v", env)
	}
}

// TestTranscripts replays every recorded session.
//
// Two things are asserted, and the second is the one the whole resume design exists
// for. Every frame a transcript names has to decode cleanly — a transcript that has
// drifted from the fixtures it references is a transcript that documents nothing. And
// the number of terminal frames a receiver's ledger rejects as duplicates has to be
// exactly what the contract records: sessions/resume.json re-sends its job.finish after
// a drop, and a ledger that let that through would finish one job twice.
func TestTranscripts(t *testing.T) {
	for _, session := range loadContract(t).Transcripts {
		t.Run(session.Name, func(t *testing.T) {
			var parsed frames
			if err := json.Unmarshal(readFixture(t, session.Document), &parsed); err != nil {
				t.Fatalf("parse the transcript: %v", err)
			}
			if len(parsed.Frames) == 0 {
				t.Fatal("the transcript holds no frames")
			}

			ledger := NewLedger()
			duplicates := 0
			terminals := 0

			for i, frame := range parsed.Frames {
				if frame.Event != "" {
					// A disconnect is not a frame. It is here because the transcript
					// is about what survives one.
					if frame.Event != "disconnect" {
						t.Errorf("frame %d: unknown event %q", i, frame.Event)
					}
					continue
				}
				if frame.From != "agent" && frame.From != "server" {
					t.Errorf("frame %d: %q is neither the agent nor the server", i, frame.From)
				}

				env, diags := Decode(readFixture(t, frame.Message))
				if len(diags) > 0 {
					t.Errorf("frame %d (%s): %v", i, frame.Message, diags)
					continue
				}
				if !env.Type.Terminal() {
					continue
				}
				terminals++
				if ledger.Record(env.ID) {
					duplicates++
				}
			}

			if duplicates != session.DuplicateTerminals {
				t.Errorf("%s: expected %d duplicate terminal frame(s), got %d",
					session.About, session.DuplicateTerminals, duplicates)
			}
			// The distinct terminal frames are the jobs that actually finished. Stated
			// separately because it is the sentence the contract is written in: a
			// job.finish sent as a socket drops must not become two finished jobs.
			if want := terminals - session.DuplicateTerminals; ledger.Len() != want {
				t.Errorf("expected %d finished job(s) on the ledger, got %d", want, ledger.Len())
			}
		})
	}
}

// TestEveryMessageTypeHasACase asserts the fixture set covers the protocol.
//
// This is the assertion that keeps the contract complete rather than merely correct. A
// message type with no case is a message type both implementations are free to disagree
// about, and it would show up as a passing suite on both sides.
func TestEveryMessageTypeHasACase(t *testing.T) {
	covered := make(map[Type]bool, len(MessageTypes))
	for _, testCase := range loadContract(t).Cases {
		if !testCase.Valid {
			continue
		}
		env, diags := Decode(readFixture(t, testCase.Document))
		if len(diags) > 0 {
			continue // already reported by TestParity
		}
		covered[env.Type] = true
	}

	for _, messageType := range MessageTypes {
		if !covered[messageType] {
			t.Errorf("no valid case covers %s — every message type needs a worked example", messageType)
		}
	}
}

// TestEveryDiagnosticCodeHasACase is the same completeness argument for the other half
// of the contract: a code this package can emit but no case records is a rejection the
// gateway has never been asked to reproduce.
func TestEveryDiagnosticCodeHasACase(t *testing.T) {
	// All thirteen, and every one of them is reachable from a committed fixture. Two
	// RULES are not — a frame over the 64KB ceiling and a chunk over the 32KB one —
	// because a fixture for either would be tens of kilobytes of filler. Both are built
	// from the published limits in limits_test.go instead, and expected.json's `about`
	// says so, so the TypeScript side is told to construct them rather than left to
	// discover the gap.
	emitted := map[string]bool{
		CodeEnvelopeMalformed:          false,
		CodeEnvelopeFieldMissing:       false,
		CodeEnvelopeFieldType:          false,
		CodeEnvelopeFieldUnknown:       false,
		CodeEnvelopeVersionUnsupported: false,
		CodeEnvelopeTypeUnknown:        false,
		CodeEnvelopeIDMalformed:        false,
		CodePayloadFieldMissing:        false,
		CodePayloadFieldType:           false,
		CodePayloadFieldUnknown:        false,
		CodePayloadFieldEnum:           false,
		CodePayloadFieldRange:          false,
		CodePayloadFieldConflict:       false,
	}

	for _, testCase := range loadContract(t).Cases {
		_, diags := Decode(readFixture(t, testCase.Document))
		for _, diag := range diags {
			if _, known := emitted[diag.Code]; !known {
				t.Errorf("%s: %s is not a code this protocol defines", testCase.Name, diag.Code)
				continue
			}
			emitted[diag.Code] = true
		}
	}

	for code, seen := range emitted {
		if !seen {
			t.Errorf("no case produces %s — a rejection nobody has been asked to reproduce", code)
		}
	}
}

// TestDiagnosticOrdering pins the ordering rule directly rather than only through the
// two-mistakes fixture, including the array case a payload diagnostic can reach.
//
// Numeric segments compare as numbers: /10 after /2, which a string sort gets wrong. It
// matters because expected.json is compared element by element, so a contract two
// implementations sorted differently would fail for both of them and be right for
// neither.
func TestDiagnosticOrdering(t *testing.T) {
	diags := Diagnostics{
		{Code: CodePayloadFieldType, Path: "/payload/command/10"},
		{Code: CodePayloadFieldType, Path: "/payload/command/2"},
		{Code: CodePayloadFieldRange, Path: "/payload/cpu_pct"},
		{Code: CodePayloadFieldEnum, Path: "/payload/cpu_pct"},
		{Code: CodeEnvelopeFieldMissing, Path: "/v"},
	}
	diags.Sort()

	want := []string{
		"/payload/command/2",
		"/payload/command/10",
		"/payload/cpu_pct", // enum before range: same path, so code decides
		"/payload/cpu_pct",
		"/v",
	}
	for i, path := range want {
		if diags[i].Path != path {
			t.Errorf("position %d: expected %s, got %s", i, path, diags[i].Path)
		}
	}
	if diags[2].Code != CodePayloadFieldEnum || diags[3].Code != CodePayloadFieldRange {
		t.Errorf("expected enum before range at the same path, got %s then %s",
			diags[2].Code, diags[3].Code)
	}
}

// TestTerminal pins which frames the resume machinery applies to. job.finish is the
// only terminal frame in this line, and receipt.of_type's enum in v1.json is what stops
// a second being added without the contract changing.
func TestTerminal(t *testing.T) {
	for _, messageType := range MessageTypes {
		want := messageType == TypeJobFinish
		if got := messageType.Terminal(); got != want {
			t.Errorf("%s: Terminal() = %t, expected %t", messageType, got, want)
		}
	}
}

// TestDecodeRejectsGarbage covers the inputs a socket can deliver that no fixture can
// be: bytes that are not JSON at all, and nothing.
func TestDecodeRejectsGarbage(t *testing.T) {
	for name, raw := range map[string][]byte{
		"empty":            {},
		"not json":         []byte("hello?"),
		"truncated object": []byte(`{"v":1,"type":"hello"`),
		"json null":        []byte("null"),
		"json string":      []byte(`"hello"`),
		// One object per frame, and nothing after it. A decoder stops at the end of the
		// first value it reads, so a frame carrying two would otherwise be accepted as
		// its first — and the second discarded without a word, which for a job.finish
		// means a result nobody ever sees.
		"two objects":      []byte(`{"v":1}{"v":1}`),
		"trailing garbage": []byte(`{"v":1} oh`),
	} {
		t.Run(name, func(t *testing.T) {
			env, diags := Decode(raw)
			if env != nil {
				t.Errorf("expected no envelope, got %+v", env)
			}
			if len(diags) != 1 || diags[0].Code != CodeEnvelopeMalformed || diags[0].Path != "" {
				t.Errorf("expected one envelope.malformed at the root, got %v", diags)
			}
		})
	}
}
