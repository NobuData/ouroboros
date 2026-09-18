package conn

import "sync"

// Resume, in two halves.
//
// The failure being survived is narrow and certain: a job.finish is written to a socket
// that dies before its receipt comes back. The agent cannot know whether the frame
// arrived, so it must re-send — and a re-send that the receiver treats as a second
// result is a job finished twice, which is worse than the drop it was fixing.
//
// The contract is therefore two rules, one per end, and both are in
// docs/RUNNER_PROTOCOL.md § Reconnect, resume and idempotency:
//
//  1. The SENDER re-sends every unacknowledged terminal frame BYTE FOR BYTE, envelope
//     id included, until a receipt arrives. That is [Outbox].
//  2. The RECEIVER records the envelope id of every terminal frame it has durably
//     accepted, and answers a second copy with `receipt.duplicate: true` instead of
//     acting on it again. That is [Ledger].
//
// Neither is the gateway's implementation — that is [#251]'s, in TypeScript, against the
// same document. These are the agent's, and they are here rather than in #244 because
// the semantics are part of the specification this issue owes both sides: an agent that
// re-sends and a gateway that deduplicates are two halves of one agreement, and an
// agreement written down only in prose is one each side reads differently.
//
// Both are in-memory. An agent that is restarted rather than merely disconnected has to
// re-send from a record that survived the restart, which means writing the frame to disk
// beside the job — that is AG.2's ([#244]) to place, because it is the same file the
// connection loop reads on start-up. The shapes here are what it will store.
//
// [#244]: https://github.com/NobuData/ouroboros/issues/244
// [#251]: https://github.com/NobuData/ouroboros/issues/251

// Outbox is the sender's half of resume: the terminal frames this agent has sent and
// not yet had acknowledged, in the order they were minted.
//
// Order matters and is preserved. Two jobs that finished in a known order are reported
// in that order after a reconnect too, so a control plane reading its own log sees the
// sequence that happened rather than a map iteration.
//
// It is safe for concurrent use: the executor finishes jobs and the connection loop
// re-sends them, and those are different goroutines.
type Outbox struct {
	mu      sync.Mutex
	order   []string          // envelope ids, in mint order
	pending map[string][]byte // envelope id -> the exact bytes to re-send
}

// NewOutbox returns an empty Outbox.
func NewOutbox() *Outbox {
	return &Outbox{pending: make(map[string][]byte)}
}

// Add records a terminal frame as sent and unacknowledged.
//
// The frame is stored as the bytes given, and Pending hands back those same bytes: a
// re-send must be byte-identical, because the receiver recognises it by the envelope id
// inside it and re-encoding is how an id, a timestamp or a float's formatting quietly
// changes. Adding an id that is already pending replaces nothing and re-queues nothing —
// the first copy is already the one that will be re-sent.
func (o *Outbox) Add(id string, frame []byte) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if _, already := o.pending[id]; already {
		return
	}
	stored := make([]byte, len(frame))
	copy(stored, frame)
	o.pending[id] = stored
	o.order = append(o.order, id)
}

// Receipt records an acknowledgement, whether or not the receiver called it a
// duplicate. Both answers mean the same thing to the sender — the frame is recorded,
// stop re-sending — and the difference is worth only a log line.
//
// An acknowledgement for an id that is not pending is ignored. It is what a receipt
// duplicated by a reconnect looks like, and it is not an error.
func (o *Outbox) Receipt(id string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if _, pending := o.pending[id]; !pending {
		return
	}
	delete(o.pending, id)
	for i, queued := range o.order {
		if queued == id {
			o.order = append(o.order[:i], o.order[i+1:]...)
			break
		}
	}
}

// Pending is every unacknowledged frame, in mint order — what the agent writes again
// after a reconnect, before anything else.
//
// Each frame is a copy. The caller is about to hand these to a socket, and a writer
// that reuses the buffer it was given would otherwise be editing what is still queued
// for the next reconnection — changing a frame that must be re-sent byte for byte.
func (o *Outbox) Pending() [][]byte {
	o.mu.Lock()
	defer o.mu.Unlock()
	frames := make([][]byte, 0, len(o.order))
	for _, id := range o.order {
		stored := o.pending[id]
		frame := make([]byte, len(stored))
		copy(frame, stored)
		frames = append(frames, frame)
	}
	return frames
}

// Len is how many frames are waiting for a receipt.
func (o *Outbox) Len() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.order)
}

// Ledger is the receiver's half of resume: the envelope ids of terminal frames already
// accepted.
//
// The gateway's own ledger is a database table, because it has to survive the gateway
// restarting and has to be shared between however many gateway processes a deployment
// runs. This one is the agent's, for the frames the agent receives, and for the tests
// that hold the transcripts in schemas/runner-protocol/fixtures/sessions/ to the
// contract.
//
// What it is NOT keyed on is the session. A reconnection that could not resume its
// session still has to be able to deliver the terminal frame it was holding, so
// deduplication is keyed on the frame itself and nothing else — which is why
// `ack.resumed: false` does not excuse an agent from re-sending.
type Ledger struct {
	mu   sync.Mutex
	seen map[string]struct{}
}

// NewLedger returns an empty Ledger.
func NewLedger() *Ledger {
	return &Ledger{seen: make(map[string]struct{})}
}

// Record accepts a terminal frame's envelope id and reports whether it had already been
// accepted — which is exactly `receipt.duplicate`.
//
// The name is Record rather than Seen because the order is the contract: a receiver
// records the id DURABLY and then answers. One that answered first and recorded
// afterwards would, on a crash between the two, have told the agent to stop re-sending
// a frame it had not kept.
func (l *Ledger) Record(id string) (duplicate bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, already := l.seen[id]; already {
		return true
	}
	l.seen[id] = struct{}{}
	return false
}

// Len is how many distinct terminal frames have been accepted.
func (l *Ledger) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.seen)
}
