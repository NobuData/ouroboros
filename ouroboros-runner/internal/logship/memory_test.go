package logship

import (
	"context"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
)

// noisyBytes is how much the deliberately noisy build writes: two hundred megabytes, which a
// log that buffered its backlog would hold most of.
const noisyBytes = 200 * 1024 * 1024

// heapGrowthBound is the most the heap may grow while it streams. Output held is bounded by
// BufferBytes (256 KiB) per job; the rest is the pipes' copy buffers, the frames in flight
// and the collector's slack — tens of kilobytes to a few megabytes, nowhere near 200.
const heapGrowthBound = 32 * 1024 * 1024

// A deliberately noisy build — a real shell job writing 200 MiB as fast as a pipe carries it
// — streamed through a log whose session is stalled, slow, or fast. Memory is MEASURED: the
// heap is sampled throughout, and its peak must stay within a fixed bound however the
// session behaves. And the accounting still holds: every byte is sent or counted.
func TestANoisyBuildStreamsWithinBoundedMemory(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		limits conn.Limits
		accept bool
	}{
		{"a stalled session", conn.Limits{LogChunkMaxBytes: conn.LogChunkMaxBytes, LogRateBytesPerS: DefaultRateBytesPerS}, false},
		{"a session at the default rate", conn.Limits{LogChunkMaxBytes: conn.LogChunkMaxBytes, LogRateBytesPerS: DefaultRateBytesPerS}, true},
		{"a fast session", conn.Limits{LogChunkMaxBytes: conn.LogChunkMaxBytes, LogRateBytesPerS: 64 * 1024 * 1024}, true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var sentBytes, frames atomic.Int64
			shipper := New(Options{
				Post: func(frame conn.Frame) bool {
					if !testCase.accept {
						return false
					}
					// A session that writes and forgets, as a socket does.
					frames.Add(1)
					sentBytes.Add(int64(len(frame.Payload.(conn.LogChunkPayload).Data)))
					return true
				},
				Interval:  10 * time.Millisecond,
				DrainWait: 100 * time.Millisecond,
			})
			shipper.SetLimits(testCase.limits)

			baseline, peak, stop := sampleHeap()
			log := shipper.Open(testJob)
			code, err := (&exec.Shell{}).Execute(context.Background(), exec.Job{
				ID: testJob, Kind: conn.ExecutorShell, Command: []string{"head", "-c", "209715200", "/dev/zero"},
			}, t.TempDir(), exec.Output{Stdout: log.Stdout(), Stderr: log.Stderr()})
			sum := log.Close()
			stop()

			if err != nil || code != 0 {
				t.Fatalf("the noisy job ended %d, %v", code, err)
			}
			if log.Written() != noisyBytes {
				t.Fatalf("the log saw %d bytes; the job wrote %d", log.Written(), noisyBytes)
			}
			if int64(sum.Bytes)+int64(sum.DroppedBytes) != noisyBytes {
				t.Fatalf("%d sent + %d dropped ≠ %d written", sum.Bytes, sum.DroppedBytes, noisyBytes)
			}
			if int64(sum.Chunks) != frames.Load() {
				t.Fatalf("the finish says %d chunks; the session took %d", sum.Chunks, frames.Load())
			}
			growth := int64(*peak - baseline) // #nosec G115 -- a heap reading, far below 2^63
			t.Logf("%d MiB written; %d sent in %d chunks, %d dropped; heap %d KiB before, peak growth %d KiB",
				noisyBytes>>20, sum.Bytes, sum.Chunks, sum.DroppedBytes, baseline>>10, growth>>10)
			if growth > heapGrowthBound {
				t.Fatalf("the heap grew %d MiB streaming %d MiB; the bound is %d MiB",
					growth>>20, noisyBytes>>20, heapGrowthBound>>20)
			}
		})
	}
}

// sampleHeap collects garbage, reads the heap as a baseline, and samples it every
// millisecond until stop is called. peak is the highest reading, never below the baseline,
// and valid after stop.
func sampleHeap() (baseline uint64, peak *uint64, stop func()) {
	runtime.GC()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	baseline = stats.HeapAlloc
	highest := baseline

	done := make(chan struct{})
	var finished sync.WaitGroup
	finished.Add(1)
	go func() {
		defer finished.Done()
		ticker := time.NewTicker(time.Millisecond)
		defer ticker.Stop()
		for {
			var sample runtime.MemStats
			runtime.ReadMemStats(&sample)
			highest = max(highest, sample.HeapAlloc)
			select {
			case <-done:
				return
			case <-ticker.C:
			}
		}
	}()
	return baseline, &highest, func() {
		close(done)
		finished.Wait()
	}
}
