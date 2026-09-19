package agent

import (
	"fmt"
	"sync"
	"testing"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// job is a job id of the published shape, numbered.
func job(n int) string { return fmt.Sprintf("job_01KE7J4EZ3204KQXMHJRPQ%04d", n) }

// TestWorkloadQueueDepthIsAcceptedNotStarted pins the one definition of queue depth the
// agent and dispatch share (#245, #252): jobs accepted and not yet started. The running
// job is the heartbeat's `job`, not part of the queue.
func TestWorkloadQueueDepthIsAcceptedNotStarted(t *testing.T) {
	var work Workload
	expect := func(what string, depth int, running string) {
		t.Helper()
		gotDepth, gotRunning := work.Snapshot()
		gotID := ""
		if gotRunning != nil {
			gotID = gotRunning.ID
		}
		if gotDepth != depth || gotID != running {
			t.Errorf("%s: expected q:%d running %q, got q:%d running %q", what, depth, running, gotDepth, gotID)
		}
	}

	expect("nothing held", 0, "")
	work.Accepted(job(1))
	work.Accepted(job(2))
	work.Accepted(job(3))
	expect("three accepted", 3, "")

	if err := work.Started(job(1), conn.PhaseFetch); err != nil {
		t.Fatal(err)
	}
	expect("one started — mockup 08's forge-01", 2, job(1))

	work.Finished(job(2)) // cancelled before it ever started
	expect("a queued job cancelled", 1, job(1))

	work.Finished(job(1))
	expect("the running job finished", 1, "")

	if err := work.Started(job(3), conn.PhaseFetch); err != nil {
		t.Fatal(err)
	}
	work.Finished(job(3))
	expect("everything finished", 0, "")
}

// TestWorkloadTransitionsAreIdempotent asserts no duplicate or out-of-order report can
// push the count below zero, count a job twice, or leave it in two places.
func TestWorkloadTransitionsAreIdempotent(t *testing.T) {
	var work Workload
	work.Accepted(job(1))
	work.Accepted(job(1))
	if depth, _ := work.Snapshot(); depth != 1 {
		t.Errorf("an accept repeated counted the job twice: q:%d", depth)
	}

	for range 2 {
		if err := work.Started(job(1), conn.PhaseFetch); err != nil {
			t.Fatal(err)
		}
	}
	work.Accepted(job(1)) // an accept arriving after the start
	if depth, running := work.Snapshot(); depth != 0 || running == nil {
		t.Errorf("a started job is not queued, however often it is reported: q:%d running %+v", depth, running)
	}

	work.Finished(job(1))
	work.Finished(job(1))
	work.Finished(job(99))
	if depth, running := work.Snapshot(); depth != 0 || running != nil {
		t.Errorf("finishes repeated or unknown: q:%d running %+v", depth, running)
	}

	// A job started without an accept is still running — the heartbeat reports what the
	// executor is doing.
	if err := work.Started(job(2), conn.PhaseRun); err != nil {
		t.Fatal(err)
	}
	if depth, running := work.Snapshot(); depth != 0 || running == nil || running.ID != job(2) {
		t.Errorf("an unaccepted start: q:%d running %+v", depth, running)
	}
}

// TestWorkloadProgress holds the running job's phase to the protocol's vocabulary and its
// percentage to 0–100 — a heartbeat carrying anything else would be refused by the
// gateway, and the whole session with it.
func TestWorkloadProgress(t *testing.T) {
	var work Workload
	if err := work.Started(job(1), "compiling"); err == nil {
		t.Error("a phase the protocol does not name was accepted at start")
	}
	if err := work.Started("job_a", conn.PhaseFetch); err == nil {
		t.Error("a job id the protocol would refuse was accepted at start")
	}
	if _, running := work.Snapshot(); running != nil {
		t.Errorf("a refused start was recorded: %+v", running)
	}

	if err := work.Started(job(1), conn.PhaseFetch); err != nil {
		t.Fatal(err)
	}
	if _, running := work.Snapshot(); *running != (conn.HeartbeatJob{ID: job(1), Phase: conn.PhaseFetch, Pct: 0}) {
		t.Errorf("a started job: %+v", running)
	}

	for _, step := range []struct {
		phase string
		pct   int
		want  int
	}{
		{conn.PhasePrepare, 10, 10},
		{conn.PhaseRun, 62, 62},
		{conn.PhaseRun, 140, 100},
		{conn.PhaseUpload, -5, 0},
	} {
		if err := work.Progress(job(1), step.phase, step.pct); err != nil {
			t.Fatal(err)
		}
		if _, running := work.Snapshot(); running.Phase != step.phase || running.Pct != step.want {
			t.Errorf("progress %s %d: got %+v", step.phase, step.pct, running)
		}
	}

	if err := work.Progress(job(1), "linking", 50); err == nil {
		t.Error("a phase the protocol does not name was accepted")
	}
	if err := work.Progress(job(98), conn.PhaseRun, 50); err == nil {
		t.Error("progress for a job that is not running was accepted")
	}
}

// TestWorkloadSnapshotIsACopy asserts a heartbeat holds a snapshot, not a view: a
// progress report after the snapshot was taken does not change a frame being encoded.
func TestWorkloadSnapshotIsACopy(t *testing.T) {
	var work Workload
	if err := work.Started(job(1), conn.PhaseFetch); err != nil {
		t.Fatal(err)
	}
	_, running := work.Snapshot()
	if err := work.Progress(job(1), conn.PhaseRun, 50); err != nil {
		t.Fatal(err)
	}
	if running.Phase != conn.PhaseFetch {
		t.Errorf("the snapshot changed under its reader: %+v", running)
	}
}

// TestWorkloadReportsTheFirstStartedJob asserts which job a heartbeat names if an
// executor ever runs more than one: the one that started first, until it finishes.
func TestWorkloadReportsTheFirstStartedJob(t *testing.T) {
	var work Workload
	for _, job := range []string{job(1), job(2)} {
		if err := work.Started(job, conn.PhaseRun); err != nil {
			t.Fatal(err)
		}
	}
	if _, running := work.Snapshot(); running.ID != job(1) {
		t.Errorf("expected the first started, got %+v", running)
	}
	work.Finished(job(1))
	if _, running := work.Snapshot(); running == nil || running.ID != job(2) {
		t.Errorf("expected the second once the first finished, got %+v", running)
	}
}

// TestWorkloadUnderConcurrentDispatch is the queue criterion under the race detector:
// offers accepted, started and finished from many goroutines at once — as a dispatcher
// pipelining work to one agent would cause — while heartbeats read the count. When the
// dust settles the depth is exactly accepted minus started, the number the server's own
// accounting of the same jobs arrives at.
func TestWorkloadUnderConcurrentDispatch(t *testing.T) {
	const jobs = 400
	var work Workload
	var group sync.WaitGroup
	stop := make(chan struct{})
	var readers sync.WaitGroup
	readers.Add(1)
	go func() {
		defer readers.Done()
		for {
			select {
			case <-stop:
				return
			default:
				if depth, _ := work.Snapshot(); depth < 0 || depth > jobs {
					t.Errorf("an impossible depth mid-flight: %d", depth)
					return
				}
			}
		}
	}()

	// Every job is accepted; a third are then started and finished, a third started and
	// left running, and a third left waiting.
	for index := range jobs {
		group.Add(1)
		go func() {
			defer group.Done()
			id := job(index)
			work.Accepted(id)
			work.Accepted(id) // a duplicate accept, as a re-sent frame would cause
			switch index % 3 {
			case 0:
				_ = work.Started(id, conn.PhaseFetch)
				_ = work.Progress(id, conn.PhaseRun, index%101)
				work.Finished(id)
				work.Finished(id)
			case 1:
				_ = work.Started(id, conn.PhaseFetch)
			}
		}()
	}
	group.Wait()
	close(stop)
	readers.Wait()

	waiting := jobs / 3 // index % 3 == 2
	depth, running := work.Snapshot()
	if depth != waiting {
		t.Errorf("expected q:%d — accepted and not started — got q:%d", waiting, depth)
	}
	if running == nil {
		t.Error("a third of the jobs are still running, and none was reported")
	}
}
