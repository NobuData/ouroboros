package conn

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Frame is a message on its way out: the frozen envelope, with the payload as whatever
// that type's own struct is.
//
// Going out it is a struct, and coming in it is the map [Envelope] carries. That
// asymmetry is deliberate. A sender knows exactly what it is writing and should be held
// to a compile-time shape; a receiver is reading a stranger's bytes and has to be able
// to say precisely what is wrong with them, which a decode into a struct cannot do —
// `json.Unmarshal` into a typed field reports the first error and calls an absent field
// a zero.
type Frame struct {
	V       int    `json:"v"`
	Type    Type   `json:"type"`
	ID      string `json:"id"`
	Payload any    `json:"payload"`
}

// NewFrame is a frame of this protocol line, carrying the given id and payload.
func NewFrame(id string, messageType Type, payload any) Frame {
	return Frame{V: Version, Type: messageType, ID: id, Payload: payload}
}

// Encode is the wire form: one compact JSON object, no trailing newline, which is what
// goes into one WebSocket text frame.
//
// It refuses to emit a frame over the ceiling rather than letting the receiver refuse
// it. The agent is the side that knows what it was trying to send, so it is the side
// that can report something useful about it — a receiver can only say that 70KB of
// something arrived.
func Encode(frame Frame) ([]byte, error) {
	buffer := &bytes.Buffer{}
	encoder := json.NewEncoder(buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(frame); err != nil {
		return nil, fmt.Errorf("encode %s frame: %w", frame.Type, err)
	}
	// Encode appends a newline; the wire form has none.
	out := bytes.TrimRight(buffer.Bytes(), "\n")
	if len(out) > EnvelopeMaxBytes {
		return nil, fmt.Errorf(
			"%s frame is %d bytes, over the %d-byte ceiling", frame.Type, len(out), EnvelopeMaxBytes)
	}
	return out, nil
}

// EncodeIndent is the same frame at two-space indentation — what the command line
// prints, and the form the golden fixtures are committed in.
//
// The fixtures being the indented form is what lets a test assert that this encoder
// reproduces a committed frame byte for byte, which is a far stronger statement than
// asserting that its output validates.
func EncodeIndent(frame Frame) ([]byte, error) {
	buffer := &bytes.Buffer{}
	encoder := json.NewEncoder(buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(frame); err != nil {
		return nil, fmt.Errorf("encode %s frame: %w", frame.Type, err)
	}
	return buffer.Bytes(), nil
}

// Agent is what a hello says about the build that sent it: its own version, and the
// range of protocol lines it can speak.
//
// The range is what makes a rolling upgrade of a fleet nobody can force-upgrade
// possible at all. The gateway picks a line inside it, or refuses with the minimum
// named — and a refusal that names the minimum is one the operator can act on.
type Agent struct {
	Version     string `json:"version"`
	ProtocolMin int    `json:"protocol_min"`
	ProtocolMax int    `json:"protocol_max"`
}

// Capabilities is what the machine can actually do, answered rather than assumed.
//
// `Docker` is the enrollment card's question — is a daemon present? — and a pool
// offering container jobs to an agent without one would dispatch work that cannot
// start. `Shell` is an operator's answer rather than a probe: a machine that holds
// signing keys can refuse shell jobs while still taking container ones.
type Capabilities struct {
	Docker   bool `json:"docker"`
	Shell    bool `json:"shell"`
	Ccache   bool `json:"ccache"`
	CPUs     int  `json:"cpus"`
	MemoryMB int  `json:"memory_mb"`
}

// SecurityMode is how this agent authenticated the connection a hello is written on —
// decision B3's two answers.
//
// It is REPORTED rather than inferred, because the whole value of the bearer fallback
// being "visibly degraded" is that nobody has to infer it: the gateway records it in the
// runner row's `security_mode`, and the farm page renders a fallback runner as the
// weaker thing it is ([#257]). A silent downgrade would be worse than no fallback.
//
// [#257]: https://github.com/NobuData/ouroboros/issues/257
type SecurityMode string

const (
	// SecurityMTLS is the default and the design: a client certificate the farm CA
	// issued, presented in the TLS handshake.
	SecurityMTLS SecurityMode = "mtls"

	// SecurityBearerFallback is the degraded mode for networks whose proxies strip
	// client certificates: a long-lived secret in the upgrade request's Authorization
	// header. Only ever chosen by an explicit flag — never by this agent on its own.
	SecurityBearerFallback SecurityMode = "bearer_fallback"
)

// HelloPayload is the agent's first frame on every connection, including a
// reconnection.
//
// It carries NO credential. Identity is the TLS client certificate the enrollment
// exchange issued ([#250]), so there is no token field here — and a frame that invents
// one is refused by the contract, which is what keeps a bearer secret out of every
// session log that will ever be captured. Even in bearer-fallback mode the secret
// travels in the WebSocket upgrade request, never in a frame; what the hello carries is
// only the fact that the fallback is in use.
//
// [#250]: https://github.com/NobuData/ouroboros/issues/250
type HelloPayload struct {
	Agent        Agent        `json:"agent"`
	Arch         string       `json:"arch"`
	Hostname     string       `json:"hostname"`
	Pool         string       `json:"pool,omitempty"`
	Capabilities Capabilities `json:"capabilities"`

	// SecurityMode is how this connection was authenticated. Optional in the contract
	// only because it was added inside line 1 (§ 3); every agent that can connect at
	// all sends it.
	SecurityMode SecurityMode `json:"security_mode,omitempty"`

	// Resume names the session this agent wants back after a drop. Empty on a first
	// connection, and omitted from the frame rather than sent as "".
	Resume string `json:"resume,omitempty"`
}

// NewHello is the hello frame for this agent, at this protocol line.
//
// The protocol range is filled in from this package's own constants rather than taken
// from the caller: what a build can speak is a property of the build, and a caller that
// could claim otherwise would be able to negotiate a version it cannot read.
func NewHello(
	id, agentVersion, arch, hostname, pool string,
	capabilities Capabilities, securityMode SecurityMode, resume string,
) Frame {
	return NewFrame(id, TypeHello, HelloPayload{
		Agent: Agent{
			Version:     agentVersion,
			ProtocolMin: MinVersion,
			ProtocolMax: Version,
		},
		Arch:         arch,
		Hostname:     hostname,
		Pool:         pool,
		Capabilities: capabilities,
		SecurityMode: securityMode,
		Resume:       resume,
	})
}
