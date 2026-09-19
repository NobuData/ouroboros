package logship

import (
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// The shipper's operating values. The chunk size and the byte rate are the gateway's, sent
// in every `ack.limits`; these are the agent's own, and they are what bounds its memory and
// its chunk frequency however verbose a build is.
const (
	// Interval is the least time between two flushes of one job's output — the throttle that
	// keeps a build emitting continuously from becoming a frame per write.
	Interval = 250 * time.Millisecond

	// MaxChunksPerFlush bounds what one flush sends, so a job's chunk frequency is at most
	// MaxChunksPerFlush per Interval (32 a second) even when its streams alternate write by
	// write and every chunk is small.
	MaxChunksPerFlush = 8

	// BufferBytes is the most output one job holds waiting to be sent. Past it the job's log
	// is in summary mode: output is counted, not kept, until the buffer has drained to half.
	BufferBytes = 256 * 1024

	// MaxSegments bounds the bookkeeping behind that buffer — one entry per run of output
	// on one stream — so a build that alternates stdout and stderr a byte at a time cannot
	// grow it past the byte bound's worth of headers.
	MaxSegments = 4096

	// DrainWait bounds how long a finished job's remaining output is given to leave before
	// what is left is reported as dropped. It fits inside agent.DefaultJobStopWait's margin,
	// so a job stopped by a shutdown still reports before the agent says bye.
	DrainWait = 2 * time.Second

	// MinSendBytes is the smallest chunk the throttle cuts short. A flush that can only
	// afford less than this — and less than the whole of what is waiting — waits for the
	// next one rather than spending a frame on a sliver.
	MinSendBytes = 1024
)

// The per-job byte cap the agent enforces itself (`--log-cap-bytes`), so that a build that
// prints four gigabytes does not ship four gigabytes for the control plane to discard. The
// default and the range are V040's `build_jobs.log_cap_bytes`, the control plane's own cap.
const (
	DefaultCapBytes int64 = 64 * 1024 * 1024
	MinCapBytes     int64 = 64 * 1024
	MaxCapBytes     int64 = 256 * 1024 * 1024
)

// The session limits a shipper uses before any `ack` has named them: the protocol's
// ceiling for a chunk, and the rate the protocol's own `ack` example sends.
const (
	DefaultChunkMaxBytes    = conn.LogChunkMaxBytes
	DefaultRateBytesPerS    = 256 * 1024
	minChunkMaxBytes        = 1024
	minRateBytesPerS        = 1024
	defaultBurstRateSeconds = 1
)
