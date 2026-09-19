package exec

import (
	"context"
	"io"
	"time"
)

// DefaultGrace is how long a job's processes are given between SIGTERM and SIGKILL — the
// same ten seconds `docker stop` defaults to, so the two executors cancel alike.
const DefaultGrace = 10 * time.Second

// The stable error codes a job.finish carries in `error.code`: greppable tokens, one per
// way a job can end without succeeding. The protocol names `executor.exit` and
// `image.pull_failed` in its own examples; the rest follow their shape.
const (
	// CodeWorkspaceInvalid is a `workdir` the executor will not run in: a `..` that would
	// leave the workspace, or a container path that is not absolute.
	CodeWorkspaceInvalid = "workspace.invalid"
	// CodeWorkspaceCreateFailed is a workspace the agent could not create.
	CodeWorkspaceCreateFailed = "workspace.create_failed"
	// CodeImagePullFailed is an image that could not be found or pulled.
	CodeImagePullFailed = "image.pull_failed"
	// CodeStartFailed is a command that never started: no such program, or a container
	// the daemon would not create or start.
	CodeStartFailed = "executor.start_failed"
	// CodeExit is a command that ran and exited non-zero.
	CodeExit = "executor.exit"
	// CodeTimeout is a job stopped because its `timeout_s` ran out.
	CodeTimeout = "executor.timeout"
	// CodeCancelled is a job stopped because the agent was told to stop.
	CodeCancelled = "executor.cancelled"
)

// Job is one job as an executor runs it: the executor-relevant half of a `job.offer`,
// already checked and already scrubbed by the agent.
type Job struct {
	// ID is the job id, `job_` and a ULID. It names the workspace directory.
	ID string
	// Kind is the executor kind — conn.ExecutorContainer or conn.ExecutorShell.
	Kind string
	// Image is the container image, for a container job. Empty for a shell job.
	Image string
	// Command is argv. It is executed as argv and never handed to a shell.
	Command []string
	// Workdir is the offer's `workdir`: where the command runs, resolved against the
	// workspace by each executor (see [ResolveWorkdir] and [ContainerWorkdir]).
	Workdir string
	// Env is the job's whole environment as `NAME=value` entries, already filtered to the
	// pool's allow-list by [Scrub]. An empty list means an empty environment — never "inherit
	// the agent's".
	Env []string
	// Timeout is the job's wall-clock budget, `timeout_s`. It runs from the moment [Runner.Run]
	// is called — accept — and so covers an image pull as well as the command.
	Timeout time.Duration
	// Limits is the share of this machine a container job may use. Zero values are no limit.
	Limits Limits
	// Mounts is what else of the host a container job sees besides its workspace — the
	// agent's choice, never the offer's: its pool's compiler cache ([#247]). A shell job
	// runs on the host and ignores them.
	//
	// [#247]: https://github.com/NobuData/ouroboros/issues/247
	Mounts []Mount
}

// Mount is a host directory a container job sees at Target.
type Mount struct {
	// Host is the directory on this machine, absolute.
	Host string
	// Target is where the container sees it, absolute. A job's workdir may not overlap it.
	Target string
}

// Limits is a container job's resource share.
type Limits struct {
	// NanoCPUs is CPU time in billionths of a core: 2e9 is two cores.
	NanoCPUs int64
	// MemoryBytes is the memory ceiling.
	MemoryBytes int64
}

// ShareOf is one job's fair share of a machine that may run maxConcurrency jobs at once —
// its cores and its memory divided evenly — so concurrent jobs cannot starve each other.
//
//   - cpus and memoryMB are the machine as `hello.capabilities` reports it.
//   - maxConcurrency is the pool's cap; anything below 1 is read as 1.
//
// It returns zero limits (no limit) for a machine that reported nothing.
func ShareOf(cpus, memoryMB, maxConcurrency int) Limits {
	jobs := int64(max(maxConcurrency, 1))
	return Limits{
		NanoCPUs:    int64(max(cpus, 0)) * 1_000_000_000 / jobs,
		MemoryBytes: int64(max(memoryMB, 0)) * 1024 * 1024 / jobs,
	}
}

// Output is where a job's output goes: its stdout and its stderr, each written by one
// goroutine at a time. A nil writer discards. The agent connects these to the log shipper
// ([#247]).
//
// [#247]: https://github.com/NobuData/ouroboros/issues/247
type Output struct {
	Stdout io.Writer
	Stderr io.Writer
}

// stdout is the writer for standard output, or a discard.
func (o Output) stdout() io.Writer { return orDiscard(o.Stdout) }

// stderr is the writer for standard error, or a discard.
func (o Output) stderr() io.Writer { return orDiscard(o.Stderr) }

// orDiscard is a writer, or io.Discard in place of nil.
func orDiscard(w io.Writer) io.Writer {
	if w == nil {
		return io.Discard
	}
	return w
}

// Progress reports how far a job's preparation has come: a percentage 0–100, and one short
// line for the run console.
type Progress func(pct int, note string)

// Failure is a job the agent could not run as asked, with the stable code a job.finish
// reports it under. Its Detail is one sentence for the operator, and never a credential.
type Failure struct {
	Code   string
	Detail string
}

// Error is the failure as a log line: its code and its sentence.
func (f *Failure) Error() string { return f.Code + ": " + f.Detail }

// failure is a Failure with a formatted-by-the-caller detail.
func failure(code, detail string) *Failure { return &Failure{Code: code, Detail: detail} }

// Executor runs one kind of job. [Container] and [Shell] are the two.
//
// Both methods are called by [Runner.Run], in order, with the job's budget as their context.
// An error either returns is a *[Failure], which the job is reported under as `errored`.
type Executor interface {
	// Kind is the executor kind this runs, as `job.offer.executor` names it.
	Kind() string

	// Prepare readies everything the command needs before it can be handed over, reporting
	// progress as it goes: the workdir is checked and, for a container job, the image is
	// pulled if this machine does not have it. It runs BEFORE `job.start`, because a job
	// shown as running while it is really downloading is a farm page that lies.
	//
	//   - workspace is the job's own directory, already created.
	Prepare(ctx context.Context, job Job, workspace string, progress Progress) error

	// Execute runs the command until it exits or ctx ends, sending its output to output,
	// and returns its exit status: 0–255, or -1 when it was ended by a signal.
	//
	// When ctx ends, Execute terminates the job's whole process tree — SIGTERM, then SIGKILL
	// after the grace period — and returns only once it is gone. An error is a command that
	// never started.
	Execute(ctx context.Context, job Job, workspace string, output Output) (int, error)
}
