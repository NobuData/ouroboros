package exec

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// Events is what [Runner.Run] tells the agent as a job moves: progress while it is being
// prepared, and the moment its command is handed over. The agent turns them into
// `job.progress` and `job.start` frames and into the heartbeat's account of the job.
type Events interface {
	// Progress is preparation progress — an image pull — before the job has started.
	Progress(pct int, note string)
	// Started is the job's command handed to the executor, in the given workspace.
	Started(workspace string, at time.Time)
}

// Result is how a job ended, in the terms a `job.finish` reports it.
type Result struct {
	// Outcome is one of conn's five outcomes.
	Outcome string
	// ExitCode is the command's status, or nil when there was never a command to exit.
	ExitCode *int
	// StartedAt is when the command was handed over — or, for a job that never got that far,
	// when its attempt began. FinishedAt is when it ended.
	StartedAt, FinishedAt time.Time
	// Workspace is the job's directory, or empty if it was never created.
	Workspace string
	// Kept is true when the cleanup policy left the workspace in place for diagnosis.
	Kept bool
	// CleanupErr is a workspace that should have been removed and could not be.
	CleanupErr error
	// ReplacedWorkspace is true when an old workspace of the same job was removed first.
	ReplacedWorkspace bool
	// Error is why the job did not succeed, as a job.finish reports it; nil on success.
	Error *Failure
}

// errTimedOut is the cause a job's context carries when its budget runs out — how Run tells
// a timeout from a cancellation, which are two different outcomes.
var errTimedOut = errors.New("the job's timeout_s ran out")

// Runner runs jobs: one executor call sequence per job, around a workspace.
type Runner struct {
	// Workspaces is where jobs run, and the cleanup policy.
	Workspaces *Workspaces
	// Now is the clock. Nil means time.Now.
	Now func() time.Time
	// BeforeCleanup, when set, is called with a finished job's workspace and result after its
	// command has ended and before the cleanup policy removes the workspace — the one moment
	// the job's output files still exist. The agent collects and uploads artifacts here
	// ([#330]); the job's finish is not reported until it returns.
	//
	// [#330]: https://github.com/NobuData/ouroboros/issues/330
	BeforeCleanup func(workspace string, result Result)
}

// Run runs one job to its end and reports how it ended. It never returns early: when it
// returns, the job's processes are gone and its workspace has been dealt with.
//
// The sequence is the protocol's: the workspace is created, the executor prepares (an image
// pull, with progress), `Started` is reported only once the command is being handed over,
// and then it runs. Its ending is classified into one of the five outcomes:
//
//   - `succeeded` and `failed` are the command's own verdict — exit 0, or anything else.
//   - `timed_out` is the job's `timeout_s` running out. The budget runs from this call, so a
//     pull that eats it times the job out too: it is the job's wall clock.
//   - `cancelled` is ctx ending for any other reason — the agent being told to stop.
//   - `errored` is the agent failing to run the job at all: a workspace it could not create,
//     an image that would not pull, a command that would not start. A retry elsewhere is the
//     right answer to that and the wrong answer to a failed build, which is why they differ.
//
// Then the workspace is removed, unless the cleanup policy keeps it.
func (r *Runner) Run(ctx context.Context, executor Executor, job Job, output Output, events Events) Result {
	now := r.Now
	if now == nil {
		now = time.Now
	}
	began := now()

	budget, cancel := context.WithTimeoutCause(ctx, max(job.Timeout, time.Millisecond), errTimedOut)
	defer cancel()

	result := Result{StartedAt: began}
	workspace, replaced, err := r.Workspaces.Create(job.ID)
	if err != nil {
		return r.errored(result, now, failure(CodeWorkspaceCreateFailed, err.Error()))
	}
	result.Workspace, result.ReplacedWorkspace = workspace, replaced

	if err := executor.Prepare(budget, job, workspace, events.Progress); err != nil {
		if ended := r.stoppedBy(budget, job, nil); ended != nil {
			result.Outcome, result.Error = ended.outcome, ended.failure
			return r.finish(result, now)
		}
		return r.errored(result, now, asFailure(err, CodeStartFailed))
	}

	// A job stopped while it was being prepared never starts: there is no command to hand over.
	if ended := r.stoppedBy(budget, job, nil); ended != nil {
		result.Outcome, result.Error = ended.outcome, ended.failure
		return r.finish(result, now)
	}

	result.StartedAt = now()
	events.Started(workspace, result.StartedAt)

	code, err := executor.Execute(budget, job, workspace, output)
	if err != nil {
		if ended := r.stoppedBy(budget, job, nil); ended != nil {
			result.Outcome, result.Error = ended.outcome, ended.failure
			return r.finish(result, now)
		}
		return r.errored(result, now, asFailure(err, CodeStartFailed))
	}

	result.ExitCode = &code
	switch ended := r.stoppedBy(budget, job, &code); {
	case ended != nil:
		result.Outcome, result.Error = ended.outcome, ended.failure
	case code == 0:
		result.Outcome = conn.OutcomeSucceeded
	default:
		result.Outcome = conn.OutcomeFailed
		result.Error = failure(CodeExit, exitDetail(code))
	}
	return r.finish(result, now)
}

// ending is a job stopped from outside — its budget ran out, or it was cancelled — or nil
// when the budget is still live.
type ending struct {
	outcome string
	failure *Failure
}

// stoppedBy classifies why the budget ended, if it has.
func (r *Runner) stoppedBy(budget context.Context, job Job, code *int) *ending {
	if budget.Err() == nil {
		return nil
	}
	suffix := ""
	if code != nil {
		suffix = "; " + exitDetail(*code)
	}
	if errors.Is(context.Cause(budget), errTimedOut) {
		return &ending{conn.OutcomeTimedOut, failure(CodeTimeout,
			truncateDetail(fmt.Sprintf("the job ran past its %s budget and was stopped%s", job.Timeout, suffix)))}
	}
	cause := "the agent was told to stop"
	if err := context.Cause(budget); err != nil && !errors.Is(err, context.Canceled) {
		cause = err.Error()
	}
	return &ending{conn.OutcomeCancelled, failure(CodeCancelled,
		truncateDetail(fmt.Sprintf("the job was cancelled (%s)%s", cause, suffix)))}
}

// errored is a job the agent could not run.
func (r *Runner) errored(result Result, now func() time.Time, reason *Failure) Result {
	result.Outcome = conn.OutcomeErrored
	if reason.Detail == "" {
		reason.Detail = "the agent could not run the job"
	}
	reason.Detail = truncateDetail(reason.Detail)
	result.Error = reason
	return r.finish(result, now)
}

// finish stamps the end, gives BeforeCleanup its moment, and applies the cleanup policy.
func (r *Runner) finish(result Result, now func() time.Time) Result {
	result.FinishedAt = now()
	if r.BeforeCleanup != nil && result.Workspace != "" {
		r.BeforeCleanup(result.Workspace, result)
	}
	result.Kept, result.CleanupErr = r.Workspaces.Finish(result.Workspace, result.Outcome)
	return result
}

// exitDetail is an exit status, as one sentence.
func exitDetail(code int) string {
	if code < 0 {
		return "the command was ended by a signal"
	}
	return fmt.Sprintf("the command exited with status %d", code)
}

// asFailure is an executor's error as a *Failure: itself, when it is one, or wrapped under
// the given code when an executor broke its own contract and returned something else.
func asFailure(err error, code string) *Failure {
	var reason *Failure
	if errors.As(err, &reason) {
		return reason
	}
	return failure(code, err.Error())
}

// detailMax is the longest `error.detail` the contract allows.
const detailMax = 1024

// truncateDetail bounds a detail to what the contract allows, on a rune boundary.
func truncateDetail(detail string) string {
	runes := []rune(detail)
	if len(runes) <= detailMax {
		return detail
	}
	return string(runes[:detailMax-1]) + "…"
}
