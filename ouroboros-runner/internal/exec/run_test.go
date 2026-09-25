package exec

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// scripted is an executor whose two steps a test writes.
type scripted struct {
	prepare func(ctx context.Context, progress Progress) error
	execute func(ctx context.Context) (int, error)
}

func (s *scripted) Kind() string { return conn.ExecutorShell }

func (s *scripted) Prepare(ctx context.Context, _ Job, _ string, progress Progress) error {
	if s.prepare == nil {
		return nil
	}
	return s.prepare(ctx, progress)
}

func (s *scripted) Execute(ctx context.Context, _ Job, _ string, _ Output) (int, error) {
	if s.execute == nil {
		return 0, nil
	}
	return s.execute(ctx)
}

// recorder is the Events a test reads back.
type recorder struct {
	mu        sync.Mutex
	progress  []int
	workspace string
	started   time.Time
}

func (r *recorder) Progress(pct int, _ string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.progress = append(r.progress, pct)
}

func (r *recorder) Started(workspace string, at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.workspace, r.started = workspace, at
}

// runScripted runs one job through a Runner with the given executor.
func runScripted(t *testing.T, ctx context.Context, executor Executor, timeout time.Duration, keep bool) (Result, *recorder) {
	t.Helper()
	events := &recorder{}
	runner := &Runner{Workspaces: &Workspaces{Root: filepath.Join(t.TempDir(), "work"), KeepOnFailure: keep}}
	job := Job{ID: jobID(1), Kind: conn.ExecutorShell, Command: []string{"make"}, Workdir: "/", Env: []string{}, Timeout: timeout}
	return runner.Run(ctx, executor, job, Output{}, events), events
}

// TestRunClassifiesEveryEnding is the five outcomes, each from the ending that produces it
// — and which of them carry an exit code, a start, and an error.
func TestRunClassifiesEveryEnding(t *testing.T) {
	t.Parallel()
	blocked := func(ctx context.Context) (int, error) { <-ctx.Done(); return -1, nil }
	stopped, stop := context.WithCancelCause(context.Background())
	stop(errors.New("SIGTERM received"))

	for _, testCase := range []struct {
		name     string
		ctx      context.Context
		executor *scripted
		timeout  time.Duration
		outcome  string
		exit     *int
		code     string
		started  bool
	}{
		{name: "exit 0", executor: &scripted{}, outcome: conn.OutcomeSucceeded, exit: ptr(0), started: true},
		{
			name:     "exit 2",
			executor: &scripted{execute: func(context.Context) (int, error) { return 2, nil }},
			outcome:  conn.OutcomeFailed, exit: ptr(2), code: CodeExit, started: true,
		},
		{
			name:     "a signal",
			executor: &scripted{execute: func(context.Context) (int, error) { return -1, nil }},
			outcome:  conn.OutcomeFailed, exit: ptr(-1), code: CodeExit, started: true,
		},
		{
			name:     "the budget ran out mid-build",
			executor: &scripted{execute: blocked}, timeout: 50 * time.Millisecond,
			outcome: conn.OutcomeTimedOut, exit: ptr(-1), code: CodeTimeout, started: true,
		},
		{
			name: "the budget ran out mid-pull",
			executor: &scripted{prepare: func(ctx context.Context, _ Progress) error {
				<-ctx.Done()
				return failure(CodeImagePullFailed, "interrupted")
			}},
			timeout: 50 * time.Millisecond, outcome: conn.OutcomeTimedOut, code: CodeTimeout,
		},
		{
			name: "the agent was stopped", ctx: stopped, executor: &scripted{execute: blocked},
			outcome: conn.OutcomeCancelled, code: CodeCancelled,
		},
		{
			name: "the image would not pull",
			executor: &scripted{prepare: func(context.Context, Progress) error {
				return failure(CodeImagePullFailed, "manifest unknown")
			}},
			outcome: conn.OutcomeErrored, code: CodeImagePullFailed,
		},
		{
			name: "the command would not start",
			executor: &scripted{execute: func(context.Context) (int, error) {
				return 0, errors.New("exec format error") // not a *Failure: wrapped as a start failure
			}},
			outcome: conn.OutcomeErrored, code: CodeStartFailed, started: true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := testCase.ctx
			if ctx == nil {
				ctx = context.Background()
			}
			timeout := testCase.timeout
			if timeout == 0 {
				timeout = time.Minute
			}
			result, events := runScripted(t, ctx, testCase.executor, timeout, false)
			if result.Outcome != testCase.outcome {
				t.Errorf("outcome %s, want %s", result.Outcome, testCase.outcome)
			}
			if (result.ExitCode == nil) != (testCase.exit == nil) ||
				(result.ExitCode != nil && *result.ExitCode != *testCase.exit) {
				t.Errorf("exit code %v, want %v", deref(result.ExitCode), deref(testCase.exit))
			}
			if (result.Error == nil) != (testCase.code == "") || (result.Error != nil && result.Error.Code != testCase.code) {
				t.Errorf("error %+v, want code %q", result.Error, testCase.code)
			}
			if (events.workspace != "") != testCase.started {
				t.Errorf("Started was reported: %t, want %t", events.workspace != "", testCase.started)
			}
			if result.FinishedAt.Before(result.StartedAt) {
				t.Errorf("finished %v before it started %v", result.FinishedAt, result.StartedAt)
			}
			if _, err := os.Stat(result.Workspace); !errors.Is(err, os.ErrNotExist) {
				t.Errorf("the default cleanup left the workspace: %v", err)
			}
		})
	}
}

// TestRunReportsTheCancellationCause asserts a cancelled job says why, in its own words.
func TestRunReportsTheCancellationCause(t *testing.T) {
	t.Parallel()
	ctx, stop := context.WithCancelCause(context.Background())
	stop(errors.New("SIGTERM received"))
	result, _ := runScripted(t, ctx, &scripted{}, time.Minute, false)
	if result.Error == nil || !strings.Contains(result.Error.Detail, "SIGTERM received") {
		t.Errorf("error %+v", result.Error)
	}
}

// TestRunReportsStartOnlyAfterPreparation is the protocol's ordering: progress while the
// image is pulled, and `Started` — job.start — only once it has been, with the duration
// running from there.
func TestRunReportsStartOnlyAfterPreparation(t *testing.T) {
	t.Parallel()
	var events *recorder
	executor := &scripted{
		prepare: func(_ context.Context, progress Progress) error {
			progress(0, "pulling")
			progress(100, "pulled")
			return nil
		},
		execute: func(context.Context) (int, error) {
			events.mu.Lock()
			defer events.mu.Unlock()
			if events.workspace == "" || len(events.progress) != 2 {
				return 99, nil // started before being reported, or before preparing
			}
			time.Sleep(20 * time.Millisecond)
			return 0, nil
		},
	}
	events = &recorder{}
	runner := &Runner{Workspaces: &Workspaces{Root: filepath.Join(t.TempDir(), "work")}}
	job := Job{ID: jobID(1), Kind: conn.ExecutorShell, Command: []string{"make"}, Workdir: "/", Timeout: time.Minute}
	result := runner.Run(context.Background(), executor, job, Output{}, events)
	if result.Outcome != conn.OutcomeSucceeded {
		t.Fatalf("outcome %s, error %+v", result.Outcome, result.Error)
	}
	if !result.StartedAt.Equal(events.started) || result.FinishedAt.Sub(result.StartedAt) < 20*time.Millisecond {
		t.Errorf("the duration runs from Started: %v → %v, started %v", result.StartedAt, result.FinishedAt, events.started)
	}
	if events.workspace != filepath.Join(runner.Workspaces.Root, jobID(1)) {
		t.Errorf("started in %s", events.workspace)
	}
}

// TestRunKeepsAFailedWorkspaceWhenAsked is the cleanup flag through Run.
func TestRunKeepsAFailedWorkspaceWhenAsked(t *testing.T) {
	t.Parallel()
	failed := &scripted{execute: func(context.Context) (int, error) { return 1, nil }}
	result, _ := runScripted(t, context.Background(), failed, time.Minute, true)
	if !result.Kept {
		t.Error("the failed job's workspace was not kept")
	}
	if _, err := os.Stat(result.Workspace); err != nil {
		t.Errorf("the kept workspace is not there: %v", err)
	}
}

// TestRunReportsAWorkspaceItCannotCreate asserts a workspace root that cannot be made is
// an `errored` job, with no command run.
func TestRunReportsAWorkspaceItCannotCreate(t *testing.T) {
	t.Parallel()
	file := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	ran := false
	runner := &Runner{Workspaces: &Workspaces{Root: filepath.Join(file, "work")}}
	job := Job{ID: jobID(1), Kind: conn.ExecutorShell, Command: []string{"make"}, Workdir: "/", Timeout: time.Minute}
	result := runner.Run(context.Background(), &scripted{execute: func(context.Context) (int, error) {
		ran = true
		return 0, nil
	}}, job, Output{}, &recorder{})
	if result.Outcome != conn.OutcomeErrored || result.Error.Code != CodeWorkspaceCreateFailed || ran || result.ExitCode != nil {
		t.Errorf("result %+v, error %+v, ran %t", result, result.Error, ran)
	}
}

func ptr(n int) *int { return &n }

func deref(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// TestRunGivesBeforeCleanupTheWorkspaceBeforeItIsRemoved is the moment a job's artifacts are
// collected (#330): after the command, with its files still on disk, and before the cleanup
// policy removes them — for a failure as for a success.
func TestRunGivesBeforeCleanupTheWorkspaceBeforeItIsRemoved(t *testing.T) {
	t.Parallel()
	for _, code := range []int{0, 2} {
		var seen []string
		runner := &Runner{Workspaces: &Workspaces{Root: filepath.Join(t.TempDir(), "work")}}
		runner.BeforeCleanup = func(workspace string, result Result) {
			if _, err := os.Stat(workspace); err != nil {
				t.Errorf("the workspace was gone before the hook: %v", err)
			}
			seen = append(seen, result.Outcome)
		}
		executor := &scripted{execute: func(context.Context) (int, error) { return code, nil }}
		job := Job{ID: jobID(1), Kind: conn.ExecutorShell, Command: []string{"make"}, Workdir: "/", Env: []string{}, Timeout: time.Minute}

		result := runner.Run(context.Background(), executor, job, Output{}, &recorder{})

		if len(seen) != 1 || seen[0] != result.Outcome {
			t.Errorf("exit %d: the hook saw %v; the result is %s", code, seen, result.Outcome)
		}
		if _, err := os.Stat(result.Workspace); !os.IsNotExist(err) {
			t.Errorf("exit %d: the workspace survived cleanup: %v", code, err)
		}
	}
}

// TestRunCallsNoHookWithoutAWorkspace: a job whose workspace could not be created has nothing
// to collect.
func TestRunCallsNoHookWithoutAWorkspace(t *testing.T) {
	t.Parallel()
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	called := false
	runner := &Runner{Workspaces: &Workspaces{Root: blocker}, BeforeCleanup: func(string, Result) { called = true }}
	job := Job{ID: jobID(1), Kind: conn.ExecutorShell, Command: []string{"make"}, Workdir: "/", Env: []string{}, Timeout: time.Minute}

	result := runner.Run(context.Background(), &scripted{}, job, Output{}, &recorder{})

	if result.Outcome != conn.OutcomeErrored || called {
		t.Fatalf("outcome %s, hook called %v", result.Outcome, called)
	}
}
