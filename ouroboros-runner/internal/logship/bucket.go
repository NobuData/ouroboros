package logship

import "time"

// bucket is a token bucket of bytes: the session's `log_rate_bytes_per_s`, shared by every
// job this agent runs, because the rate is the connection's and not any one build's.
//
// It holds at most one second's worth, so an idle agent can send a second's output at once
// and no more. It is not safe for concurrent use; the Shipper holds its lock.
type bucket struct {
	rate   float64 // bytes a second
	tokens float64
	last   time.Time
}

// newBucket is a full bucket at rate bytes a second.
func newBucket(rate int) bucket {
	return bucket{rate: float64(rate), tokens: float64(rate) * defaultBurstRateSeconds}
}

// setRate changes the rate, keeping what is already in the bucket up to the new burst.
func (b *bucket) setRate(rate int) {
	b.rate = float64(rate)
	b.tokens = min(b.tokens, b.burst())
}

// burst is the most the bucket holds.
func (b *bucket) burst() float64 { return b.rate * defaultBurstRateSeconds }

// refill adds what has accrued since the last call. A clock that went backwards adds nothing.
func (b *bucket) refill(now time.Time) {
	if !b.last.IsZero() && now.After(b.last) {
		b.tokens = min(b.burst(), b.tokens+now.Sub(b.last).Seconds()*b.rate)
	}
	if b.last.IsZero() || now.After(b.last) {
		b.last = now
	}
}

// take grants up to want bytes, and returns how many.
func (b *bucket) take(now time.Time, want int) int {
	b.refill(now)
	granted := min(want, int(b.tokens))
	if granted <= 0 {
		return 0
	}
	b.tokens -= float64(granted)
	return granted
}

// give returns bytes taken and not spent — a chunk the session had no room for.
func (b *bucket) give(n int) {
	b.tokens = min(b.burst(), b.tokens+float64(n))
}
