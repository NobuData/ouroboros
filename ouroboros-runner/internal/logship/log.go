package logship

import (
	"encoding/base64"
	"io"
	"sync"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// Log is one job's output on its way to the gateway.
//
//	stdout ┐                         ┌─ fits ──────▶ buffer (≤ BufferBytes, ordered, one stream per run)
//	       ├─▶ Write ─▶ under the cap ┤                    │ every Interval: ≤ MaxChunksPerFlush chunks,
//	stderr ┘      │                   └─ full ─▶ summary    │ within the shared rate, `seq` spent only
//	              │                              mode:      ▼ when the session takes the frame
//	              └─ past the cap ─▶ tail        counted   log.chunk{seq, stream, data, dropped_bytes}
//
// Nothing a build writes is lost without being counted. Every byte is either sent in a
// chunk or reported as dropped: before the chunk that follows the hole (`dropped_bytes`),
// or — when nothing follows it — in the total `job.finish.log.dropped_bytes` carries, which
// the gateway reads as the log's tail. That is the invariant Close's result keeps:
// written = Bytes + DroppedBytes.
//
// Writes never block and never fail, so a stalled connection never stalls a compiler; and
// what the log holds is bounded by BufferBytes and MaxSegments, however much is written.
type Log struct {
	shipper *Shipper
	job     string

	stop chan struct{}
	done chan struct{}
	once sync.Once
	sum  conn.FinishLog

	mu       sync.Mutex
	segments []segment
	buffered int   // bytes held in segments
	admitted int64 // bytes ever held, which the cap counts
	written  int64 // bytes ever written
	closed   bool

	// summary is true while output is being counted rather than kept, from a write that
	// found the buffer full until it has drained to half.
	summary bool
	// pending is output dropped since the last byte held — placed before the next one held,
	// or part of the tail when nothing more is.
	pending int64
	// capped is true once CapBytes have been held: from then on everything is tail.
	capped bool
	// tail is output dropped past the cap: after the last byte held, whatever follows.
	tail int64

	seq    int   // chunks sent — the next chunk's `seq`
	sent   int64 // bytes sent
	placed int64 // dropped bytes sent as some chunk's `dropped_bytes`
}

// segment is a run of output on one stream, and what was dropped immediately before it.
type segment struct {
	stream  string
	data    []byte
	dropped int64
}

// Stdout is the writer for the job's standard output.
func (l *Log) Stdout() io.Writer { return stream{l, conn.StreamStdout} }

// Stderr is the writer for the job's standard error.
func (l *Log) Stderr() io.Writer { return stream{l, conn.StreamStderr} }

// stream is one of a Log's two writers.
type stream struct {
	log  *Log
	name string
}

// Write takes the whole of p, always: what the log cannot hold is counted as dropped.
func (s stream) Write(p []byte) (int, error) {
	s.log.write(s.name, p)
	return len(p), nil
}

// write holds as much of p as the cap and the buffer allow, and counts the rest.
//
// Only bytes that are held count toward the cap, so the cap is a position in the log: the
// CapBytes-th byte held. Output dropped before it — in summary mode — is a hole before the
// next byte held; output after it is the tail.
func (l *Log) write(name string, p []byte) {
	l.mu.Lock()
	defer l.mu.Unlock()

	n := int64(len(p))
	l.written += n
	if l.closed {
		return // the finish has been counted; a write this late is only in Written
	}

	if l.capped {
		l.tail += n
		return
	}
	if l.summary {
		if l.buffered > BufferBytes/2 {
			l.pending += n
			return
		}
		l.summary = false
	}

	fit := min(n, int64(BufferBytes-l.buffered), l.shipper.capBytes-l.admitted)
	if !l.canMerge(name) && len(l.segments) >= MaxSegments {
		fit = 0
	}
	if fit > 0 {
		l.hold(name, p[:fit])
	}
	switch rest := n - fit; {
	case rest == 0:
	case l.admitted >= l.shipper.capBytes:
		// The cap keeps the head of the log, as the control plane's does: the first CapBytes
		// held are the most that is ever sent, and everything written after them is tail.
		l.capped = true
		l.tail += rest
	default:
		l.pending += rest
		l.summary = true
	}
}

// canMerge reports whether output on this stream extends the last segment: same stream,
// and nothing dropped in between.
func (l *Log) canMerge(name string) bool {
	return len(l.segments) > 0 && l.segments[len(l.segments)-1].stream == name && l.pending == 0
}

// hold appends output to the buffer, carrying whatever was dropped just before it.
func (l *Log) hold(name string, p []byte) {
	if l.canMerge(name) {
		last := &l.segments[len(l.segments)-1]
		last.data = append(last.data, p...)
	} else {
		l.segments = append(l.segments, segment{stream: name, data: append([]byte(nil), p...), dropped: l.pending})
		l.pending = 0
	}
	l.buffered += len(p)
	l.admitted += int64(len(p))
}

// pump flushes every Interval until Close stops it.
func (l *Log) pump() {
	defer close(l.done)
	ticker := time.NewTicker(l.shipper.interval)
	defer ticker.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-ticker.C:
			l.flush()
		}
	}
}

// flush sends what the throttle allows, and reports how many chunks that was.
//
// Each chunk is a prefix of the oldest segment: one stream, at most the session's chunk
// size, and never across a hole — so its `dropped_bytes` is exactly what was dropped
// before its first byte. A chunk the session does not take is not sent at all: its bytes
// stay held, its `seq` is not spent and its share of the rate is returned.
func (l *Log) flush() int {
	l.mu.Lock()
	defer l.mu.Unlock()

	sent := 0
	for sent < MaxChunksPerFlush && len(l.segments) > 0 {
		head := &l.segments[0]
		granted, chunkMax := l.shipper.grant(l.shipper.now(), len(head.data))
		if want := min(len(head.data), chunkMax); granted < want && granted < MinSendBytes {
			l.shipper.refund(granted)
			break
		}

		frame := conn.NewFrame(conn.NewID(), conn.TypeLogChunk, conn.LogChunkPayload{
			Job:          l.job,
			Seq:          l.seq,
			Stream:       head.stream,
			Encoding:     conn.EncodingBase64,
			Data:         base64.StdEncoding.EncodeToString(head.data[:granted]),
			DroppedBytes: int(head.dropped),
		})
		if !l.shipper.post(frame) {
			l.shipper.refund(granted)
			break
		}

		l.seq++
		l.sent += int64(granted)
		l.placed += head.dropped
		head.dropped = 0
		head.data = head.data[granted:]
		l.buffered -= granted
		if len(head.data) == 0 {
			l.segments[0] = segment{}
			l.segments = l.segments[1:]
		}
		sent++
	}
	if len(l.segments) == 0 {
		l.segments = nil // let a drained buffer's backing array go
	}
	return sent
}

// Close stops the throttle, gives what is still held up to DrainWait to leave, and
// returns what `job.finish.log` reports: the bytes and chunks sent, and every byte dropped.
// It is called once the job's command has ended — its writers are done — and a second call
// returns the same result. Output written after Close is not in it.
func (l *Log) Close() conn.FinishLog {
	l.once.Do(func() {
		close(l.stop)
		<-l.done

		// The drain is bounded by the wall clock, whatever clock the rate is measured by.
		deadline := time.Now().Add(l.shipper.drainWait)
		for {
			l.flush()
			if l.empty() || !time.Now().Before(deadline) {
				break
			}
			time.Sleep(min(l.shipper.interval, time.Until(deadline)))
		}

		l.mu.Lock()
		defer l.mu.Unlock()
		l.closed = true
		unsent := l.pending + l.tail
		for _, held := range l.segments {
			unsent += held.dropped + int64(len(held.data))
		}
		l.segments, l.buffered, l.pending, l.tail = nil, 0, 0, 0
		l.sum = conn.FinishLog{Bytes: int(l.sent), Chunks: l.seq, DroppedBytes: int(l.placed + unsent)}
	})
	return l.sum
}

// empty reports whether nothing is held.
func (l *Log) empty() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.segments) == 0
}

// Written is every byte written to the log, kept or not — for the agent's own record of how
// verbose a job was.
func (l *Log) Written() int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.written
}
