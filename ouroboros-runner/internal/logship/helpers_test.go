package logship

import (
	"bytes"
	"encoding/base64"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// session is a stand-in for the agent's log channel: it records every frame it takes, and
// refuses them while a test says it is full.
type session struct {
	mu      sync.Mutex
	refuse  bool
	frames  []conn.Frame
	offered int
}

// post is Options.Post.
func (s *session) post(frame conn.Frame) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.offered++
	if s.refuse {
		return false
	}
	s.frames = append(s.frames, frame)
	return true
}

// setRefuse makes the session full (true) or not.
func (s *session) setRefuse(refuse bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refuse = refuse
}

// chunks decodes every frame taken, holding each to the contract on the way.
func (s *session) chunks(t testing.TB) []chunk {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []chunk
	for _, frame := range s.frames {
		encoded, err := conn.Encode(frame)
		if err != nil {
			t.Fatalf("encode a chunk: %v", err)
		}
		envelope, diags := conn.Decode(encoded)
		if len(diags) > 0 {
			t.Fatalf("an illegal log.chunk: %v\n%s", diags, encoded)
		}
		var payload conn.LogChunkPayload
		if err := envelope.Into(&payload); err != nil {
			t.Fatalf("read a chunk: %v", err)
		}
		data, err := base64.StdEncoding.DecodeString(payload.Data)
		if err != nil {
			t.Fatalf("decode a chunk: %v", err)
		}
		out = append(out, chunk{payload: payload, data: data})
	}
	return out
}

// chunk is one frame taken, decoded.
type chunk struct {
	payload conn.LogChunkPayload
	data    []byte
}

// clock is a rate clock a test moves by hand.
type clock struct {
	mu  sync.Mutex
	now time.Time
}

func newClock() *clock { return &clock{now: time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)} }

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// manual is a shipper whose pump never fires on its own — the test calls flush — with a
// rate clock the test moves and a short drain.
func manual(s *session, c *clock, capBytes int64) *Shipper {
	return New(Options{Post: s.post, CapBytes: capBytes, Interval: time.Hour, DrainWait: 20 * time.Millisecond, Now: c.Now})
}

// written is a job's output as it was written, byte for byte, with the stream of each run.
type written struct {
	data []byte
	runs []run
}

// run is output written to one stream, from start up to the next run's start.
type run struct {
	start  int
	stream string
}

// streamAt is the stream the byte at offset was written to.
func (w written) streamAt(offset int) string {
	i := sort.Search(len(w.runs), func(i int) bool { return w.runs[i].start > offset })
	return w.runs[i-1].stream
}

// write writes to a log and records what was written.
func (w *written) write(t testing.TB, log *Log, name string, p []byte) {
	t.Helper()
	writer := log.Stdout()
	switch name {
	case conn.StreamStderr:
		writer = log.Stderr()
	case conn.StreamRunner:
		writer = log.Runner()
	}
	n, err := writer.Write(p)
	if n != len(p) || err != nil {
		t.Fatalf("a write returned %d, %v for %d bytes: writes never fail", n, err, len(p))
	}
	if len(p) > 0 && (len(w.runs) == 0 || w.runs[len(w.runs)-1].stream != name) {
		w.runs = append(w.runs, run{start: len(w.data), stream: name})
	}
	w.data = append(w.data, p...)
}

// reassemble checks that the chunks are exactly the output with holes in it: `seq`
// contiguous from 0, each chunk's bytes found where the bytes sent and dropped before it
// put them, on the stream they were written to — and that what follows the last chunk is
// the tail the finish reports.
func reassemble(t testing.TB, chunks []chunk, out written, sum conn.FinishLog) {
	t.Helper()
	offset, sent, placed := 0, 0, 0
	for i, c := range chunks {
		if c.payload.Seq != i {
			t.Fatalf("chunk %d has seq %d: seq is 0-based and contiguous", i, c.payload.Seq)
		}
		if c.payload.Encoding != conn.EncodingBase64 {
			t.Fatalf("chunk %d is %q", i, c.payload.Encoding)
		}
		offset += c.payload.DroppedBytes
		placed += c.payload.DroppedBytes
		end := offset + len(c.data)
		if end > len(out.data) {
			t.Fatalf("chunk %d ends at %d, past the %d bytes written", i, end, len(out.data))
		}
		if !bytes.Equal(out.data[offset:end], c.data) {
			t.Fatalf("chunk %d is not the output at %d (dropped_bytes %d)", i, offset, c.payload.DroppedBytes)
		}
		// One stream per chunk: its first and last bytes, and no run starting inside it.
		for _, at := range []int{offset, end - 1} {
			if got := out.streamAt(at); got != c.payload.Stream {
				t.Fatalf("chunk %d carries byte %d as %s; it was written to %s", i, at, c.payload.Stream, got)
			}
		}
		if first := sort.Search(len(out.runs), func(r int) bool { return out.runs[r].start > offset }); first < len(out.runs) && out.runs[first].start < end {
			t.Fatalf("chunk %d spans a change of stream at byte %d", i, out.runs[first].start)
		}
		offset, sent = end, sent+len(c.data)
	}
	if sum.Chunks != len(chunks) || sum.Bytes != sent {
		t.Fatalf("the finish says %d chunks and %d bytes; %d chunks and %d bytes were sent",
			sum.Chunks, sum.Bytes, len(chunks), sent)
	}
	if sum.Bytes+sum.DroppedBytes != len(out.data) {
		t.Fatalf("%d written, but %d sent + %d dropped: a byte was lost without being counted",
			len(out.data), sum.Bytes, sum.DroppedBytes)
	}
	if tail := len(out.data) - offset; sum.DroppedBytes-placed != tail {
		t.Fatalf("the finish reports %d dropped after the last chunk; the log's tail is %d", sum.DroppedBytes-placed, tail)
	}
}

// fill is n bytes that depend on their position (a multiplicative hash of it), so a chunk
// found at the wrong offset does not match by accident.
func fill(n, from int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = byte((uint32(from+i) * 2654435761) >> 24) // #nosec G115 -- a test pattern
	}
	return out
}
