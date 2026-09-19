package exec

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// The shell executor, running real processes. Everything the trust model promises about
// this executor is asserted here against the operating system rather than a fake: the
// environment a job actually sees, the argv a program actually receives, and whether the
// processes a cancelled build spawned are actually gone.

// testGrace is the grace period these tests cancel with: long enough to be a grace, short
// enough that a test waiting it out is quick.
const testGrace = time.Second

// buffer is an output sink safe for the executor's copying goroutines.
type buffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *buffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *buffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

// shellJob is a shell job running argv.
func shellJob(argv ...string) Job {
	return Job{ID: jobID(1), Kind: conn.ExecutorShell, Command: argv, Workdir: "/", Env: []string{}, Timeout: time.Minute}
}

// execute prepares and runs a job in a fresh workspace, returning its exit code and output.
func execute(t *testing.T, ctx context.Context, job Job) (int, string, string, error) {
	t.Helper()
	shell := &Shell{Grace: testGrace}
	workspace := t.TempDir()
	if err := shell.Prepare(ctx, job, workspace, func(int, string) {}); err != nil {
		return 0, "", "", err
	}
	stdout, stderr := &buffer{}, &buffer{}
	code, err := shell.Execute(ctx, job, workspace, Output{Stdout: stdout, Stderr: stderr})
	return code, stdout.String(), stderr.String(), err
}

// gone reports whether a process no longer exists.
func gone(pid int) bool { return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) }

// waitGone waits briefly for processes that were just killed to be reaped by init.
func waitGone(pids []int) []int {
	deadline := time.Now().Add(2 * time.Second)
	for {
		var alive []int
		for _, pid := range pids {
			if !gone(pid) {
				alive = append(alive, pid)
			}
		}
		if len(alive) == 0 || time.Now().After(deadline) {
			return alive
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// readPIDs reads the pids a job wrote, one per line.
func readPIDs(t *testing.T, path string) []int {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("the job's pid file: %v", err)
	}
	var pids []int
	for _, field := range strings.Fields(string(raw)) {
		pid, err := strconv.Atoi(field)
		if err != nil {
			t.Fatal(err)
		}
		pids = append(pids, pid)
	}
	return pids
}

// TestShellCapturesExitCodesAndOutput is the executor's plain job: stdout and stderr to
// their own writers, and the exit status as the command gave it.
func TestShellCapturesExitCodesAndOutput(t *testing.T) {
	t.Parallel()
	for want, argv := range map[int][]string{
		0: {"sh", "-c", "echo out; echo err >&2"},
		2: {"sh", "-c", "echo out; echo err >&2; exit 2"},
	} {
		code, stdout, stderr, err := execute(t, context.Background(), shellJob(argv...))
		if err != nil || code != want || stdout != "out\n" || stderr != "err\n" {
			t.Errorf("%v: code %d, stdout %q, stderr %q, err %v", argv, code, stdout, stderr, err)
		}
	}
}

// TestShellEnvironmentIsOnlyTheAllowList is the acceptance criterion verbatim: a job that
// prints its environment prints only the allow-listed variables — nothing of the agent's,
// though the agent's environment holds a variable the job would love to see.
func TestShellEnvironmentIsOnlyTheAllowList(t *testing.T) {
	t.Setenv("OURO_RUNNER_TEST_SENTINEL", "the agent's own environment")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "hunter2")
	env, dropped := Scrub(map[string]string{"CI": "true", "MAKEFLAGS": "-j8", "AWS_SECRET_ACCESS_KEY": "x"},
		[]string{"CI", "MAKEFLAGS"})

	job := shellJob("env")
	job.Env = env
	code, stdout, _, err := execute(t, context.Background(), job)
	if err != nil || code != 0 {
		t.Fatalf("env: %d, %v", code, err)
	}
	if stdout != "CI=true\nMAKEFLAGS=-j8\n" {
		t.Errorf("the job's environment was:\n%s", stdout)
	}
	if strings.Contains(stdout, "SENTINEL") || strings.Contains(stdout, "hunter2") || strings.Contains(stdout, "PATH=") {
		t.Error("the agent's environment leaked into the job")
	}
	if strings.Join(dropped, ",") != "AWS_SECRET_ACCESS_KEY" {
		t.Errorf("dropped %v", dropped)
	}

	// And a job given no environment at all has none — not the agent's by default.
	job.Env = nil
	if _, stdout, _, _ := execute(t, context.Background(), job); stdout != "" {
		t.Errorf("a job with a nil environment inherited:\n%s", stdout)
	}
}

// TestShellNeverExpandsServerData is argv-exec, verified: a command whose arguments are
// full of shell metacharacters reaches the program as those literal characters.
func TestShellNeverExpandsServerData(t *testing.T) {
	t.Parallel()
	arguments := []string{"$(id)", "; touch pwned", "`whoami`", "*", "$HOME", "a b", "x && echo y", "'\"", "|cat", ">out"}
	code, stdout, _, err := execute(t, context.Background(), shellJob(append([]string{"printf", "%s\\n"}, arguments...)...))
	if err != nil || code != 0 {
		t.Fatalf("printf: %d, %v", code, err)
	}
	if want := strings.Join(arguments, "\n") + "\n"; stdout != want {
		t.Errorf("the program received:\n%s\nwant:\n%s", stdout, want)
	}
}

// TestCancellationTerminatesTheProcessTree is the acceptance criterion: a build that has
// spawned a tree of processes — including one that ignores SIGTERM, as a compiler mid-write
// might — is gone, every process of it, within the grace period after cancellation.
func TestCancellationTerminatesTheProcessTree(t *testing.T) {
	t.Parallel()
	pids := filepath.Join(t.TempDir(), "pids")
	// The leader ignores SIGTERM; so does one grandchild (an ignored signal survives exec);
	// another child is an ordinary sleep. Every pid goes to the file, then the leader waits.
	script := `trap '' TERM
(trap '' TERM; exec sleep 300) & echo $! >> "$1"
sleep 300 & echo $! >> "$1"
echo $$ >> "$1"
echo ready
wait`
	job := shellJob("sh", "-c", script, "build", pids)

	ctx, cancel := context.WithCancel(context.Background())
	stdout := &buffer{}
	shell := &Shell{Grace: testGrace}
	workspace := t.TempDir()
	type exit struct {
		code int
		err  error
	}
	exited := make(chan exit, 1)
	go func() {
		code, err := shell.Execute(ctx, job, workspace, Output{Stdout: stdout})
		exited <- exit{code, err}
	}()
	for deadline := time.Now().Add(10 * time.Second); !strings.Contains(stdout.String(), "ready"); {
		if time.Now().After(deadline) {
			t.Fatal("the build never started its tree")
		}
		time.Sleep(10 * time.Millisecond)
	}
	tree := readPIDs(t, pids)
	if len(tree) != 3 {
		t.Fatalf("expected three processes, got %v", tree)
	}

	cancelled := time.Now()
	cancel()
	var result exit
	select {
	case result = <-exited:
	case <-time.After(testGrace + killWait + 5*time.Second):
		t.Fatal("Execute did not return after cancellation")
	}
	elapsed := time.Since(cancelled)

	if result.err != nil || result.code != -1 {
		t.Errorf("a killed build: code %d, err %v", result.code, result.err)
	}
	if alive := waitGone(tree); len(alive) > 0 {
		t.Errorf("orphaned processes survived the cancellation: %v", alive)
	}
	// Two of the three ignore SIGTERM, so SIGKILL was needed — after the grace, not before
	// it, and not long after it either.
	if elapsed < testGrace || elapsed > testGrace+3*time.Second {
		t.Errorf("the tree was terminated %v after cancellation, with a %v grace", elapsed, testGrace)
	}
}

// TestAPromptTreeIsTerminatedWithoutWaitingOutTheGrace asserts a build whose processes all
// honour SIGTERM costs milliseconds to cancel, not the grace period.
func TestAPromptTreeIsTerminatedWithoutWaitingOutTheGrace(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(200*time.Millisecond, cancel)
	started := time.Now()
	shell := &Shell{Grace: 30 * time.Second}
	code, err := shell.Execute(ctx, shellJob("sleep", "300"), t.TempDir(), Output{})
	if err != nil || code != -1 {
		t.Errorf("code %d, err %v", code, err)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Errorf("a prompt SIGTERM took %v", elapsed)
	}
}

// TestALeaderThatExitsLeavesNoOrphans asserts the group is swept after a NORMAL exit too:
// a command that backgrounds a process and exits 0 does not leave it running — and the
// background process, which still held the output pipe, does not hold up the job.
func TestALeaderThatExitsLeavesNoOrphans(t *testing.T) {
	t.Parallel()
	pids := filepath.Join(t.TempDir(), "pids")
	started := time.Now()
	code, _, _, err := execute(t, context.Background(),
		shellJob("sh", "-c", `sleep 300 & echo $! > "$1"; echo done`, "build", pids))
	if err != nil || code != 0 {
		t.Fatalf("code %d, err %v", code, err)
	}
	if alive := waitGone(readPIDs(t, pids)); len(alive) > 0 {
		t.Errorf("the backgrounded process outlived its job: %v", alive)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Errorf("the job took %v; the orphan held it up", elapsed)
	}
}

// TestShellWorkdirIsInsideTheWorkspace runs a program named relative to the workdir, which
// is resolved inside the workspace and created for the job.
func TestShellWorkdirIsInsideTheWorkspace(t *testing.T) {
	t.Parallel()
	shell := &Shell{Grace: testGrace}
	workspace := t.TempDir()
	job := shellJob("./run.sh")
	job.Workdir = "/Users/builder/work"
	if err := shell.Prepare(context.Background(), job, workspace, nil); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(workspace, "Users", "builder", "work")
	if err := os.WriteFile(filepath.Join(dir, "run.sh"), []byte("#!/bin/sh\npwd\n"), 0o700); err != nil { // #nosec G306 -- an executable test script
		t.Fatal(err)
	}
	stdout := &buffer{}
	code, err := shell.Execute(context.Background(), job, workspace, Output{Stdout: stdout})
	resolved, _ := filepath.EvalSymlinks(dir)
	if err != nil || code != 0 || strings.TrimSpace(stdout.String()) != resolved {
		t.Errorf("code %d, err %v, ran in %q, want %q", code, err, stdout.String(), resolved)
	}

	job.Workdir = "../../etc"
	var reason *Failure
	if err := shell.Prepare(context.Background(), job, workspace, nil); !errors.As(err, &reason) ||
		reason.Code != CodeWorkspaceInvalid {
		t.Errorf("a workdir leaving the workspace: %v", err)
	}
}

// TestACommandThatCannotStartIsAFailure asserts a program that does not exist is a
// start failure — the job errored — rather than a build that failed.
func TestACommandThatCannotStartIsAFailure(t *testing.T) {
	t.Parallel()
	for _, argv := range [][]string{
		{"ouroboros-no-such-program"},
		{"./not-here.sh"},
		{},
	} {
		_, _, _, err := execute(t, context.Background(), shellJob(argv...))
		var reason *Failure
		if !errors.As(err, &reason) || reason.Code != CodeStartFailed {
			t.Errorf("%v: %v", argv, err)
		}
	}
}
