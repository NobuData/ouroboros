package logship

import (
	"math/rand/v2"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

const testJob = "job_01KE7J4EZ3204KQXMHJRPQPWQ6"

// fastLimits is a session whose rate never gets in a test's way.
var fastLimits = conn.Limits{LogChunkMaxBytes: conn.LogChunkMaxBytes, LogRateBytesPerS: 1 << 30}

// fast is a manual shipper whose rate never gets in the test's way: a very high rate, with
// the clock moved on a second so the bucket holds a full second of it.
func fast(s *session, c *clock, capBytes int64) *Shipper {
	shipper := manual(s, c, capBytes)
	shipper.SetLimits(fastLimits)
	shipper.grant(c.Now(), 0) // the bucket's first reading, so the second below counts
	c.advance(time.Second)
	return shipper
}

// drain flushes until nothing is held or a flush sends nothing.
func drain(log *Log) {
	for !log.empty() && log.flush() > 0 {
	}
}

func TestChunksAreInOrderContiguousAndOneStreamEach(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, 0)
	log := shipper.Open(testJob)
	var out written

	out.write(t, log, conn.StreamStdout, []byte("west build -b nrf52840dk\n"))
	out.write(t, log, conn.StreamStdout, []byte("-- Zephyr version: 3.7.0\n"))
	out.write(t, log, conn.StreamStderr, []byte("warning: unused variable 'x'\n"))
	out.write(t, log, conn.StreamStdout, []byte("[412/525] Linking C executable zephyr.elf\n"))
	drain(log)
	sum := log.Close()

	chunks := s.chunks(t)
	if len(chunks) != 3 {
		t.Fatalf("got %d chunks; want 3 — one per run of output on one stream", len(chunks))
	}
	for i, want := range []string{conn.StreamStdout, conn.StreamStderr, conn.StreamStdout} {
		if chunks[i].payload.Stream != want || chunks[i].payload.Job != testJob {
			t.Errorf("chunk %d is %s of %s; want %s of %s", i, chunks[i].payload.Stream, chunks[i].payload.Job, want, testJob)
		}
	}
	reassemble(t, chunks, out, sum)
	if sum.DroppedBytes != 0 {
		t.Errorf("nothing was dropped, but the finish says %d", sum.DroppedBytes)
	}
}

func TestAChunkIsNeverLargerThanTheSessionAllows(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := manual(s, c, 0)
	shipper.SetLimits(conn.Limits{LogChunkMaxBytes: 1024, LogRateBytesPerS: 1 << 30})
	log := shipper.Open(testJob)
	var out written
	out.write(t, log, conn.StreamStdout, fill(5000, 0))
	drain(log)
	sum := log.Close()

	chunks := s.chunks(t)
	for i, c := range chunks {
		if len(c.data) > 1024 {
			t.Errorf("chunk %d carries %d bytes; the session allows 1024", i, len(c.data))
		}
	}
	if len(chunks) != 5 {
		t.Errorf("got %d chunks for 5000 bytes at 1024; want 5", len(chunks))
	}
	reassemble(t, chunks, out, sum)
}

func TestOneFlushSendsAtMostMaxChunksPerFlush(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, 0)
	log := shipper.Open(testJob)
	var out written
	// Twenty alternating runs: twenty chunks, however small.
	for i := range 20 {
		name := conn.StreamStdout
		if i%2 == 1 {
			name = conn.StreamStderr
		}
		out.write(t, log, name, fill(10, i*10))
	}

	for _, want := range []int{MaxChunksPerFlush, MaxChunksPerFlush, 20 - 2*MaxChunksPerFlush, 0} {
		if got := log.flush(); got != want {
			t.Fatalf("a flush sent %d chunks; want %d (at most %d a flush)", got, want, MaxChunksPerFlush)
		}
	}
	sum := log.Close()
	reassemble(t, s.chunks(t), out, sum)
}

func TestTheRateIsOneBudgetSharedByEveryJob(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := manual(s, c, 0)
	shipper.SetLimits(conn.Limits{LogChunkMaxBytes: conn.LogChunkMaxBytes, LogRateBytesPerS: 4096})
	first, second := shipper.Open(testJob), shipper.Open("job_01KE7J4EZ3204KQXMHJRPQPWQ7")
	var outFirst, outSecond written
	outFirst.write(t, first, conn.StreamStdout, fill(4096, 0))
	outSecond.write(t, second, conn.StreamStdout, fill(4096, 0))

	first.flush()
	if got := second.flush(); got != 0 {
		t.Fatalf("the second job sent %d chunks with the second's budget already spent by the first", got)
	}
	c.advance(500 * time.Millisecond)
	second.flush()
	c.advance(500 * time.Millisecond)
	second.flush()

	var sentFirst, sentSecond int
	for _, chunk := range s.chunks(t) {
		if chunk.payload.Job == testJob {
			sentFirst += len(chunk.data)
		} else {
			sentSecond += len(chunk.data)
		}
	}
	if sentFirst != 4096 || sentSecond != 4096 {
		t.Errorf("sent %d and %d; want each job's 4096 inside one 4096 B/s budget over a second", sentFirst, sentSecond)
	}
}

func TestAThrottledFlushWaitsRatherThanSendingASliver(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := manual(s, c, 0)
	shipper.SetLimits(conn.Limits{LogChunkMaxBytes: conn.LogChunkMaxBytes, LogRateBytesPerS: 4096})
	log := shipper.Open(testJob)
	var out written
	out.write(t, log, conn.StreamStdout, fill(4096+2000, 0))

	log.flush() // the burst: 4096
	c.advance(100 * time.Millisecond)
	if got := log.flush(); got != 0 {
		t.Fatalf("a flush with ~409 bytes of budget sent %d chunks; it should wait for %d", got, MinSendBytes)
	}
	c.advance(time.Second)
	log.flush()
	sum := log.Close()
	reassemble(t, s.chunks(t), out, sum)
	for i, chunk := range s.chunks(t) {
		if len(chunk.data) < MinSendBytes {
			t.Errorf("chunk %d is a %d-byte sliver", i, len(chunk.data))
		}
	}
}

func TestARefusedChunkSpendsNoSeqAndLosesNothing(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, 0)
	log := shipper.Open(testJob)
	var out written
	out.write(t, log, conn.StreamStdout, fill(3000, 0))

	s.setRefuse(true)
	if got := log.flush(); got != 0 {
		t.Fatalf("a full session took %d chunks", got)
	}
	if s.offered != 1 {
		t.Fatalf("a refused flush offered %d frames; it should stop at the first refusal", s.offered)
	}
	s.setRefuse(false)
	drain(log)
	chunks := s.chunks(t)
	if len(chunks) != 1 || chunks[0].payload.Seq != 0 || chunks[0].payload.DroppedBytes != 0 {
		t.Fatalf("after a refusal the output went as %+v; want one chunk, seq 0, nothing dropped", chunks)
	}
	sum := log.Close()
	reassemble(t, s.chunks(t), out, sum)
}

// A session that stays full is the stall the issue is about: the buffer fills, the log goes
// into summary mode and counts, and when the session takes frames again the hole is marked
// on the first chunk after it — exactly where it was, and exactly as large.
func TestAStalledSessionPutsTheLogInSummaryModeAndMarksTheHole(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, 0)
	log := shipper.Open(testJob)
	var out written

	s.setRefuse(true)
	out.write(t, log, conn.StreamStdout, fill(BufferBytes+100, 0))
	log.flush()
	out.write(t, log, conn.StreamStdout, fill(50_000, BufferBytes+100)) // counted, not kept
	s.setRefuse(false)

	drain(log) // the buffer empties, and summary mode ends at the next write
	out.write(t, log, conn.StreamStderr, []byte("error: region `FLASH' overflowed by 1024 bytes\n"))
	drain(log)
	sum := log.Close()

	chunks := s.chunks(t)
	reassemble(t, chunks, out, sum)
	last := chunks[len(chunks)-1]
	if last.payload.Stream != conn.StreamStderr || last.payload.DroppedBytes != 100+50_000 {
		t.Fatalf("the chunk after the stall is %s with dropped_bytes %d; want stderr after 50100 dropped",
			last.payload.Stream, last.payload.DroppedBytes)
	}
	if sum.DroppedBytes != 50_100 {
		t.Errorf("the finish reports %d dropped; want 50100", sum.DroppedBytes)
	}
}

func TestSummaryModeLastsUntilTheBufferHasDrainedToHalf(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, 0)
	log := shipper.Open(testJob)
	var out written

	s.setRefuse(true)
	out.write(t, log, conn.StreamStdout, fill(BufferBytes+1, 0)) // full: summary mode
	s.setRefuse(false)
	log.flush() // 8 chunks of 32 KiB: the whole buffer
	s.setRefuse(true)
	out.write(t, log, conn.StreamStdout, fill(10, BufferBytes+1))
	if log.buffered != 10 {
		t.Fatalf("with the buffer drained below half, a write was not held (buffered %d)", log.buffered)
	}

	// Refill past half and stay in summary mode while above it.
	out.write(t, log, conn.StreamStdout, fill(BufferBytes, BufferBytes+11))
	held := log.buffered
	out.write(t, log, conn.StreamStdout, fill(100, 2*BufferBytes+11))
	if log.buffered != held {
		t.Fatalf("a write in summary mode above half was held (%d → %d)", held, log.buffered)
	}
	s.setRefuse(false)
	drain(log)
	sum := log.Close()
	reassemble(t, s.chunks(t), out, sum)
}

func TestTheCapKeepsTheHeadAndReportsTheRestAsTheTail(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, MinCapBytes)
	log := shipper.Open(testJob)
	var out written
	for i := range 10 {
		out.write(t, log, conn.StreamStdout, fill(10_000, i*10_000))
		drain(log)
	}
	sum := log.Close()

	chunks := s.chunks(t)
	reassemble(t, chunks, out, sum)
	if sum.Bytes != int(MinCapBytes) || sum.DroppedBytes != 100_000-int(MinCapBytes) {
		t.Fatalf("sent %d and dropped %d of 100000 under a %d cap; want the head sent and the rest dropped",
			sum.Bytes, sum.DroppedBytes, MinCapBytes)
	}
	for i, chunk := range chunks {
		if chunk.payload.DroppedBytes != 0 {
			t.Errorf("chunk %d carries dropped_bytes %d; the cap's drops are the tail, after every chunk", i, chunk.payload.DroppedBytes)
		}
	}
}

func TestTheCapIsClampedToTheControlPlanesRange(t *testing.T) {
	for _, testCase := range []struct{ asked, want int64 }{
		{0, DefaultCapBytes}, {1, MinCapBytes}, {MinCapBytes, MinCapBytes},
		{MaxCapBytes + 1, MaxCapBytes}, {100 * 1024 * 1024, 100 * 1024 * 1024},
	} {
		if got := New(Options{CapBytes: testCase.asked}).CapBytes(); got != testCase.want {
			t.Errorf("a cap of %d became %d; want %d", testCase.asked, got, testCase.want)
		}
	}
}

func TestSetLimitsKeepsChunksInsideTheContract(t *testing.T) {
	shipper := New(Options{})
	if chunk, rate := shipper.Limits(); chunk != DefaultChunkMaxBytes || rate != DefaultRateBytesPerS {
		t.Fatalf("before any ack the limits are %d, %d; want %d, %d", chunk, rate, DefaultChunkMaxBytes, DefaultRateBytesPerS)
	}
	for _, testCase := range []struct {
		limits          conn.Limits
		wantChunk, want int
	}{
		{conn.Limits{LogChunkMaxBytes: 0, LogRateBytesPerS: 0}, 1024, 1024},
		{conn.Limits{LogChunkMaxBytes: 99_999, LogRateBytesPerS: 262_144}, conn.LogChunkMaxBytes, 262_144},
		{conn.Limits{LogChunkMaxBytes: 4096, LogRateBytesPerS: 8192}, 4096, 8192},
	} {
		shipper.SetLimits(testCase.limits)
		if chunk, rate := shipper.Limits(); chunk != testCase.wantChunk || rate != testCase.want {
			t.Errorf("limits %+v became %d, %d; want %d, %d", testCase.limits, chunk, rate, testCase.wantChunk, testCase.want)
		}
	}
}

func TestCloseSendsWhatIsHeld(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, 0)
	log := shipper.Open(testJob)
	var out written
	out.write(t, log, conn.StreamStdout, fill(100_000, 0))
	sum := log.Close() // the pump never ran: Close is the flush

	reassemble(t, s.chunks(t), out, sum)
	if sum.Bytes != 100_000 || sum.DroppedBytes != 0 {
		t.Fatalf("Close left %d of 100000 unsent", 100_000-sum.Bytes)
	}
}

func TestCloseGivesUpAtItsDeadlineAndCountsWhatIsLeft(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := manual(s, c, 0)
	log := shipper.Open(testJob)
	var out written
	out.write(t, log, conn.StreamStdout, fill(1000, 0))
	s.setRefuse(true)

	began := time.Now()
	sum := log.Close()
	if waited := time.Since(began); waited > time.Second {
		t.Fatalf("Close waited %s for a session that never took a frame; DrainWait is 20ms", waited)
	}
	if sum.Chunks != 0 || sum.Bytes != 0 || sum.DroppedBytes != 1000 {
		t.Fatalf("got %+v; want nothing sent and all 1000 bytes reported dropped", sum)
	}
	if again := log.Close(); again != sum {
		t.Errorf("a second Close returned %+v; want the first's %+v", again, sum)
	}
}

func TestWritesAfterCloseAreCountedButChangeNothing(t *testing.T) {
	s, c := &session{}, newClock()
	log := manual(s, c, 0).Open(testJob)
	sum := log.Close()
	if n, err := log.Stdout().Write([]byte("late")); n != 4 || err != nil {
		t.Fatalf("a late write returned %d, %v", n, err)
	}
	if log.Written() != 4 || log.Close() != sum {
		t.Errorf("a late write changed the finish, or was not counted (written %d)", log.Written())
	}
}

func TestTheSegmentBookkeepingIsBounded(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, 0)
	log := shipper.Open(testJob)
	var out written

	s.setRefuse(true)
	for i := range MaxSegments + 500 {
		name := conn.StreamStdout
		if i%2 == 1 {
			name = conn.StreamStderr
		}
		out.write(t, log, name, fill(1, i))
	}
	if len(log.segments) > MaxSegments {
		t.Fatalf("%d segments held; the bound is %d", len(log.segments), MaxSegments)
	}
	if !log.summary {
		t.Fatal("a log out of segments is not in summary mode")
	}
	s.setRefuse(false)
	drain(log)
	sum := log.Close()
	reassemble(t, s.chunks(t), out, sum)
}

func TestThePumpFlushesOnItsOwn(t *testing.T) {
	s := &session{}
	shipper := New(Options{Post: s.post, Interval: 5 * time.Millisecond})
	log := shipper.Open(testJob)
	defer log.Close()
	var out written
	out.write(t, log, conn.StreamStdout, []byte("hello\n"))

	deadline := time.Now().Add(5 * time.Second)
	for len(s.chunks(t)) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("nothing was sent in 5s with a 5ms interval")
		}
		time.Sleep(time.Millisecond)
	}
}

// The invariant under anything: random writes of random sizes on random streams, a
// session that is full at random, flushes at random and a rate clock that moves at random.
// Whatever happens, every byte is sent or counted, and every chunk is where it belongs.
func TestEveryByteIsSentOrCountedUnderRandomStalls(t *testing.T) {
	for seed := range uint64(24) {
		random := rand.New(rand.NewPCG(seed, 247)) // #nosec G404 -- a seeded test, not a secret
		s, c := &session{}, newClock()
		capBytes := []int64{0, MinCapBytes, 300_000}[seed%3]
		shipper := manual(s, c, capBytes)
		shipper.SetLimits(conn.Limits{LogChunkMaxBytes: 1024 + random.IntN(32768-1024), LogRateBytesPerS: 1024 + random.IntN(400_000)})
		log := shipper.Open(testJob)
		var out written
		for range 400 {
			switch random.IntN(5) {
			case 0, 1:
				name := conn.StreamStdout
				if random.IntN(3) == 0 {
					name = conn.StreamStderr
				}
				out.write(t, log, name, fill(random.IntN(40_000), len(out.data)))
			case 2:
				s.setRefuse(random.IntN(2) == 0)
			case 3:
				log.flush()
			case 4:
				c.advance(time.Duration(random.IntN(2000)) * time.Millisecond)
			}
		}
		s.setRefuse(random.IntN(2) == 0)
		sum := log.Close()
		reassemble(t, s.chunks(t), out, sum)
	}
}

// FuzzEveryByteIsSentOrCounted drives a log from arbitrary bytes: each byte an operation.
func FuzzEveryByteIsSentOrCounted(f *testing.F) {
	f.Add([]byte{0, 1, 2, 3, 4, 5, 6, 7})
	f.Add([]byte{0, 0, 0, 0, 2, 0, 0, 3, 3, 4, 1, 1})
	f.Fuzz(func(t *testing.T, operations []byte) {
		s, c := &session{}, newClock()
		shipper := manual(s, c, MinCapBytes)
		shipper.SetLimits(conn.Limits{LogChunkMaxBytes: 1024, LogRateBytesPerS: 4096})
		log := shipper.Open(testJob)
		var out written
		for _, op := range operations {
			switch op % 6 {
			case 0:
				out.write(t, log, conn.StreamStdout, fill(int(op)*40, len(out.data)))
			case 1:
				out.write(t, log, conn.StreamStderr, fill(int(op), len(out.data)))
			case 2:
				s.setRefuse(true)
			case 3:
				s.setRefuse(false)
			case 4:
				log.flush()
			case 5:
				c.advance(time.Duration(op) * 10 * time.Millisecond)
			}
		}
		sum := log.Close()
		reassemble(t, s.chunks(t), out, sum)
	})
}

// TestTheAgentsOwnLinesTravelOnTheRunnerStream: what the agent says about a job — its artifact
// upload (#330) — is a run of its own on the `runner` stream, apart from the build's output.
func TestTheAgentsOwnLinesTravelOnTheRunnerStream(t *testing.T) {
	s, c := &session{}, newClock()
	shipper := fast(s, c, 0)
	log := shipper.Open(testJob)
	var out written

	out.write(t, log, conn.StreamStdout, []byte("[525/525] Linking C executable zephyr.elf\n"))
	out.write(t, log, conn.StreamRunner, []byte("ouroboros-runner: artifacts: uploaded 3 file(s)\n"))
	drain(log)
	sum := log.Close()

	chunks := s.chunks(t)
	if len(chunks) != 2 || chunks[1].payload.Stream != conn.StreamRunner {
		t.Fatalf("got %d chunks; want the build's, then the runner's", len(chunks))
	}
	reassemble(t, chunks, out, sum)
}
