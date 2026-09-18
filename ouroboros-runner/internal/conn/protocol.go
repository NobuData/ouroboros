package conn

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// The ceilings this protocol line fixes. They are the numbers published as
// `$defs/limits` in schemas/runner-protocol/v1.json, and limits_test.go asserts that
// they still are — a constant copied out of a document is a constant that drifts from
// it, so the copy is checked rather than trusted.
//
// These are not the session's operating values. Those are chosen per session by the
// gateway and arrive in ack.limits, each at or below the matching ceiling here, which
// is what lets the fleet be re-tuned without a release nobody can force onto customer
// hardware.
const (
	// Version is the protocol line this build writes and the only one it reads.
	Version = 1

	// MinVersion is the oldest line this build still speaks. There is no protocol 0.
	MinVersion = 1

	// EnvelopeMaxBytes is the largest single frame. A frame over it is not a frame.
	EnvelopeMaxBytes = 65536

	// LogChunkMaxBytes is the largest DECODED log chunk.
	LogChunkMaxBytes = 32768

	// LogChunkMaxBase64Chars is what LogChunkMaxBytes becomes on the wire, because
	// base64 inflates by four characters per three bytes: ceil(32768/3)*4.
	LogChunkMaxBase64Chars = 43692
)

// Type is a message type — the closed set in the envelope's `type` field.
type Type string

// The fifteen message types of protocol 1, grouped as
// docs/RUNNER_PROTOCOL.md groups them.
const (
	TypeHello       Type = "hello"      // session — the agent's first frame
	TypeAck         Type = "ack"        // session — the gateway's answer
	TypeRefuse      Type = "refuse"     // session — the gateway's refusal, then a close
	TypeHeartbeat   Type = "heartbeat"  // liveness and telemetry
	TypeJobOffer    Type = "job.offer"  // dispatch
	TypeJobAccept   Type = "job.accept" // dispatch
	TypeJobDecline  Type = "job.decline"
	TypeJobStart    Type = "job.start"    // execution
	TypeJobProgress Type = "job.progress" // execution, advisory
	TypeJobFinish   Type = "job.finish"   // execution, TERMINAL and idempotent
	TypeLogChunk    Type = "log.chunk"    // output
	TypeReceipt     Type = "receipt"      // delivery — what lets a re-send stop
	TypeDrain       Type = "drain"        // control
	TypeUndrain     Type = "undrain"      // control
	TypeBye         Type = "bye"          // control
)

// MessageTypes is every type of protocol 1, in the order v1.json enumerates them.
//
// It is exported because it is the list the repository's own checks walk: every type
// here has a section in the protocol document, a worked example in the fixture set and
// a case in expected.json, and scripts/verify-runner-protocol.sh fails when one of
// those is missing.
var MessageTypes = []Type{
	TypeHello, TypeAck, TypeRefuse, TypeHeartbeat,
	TypeJobOffer, TypeJobAccept, TypeJobDecline,
	TypeJobStart, TypeJobProgress, TypeJobFinish,
	TypeLogChunk, TypeReceipt,
	TypeDrain, TypeUndrain, TypeBye,
}

// Terminal reports whether a frame of this type is a terminal frame: one whose delivery
// must be acknowledged, whose envelope id is its idempotency id, and which a receiver
// deduplicates. job.finish is the only one in this line, and Receipt.OfType's enum is
// what stops a second being added without the contract changing.
func (t Type) Terminal() bool { return t == TypeJobFinish }

// The diagnostic codes. An implementation reports a code and the RFC 6901 path it is
// anchored at, and renders its own prose for the human — a contract over English
// sentences is one nobody can translate.
//
// Two mappings are worth stating, because they are the ones a second implementation
// would otherwise guess at:
//
//   - CodePayloadFieldType covers a value of the wrong JSON type AND a value of the
//     right type in the wrong published shape — a job id that is not a job id, a
//     timestamp that is not RFC 3339 with milliseconds.
//   - CodePayloadFieldRange covers every bound: a number outside its minimum or
//     maximum, a string outside its length, an array outside its item count.
const (
	CodeEnvelopeMalformed          = "envelope.malformed"
	CodeEnvelopeFieldMissing       = "envelope.field.missing"
	CodeEnvelopeFieldType          = "envelope.field.type"
	CodeEnvelopeFieldUnknown       = "envelope.field.unknown"
	CodeEnvelopeVersionUnsupported = "envelope.version.unsupported"
	CodeEnvelopeTypeUnknown        = "envelope.type.unknown"
	CodeEnvelopeIDMalformed        = "envelope.id.malformed"

	CodePayloadFieldMissing  = "payload.field.missing"
	CodePayloadFieldType     = "payload.field.type"
	CodePayloadFieldUnknown  = "payload.field.unknown"
	CodePayloadFieldEnum     = "payload.field.enum"
	CodePayloadFieldRange    = "payload.field.range"
	CodePayloadFieldConflict = "payload.field.conflict"
)

// Diagnostic is one reason a frame was rejected: a stable code, and the RFC 6901 path
// it is anchored at. The empty path is the frame itself.
type Diagnostic struct {
	Code string `json:"code"`
	Path string `json:"path"`
}

// Diagnostics is a rejection, in the contract's order: by path — with numeric path
// segments compared as numbers rather than as text, so /0 sorts before /10 — and then
// by code. Both implementations sort identically, which is what makes expected.json a
// comparison rather than a set membership test.
type Diagnostics []Diagnostic

// Sort puts the diagnostics into the contract's order, in place.
func (d Diagnostics) Sort() {
	sort.SliceStable(d, func(i, j int) bool {
		if d[i].Path != d[j].Path {
			return pathLess(d[i].Path, d[j].Path)
		}
		return d[i].Code < d[j].Code
	})
}

// pathLess orders two RFC 6901 pointers segment by segment, comparing two numeric
// segments as numbers. A shorter pointer that is a prefix of a longer one comes first.
func pathLess(a, b string) bool {
	as, bs := strings.Split(a, "/"), strings.Split(b, "/")
	for i := 0; i < len(as) && i < len(bs); i++ {
		if as[i] == bs[i] {
			continue
		}
		an, aerr := strconv.Atoi(as[i])
		bn, berr := strconv.Atoi(bs[i])
		if aerr == nil && berr == nil {
			return an < bn
		}
		return as[i] < bs[i]
	}
	return len(as) < len(bs)
}

// Envelope is a decoded frame: the four outer keys, and the payload as the object the
// type's own contract is applied to.
//
// The envelope is FROZEN across every version of this protocol. A gateway that speaks
// only version 1 still has to read the `v` of a version 2 hello in order to refuse it
// politely, and an agent that has just been refused still has to read the refusal. That
// is only possible if these four keys never change meaning — so a fifth key is an error
// rather than an extension point, and everything new goes in the payload, where it is
// versioned.
type Envelope struct {
	V       int
	Type    Type
	ID      string
	Payload map[string]any
}

var (
	ulidRe      = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
	sessionRe   = regexp.MustCompile(`^sess_[0-9A-HJKMNP-TV-Z]{26}$`)
	runnerRe    = regexp.MustCompile(`^rnr_[0-9A-HJKMNP-TV-Z]{26}$`)
	jobRe       = regexp.MustCompile(`^job_[0-9A-HJKMNP-TV-Z]{26}$`)
	commitRe    = regexp.MustCompile(`^[0-9a-f]{40}$`)
	timestampRe = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`)
)

// ValidID reports whether a string is a ULID in the published shape — what an envelope
// id, and so an outbox file's name, must be.
func ValidID(id string) bool { return ulidRe.MatchString(id) }

// envelopeKeys is the frozen set, used to report a fifth one.
var envelopeKeys = map[string]bool{"v": true, "type": true, "id": true, "payload": true}

// Decode reads one frame and returns it with every reason it is not a legal frame.
//
// An envelope error ENDS THE WALK. A frame whose envelope does not decode has no
// payload to check — reporting a payload diagnostic as well would mean guessing which
// message type the payload was meant to be, and a guess is what this contract exists to
// remove. So a rejected envelope yields envelope diagnostics only, and a nil Envelope.
//
// A frame that decodes cleanly returns its Envelope and no diagnostics. A frame whose
// envelope is legal but whose payload is not returns BOTH: the envelope, because a
// receiver may want to log what type of frame was wrong, and the diagnostics.
func Decode(raw []byte) (*Envelope, Diagnostics) {
	var diags Diagnostics

	// A frame over the ceiling is not a frame. Checked before parsing, because the
	// point of a ceiling is to bound the work a stranger can ask for.
	if len(raw) > EnvelopeMaxBytes {
		return nil, Diagnostics{{Code: CodeEnvelopeMalformed, Path: ""}}
	}

	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber() // so 1 and 1.0 stay distinguishable, which `v` depends on
	var root any
	if err := dec.Decode(&root); err != nil {
		return nil, Diagnostics{{Code: CodeEnvelopeMalformed, Path: ""}}
	}
	// One JSON object per frame, and nothing after it. A decoder stops at the end of the
	// first value it reads, so without this a frame carrying two objects would be accepted
	// as its first one — and the second would be silently discarded, which for a
	// `job.finish` means a result nobody ever sees.
	if dec.More() {
		return nil, Diagnostics{{Code: CodeEnvelopeMalformed, Path: ""}}
	}
	frame, ok := root.(map[string]any)
	if !ok {
		return nil, Diagnostics{{Code: CodeEnvelopeMalformed, Path: ""}}
	}

	for key := range frame {
		if !envelopeKeys[key] {
			diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldUnknown, Path: "/" + escape(key)})
		}
	}

	env := &Envelope{}

	switch value, present := frame["v"]; {
	case !present:
		diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldMissing, Path: "/v"})
	default:
		if n, isInt := asInteger(value); !isInt {
			diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldType, Path: "/v"})
		} else if n != Version {
			diags = append(diags, Diagnostic{Code: CodeEnvelopeVersionUnsupported, Path: "/v"})
		} else {
			env.V = n
		}
	}

	switch value, present := frame["type"]; {
	case !present:
		diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldMissing, Path: "/type"})
	default:
		name, isString := value.(string)
		switch {
		case !isString:
			diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldType, Path: "/type"})
		case specFor(Type(name)) == nil:
			diags = append(diags, Diagnostic{Code: CodeEnvelopeTypeUnknown, Path: "/type"})
		default:
			env.Type = Type(name)
		}
	}

	switch value, present := frame["id"]; {
	case !present:
		diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldMissing, Path: "/id"})
	default:
		id, isString := value.(string)
		switch {
		case !isString:
			diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldType, Path: "/id"})
		case !ulidRe.MatchString(id):
			diags = append(diags, Diagnostic{Code: CodeEnvelopeIDMalformed, Path: "/id"})
		default:
			env.ID = id
		}
	}

	switch value, present := frame["payload"]; {
	case !present:
		diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldMissing, Path: "/payload"})
	default:
		payload, isObject := value.(map[string]any)
		if !isObject {
			diags = append(diags, Diagnostic{Code: CodeEnvelopeFieldType, Path: "/payload"})
		} else {
			env.Payload = payload
		}
	}

	if len(diags) > 0 {
		diags.Sort()
		return nil, diags
	}

	spec := specFor(env.Type)
	diags = append(diags, checkObject("/payload", spec.fields, env.Payload)...)
	if spec.extra != nil {
		diags = append(diags, spec.extra(env.Payload)...)
	}
	diags.Sort()
	return env, diags
}

// Valid reports whether a frame is a legal frame of this protocol. It is the same walk
// as Decode and is here for the call sites that only want the verdict.
func Valid(raw []byte) bool {
	_, diags := Decode(raw)
	return len(diags) == 0
}

// escape encodes an object key as an RFC 6901 reference token. `~` and `/` are the two
// characters a pointer cannot carry literally.
func escape(key string) string {
	key = strings.ReplaceAll(key, "~", "~0")
	return strings.ReplaceAll(key, "/", "~1")
}

// asInteger reports the value of a JSON number with no fractional or exponent part.
// Anything else — a string, a float, a bool — is not an integer.
func asInteger(value any) (int, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	text := number.String()
	if strings.ContainsAny(text, ".eE") {
		return 0, false
	}
	n, err := strconv.Atoi(text)
	if err != nil {
		return 0, false
	}
	return n, true
}

// decodedLen is the number of bytes a base64 string decodes to, and whether it decodes
// at all. Standard encoding with padding, which is what the contract specifies.
func decodedLen(text string) (int, bool) {
	out, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return 0, false
	}
	return len(out), true
}
