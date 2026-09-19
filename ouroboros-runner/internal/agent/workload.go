package agent

import (
	"fmt"
	"sync"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// Workload is the agent's own account of the jobs it holds: which it has accepted and not
// yet started — the heartbeat's `queue_depth` — and which it is running, with the phase
// and progress the executor last reported.
//
// Queue depth has one definition, and it is the one dispatch reasons about for capacity
// ([#252]) and the runners table prints as `q:2`: jobs ACCEPTED BUT NOT STARTED. The
// running job is not in it — it is the heartbeat's `job` — so a machine building one job
// with two waiting behind it reports `q:2`, as mockup 08's forge-01 does. A server that
// counted the running job too would disagree with every agent by exactly one.
//
// The executors ([#246]) drive it: Accepted when a job.accept is sent, Started at
// job.start, Progress as phases change, Finished when the job is over however it ended —
// including a job cancelled before it ever started. Every method is safe for concurrent
// use, and every transition is idempotent: a duplicate or out-of-order report cannot push
// the count below zero or leave a job counted twice.
//
// [#246]: https://github.com/NobuData/ouroboros/issues/246
// [#252]: https://github.com/NobuData/ouroboros/issues/252
type Workload struct {
	mu sync.Mutex
	// queued is the accepted-not-started set. A set, not a counter, so that an Accepted
	// repeated for the same job counts it once.
	queued map[string]bool
	// running is the started-not-finished jobs, in the order they started.
	running []conn.HeartbeatJob
}

// Accepted counts a job this agent has accepted and not yet started. A job already
// queued or already running is left where it is.
func (w *Workload) Accepted(job string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.find(job) >= 0 {
		return
	}
	if w.queued == nil {
		w.queued = map[string]bool{}
	}
	w.queued[job] = true
}

// Started moves a job out of the queue and into the running set, in its first phase.
// A job that was never accepted is still recorded as running: whatever the executor is
// doing is what the heartbeat should say. Starting a running job again changes nothing.
//
// It returns an error, and records nothing, for a job id or a phase the protocol would
// refuse — the heartbeat carries both, and a gateway refusing it ends the session.
func (w *Workload) Started(job, phase string) error {
	if !conn.ValidJobID(job) {
		return fmt.Errorf("%q is not a job id (job_ and a ULID)", job)
	}
	if !conn.ValidPhase(phase) {
		return fmt.Errorf("%q is not a job phase (fetch, prepare, run, upload)", phase)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.queued, job)
	if w.find(job) < 0 {
		w.running = append(w.running, conn.HeartbeatJob{ID: job, Phase: phase, Pct: 0})
	}
	return nil
}

// Progress records a running job's phase and how far through it is. A percentage
// outside 0–100 is held to it.
//
// It returns an error for a job that is not running — an executor reporting progress
// for a job it never started has lost track of something worth a log line — and for a
// phase the protocol does not name.
func (w *Workload) Progress(job, phase string, pct int) error {
	if !conn.ValidPhase(phase) {
		return fmt.Errorf("%q is not a job phase (fetch, prepare, run, upload)", phase)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	index := w.find(job)
	if index < 0 {
		return fmt.Errorf("job %s is not running", job)
	}
	w.running[index].Phase = phase
	w.running[index].Pct = min(max(pct, 0), 100)
	return nil
}

// Finished forgets a job, wherever it was: running, or accepted and never started. A
// job it does not know is ignored — a finish reported twice is not a second finish.
func (w *Workload) Finished(job string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.queued, job)
	if index := w.find(job); index >= 0 {
		w.running = append(w.running[:index], w.running[index+1:]...)
	}
}

// Snapshot is what a heartbeat reports: the queue depth, and the running job — the one
// started first, if an executor ever runs more than one — or nil when nothing runs.
func (w *Workload) Snapshot() (queueDepth int, running *conn.HeartbeatJob) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.running) > 0 {
		job := w.running[0]
		running = &job
	}
	return len(w.queued), running
}

// find is a running job's index, or -1. The caller holds the lock.
func (w *Workload) find(job string) int {
	for index, running := range w.running {
		if running.ID == job {
			return index
		}
	}
	return -1
}
