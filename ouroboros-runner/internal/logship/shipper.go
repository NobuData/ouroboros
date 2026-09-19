package logship

import (
	"sync"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// Options configures a Shipper. Only Post is required; every zero value is a default.
type Options struct {
	// Post hands a `log.chunk` frame to the live session and reports whether it was taken.
	// It must never block: false — no session, or no room — leaves the output where it is,
	// and a job whose output keeps being refused goes into summary mode rather than
	// growing. A frame Post took has its `seq` spent, whether or not a socket then carries it.
	Post func(conn.Frame) bool

	// CapBytes is the per-job cap: the most of one job's output that is ever sent. Zero
	// means DefaultCapBytes. Values outside MinCapBytes–MaxCapBytes are clamped into it.
	CapBytes int64

	// Interval and DrainWait override the package's throttle and drain bound, for tests.
	Interval  time.Duration
	DrainWait time.Duration

	// Now is the clock the rate is measured by. Nil means time.Now.
	Now func() time.Time
}

// Shipper carries every job's output to the gateway, within the session's limits: the
// largest chunk the gateway accepts, and the byte rate the connection is throttled to.
// Both come from each `ack` (SetLimits), and the rate is one budget shared by all the jobs
// the agent is running.
type Shipper struct {
	post      func(conn.Frame) bool
	capBytes  int64
	interval  time.Duration
	drainWait time.Duration
	now       func() time.Time

	mu       sync.Mutex
	chunkMax int
	bucket   bucket
}

// New is a shipper with the default session limits, until SetLimits names the gateway's.
func New(options Options) *Shipper {
	s := &Shipper{
		post:      options.Post,
		capBytes:  options.CapBytes,
		interval:  options.Interval,
		drainWait: options.DrainWait,
		now:       options.Now,
		chunkMax:  DefaultChunkMaxBytes,
		bucket:    newBucket(DefaultRateBytesPerS),
	}
	if s.post == nil {
		s.post = func(conn.Frame) bool { return false }
	}
	if s.capBytes == 0 {
		s.capBytes = DefaultCapBytes
	}
	s.capBytes = min(max(s.capBytes, MinCapBytes), MaxCapBytes)
	if s.interval <= 0 {
		s.interval = Interval
	}
	if s.drainWait <= 0 {
		s.drainWait = DrainWait
	}
	if s.now == nil {
		s.now = time.Now
	}
	return s
}

// SetLimits adopts a session's `ack.limits`: its chunk size and its byte rate. Values the
// contract would not allow — which a validated ack never carries — are clamped into it, so
// a shipper never builds a chunk the gateway would refuse.
func (s *Shipper) SetLimits(limits conn.Limits) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.chunkMax = min(max(limits.LogChunkMaxBytes, minChunkMaxBytes), conn.LogChunkMaxBytes)
	s.bucket.setRate(max(limits.LogRateBytesPerS, minRateBytesPerS))
}

// Limits is the chunk size and byte rate the shipper is using.
func (s *Shipper) Limits() (chunkMaxBytes, rateBytesPerS int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.chunkMax, int(s.bucket.rate)
}

// CapBytes is the per-job cap in force.
func (s *Shipper) CapBytes() int64 { return s.capBytes }

// Open starts shipping one job's output. The caller writes the job's streams to the Log's
// writers and calls Close once the job's command has ended.
func (s *Shipper) Open(job string) *Log {
	log := &Log{
		shipper: s,
		job:     job,
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}
	go log.pump()
	return log
}

// grant takes up to want bytes of the shared rate, and the chunk size in force.
func (s *Shipper) grant(now time.Time, want int) (granted, chunkMax int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.bucket.take(now, min(want, s.chunkMax)), s.chunkMax
}

// refund returns bytes granted and not sent.
func (s *Shipper) refund(n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bucket.give(n)
}
