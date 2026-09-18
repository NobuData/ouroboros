package conn

import (
	"crypto/rand"
	"fmt"
	"io"
	"sync"
	"time"
)

// Envelope ids, minted.
//
// Every frame carries a ULID (docs/RUNNER_PROTOCOL.md § IDs): 48 bits of milliseconds
// and 80 bits of randomness, written as 26 Crockford base32 characters. The shape is
// fixed because the first ten characters encode the millisecond the id was minted, so
// ids SORT BY TIME — a session log sorts into the order it happened, and a duplicate is
// adjacent to its original.
//
// That property is load-bearing for this agent in one more place: the durable outbox
// (internal/state) names each unacknowledged terminal frame's file after its envelope
// id, and after a restart it re-sends them in file-name order. Mint order and name order
// have to be the same order, which two ids minted in the same millisecond would not
// otherwise guarantee — so this minter is MONOTONIC: a second id in the same
// millisecond is the first one's random part plus one, and a clock that steps
// backwards does not make a later id sort earlier.

// crockford is the ULID alphabet: base32 without I, L, O or U, so an id read aloud or
// copied by hand cannot be misread.
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// IDMinter mints monotonic ULIDs. The zero value is not usable; see [NewIDMinter].
//
// It is safe for concurrent use: the heartbeat ticker, the executor and the
// connection loop all mint ids for the frames they write.
type IDMinter struct {
	mu     sync.Mutex
	now    func() time.Time
	random io.Reader

	lastMS uint64
	hi     uint16 // the top 16 of the 80 random bits
	lo     uint64 // the bottom 64
}

// NewIDMinter is a minter reading the given clock and entropy source. Production uses
// [NewID], which reads the wall clock and crypto/rand; tests pass their own, so that a
// same-millisecond burst and a clock stepping backwards are cases rather than accidents.
func NewIDMinter(now func() time.Time, random io.Reader) *IDMinter {
	return &IDMinter{now: now, random: random}
}

// defaultMinter is the process-wide minter behind [NewID]. One per process, because
// monotonicity is only a guarantee inside one minter.
var defaultMinter = NewIDMinter(time.Now, rand.Reader)

// NewID mints a ULID for an envelope, from the wall clock and crypto/rand.
//
// It panics if the operating system's entropy source fails, which is the one failure
// crypto/rand itself treats as unrecoverable: an id that is not random is an id that
// can collide with another agent's, and a collided terminal id is a finished job the
// gateway deduplicates away.
func NewID() string {
	id, err := defaultMinter.Mint()
	if err != nil {
		panic(err)
	}
	return id
}

// Mint returns the next id.
//
// Inside one millisecond, the random part is incremented rather than redrawn, so the
// ids stay in mint order; across milliseconds it is drawn fresh. A clock that has moved
// backwards is treated as the last millisecond seen, for the same reason. The 80-bit
// increment overflowing — 2^80 ids in one millisecond — moves the id into the next
// millisecond rather than wrapping to a smaller one.
func (m *IDMinter) Mint() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ms := uint64(max(m.now().UnixMilli(), 0)) // #nosec G115 -- clamped to zero first

	if ms > m.lastMS || (m.lastMS == 0 && m.hi == 0 && m.lo == 0) {
		var entropy [10]byte
		if _, err := io.ReadFull(m.random, entropy[:]); err != nil {
			return "", fmt.Errorf("draw entropy for an envelope id: %w", err)
		}
		m.lastMS = ms
		m.hi = uint16(entropy[0])<<8 | uint16(entropy[1])
		m.lo = 0
		for _, b := range entropy[2:] {
			m.lo = m.lo<<8 | uint64(b)
		}
	} else {
		m.lo++
		if m.lo == 0 {
			m.hi++
			if m.hi == 0 {
				m.lastMS++
			}
		}
	}

	return encodeULID(m.lastMS, m.hi, m.lo), nil
}

// encodeULID writes a 48-bit millisecond count and an 80-bit random value as the 26
// characters of a ULID: ten for the time, sixteen for the randomness.
func encodeULID(ms uint64, hi uint16, lo uint64) string {
	var out [26]byte
	for i := 9; i >= 0; i-- {
		out[i] = crockford[ms&31]
		ms >>= 5
	}
	high := uint64(hi)
	for i := 25; i >= 10; i-- {
		out[i] = crockford[lo&31]
		lo = lo>>5 | high<<59
		high >>= 5
	}
	return string(out[:])
}
