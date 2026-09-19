package agent

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/logship"
)

// Log shipping and ccache statistics (#247) through the whole agent: a job's output reaching
// the farm in order, what a throttled session does to it and how that is reported, the
// agent's own cap, and the cache each pool's jobs run with.

// decodeChunk is a chunk's output.
func decodeChunk(t *testing.T, chunk conn.LogChunkPayload) string {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(chunk.Data)
	if err != nil {
		t.Fatalf("chunk %d is not base64: %v", chunk.Seq, err)
	}
	return string(data)
}

// assembled checks the chunks of one job against the output it produced — `seq` contiguous
// from 0, and every chunk's bytes where the bytes sent and dropped before it put them — and
// against the finish, whose totals must account for every byte written. It returns how much
// was reported as dropped before some chunk, rather than after the last one.
func assembled(t *testing.T, observed farmtest.Observed, produced string, finish conn.JobFinishPayload) (placed int) {
	t.Helper()
	offset, sent := 0, 0
	for i, chunk := range observed.Chunks {
		if chunk.Seq != i || chunk.Job != finish.Job {
			t.Fatalf("chunk %d is seq %d of %s: seq is 0-based and contiguous per job", i, chunk.Seq, chunk.Job)
		}
		data := decodeChunk(t, chunk)
		offset += chunk.DroppedBytes
		placed += chunk.DroppedBytes
		if end := offset + len(data); end > len(produced) || produced[offset:end] != data {
			t.Fatalf("chunk %d (dropped_bytes %d) is not the output at %d: %.60q", i, chunk.DroppedBytes, offset, data)
		}
		offset, sent = offset+len(data), sent+len(data)
	}
	if finish.Log.Bytes != sent || finish.Log.Chunks != len(observed.Chunks) {
		t.Fatalf("the finish says %d bytes in %d chunks; %d bytes arrived in %d",
			finish.Log.Bytes, finish.Log.Chunks, sent, len(observed.Chunks))
	}
	if finish.Log.Bytes+finish.Log.DroppedBytes != len(produced) {
		t.Fatalf("%d bytes written, but %d sent + %d dropped: output was lost without being reported",
			len(produced), finish.Log.Bytes, finish.Log.DroppedBytes)
	}
	return placed
}

// seqOf is the output a shell job produces with `seq 1 n`: every line different, so a chunk
// read at the wrong offset cannot match.
func seqOf(n int) string {
	var out strings.Builder
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&out, "%d\n", i)
	}
	return out.String()
}

// shellAgent starts an agent with a real shell executor, a cache root, and the log shipper
// tuned for a test: a short throttle and a short drain.
func shellAgent(t *testing.T, farm *farmtest.Farm, adjust func(*Config)) *harness {
	t.Helper()
	return start(t, farm, enrolled(t, farm, false), func(c *Config) {
		c.Capabilities.Shell = true
		c.Executors[conn.ExecutorShell] = &exec.Shell{Grace: time.Second}
		c.CacheRoot = filepath.Join(c.Dir.Path(), "cache")
		c.LogInterval = 10 * time.Millisecond
		c.LogDrainWait = 5 * time.Second
		if adjust != nil {
			adjust(c)
		}
	})
}

// A real build's output, shipped: the chunks arrive in order, they reassemble into exactly
// what the command printed, and they arrive after the job's start and before its finish —
// which is when the gateway closes the job's log (#253).
func TestAJobsOutputReachesTheFarmInOrderAndComplete(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetLimits(conn.Limits{HeartbeatIntervalMS: 10_000, HeartbeatJitterMS: 500, LogChunkMaxBytes: 32768,
		LogRateBytesPerS: 8 * 1024 * 1024, OfferAckMS: 5000, ResumeWindowMS: 300_000})
	h := shellAgent(t, farm, nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorShell, func(p map[string]any) {
		p["command"] = []string{"sh", "-c", "seq 1 20000"}
	})

	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	finish := finishes(t, observed)[0]
	produced := seqOf(20000)
	if dropped := assembled(t, observed, produced, finish); dropped != 0 || finish.Log.DroppedBytes != 0 {
		t.Errorf("a job whose output fitted the rate dropped %d bytes: %+v", dropped, finish.Log)
	}
	if finish.Log.Bytes != len(produced) || finish.Log.Chunks < 2 {
		t.Errorf("finish log: %+v for %d bytes", finish.Log, len(produced))
	}

	start, first, last := -1, -1, -1
	for i, arrival := range observed.Arrivals {
		switch arrival {
		case conn.TypeJobStart:
			start = i
		case conn.TypeLogChunk:
			if first < 0 {
				first = i
			}
			last = i
		}
	}
	if start < 0 || start >= first || last >= len(observed.Arrivals)-1 ||
		observed.Arrivals[len(observed.Arrivals)-1] != conn.TypeJobFinish {
		t.Errorf("the order the farm read: start at %d, chunks %d–%d, arrivals %v", start, first, last, observed.Arrivals)
	}
}

// A gateway slow to read: the agent's output is written BEFORE the finish that ends it —
// the gateway closes a job's log when it records the finish (#253), so a chunk written after
// it would be thrown away — and what could not be sent in time is dropped rather than lost,
// so the finish still accounts for every byte the build printed.
func TestAJobsOutputIsWrittenBeforeItsFinish(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	// A quick heartbeat, which is the marker for "everything written so far has arrived".
	farm.SetLimits(conn.Limits{HeartbeatIntervalMS: 1000, HeartbeatJitterMS: 0, LogChunkMaxBytes: 32768,
		LogRateBytesPerS: 8 * 1024 * 1024, OfferAckMS: 5000, ResumeWindowMS: 300_000})
	// Every frame is read a tick late, and the build keeps printing: the socket the agent writes
	// into fills, its chunks queue up inside it, and the order it writes them in — output first,
	// then the finish — is then what the farm sees. Without the backlog there is nothing to order.
	farm.SlowReads(60 * time.Millisecond)
	// A short drain, so the finish is queued while that backlog is still waiting: the moment
	// the two could be written in the wrong order.
	h := shellAgent(t, farm, func(c *Config) { c.LogDrainWait = 50 * time.Millisecond })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorShell, func(p map[string]any) {
		p["command"] = []string{"sh", "-c", "i=0; while [ $i -lt 6 ]; do seq 1 100000; i=$((i+1)); done"}
	})

	h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	// Read the rest at full speed and let it land: anything the agent wrote AFTER the finish
	// arrives now, and would be invisible to a snapshot taken the moment the finish did.
	farm.SlowReads(0)
	beats := len(farm.Observe().Heartbeats)
	observed := h.until("the backlog behind the finish", func(o farmtest.Observed) bool {
		return len(o.Heartbeats) > beats+1
	})
	finished := slices.Index(observed.Arrivals, conn.TypeJobFinish)
	chunks := 0
	for i, arrival := range observed.Arrivals {
		if arrival != conn.TypeLogChunk {
			continue
		}
		chunks++
		if i > finished {
			t.Fatalf("a log.chunk was written after the job.finish that closes its log: %v", observed.Arrivals)
		}
	}
	if chunks < 4 {
		t.Fatalf("only %d chunks queued behind a slow gateway; the order was not put to the test", chunks)
	}
	// What did not fit is dropped, not lost: the finish still accounts for every byte the build
	// printed, which is what the run console renders as an elision.
	if finish := finishes(t, observed)[0]; finish.Log.DroppedBytes == 0 || finish.Log.Chunks < chunks {
		t.Errorf("finish log: %+v behind a gateway that could not keep up", finish.Log)
	}
}

// Forced backpressure: a build louder than the session's rate. What could not be sent is
// dropped — never silently — and reported where it happened: on the next chunk when output
// follows it, and in the finish's total when nothing does.
func TestForcedBackpressureIsMarkedAndNeverSilent(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetLimits(conn.Limits{HeartbeatIntervalMS: 10_000, HeartbeatJitterMS: 500, LogChunkMaxBytes: 32768,
		LogRateBytesPerS: 256 * 1024, OfferAckMS: 5000, ResumeWindowMS: 300_000})
	h := shellAgent(t, farm, nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	// A megabyte at once — far past the rate — then a pause long enough for the backlog to
	// drain, and a last line, which is the output after the hole.
	offerJob(t, farm, 1, conn.ExecutorShell, func(p map[string]any) {
		p["command"] = []string{"sh", "-c", "seq 1 200000; sleep 3; echo AFTER"}
	})

	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	finish := finishes(t, observed)[0]
	produced := seqOf(200000) + "AFTER\n"
	placed := assembled(t, observed, produced, finish)

	if finish.Log.DroppedBytes == 0 {
		t.Fatalf("a megabyte at 256 KiB/s dropped nothing: %+v", finish.Log)
	}
	if placed == 0 {
		t.Errorf("nothing was marked as dropped before a chunk; the hole must be where it happened: %+v", finish.Log)
	}
	if last := observed.Chunks[len(observed.Chunks)-1]; !strings.HasSuffix(decodeChunk(t, last), "AFTER\n") {
		t.Errorf("the output after the hole did not arrive: %.60q", decodeChunk(t, last))
	}
	h.logged("log_dropped_bytes=")
}

// The agent's own per-job cap (`--log-cap-bytes`): the head of the log is sent, and the rest
// is the tail — reported in the finish, not marked before a chunk, because nothing follows it.
func TestTheAgentEnforcesItsOwnPerJobCap(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetLimits(conn.Limits{HeartbeatIntervalMS: 10_000, HeartbeatJitterMS: 500, LogChunkMaxBytes: 32768,
		LogRateBytesPerS: 8 * 1024 * 1024, OfferAckMS: 5000, ResumeWindowMS: 300_000})
	h := shellAgent(t, farm, func(c *Config) { c.LogCapBytes = logship.MinCapBytes })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorShell, func(p map[string]any) {
		p["command"] = []string{"sh", "-c", "seq 1 200000"}
	})

	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	finish := finishes(t, observed)[0]
	produced := seqOf(200000)
	placed := assembled(t, observed, produced, finish)
	if finish.Log.Bytes != int(logship.MinCapBytes) || placed != 0 {
		t.Errorf("under a %d-byte cap the agent sent %d bytes with %d marked before a chunk",
			logship.MinCapBytes, finish.Log.Bytes, placed)
	}
	if finish.Log.DroppedBytes != len(produced)-int(logship.MinCapBytes) {
		t.Errorf("the tail is %d of %d bytes written", finish.Log.DroppedBytes, len(produced))
	}
}

// ccacheExecutor is a build that uses ccache: it writes the job's statistics log where the
// agent told it to, as ccache 4 does, and records the environment and mounts it was given.
type ccacheExecutor struct {
	fakeExecutor
	hits, misses int
}

func (c *ccacheExecutor) Execute(ctx context.Context, job exec.Job, workspace string, output exec.Output) (int, error) {
	var log strings.Builder
	for range c.hits {
		log.WriteString("# src/main.c\ndirect_cache_hit\nlocal_storage_hit\n")
	}
	for range c.misses {
		log.WriteString("# src/main.c\ncache_miss\ndirect_cache_miss\npreprocessed_cache_miss\n")
	}
	for _, entry := range job.Env {
		if inside, found := strings.CutPrefix(entry, logship.EnvCcacheStatsLog+"="); found {
			if err := os.WriteFile(throughMounts(inside, job.Mounts), []byte(log.String()), 0o600); err != nil {
				return 0, err
			}
		}
	}
	return c.fakeExecutor.Execute(ctx, job, workspace, output)
}

// throughMounts is where a path the job sees is on the host: a container job writes its
// statistics log through the mount the agent gave it, as a real build in a container does.
func throughMounts(inside string, mounts []exec.Mount) string {
	for _, mount := range mounts {
		if rest, found := strings.CutPrefix(inside, mount.Target+"/"); found {
			return filepath.Join(mount.Host, filepath.FromSlash(rest))
		}
	}
	return inside
}

// A job that used ccache reports its own hit rate; one that did not reports null — "no cache
// here", never 0% (decision B5) — and each pool's jobs run against their own cache directory.
func TestCcacheStatisticsReachTheFinishAndAreNullWithoutACache(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	cached := &ccacheExecutor{fakeExecutor: fakeExecutor{kind: conn.ExecutorContainer}, hits: 412, misses: 113}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) {
		c.Executors[conn.ExecutorContainer] = cached
		c.CacheRoot = filepath.Join(c.Dir.Path(), "cache")
		c.LogInterval = 10 * time.Millisecond
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorContainer, nil)

	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	finish := finishes(t, observed)[0]
	if finish.Ccache == nil || finish.Ccache.Hits != 412 || finish.Ccache.Misses != 113 ||
		finish.Ccache.HitRatePct != 78.48 || finish.Ccache.MaxSizeMB == 0 {
		t.Fatalf("ccache: %+v", finish.Ccache)
	}

	// The job ran with its pool's cache: the directory for pool-a, its own statistics log,
	// and — a container job — the pool's directory mounted where the variables point.
	ran := cached.jobs()[0]
	cache := filepath.Join(h.dir.Path(), "cache", "pool-a")
	if !slices.Contains(ran.Env, logship.EnvCcacheDir+"="+logship.CacheMountTarget+"/ccache") ||
		!slices.Contains(ran.Env, logship.EnvCcacheStatsLog+"="+logship.CacheMountTarget+"/stats/"+job(1)+".log") {
		t.Errorf("the job's environment: %q", ran.Env)
	}
	if !slices.Equal(ran.Mounts, []exec.Mount{{Host: cache, Target: logship.CacheMountTarget}}) {
		t.Errorf("the job's mounts: %v", ran.Mounts)
	}
	if _, err := os.Stat(filepath.Join(cache, "ccache")); err != nil {
		t.Errorf("the pool's cache directory: %v", err)
	}

	// A second job of another pool: a cache directory of its own, and no ccache at all, which
	// is null rather than a hit rate of zero.
	cached.hits, cached.misses = 0, 0
	offerJob(t, farm, 2, conn.ExecutorContainer, func(p map[string]any) { p["pool"] = "pool-b" })
	observed = h.until("the second finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 2 })
	second := finishes(t, observed)[1]
	if second.Ccache != nil {
		t.Errorf("a build that measured no compilation reported %+v; want null", second.Ccache)
	}
	if raw := observed.FinishFrames[1]; !strings.Contains(string(raw), `"ccache":null`) {
		t.Errorf("the finish frame does not carry a null ccache: %s", raw)
	}
	if dir := cacheDirOf(t, cached.jobs()[1]); dir == cacheDirOf(t, ran) {
		t.Errorf("pool-b's job ran against pool-a's cache: %s", dir)
	}
	if _, err := os.Stat(filepath.Join(h.dir.Path(), "cache", "pool-b", "ccache")); err != nil {
		t.Errorf("pool-b's cache directory: %v", err)
	}
}

// cacheDirOf is the CCACHE_DIR a job ran with — for a container job, the host directory its
// mount carries there.
func cacheDirOf(t *testing.T, job exec.Job) string {
	t.Helper()
	if len(job.Mounts) != 1 {
		t.Fatalf("a container job has one mount, not %v", job.Mounts)
	}
	return job.Mounts[0].Host
}

// `seq` is contiguous per job across a reconnect: the numbering does not restart when the
// socket does, so a gap in it is a lost frame and nothing else.
func TestSeqContinuesAcrossAReconnect(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := shellAgent(t, farm, nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorShell, func(p map[string]any) {
		p["command"] = []string{"sh", "-c", "i=0; while [ $i -lt 40 ]; do echo \"line $i\"; sleep 0.05; i=$((i+1)); done"}
	})

	h.until("the first chunks", func(o farmtest.Observed) bool { return len(o.Chunks) >= 2 })
	farm.Drop()
	observed := h.until("the finish on the new connection", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	if observed.Connections < 2 {
		t.Fatalf("the connection was not dropped: %d connections", observed.Connections)
	}

	var produced strings.Builder
	for i := range 40 {
		fmt.Fprintf(&produced, "line %d\n", i)
	}
	finish := finishes(t, observed)[0]
	if finish.Log.Bytes+finish.Log.DroppedBytes != produced.Len() {
		t.Errorf("%d bytes written, but the finish accounts for %d sent + %d dropped",
			produced.Len(), finish.Log.Bytes, finish.Log.DroppedBytes)
	}

	// The farm may have missed a frame the agent wrote into the dying socket — which its `seq`
	// makes noticeable, and which the gateway records as a lost chunk (#253). What it must
	// never see is a `seq` that restarted, repeated or went backwards.
	seqs, arrived := make([]int, 0, len(observed.Chunks)), 0
	for _, chunk := range observed.Chunks {
		seqs = append(seqs, chunk.Seq)
		arrived += len(decodeChunk(t, chunk))
	}
	if !slices.IsSorted(seqs) || len(slices.Compact(slices.Clone(seqs))) != len(seqs) || seqs[0] != 0 {
		t.Errorf("seq restarted, repeated or went backwards across the reconnect: %v", seqs)
	}
	if last := seqs[len(seqs)-1]; finish.Log.Chunks <= last || finish.Log.Bytes < arrived {
		t.Errorf("the finish says %d chunks and %d bytes; the farm saw seq up to %d and %d bytes",
			finish.Log.Chunks, finish.Log.Bytes, last, arrived)
	}
	if len(seqs) > 1 && seqs[len(seqs)-1] == len(seqs)-1 {
		t.Logf("no frame was lost to the drop: %d chunks, seq 0–%d", len(seqs), seqs[len(seqs)-1])
	}
}
