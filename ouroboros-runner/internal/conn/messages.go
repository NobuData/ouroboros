package conn

import (
	"encoding/json"
	"fmt"
)

// The typed views of the messages the connection loop writes and reads.
//
// Outgoing, a struct per message is the compile-time shape a sender is held to (see
// [Frame]). Incoming, a frame is first decoded into an [Envelope] and VALIDATED against
// the contract — Decode is where a stranger's bytes are judged — and only a frame that
// passed is read into one of these with [Envelope.Into]. So a field here being its zero
// value never means the field was absent: the validator has already refused that.
//
// Every field name and bound is docs/RUNNER_PROTOCOL.md § 4's; the comments say only
// what the agent does with each.

// Direction is which end of the connection may send a message type.
type Direction uint8

const (
	// FromAgent is a type only the agent writes.
	FromAgent Direction = 1 << iota
	// FromGateway is a type only the gateway writes.
	FromGateway
)

// directions is each type's fixed direction, from the line that opens its section of
// the protocol document. `bye` is the one type either end may send.
var directions = map[Type]Direction{
	TypeHello:       FromAgent,
	TypeAck:         FromGateway,
	TypeRefuse:      FromGateway,
	TypeHeartbeat:   FromAgent,
	TypeJobOffer:    FromGateway,
	TypeJobAccept:   FromAgent,
	TypeJobDecline:  FromAgent,
	TypeJobStart:    FromAgent,
	TypeJobProgress: FromAgent,
	TypeJobFinish:   FromAgent,
	TypeLogChunk:    FromAgent,
	TypeReceipt:     FromGateway,
	TypeDrain:       FromGateway,
	TypeUndrain:     FromGateway,
	TypeBye:         FromAgent | FromGateway,
}

// SentBy reports whether a frame of this type may be sent by the given end.
//
// A codec cannot check direction, because a codec does not know which end it is
// running on — so the check belongs to the connection loop, and this is its table. A
// frame arriving in the wrong direction is a protocol error, and neither end has to
// guess whether it was meant.
func (t Type) SentBy(end Direction) bool {
	return directions[t]&end != 0
}

// Into reads a validated envelope's payload into one of the typed views below.
//
// It is a round trip through JSON on purpose: Decode kept the payload as the generic
// map it judged, with numbers as json.Number so that 1 and 1.0 stayed
// distinguishable, and re-encoding that map is the one conversion that cannot disagree
// with what was validated.
func (e *Envelope) Into(target any) error {
	raw, err := json.Marshal(e.Payload)
	if err != nil {
		return fmt.Errorf("re-encode the %s payload: %w", e.Type, err)
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("read the %s payload: %w", e.Type, err)
	}
	return nil
}

// AckRunner is who the control plane thinks this agent is.
type AckRunner struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Pool string `json:"pool"`
}

// Limits is every operating value the gateway chose for a session. None of them is
// hard-coded in the agent: sending them is what lets a fleet nobody can force-upgrade be
// re-tuned without a release.
type Limits struct {
	HeartbeatIntervalMS int `json:"heartbeat_interval_ms"`
	HeartbeatJitterMS   int `json:"heartbeat_jitter_ms"`
	LogChunkMaxBytes    int `json:"log_chunk_max_bytes"`
	LogRateBytesPerS    int `json:"log_rate_bytes_per_s"`
	OfferAckMS          int `json:"offer_ack_ms"`
	ResumeWindowMS      int `json:"resume_window_ms"`
}

// AckPayload is the gateway's acceptance of a hello.
type AckPayload struct {
	Session  string    `json:"session"`
	Protocol int       `json:"protocol"`
	Resumed  bool      `json:"resumed"`
	Runner   AckRunner `json:"runner"`
	Limits   Limits    `json:"limits"`
}

// The refusal codes, and what each obliges the agent to do (§ 4.1, `refuse`).
const (
	RefuseVersionBelowMinimum = "version.below_minimum"
	RefuseVersionUnsupported  = "version.unsupported"
	RefuseIdentityUnknown     = "identity.unknown"
	RefuseIdentityRevoked     = "identity.revoked"
	RefusePoolUnknown         = "pool.unknown"
	RefuseCapacityExhausted   = "capacity.exhausted"
)

// RefusePayload is the gateway's refusal of a hello, sent instead of an ack.
type RefusePayload struct {
	Code         string `json:"code"`
	Minimum      *int   `json:"minimum"`
	Detail       string `json:"detail"`
	RetryAfterMS *int   `json:"retry_after_ms"`
}

// Final reports whether a refusal is one the agent must not reconnect into.
//
// `version.*` and `identity.*` do not clear by themselves: reconnecting into them is a
// loop that costs both ends and fixes nothing, so the agent logs the reason and exits
// non-zero for the service manager to record. `pool.unknown` and `capacity.exhausted`
// may clear, and are retried on `retry_after_ms`.
func (r RefusePayload) Final() bool {
	switch r.Code {
	case RefusePoolUnknown, RefuseCapacityExhausted:
		return false
	default:
		return true
	}
}

// HeartbeatJob is the job a heartbeat reports as running.
type HeartbeatJob struct {
	ID    string `json:"id"`
	Phase string `json:"phase"`
	Pct   int    `json:"pct"`
}

// The phases a running job moves through, as `heartbeat.job.phase` and `job.progress`
// name them.
const (
	PhaseFetch   = "fetch"
	PhasePrepare = "prepare"
	PhaseRun     = "run"
	PhaseUpload  = "upload"
)

// ValidPhase reports whether a phase is one the contract accepts. The executors report
// their phase from code, so the check is here, where one table of names holds it, rather
// than left for the gateway to refuse a whole heartbeat over.
func ValidPhase(phase string) bool {
	for _, known := range phaseValues {
		if phase == known {
			return true
		}
	}
	return false
}

// ValidJobID reports whether a job id has the published shape, `job_` and a ULID.
func ValidJobID(job string) bool { return jobRe.MatchString(job) }

// The three states a heartbeat can report.
const (
	StateIdle     = "idle"
	StateBusy     = "busy"
	StateDraining = "draining"
)

// HeartbeatPayload is liveness and telemetry in one frame.
//
// `Job` is a pointer so that an idle agent sends `"job": null` — the key present and
// null, not absent, which is the one shape the contract accepts.
//
// The three measurements are pointers for the same reason and a stronger one: nil is sent
// as `null`, which is what a heartbeat says about a metric this machine could not measure
// ([#245]). Zero is a reading, and a `0%` CPU on a machine mid-build is a lie nobody
// doubts. None of them is `omitempty` — a missing reading is null, never an absent key.
//
// [#245]: https://github.com/NobuData/ouroboros/issues/245
type HeartbeatPayload struct {
	SentAt        string        `json:"sent_at"`
	State         string        `json:"state"`
	UptimeS       int           `json:"uptime_s"`
	CPUPct        *float64      `json:"cpu_pct"`
	MemoryUsedMB  *int          `json:"memory_used_mb"`
	MemoryTotalMB *int          `json:"memory_total_mb"`
	QueueDepth    int           `json:"queue_depth"`
	Job           *HeartbeatJob `json:"job"`
}

// JobOfferPayload is the part of a job.offer the connection loop reads. The executor
// fields — image, command, workdir, env, repository — are the executors' to read
// ([#246]); the loop only has to answer the offer in time.
//
// [#246]: https://github.com/NobuData/ouroboros/issues/246
type JobOfferPayload struct {
	Job       string `json:"job"`
	Pool      string `json:"pool"`
	Executor  string `json:"executor"`
	ExpiresAt string `json:"expires_at"`
}

// The decline reasons.
const (
	DeclineDraining            = "draining"
	DeclineBusy                = "busy"
	DeclineUnsupportedExecutor = "unsupported_executor"
	DeclineImageUnavailable    = "image_unavailable"
	DeclineCapacity            = "capacity"
	DeclineExpired             = "expired"
)

// JobDeclinePayload is an offer refused, immediately and with a reason.
type JobDeclinePayload struct {
	Job    string `json:"job"`
	Offer  string `json:"offer"`
	Reason string `json:"reason"`
	Detail string `json:"detail"`
}

// ReceiptPayload is the gateway's confirmation that a terminal frame is durably
// recorded — the message that lets a re-send stop.
type ReceiptPayload struct {
	Of        string `json:"of"`
	OfType    string `json:"of_type"`
	Duplicate bool   `json:"duplicate"`
}

// DrainPayload withdraws the agent from dispatch without stopping it.
type DrainPayload struct {
	Reason     string `json:"reason"`
	DeadlineMS int    `json:"deadline_ms"`
	Detail     string `json:"detail"`
}

// The bye reasons.
const (
	ByeShutdown       = "shutdown"
	ByeDrained        = "drained"
	ByeError          = "error"
	ByeServerShutdown = "server_shutdown"
)

// ByePayload is the orderly close, in either direction.
//
// `ReconnectAfterMS` is a pointer because null is a value here: the sender has no
// opinion, and the agent falls back to its own backoff.
type ByePayload struct {
	Reason           string `json:"reason"`
	Detail           string `json:"detail"`
	ReconnectAfterMS *int   `json:"reconnect_after_ms"`
}
