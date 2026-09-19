package agent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
)

// The job half of the agent (#246), against the in-process farm: which offers are taken
// and which are declined, the frames a taken job produces and their order, the concurrency
// cap, the pool's allow-list, and what a SIGTERM does to a running build.

// fakeExecutor is an executor whose behaviour a test scripts. Its zero value is a job that
// prepares at once and exits 0.
type fakeExecutor struct {
	kind string
	// prepare and execute replace the defaults when set.
	prepare func(ctx context.Context, job exec.Job, progress exec.Progress) error
	execute func(ctx context.Context, job exec.Job) (int, error)

	mu   sync.Mutex
	seen []exec.Job
}

func (f *fakeExecutor) Kind() string { return f.kind }

func (f *fakeExecutor) Prepare(ctx context.Context, job exec.Job, _ string, progress exec.Progress) error {
	f.mu.Lock()
	f.seen = append(f.seen, job)
	f.mu.Unlock()
	if f.prepare != nil {
		return f.prepare(ctx, job, progress)
	}
	return nil
}

func (f *fakeExecutor) Execute(ctx context.Context, job exec.Job, _ string, output exec.Output) (int, error) {
	_, _ = output.Stdout.Write([]byte("building\n"))
	if f.execute != nil {
		return f.execute(ctx, job)
	}
	return 0, nil
}

// jobs is every job the executor was handed, in order.
func (f *fakeExecutor) jobs() []exec.Job {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]exec.Job(nil), f.seen...)
}

// blockUntilCancelled is an execute that runs until its job is stopped, as a build that
// will not finish on its own does.
func blockUntilCancelled(ctx context.Context, _ exec.Job) (int, error) {
	<-ctx.Done()
	return -1, nil
}

// offerJob sends a job.offer for job n and returns the offer's envelope id.
func offerJob(t *testing.T, farm *farmtest.Farm, n int, executor string, adjust func(map[string]any)) string {
	t.Helper()
	payload := map[string]any{
		"job": job(n), "pool": "pool-a", "executor": executor,
		"command": []string{"make", "-j8", "all"}, "workdir": "/workspace",
		"env": map[string]string{}, "repository": nil, "timeout_s": 60,
		"expires_at": conn.Timestamp(time.Now().Add(time.Minute)),
	}
	if executor == conn.ExecutorContainer {
		payload["image"] = "registry.example.invalid/zephyr-sdk:0.17"
	}
	if adjust != nil {
		adjust(payload)
	}
	id := conn.NewID()
	if err := farm.Send(conn.NewFrame(id, conn.TypeJobOffer, payload)); err != nil {
		t.Fatal(err)
	}
	return id
}

// finishes decodes every job.finish the farm received.
func finishes(t *testing.T, observed farmtest.Observed) []conn.JobFinishPayload {
	t.Helper()
	var decoded []conn.JobFinishPayload
	for _, raw := range observed.FinishFrames {
		envelope, diags := conn.Decode(raw)
		if len(diags) > 0 {
			t.Fatalf("an illegal finish: %v", diags)
		}
		var finish conn.JobFinishPayload
		if err := envelope.Into(&finish); err != nil {
			t.Fatal(err)
		}
		decoded = append(decoded, finish)
	}
	return decoded
}

// TestAnOfferThatCanBeRunIsAcceptedStartedAndFinished is the happy path, frame by frame:
// accept at once, the image pull's progress while the job is still queued, job.start only
// after it, and a job.finish carrying the exit code and the duration. The pool's policy
// from the ack is honoured on the way: the environment scrubbed to its allow-list, and the
// machine shared by its cap.
func TestAnOfferThatCanBeRunIsAcceptedStartedAndFinished(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetPool(&conn.AckPool{MaxConcurrency: 2, EnvAllowlist: []string{"CI", "MAKEFLAGS"}})
	container := &fakeExecutor{
		kind: conn.ExecutorContainer,
		prepare: func(_ context.Context, _ exec.Job, progress exec.Progress) error {
			progress(0, "pulling zephyr-sdk:0.17")
			progress(42, "pulling zephyr-sdk:0.17 — 412.0 MB of 980.0 MB, 1 of 3 layers")
			progress(100, "pulled zephyr-sdk:0.17")
			return nil
		},
		execute: func(context.Context, exec.Job) (int, error) {
			time.Sleep(50 * time.Millisecond)
			return 0, nil
		},
	}
	dir := enrolled(t, farm, false)
	h := start(t, farm, dir, func(c *Config) { c.Executors[conn.ExecutorContainer] = container })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	h.logged("max_concurrency=2")

	offer := offerJob(t, farm, 1, conn.ExecutorContainer, func(p map[string]any) {
		p["env"] = map[string]string{"CI": "true", "MAKEFLAGS": "-j8", "AWS_SECRET_ACCESS_KEY": "hunter2"}
	})
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	want := []conn.Type{conn.TypeJobAccept, conn.TypeJobProgress, conn.TypeJobProgress, conn.TypeJobProgress,
		conn.TypeJobStart, conn.TypeJobFinish}
	if !slices.Equal(observed.JobFrames, want) {
		t.Fatalf("job frames arrived as %v, want %v", observed.JobFrames, want)
	}
	if observed.Accepts[0].Offer != offer || observed.Accepts[0].Job != job(1) {
		t.Errorf("accept: %+v", observed.Accepts[0])
	}
	for _, progress := range observed.Progress {
		if progress.Phase != conn.PhasePrepare || progress.Job != job(1) {
			t.Errorf("pull progress is the prepare phase of its job: %+v", progress)
		}
	}
	if observed.Progress[1].Pct != 42 || !strings.Contains(observed.Progress[1].Note, "412.0 MB") {
		t.Errorf("progress: %+v", observed.Progress[1])
	}
	started := observed.Starts[0]
	if started.Attempt != 1 || started.Executor != conn.ExecutorContainer ||
		started.Workspace != filepath.Join(dir.Path(), "work", job(1)) {
		t.Errorf("start: %+v", started)
	}

	finish := finishes(t, observed)[0]
	if finish.Outcome != conn.OutcomeSucceeded || finish.ExitCode == nil || *finish.ExitCode != 0 ||
		finish.Error != nil || finish.Ccache != nil {
		t.Errorf("finish: %+v", finish)
	}
	begun, _ := time.Parse(time.RFC3339Nano, finish.StartedAt)
	ended, _ := time.Parse(time.RFC3339Nano, finish.FinishedAt)
	if finish.StartedAt != started.StartedAt || ended.Sub(begun) < 50*time.Millisecond {
		t.Errorf("the duration runs from job.start to the end: %s → %s", finish.StartedAt, finish.FinishedAt)
	}
	// Output is not shipped yet (#247), so it is reported as produced and not delivered.
	if finish.Log != (conn.FinishLog{DroppedBytes: len("building\n")}) {
		t.Errorf("finish log: %+v", finish.Log)
	}

	// The executor saw the scrubbed environment and the pool's share of the machine.
	ran := container.jobs()[0]
	if strings.Join(ran.Env, " ") != "CI=true MAKEFLAGS=-j8" {
		t.Errorf("the job's environment was %q", ran.Env)
	}
	if ran.Limits != exec.ShareOf(8, 16384, 2) || ran.Timeout != time.Minute || ran.Image == "" {
		t.Errorf("the job: %+v", ran)
	}
	h.logged("dropped=[AWS_SECRET_ACCESS_KEY]")
	if strings.Contains(h.logs.String(), "hunter2") {
		t.Error("a dropped variable's value reached the log")
	}

	// And the workspace is gone, and the workload empty again.
	waitForEmptyOutbox(t, h)
	if _, err := os.Stat(started.Workspace); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the workspace of a succeeded job was left: %v", err)
	}
	if h.agent.workload.InFlight() != 0 {
		t.Errorf("%d jobs still held", h.agent.workload.InFlight())
	}
}

// TestOffersTheRunnerCannotSatisfyAreDeclined is capability honesty: a runner that cannot
// run an offer says so at once, with the true reason, rather than accepting it and failing
// — no daemon, shell jobs refused, or a repository this build cannot check out.
func TestOffersTheRunnerCannotSatisfyAreDeclined(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) {
		c.Capabilities.Docker, c.Executors = false, nil
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	offerJob(t, farm, 1, conn.ExecutorContainer, nil)
	offerJob(t, farm, 2, conn.ExecutorShell, nil)
	observed := h.until("two declines", func(o farmtest.Observed) bool { return len(o.Declines) == 2 })
	if d := observed.Declines[0]; d.Reason != conn.DeclineUnsupportedExecutor || !strings.Contains(d.Detail, "Docker or Podman") {
		t.Errorf("a container offer to a runner without docker: %+v", d)
	}
	if d := observed.Declines[1]; d.Reason != conn.DeclineUnsupportedExecutor || !strings.Contains(d.Detail, "--no-shell") {
		t.Errorf("a shell offer to a runner that refuses shell jobs: %+v", d)
	}
	if len(observed.Accepts) != 0 {
		t.Errorf("an offer the runner cannot satisfy was accepted: %+v", observed.Accepts)
	}

	// A runner WITH a container executor still declines an offer naming a repository.
	farm2 := farmtest.NewFarm(t)
	h2 := start(t, farm2, enrolled(t, farm2, false), nil)
	h2.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm2, 3, conn.ExecutorContainer, func(p map[string]any) {
		p["repository"] = map[string]any{
			"url": "https://github.com/NobuData/ouroboros.git", "ref": "refs/heads/main",
			"commit": "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
		}
	})
	observed = h2.until("the decline", func(o farmtest.Observed) bool { return len(o.Declines) == 1 })
	if d := observed.Declines[0]; d.Reason != conn.DeclineUnsupportedExecutor || !strings.Contains(d.Detail, "repositories") {
		t.Errorf("an offer naming a repository: %+v", d)
	}
}

// TestTheConcurrencyCapIsEnforced holds a runner to the pool's cap: one job at a time when
// the gateway names no policy, the pool's number when it does, a duplicate offer of a job
// already held declined rather than run twice — and room again once a job finishes.
func TestTheConcurrencyCapIsEnforced(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	release := make(chan struct{})
	container := &fakeExecutor{kind: conn.ExecutorContainer, execute: func(ctx context.Context, _ exec.Job) (int, error) {
		select {
		case <-release:
			return 0, nil
		case <-ctx.Done():
			return -1, nil
		}
	}}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Executors[conn.ExecutorContainer] = container })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	h.logged("named_by_gateway=false")

	// No pool policy in the ack: the column default, one job.
	offerJob(t, farm, 1, conn.ExecutorContainer, nil)
	h.until("the first start", func(o farmtest.Observed) bool { return len(o.Starts) == 1 })
	offerJob(t, farm, 2, conn.ExecutorContainer, nil)
	offerJob(t, farm, 1, conn.ExecutorContainer, nil) // re-dispatched while still running here
	observed := h.until("two declines", func(o farmtest.Observed) bool { return len(o.Declines) == 2 })
	if d := observed.Declines[0]; d.Job != job(2) || d.Reason != conn.DeclineBusy || !strings.Contains(d.Detail, "1 of the 1") {
		t.Errorf("an offer past the default cap: %+v", d)
	}
	if d := observed.Declines[1]; d.Job != job(1) || d.Reason != conn.DeclineBusy || !strings.Contains(d.Detail, "already holds") {
		t.Errorf("a duplicate offer: %+v", d)
	}

	// The pool raises the cap to 2; the runner learns it at the next hello.
	farm.SetPool(&conn.AckPool{MaxConcurrency: 2, EnvAllowlist: []string{}})
	farm.Drop()
	h.until("the reconnection", func(o farmtest.Observed) bool { return len(o.Hellos) == 2 && len(o.Heartbeats) >= 2 })
	h.logged("max_concurrency=2")
	offerJob(t, farm, 2, conn.ExecutorContainer, nil)
	offerJob(t, farm, 3, conn.ExecutorContainer, nil)
	observed = h.until("the second accept and a third decline", func(o farmtest.Observed) bool {
		return len(o.Accepts) == 2 && len(o.Declines) == 3
	})
	if observed.Accepts[1].Job != job(2) {
		t.Errorf("the pool's cap of 2 did not admit a second job: %+v", observed.Accepts)
	}
	if d := observed.Declines[2]; d.Job != job(3) || d.Reason != conn.DeclineBusy || !strings.Contains(d.Detail, "2 of the 2") {
		t.Errorf("an offer past the pool's cap: %+v", d)
	}

	// Both finish; the runner has room again.
	close(release)
	h.until("two finishes", func(o farmtest.Observed) bool { return len(o.Finishes) == 2 })
	deadline := time.Now().Add(wait)
	for h.agent.workload.InFlight() != 0 {
		if time.Now().After(deadline) {
			t.Fatalf("%d jobs still held", h.agent.workload.InFlight())
		}
		time.Sleep(10 * time.Millisecond)
	}
	offerJob(t, farm, 3, conn.ExecutorContainer, nil)
	h.until("the third job accepted", func(o farmtest.Observed) bool { return len(o.Accepts) == 3 })
}

// TestSIGTERMCancelsARunningJobAndReportsItBeforeBye is what a service manager's stop does
// to a runner mid-build: the build is cancelled — the executor's context ends — and its
// `cancelled` finish reaches the gateway on the same connection, before the bye.
func TestSIGTERMCancelsARunningJobAndReportsItBeforeBye(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	container := &fakeExecutor{kind: conn.ExecutorContainer, execute: blockUntilCancelled}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Executors[conn.ExecutorContainer] = container })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorContainer, nil)
	h.until("the start", func(o farmtest.Observed) bool { return len(o.Starts) == 1 })

	if err := h.stop(); err != nil {
		t.Fatalf("a clean shutdown returned %v", err)
	}
	observed := h.until("the bye", func(o farmtest.Observed) bool { return len(o.Byes) == 1 })
	if len(observed.Finishes) != 1 {
		t.Fatalf("the cancelled job's finish did not precede the bye: %+v", summary(observed))
	}
	finish := finishes(t, observed)[0]
	if finish.Outcome != conn.OutcomeCancelled || finish.Error == nil || finish.Error.Code != exec.CodeCancelled ||
		!strings.Contains(finish.Error.Detail, "SIGTERM received") {
		t.Errorf("finish: %+v %+v", finish, finish.Error)
	}
}

// TestATimedOutJobIsReportedAsOne asserts `timeout_s` is enforced by the agent and reported
// as `timed_out` — not as a failure, and not as a cancellation.
func TestATimedOutJobIsReportedAsOne(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	container := &fakeExecutor{kind: conn.ExecutorContainer, execute: blockUntilCancelled}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Executors[conn.ExecutorContainer] = container })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorContainer, func(p map[string]any) { p["timeout_s"] = 1 })

	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	finish := finishes(t, observed)[0]
	if finish.Outcome != conn.OutcomeTimedOut || finish.Error == nil || finish.Error.Code != exec.CodeTimeout {
		t.Errorf("finish: %+v %+v", finish, finish.Error)
	}
}

// cancelJob sends the gateway's job.cancel for job n.
func cancelJob(t *testing.T, farm *farmtest.Farm, n int, reason string) {
	t.Helper()
	if err := farm.Send(conn.NewFrame(conn.NewID(), conn.TypeJobCancel, conn.JobCancelPayload{
		Job: job(n), Reason: reason, Detail: "an operator cancelled this build from the farm page",
	})); err != nil {
		t.Fatal(err)
	}
}

// TestAGatewayCancelStopsARunningJob is #252's propagation: a job.cancel for a running job
// stops that job — and only that job — and it is reported as `cancelled`, naming why, on a
// session that carries on.
func TestAGatewayCancelStopsARunningJob(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetPool(&conn.AckPool{MaxConcurrency: 2, EnvAllowlist: []string{}})
	container := &fakeExecutor{kind: conn.ExecutorContainer, execute: blockUntilCancelled}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Executors[conn.ExecutorContainer] = container })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorContainer, nil)
	offerJob(t, farm, 2, conn.ExecutorContainer, nil)
	h.until("both starts", func(o farmtest.Observed) bool { return len(o.Starts) == 2 })

	cancelJob(t, farm, 1, conn.CancelOperator)
	observed := h.until("the cancelled finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	finish := finishes(t, observed)[0]
	if finish.Job != job(1) || finish.Outcome != conn.OutcomeCancelled || finish.Error == nil ||
		finish.Error.Code != exec.CodeCancelled || !strings.Contains(finish.Error.Detail, "operator") {
		t.Errorf("finish: %+v %+v", finish, finish.Error)
	}
	if !h.agent.workload.Holds(job(2)) {
		t.Error("cancelling one job stopped another")
	}
	if len(observed.Byes) != 0 || len(observed.Violations) != 0 {
		t.Errorf("a cancel ended the session: %+v", summary(observed))
	}
	h.logged("the gateway cancelled a job; stopping it")

	// The other job is still the agent's, and still stoppable the ordinary way.
	if err := h.stop(); err != nil {
		t.Fatalf("a clean shutdown returned %v", err)
	}
}

// TestACancelDuringPreparationFinishesWithoutAStart is a job cancelled while its image is
// still being pulled: it never started, so there is no job.start and no exit code.
func TestACancelDuringPreparationFinishesWithoutAStart(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	pulling := make(chan struct{})
	container := &fakeExecutor{
		kind: conn.ExecutorContainer,
		prepare: func(ctx context.Context, _ exec.Job, _ exec.Progress) error {
			close(pulling)
			<-ctx.Done()
			return ctx.Err()
		},
	}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Executors[conn.ExecutorContainer] = container })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorContainer, nil)
	h.until("the accept", func(o farmtest.Observed) bool { return len(o.Accepts) == 1 })
	<-pulling

	cancelJob(t, farm, 1, conn.CancelReassigned)
	observed := h.until("the cancelled finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	finish := finishes(t, observed)[0]
	if finish.Outcome != conn.OutcomeCancelled || finish.ExitCode != nil || len(observed.Starts) != 0 ||
		!strings.Contains(finish.Error.Detail, "reassigned") {
		t.Errorf("finish: %+v %+v, starts %d", finish, finish.Error, len(observed.Starts))
	}
	waitForEmptyOutbox(t, h)
	if h.agent.workload.InFlight() != 0 {
		t.Errorf("%d jobs still held", h.agent.workload.InFlight())
	}
}

// TestACancelForAJobNotHeldIsIgnored is the race the contract names: a cancel that crossed
// the job's own finish, or answers an offer that never arrived. Nothing is stopped, nothing
// is sent, and the session carries on taking work.
func TestACancelForAJobNotHeldIsIgnored(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	container := &fakeExecutor{kind: conn.ExecutorContainer}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Executors[conn.ExecutorContainer] = container })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	cancelJob(t, farm, 9, conn.CancelOperator)
	h.logged("the gateway cancelled a job this agent does not hold")
	offerJob(t, farm, 1, conn.ExecutorContainer, nil)
	observed := h.until("the next job's finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if finish := finishes(t, observed)[0]; finish.Job != job(1) || finish.Outcome != conn.OutcomeSucceeded {
		t.Errorf("finish: %+v", finish)
	}
	if observed.Connections != 1 || len(observed.Byes) != 0 || len(observed.Violations) != 0 {
		t.Errorf("an unknown job's cancel disturbed the session: %+v", summary(observed))
	}
}

// TestARetryOfferReportsItsAttempt is the dispatcher's automatic retry (#252): an offer that
// says it is attempt 2 is started and finished as attempt 2.
func TestARetryOfferReportsItsAttempt(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	container := &fakeExecutor{kind: conn.ExecutorContainer}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Executors[conn.ExecutorContainer] = container })
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorContainer, func(p map[string]any) { p["attempt"] = 2 })

	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	if observed.Starts[0].Attempt != 2 {
		t.Errorf("start: %+v", observed.Starts[0])
	}
	if finish := finishes(t, observed)[0]; finish.Attempt != 2 {
		t.Errorf("finish: %+v", finish)
	}
}

// TestAShellJobRunsForReal runs a real shell executor through the whole agent: a command
// that exits 3 is `failed` with exit code 3, in a workspace under the state directory
// that is removed afterwards.
func TestAShellJobRunsForReal(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	dir := enrolled(t, farm, false)
	h := start(t, farm, dir, func(c *Config) {
		c.Capabilities.Shell = true
		c.Executors[conn.ExecutorShell] = &exec.Shell{Grace: time.Second}
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorShell, func(p map[string]any) {
		p["command"] = []string{"sh", "-c", "echo compiling; exit 3"}
		p["workdir"] = "/build"
	})

	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })
	finish := finishes(t, observed)[0]
	if finish.Outcome != conn.OutcomeFailed || finish.ExitCode == nil || *finish.ExitCode != 3 ||
		finish.Error == nil || finish.Error.Code != exec.CodeExit || finish.Log.DroppedBytes != len("compiling\n") {
		t.Errorf("finish: %+v %+v", finish, finish.Error)
	}
	workspace := observed.Starts[0].Workspace
	if workspace != filepath.Join(dir.Path(), "work", job(1)) || observed.Starts[0].Executor != conn.ExecutorShell {
		t.Errorf("start: %+v", observed.Starts[0])
	}
	if _, err := os.Stat(workspace); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the default cleanup left the workspace: %v", err)
	}
}

// TestKeepWorkspaceOnFailureLeavesItForDiagnosis is the cleanup flag through the agent: a
// failed job's workspace stays, and the log says where.
func TestKeepWorkspaceOnFailureLeavesItForDiagnosis(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	container := &fakeExecutor{kind: conn.ExecutorContainer, execute: func(context.Context, exec.Job) (int, error) {
		return 2, nil
	}}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) {
		c.Executors[conn.ExecutorContainer] = container
		c.Workspaces.KeepOnFailure = true
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	offerJob(t, farm, 1, conn.ExecutorContainer, nil)
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if info, err := os.Stat(observed.Starts[0].Workspace); err != nil || !info.IsDir() {
		t.Errorf("the failed job's workspace was not kept: %v", err)
	}
	h.logged("the workspace was kept for diagnosis")
}

// TestNewRefusesDishonestCapabilities is capability honesty enforced where the agent is
// built: a hello that would claim a kind of job the agent cannot run — or hide one it can —
// is a configuration New refuses.
func TestNewRefusesDishonestCapabilities(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	dir := enrolled(t, farm, false)
	for name, adjust := range map[string]func(*Config){
		"docker claimed, no container executor": func(c *Config) { c.Executors = nil },
		"a container executor, docker denied":   func(c *Config) { c.Capabilities.Docker = false },
		"shell claimed, no shell executor":      func(c *Config) { c.Capabilities.Shell = true },
		"a shell executor, shell denied": func(c *Config) {
			c.Executors[conn.ExecutorShell] = &exec.Shell{}
		},
		"an executor filed under another kind": func(c *Config) {
			c.Executors[conn.ExecutorContainer] = &exec.Shell{}
		},
		"executors with nowhere to run": func(c *Config) { c.Workspaces = nil },
	} {
		configuration := config(farm, dir, &logBuffer{})
		adjust(&configuration)
		if _, err := New(configuration); err == nil {
			t.Errorf("%s: New accepted it", name)
		}
	}
}

// TestPoolPolicyDefaults pins the reading of an ack without `pool`: the column defaults —
// one job at a time, nothing allowed through — and a policy that is replaced, not merged,
// by the next ack.
func TestPoolPolicyDefaults(t *testing.T) {
	var policy poolPolicy
	if cap, allowlist := policy.get(); cap != 1 || len(allowlist) != 0 {
		t.Errorf("a policy never set: %d %v", cap, allowlist)
	}
	policy.set(&conn.AckPool{MaxConcurrency: 4, EnvAllowlist: []string{"CI"}})
	if cap, allowlist := policy.get(); cap != 4 || !slices.Equal(allowlist, []string{"CI"}) {
		t.Errorf("a named policy: %d %v", cap, allowlist)
	}
	policy.set(nil)
	if cap, allowlist := policy.get(); cap != 1 || len(allowlist) != 0 {
		t.Errorf("an ack without pool after one with it: %d %v", cap, allowlist)
	}
}

// TestJobFramesWhileDisconnectedAreDropped asserts a non-terminal frame produced with no
// session live goes nowhere — it is advisory, and a stale job.start must never follow the
// finish it preceded — while the notice board delivers to a live session.
func TestJobFramesWhileDisconnectedAreDropped(t *testing.T) {
	var board noticeBoard
	frame := conn.NewFrame(conn.NewID(), conn.TypeJobProgress, conn.JobProgressPayload{
		Job: job(1), Phase: conn.PhasePrepare, Note: "",
	})
	if board.post(frame) {
		t.Error("a frame was accepted with no session live")
	}
	live := board.open()
	if !board.post(frame) || len(live) != 1 {
		t.Error("a live session did not receive the frame")
	}
	board.release(live)
	if board.post(frame) {
		t.Error("a released session still received frames")
	}
}

// TestExitCodeIsHeldToTheContract asserts an exit status outside −1–255 cannot make an
// illegal finish.
func TestExitCodeIsHeldToTheContract(t *testing.T) {
	for in, want := range map[int]int{0: 0, 255: 255, -1: -1, 256: -1, -9: -1} {
		value := in
		if got := exitCode(&value); *got != want {
			t.Errorf("exitCode(%d) = %d, want %d", in, *got, want)
		}
	}
	if exitCode(nil) != nil {
		t.Error("no exit code stays no exit code")
	}
}

// TestAnIllegalJobFrameIsNotSent asserts notify holds a frame to the contract before it
// reaches a socket: the gateway would end the session over it.
func TestAnIllegalJobFrameIsNotSent(t *testing.T) {
	logs := &logBuffer{}
	agent := &Agent{log: newLogger(logs)}
	live := agent.notices.open()
	agent.notify(conn.NewFrame(conn.NewID(), conn.TypeJobProgress, conn.JobProgressPayload{Job: "not-a-job", Phase: "run"}))
	if len(live) != 0 || !strings.Contains(logs.String(), "an illegal frame was not sent") {
		t.Errorf("an illegal frame was posted: %d queued\n%s", len(live), logs)
	}
	raw, _ := json.Marshal(conn.JobProgressPayload{Job: job(1), Phase: "run"})
	if !strings.Contains(string(raw), `"note":""`) {
		t.Errorf("an empty note must be sent, not omitted: %s", raw)
	}
}
