package agent

import (
	"math/rand/v2"
	"time"
)

// Reconnection is the normal case, not the error case: customer machines sleep, lose
// their VPN and get rebooted, and a gateway gets deployed. So how the agent comes back
// matters as much as how it connects, and the one property that matters most is that a
// FLEET does not come back together.
//
// A control-plane restart drops every agent at the same instant. If each of them waited
// the same exponential delay, they would all reconnect in the same instant too — once,
// then again at the doubled delay, in lockstep, for as long as the gateway kept falling
// over under the load. Jitter is what breaks the lockstep, and this uses FULL jitter:
// each delay is drawn uniformly from zero up to the exponential ceiling, so a thousand
// agents dropped together arrive spread across the whole window rather than bunched at
// its end. backoff_test.go holds a simulated fleet to that.

// Default reconnection bounds.
const (
	// DefaultBackoffBase is the first ceiling — a dropped agent is back within a second.
	DefaultBackoffBase = time.Second
	// DefaultBackoffMax is the ceiling's ceiling. An agent that has failed for a while
	// still tries at least once a minute.
	DefaultBackoffMax = time.Minute
)

// Jitter draws a random duration in [0, limit). Injectable so a test can make the
// schedule deterministic; the default is math/rand/v2, which is the right tool here —
// the point is spread, not secrecy.
type Jitter func(limit time.Duration) time.Duration

// uniformJitter is the default Jitter.
func uniformJitter(limit time.Duration) time.Duration {
	if limit <= 0 {
		return 0
	}
	return time.Duration(rand.Int64N(int64(limit))) // #nosec G404 -- spreading reconnections, not a secret
}

// Backoff is exponential backoff with full jitter.
//
// It is not safe for concurrent use; the connection loop owns one.
type Backoff struct {
	// Base is the first ceiling, and the spread added to a delay the gateway named.
	Base time.Duration
	// Max bounds every ceiling.
	Max time.Duration
	// Jitter draws the random part. Nil means uniform.
	Jitter Jitter

	attempt int
}

// Next is the delay before the next attempt: uniform in [0, min(Max, Base·2^n)), where n
// is how many attempts have failed since the last [Backoff.Reset].
func (b *Backoff) Next() time.Duration {
	ceiling := b.base()
	for range b.attempt {
		if ceiling >= b.max()/2 {
			ceiling = b.max()
			break
		}
		ceiling *= 2
	}
	ceiling = min(ceiling, b.max())
	b.attempt++
	return b.jitter()(ceiling)
}

// After is the delay before reconnecting when the gateway said when: the delay it named,
// plus a spread.
//
// A gateway that told a thousand agents "come back in thirty seconds" and was obeyed
// exactly would get them all back at second thirty. So the named delay is a floor, and
// up to half of it again — or at least Base, so "come back now" is not an instant
// stampede either — is added at random.
func (b *Backoff) After(named time.Duration) time.Duration {
	spread := max(named/2, b.base())
	return named + b.jitter()(spread)
}

// Reset starts the exponential series again, after a connection that held.
func (b *Backoff) Reset() { b.attempt = 0 }

func (b *Backoff) base() time.Duration {
	if b.Base <= 0 {
		return DefaultBackoffBase
	}
	return b.Base
}

func (b *Backoff) max() time.Duration {
	if b.Max <= 0 {
		return DefaultBackoffMax
	}
	return max(b.Max, b.base())
}

func (b *Backoff) jitter() Jitter {
	if b.Jitter == nil {
		return uniformJitter
	}
	return b.Jitter
}
