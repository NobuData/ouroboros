package exec

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// Shell runs a job's command directly on this machine — pool-b's world: HIL rigs wired to
// physical boards, and macOS hosts that cannot run a container at all.
//
// The package documentation's trust model is this executor's contract: argv-exec only, an
// environment that is the pool's allow-list and nothing inherited, a workdir that cannot
// leave the job's workspace, and a process group that is terminated as a whole.
type Shell struct {
	// Grace is how long SIGTERM is given before SIGKILL. Zero means [DefaultGrace].
	Grace time.Duration
}

// Kind is `shell`.
func (s *Shell) Kind() string { return conn.ExecutorShell }

// Prepare resolves the job's workdir inside its workspace and creates it. There is nothing
// to pull: a shell job's environment is the machine itself.
func (s *Shell) Prepare(_ context.Context, job Job, workspace string, _ Progress) error {
	dir, err := ResolveWorkdir(workspace, job.Workdir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, workspaceMode); err != nil {
		return failure(CodeWorkspaceCreateFailed, fmt.Sprintf("the workdir %s could not be created: %v", dir, err))
	}
	return nil
}

// Execute runs the command as the leader of a new process group, with the scrubbed
// environment and stdin at /dev/null, and waits for it.
//
// However it ends, the group is terminated afterwards: on cancellation that is the whole
// point, and after a normal exit it is what stops a child the command left running — a
// backgrounded server, a compiler still writing — from outliving the job it belonged to.
func (s *Shell) Execute(ctx context.Context, job Job, workspace string, output Output) (int, error) {
	if len(job.Command) == 0 {
		return 0, failure(CodeStartFailed, "the job has no command")
	}
	dir, err := ResolveWorkdir(workspace, job.Workdir)
	if err != nil {
		return 0, err
	}
	program, err := lookPath(job.Command[0], dir)
	if err != nil {
		return 0, failure(CodeStartFailed, fmt.Sprintf("the command %q cannot be run: %v", job.Command[0], err))
	}

	// Our own pipes rather than cmd.Stdout = writer. With a writer, os/exec copies in
	// goroutines that Wait joins — so Wait would not return while a child the command left
	// behind still held the pipe, and the leader's exit would go unnoticed. With *os.File,
	// Wait returns when the LEADER exits, the group is swept, and the copies finish when
	// the last holder is gone.
	stdout, err := newPipe(output.stdout())
	if err != nil {
		return 0, failure(CodeStartFailed, "the output pipe could not be created: "+err.Error())
	}
	stderr, err := newPipe(output.stderr())
	if err != nil {
		stdout.abandon()
		return 0, failure(CodeStartFailed, "the output pipe could not be created: "+err.Error())
	}

	env := job.Env
	if env == nil {
		env = []string{} // nil would mean "inherit the agent's environment" to os/exec
	}
	// #nosec G204 -- running the job's argv is this executor's purpose. It is executed as
	// argv, never through a shell, so nothing in it is expanded (see the package doc).
	cmd := &exec.Cmd{
		Path:        program,
		Args:        job.Command,
		Dir:         dir,
		Env:         env,
		Stdout:      stdout.write,
		Stderr:      stderr.write,
		SysProcAttr: procAttr(),
	}
	if err := cmd.Start(); err != nil {
		stdout.abandon()
		stderr.abandon()
		return 0, failure(CodeStartFailed, fmt.Sprintf("the command %q could not be started: %v", job.Command[0], err))
	}
	// The child has its own copies of the write ends; ours must go, or the readers would
	// never see end-of-file.
	stdout.started()
	stderr.started()

	pgid := cmd.Process.Pid
	exited := make(chan struct{})
	go func() {
		_ = cmd.Wait() // its error is the exit status, read from ProcessState below
		close(exited)
	}()

	grace := s.grace()
	select {
	case <-exited:
		terminateGroup(pgid, grace) // orphans the leader left behind
	case <-ctx.Done():
		terminateGroup(pgid, grace)
		<-exited
	}

	// Every member is gone, so the pipes are at end-of-file — unless a process that left
	// the group still holds one. Its output is not the job's; stop waiting for it.
	stdout.finish(grace)
	stderr.finish(grace)

	return cmd.ProcessState.ExitCode(), nil
}

// grace is the configured grace, or the default.
func (s *Shell) grace() time.Duration {
	if s.Grace <= 0 {
		return DefaultGrace
	}
	return s.Grace
}

// lookPath resolves a command's program.
//
// A name with a slash is a path: relative to the workdir, the way it would be for a person
// standing in it — `./scripts/notarize.sh`. A bare name is looked up on the AGENT's PATH,
// because the job's own environment carries no PATH unless its pool allow-lists one; what
// the program then runs is resolved in its own environment. Either way the result must be
// an executable file.
func lookPath(name, dir string) (string, error) {
	if !strings.Contains(name, "/") {
		program, err := exec.LookPath(name)
		if errors.Is(err, exec.ErrDot) {
			return "", fmt.Errorf("%s resolves to the current directory through PATH, which is refused", name)
		}
		return program, err
	}
	if !filepath.IsAbs(name) {
		name = filepath.Join(dir, name)
	}
	return exec.LookPath(name)
}

// pipe is one of a job's output streams: the write end the command inherits, and a copy
// from the read end to the job's Output.
type pipe struct {
	read, write *os.File
	copied      chan struct{}
	once        sync.Once
	destination io.Writer
}

// newPipe makes a stream whose output is copied to destination once the command starts.
func newPipe(destination io.Writer) (*pipe, error) {
	read, write, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	return &pipe{read: read, write: write, copied: make(chan struct{}), destination: destination}, nil
}

// started closes the parent's write end and begins copying.
func (p *pipe) started() {
	_ = p.write.Close()
	go func() {
		defer close(p.copied)
		_, _ = io.Copy(p.destination, p.read)
	}()
}

// finish waits up to timeout for the copy to reach end-of-file, then closes the read end
// — which ends a copy still blocked on a pipe held by a process outside the job.
func (p *pipe) finish(timeout time.Duration) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-p.copied:
	case <-timer.C:
	}
	p.once.Do(func() { _ = p.read.Close() })
	<-p.copied
}

// abandon closes both ends of a stream whose command never started.
func (p *pipe) abandon() {
	_ = p.write.Close()
	_ = p.read.Close()
}
