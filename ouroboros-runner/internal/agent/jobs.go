package agent

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
)

// The job half of the agent ([#246]): deciding whether an offer can be satisfied, and
// running the ones that can.
//
//	job.offer ──▶ can this runner satisfy it? ──no──▶ job.decline {reason} — at once, never accept-then-fail
//	                    │ yes
//	                    ▼
//	               job.accept ──▶ workspace · prepare (pull, job.progress) ──▶ job.start
//	                                                                               │
//	               job.finish (outbox, re-sent until receipted) ◀── run ◀──────────┘
//	                    ▲
//	job.cancel ─────────┘ the job's own context, cancelled: finish {cancelled} ([#252])
//
// The deciding is CAPABILITY HONESTY. A runner without docker cannot run a container job,
// and accepting one to fail it at execution would burn a dispatch cycle and show somebody
// a build failure that is really a farm fact. So every offer this runner cannot satisfy —
// no executor for its kind, a repository this build cannot check out, no room under the
// pool's cap — is declined immediately, with a reason, and dispatch ([#252]) finds a
// runner that can.
//
// [#246]: https://github.com/NobuData/ouroboros/issues/246
// [#252]: https://github.com/NobuData/ouroboros/issues/252

// attemptOf is the attempt a job's job.start and job.finish report: the offer's, which the
// dispatcher sets on the automatic retry of an infrastructure failure ([#252]), and 1 when
// the offer did not say — a first attempt.
//
// [#252]: https://github.com/NobuData/ouroboros/issues/252
func attemptOf(offer conn.JobOfferPayload) int {
	return max(offer.Attempt, 1)
}

// jobCancels is a stop handle for every job this agent holds, by job id — what a gateway's
// `job.cancel` ([#252]) reaches. Each job runs under a context of its own, derived from the
// agent's, so cancelling one stops that job alone while a SIGTERM still stops them all.
//
// [#252]: https://github.com/NobuData/ouroboros/issues/252
type jobCancels struct {
	mu      sync.Mutex
	handles map[string]context.CancelCauseFunc
}

// add registers a job's stop handle.
func (c *jobCancels) add(job string, cancel context.CancelCauseFunc) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.handles == nil {
		c.handles = map[string]context.CancelCauseFunc{}
	}
	c.handles[job] = cancel
}

// remove forgets a job's stop handle once the job is over.
func (c *jobCancels) remove(job string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.handles, job)
}

// cancel stops a held job with a cause, and reports whether the agent held it.
func (c *jobCancels) cancel(job string, cause error) bool {
	c.mu.Lock()
	cancel, held := c.handles[job]
	c.mu.Unlock()
	if held {
		cancel(cause)
	}
	return held
}

// DefaultJobStopWait bounds how long a shutting-down agent waits for its cancelled jobs to
// report before it says bye: the executors' grace, and a margin for the reports.
const DefaultJobStopWait = exec.DefaultGrace + 5*time.Second

// poolPolicy is the pool of record's execution policy, from the last `ack.pool` — how many
// jobs this runner may hold, and which variables a job may carry. It outlives a connection,
// like the drain: a runner does not forget its pool's rules because a socket dropped.
type poolPolicy struct {
	mu             sync.Mutex
	maxConcurrency int
	allowlist      []string
}

// set records the policy an ack named. An ack without one (nil) resets to the column
// defaults: one job at a time, and no variable allowed through.
func (p *poolPolicy) set(pool *conn.AckPool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if pool == nil {
		p.maxConcurrency, p.allowlist = conn.DefaultMaxConcurrency, nil
		return
	}
	p.maxConcurrency = pool.MaxConcurrency
	p.allowlist = append([]string(nil), pool.EnvAllowlist...)
}

// get is the cap and a copy of the allow-list. A policy never set is the defaults.
func (p *poolPolicy) get() (maxConcurrency int, allowlist []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return max(p.maxConcurrency, conn.DefaultMaxConcurrency), append([]string(nil), p.allowlist...)
}

// noticeBuffer is how many non-terminal frames a session holds for writing. Progress is
// reported at most once a second per job, so this is minutes of headroom.
const noticeBuffer = 256

// noticeBoard carries the non-terminal frames a job produces — job.start, job.progress —
// to whichever session is live. They are advisory: the protocol re-sends only terminal
// frames, so one produced while no session is live is dropped rather than held, and a
// stale job.start can never arrive after the finish it preceded.
type noticeBoard struct {
	mu   sync.Mutex
	live chan conn.Frame
}

// open gives a new session its channel. The caller closes it with release.
func (n *noticeBoard) open() chan conn.Frame {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.live = make(chan conn.Frame, noticeBuffer)
	return n.live
}

// release stops delivering to a session's channel.
func (n *noticeBoard) release(channel chan conn.Frame) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.live == channel {
		n.live = nil
	}
}

// post hands a frame to the live session, and reports whether there was one with room.
func (n *noticeBoard) post(frame conn.Frame) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.live == nil {
		return false
	}
	select {
	case n.live <- frame:
		return true
	default:
		return false
	}
}

// decline is why an offer cannot be taken, or an empty reason when it can.
//
// The checks are ordered from the reasons that say the most about the farm to the ones that
// will clear by themselves, so the reason a dispatcher reads is the most useful true one:
// a drain, an expiry, then what this runner cannot do at all (`unsupported_executor` — the
// POOL is mis-configured, and this will not clear), then what it cannot do now (`busy`).
func (a *Agent) decline(offer conn.JobOfferPayload) (reason, detail string) {
	expires, _ := time.Parse(time.RFC3339Nano, offer.ExpiresAt)
	maxConcurrency, _ := a.pool.get()

	switch draining, why := a.draining.get(); {
	case draining:
		return conn.DeclineDraining, "this agent is draining: " + why
	case !expires.IsZero() && !a.config.Now().Before(expires):
		return conn.DeclineExpired, "the offer expired before it arrived"
	case offer.Repository != nil:
		return conn.DeclineUnsupportedExecutor, fmt.Sprintf(
			"this agent build (%s) does not check out repositories yet; the job names one", a.config.Version)
	case a.config.Executors[offer.Executor] == nil:
		return conn.DeclineUnsupportedExecutor, a.unsupported(offer.Executor)
	case a.workload.Holds(offer.Job):
		return conn.DeclineBusy, "this runner already holds " + offer.Job
	case a.workload.InFlight() >= maxConcurrency:
		return conn.DeclineBusy, fmt.Sprintf(
			"this runner holds %d of the %d jobs its pool allows at once", a.workload.InFlight(), maxConcurrency)
	}
	return "", ""
}

// unsupported is the one-sentence reason this runner has no executor for a kind — the same
// fact its hello reported as a capability.
func (a *Agent) unsupported(kind string) string {
	switch kind {
	case conn.ExecutorContainer:
		return "this runner has no reachable Docker or Podman daemon, so it cannot run container jobs"
	case conn.ExecutorShell:
		return "this runner does not run shell jobs (it was started with --no-shell)"
	default:
		return fmt.Sprintf("this agent build (%s) has no %s executor", a.config.Version, kind)
	}
}

// launch runs an accepted job in the background, holding it in the workload until its
// finish is queued. The job's context is derived from ctx — the agent's own — so a job
// outlives the connection it was offered on, and ends when the agent is told to stop or
// when the gateway cancels that one job.
func (a *Agent) launch(ctx context.Context, offer conn.JobOfferPayload) {
	maxConcurrency, allowlist := a.pool.get()
	env, dropped := exec.Scrub(offer.Env, allowlist)
	if len(dropped) > 0 {
		// Names only: a value is the job's business, and the contract says it holds no
		// credential, but a log line is not where to find out it did.
		a.log.Warn("a job asked for environment variables its pool does not allow; they were dropped",
			"job", offer.Job, "dropped", dropped)
	}
	job := exec.Job{
		ID:      offer.Job,
		Kind:    offer.Executor,
		Image:   offer.Image,
		Command: offer.Command,
		Workdir: offer.Workdir,
		Env:     env,
		Timeout: time.Duration(offer.TimeoutS) * time.Second,
		Limits:  exec.ShareOf(a.config.Capabilities.CPUs, a.config.Capabilities.MemoryMB, maxConcurrency),
	}
	executor := a.config.Executors[offer.Executor]
	attempt := attemptOf(offer)
	jobCtx, cancel := context.WithCancelCause(ctx)

	a.workload.Accepted(job.ID)
	a.cancels.add(job.ID, cancel)
	a.jobs.Add(1)
	go func() {
		defer a.jobs.Done()
		defer cancel(nil)
		a.run(jobCtx, executor, job, attempt)
		a.cancels.remove(job.ID)
	}()
}

// cancelJob stops a job the gateway took back ([#252]). A held job is cancelled with a
// cause naming the reason, which the executor's `cancelled` finish carries as its detail;
// a job this agent does not hold — its finish crossed the cancel, or the offer never
// arrived — is logged and otherwise ignored, because there is nothing to stop.
//
// [#252]: https://github.com/NobuData/ouroboros/issues/252
func (a *Agent) cancelJob(cancel conn.JobCancelPayload) {
	cause := fmt.Errorf("the gateway cancelled it, %s: %s", cancel.Reason, cancel.Detail)
	if a.cancels.cancel(cancel.Job, cause) {
		a.log.Warn("the gateway cancelled a job; stopping it", "job", cancel.Job, "reason", cancel.Reason,
			"detail", cancel.Detail)
		return
	}
	a.log.Info("the gateway cancelled a job this agent does not hold; nothing to stop", "job", cancel.Job,
		"reason", cancel.Reason)
}

// run runs one job to its end and reports it.
func (a *Agent) run(ctx context.Context, executor exec.Executor, job exec.Job, attempt int) {
	a.log.Info("running a job", "job", job.ID, "attempt", attempt, "executor", job.Kind, "image", job.Image,
		"timeout", job.Timeout)
	produced := &outputCounter{}
	events := &jobEvents{agent: a, job: job, attempt: attempt}
	runner := exec.Runner{Workspaces: a.config.Workspaces, Now: a.config.Now}
	result := runner.Run(ctx, executor, job, exec.Output{Stdout: produced, Stderr: produced}, events)
	a.report(job, attempt, result, produced.bytes.Load())
	a.workload.Finished(job.ID)
}

// report queues a job's terminal frame and logs how it ended.
//
// The output is counted and not yet shipped — log shipping is [#247]'s — so the finish says
// so honestly: nothing delivered, and every byte the command wrote reported as dropped,
// which the run console renders as an elision rather than as an empty log.
//
// [#247]: https://github.com/NobuData/ouroboros/issues/247
func (a *Agent) report(job exec.Job, attempt int, result exec.Result, produced int64) {
	finish := conn.JobFinishPayload{
		Job:        job.ID,
		Attempt:    attempt,
		Outcome:    result.Outcome,
		ExitCode:   exitCode(result.ExitCode),
		StartedAt:  conn.Timestamp(result.StartedAt),
		FinishedAt: conn.Timestamp(result.FinishedAt),
		Log:        conn.FinishLog{DroppedBytes: int(min(produced, int64(maxInt)))},
	}
	if result.Error != nil {
		finish.Error = &conn.FinishError{Code: result.Error.Code, Detail: result.Error.Detail}
	}
	if err := a.SendTerminal(conn.NewFrame(conn.NewID(), conn.TypeJobFinish, finish)); err != nil {
		a.log.Error("a job's result could not be queued; the gateway will not hear how it ended",
			"job", job.ID, "outcome", result.Outcome, "error", err)
	}

	attributes := []any{"job", job.ID, "outcome", result.Outcome, "exit_code", finish.ExitCode,
		"duration", result.FinishedAt.Sub(result.StartedAt).Round(time.Millisecond)}
	if result.Error != nil {
		attributes = append(attributes, "error", result.Error.Code, "detail", result.Error.Detail)
	}
	if result.Outcome == conn.OutcomeSucceeded {
		a.log.Info("a job finished", attributes...)
	} else {
		a.log.Warn("a job finished", attributes...)
	}
	if result.ReplacedWorkspace {
		a.log.Warn("an old workspace of the same job was replaced", "job", job.ID, "workspace", result.Workspace)
	}
	if result.Kept {
		a.log.Info("the workspace was kept for diagnosis (--keep-workspace-on-failure)",
			"job", job.ID, "workspace", result.Workspace)
	}
	if result.CleanupErr != nil {
		a.log.Warn("a job's workspace could not be removed; it is left for the operator",
			"job", job.ID, "workspace", result.Workspace, "error", result.CleanupErr)
	}
}

// maxInt is the largest int, for a byte count that must fit one.
const maxInt = int(^uint(0) >> 1)

// exitCode is an exit status as a job.finish carries it: nil stays nil, and anything outside
// the contract's −1–255 — which no executor produces — is −1 rather than an illegal frame.
func exitCode(code *int) *int {
	if code == nil {
		return nil
	}
	value := *code
	if value < -1 || value > 255 {
		value = -1
	}
	return &value
}

// outputCounter is a job's output until the log shipper ([#247]) carries it: counted and
// discarded. Both streams write to one counter, from two goroutines.
//
// [#247]: https://github.com/NobuData/ouroboros/issues/247
type outputCounter struct{ bytes atomic.Int64 }

// Write counts and discards.
func (c *outputCounter) Write(p []byte) (int, error) {
	c.bytes.Add(int64(len(p)))
	return len(p), nil
}

// jobEvents turns what the executor reports into frames and the heartbeat's account.
type jobEvents struct {
	agent   *Agent
	job     exec.Job
	attempt int
}

// Progress is preparation progress — an image pull — as a job.progress in the `prepare`
// phase. The job has not started, so the heartbeat still counts it as queued; this frame is
// what keeps a long first pull from reading as a stall.
func (e *jobEvents) Progress(pct int, note string) {
	if pct == 0 || pct == 100 {
		e.agent.log.Info("preparing a job", "job", e.job.ID, "pct", pct, "note", note)
	} else {
		e.agent.log.Debug("preparing a job", "job", e.job.ID, "pct", pct, "note", note)
	}
	e.agent.notify(conn.NewFrame(conn.NewID(), conn.TypeJobProgress, conn.JobProgressPayload{
		Job: e.job.ID, Phase: conn.PhasePrepare, Pct: min(max(pct, 0), 100), Note: note,
	}))
}

// Started is the command handed over: the job moves from the queue to running, and the
// gateway is told with a job.start naming the workspace.
func (e *jobEvents) Started(workspace string, at time.Time) {
	if err := e.agent.workload.Started(e.job.ID, conn.PhaseRun); err != nil {
		e.agent.log.Warn("a started job could not be recorded for the heartbeat", "job", e.job.ID, "error", err)
	}
	e.agent.log.Info("a job started", "job", e.job.ID, "executor", e.job.Kind, "workspace", workspace)
	e.agent.notify(conn.NewFrame(conn.NewID(), conn.TypeJobStart, conn.JobStartPayload{
		Job: e.job.ID, Attempt: e.attempt, Executor: e.job.Kind,
		StartedAt: conn.Timestamp(at), Workspace: workspace,
	}))
}

// notify posts a non-terminal frame to the live session, after holding it to the contract:
// a frame the gateway would refuse ends the session, so an illegal one is logged and
// dropped here rather than sent.
func (a *Agent) notify(frame conn.Frame) {
	encoded, err := conn.Encode(frame)
	if err == nil {
		if _, diags := conn.Decode(encoded); len(diags) > 0 {
			err = fmt.Errorf("%s at %q", diags[0].Code, diags[0].Path)
		}
	}
	if err != nil {
		a.log.Error("an illegal frame was not sent", "type", frame.Type, "error", err)
		return
	}
	if !a.notices.post(frame) {
		a.log.Debug("a job frame was dropped: no session is connected", "type", frame.Type)
	}
}

// awaitJobs waits for every running job to end, up to timeout, and reports whether they did.
func (a *Agent) awaitJobs(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() {
		a.jobs.Wait()
		close(done)
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		return false
	}
}
