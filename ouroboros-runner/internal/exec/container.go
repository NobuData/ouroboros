package exec

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// The labels every job container carries, so an operator can find the farm's containers
// with `docker ps --filter label=dev.ouroboros.job` and tell which job each one is.
const (
	LabelJob    = "dev.ouroboros.job"
	LabelRunner = "dev.ouroboros.runner"
)

// daemonCallTimeout bounds each cleanup call the executor makes after its job has ended —
// stop, remove — which must not hang the agent on a daemon that has stopped answering.
const daemonCallTimeout = 30 * time.Second

// logDrain bounds the wait for a stopped container's output to finish arriving.
const logDrain = 5 * time.Second

// Container runs a job's command in its pool's pinned image — pool-a's world: firmware
// builds in `zephyr-sdk 0.17`.
//
// The job's workspace is bind-mounted at its `workdir`, which is also the working
// directory; nothing else of the host is mounted. The command is the container's exec-form
// CMD, so the daemon never hands it to a shell; the image's own ENTRYPOINT, if it has one, is
// part of the pool's pinned environment and is honoured. The environment is the scrubbed
// list and nothing of the agent's. The container gets the job's share of the machine
// ([ShareOf]), and an init process as PID 1 — so the stop signal reaches the build rather
// than a PID 1 that ignores it, and zombies are reaped.
type Container struct {
	// Engine is the daemon — the socket the `hello` probe found answering.
	Engine *Engine
	// Grace is how long the stop signal is given before SIGKILL. Zero means [DefaultGrace].
	Grace time.Duration
	// Now is the clock pull progress is paced by. Nil means time.Now.
	Now func() time.Time
}

// Kind is `container`.
func (c *Container) Kind() string { return conn.ExecutorContainer }

// Prepare checks the workdir and the image reference, and pulls the image if the daemon
// does not have it — reporting progress, because a first pull of a large SDK image is
// minutes of apparent silence otherwise.
func (c *Container) Prepare(ctx context.Context, job Job, workspace string, progress Progress) error {
	if _, err := ContainerWorkdir(job.Workdir); err != nil {
		return err
	}
	if strings.Contains(workspace, ":") {
		return failure(CodeWorkspaceInvalid, fmt.Sprintf("the workspace %s contains ':', which a bind mount cannot carry", workspace))
	}
	if !ValidReference(job.Image) {
		return failure(CodeImagePullFailed, fmt.Sprintf("%q is not an image reference this agent will pull", job.Image))
	}

	present, err := c.Engine.ImagePresent(ctx, job.Image)
	if err != nil {
		return failure(CodeImagePullFailed, fmt.Sprintf("the daemon could not be asked about %s: %v", job.Image, err))
	}
	if present {
		progress(100, truncateNote("image "+job.Image+" is present"))
		return nil
	}

	now := c.Now
	if now == nil {
		now = time.Now
	}
	tracker := newPullTracker(job.Image, now)
	progress(tracker.begin())
	err = c.Engine.Pull(ctx, job.Image, func(event PullEvent) {
		if tracker.observe(event) {
			progress(tracker.report())
		}
	})
	if err != nil {
		return failure(CodeImagePullFailed, fmt.Sprintf("%s could not be pulled: %v", job.Image, err))
	}
	progress(tracker.complete())
	return nil
}

// Execute creates the container, starts it, follows its output and waits for it to exit.
// When ctx ends first it stops the container — the stop signal, then SIGKILL after the
// grace — which ends every process in it, because nothing in a container outlives its
// PID 1. The container is removed however the job ended.
func (c *Container) Execute(ctx context.Context, job Job, workspace string, output Output) (int, error) {
	workdir, err := ContainerWorkdir(job.Workdir)
	if err != nil {
		return 0, err
	}
	env := job.Env
	if env == nil {
		env = []string{}
	}
	id, err := c.Engine.Create(ctx, ContainerSpec{
		Image:      job.Image,
		Cmd:        job.Command,
		Env:        env,
		WorkingDir: workdir,
		Labels:     map[string]string{LabelJob: job.ID, LabelRunner: "ouroboros-runner"},
		HostConfig: HostConfig{
			Binds:    []string{workspace + ":" + workdir},
			Init:     true,
			NanoCPUs: job.Limits.NanoCPUs,
			Memory:   job.Limits.MemoryBytes,
		},
	})
	if err != nil {
		return 0, failure(CodeStartFailed, fmt.Sprintf("the container could not be created: %v", err))
	}
	// Cleanup outlives the job's context, which may be why we are cleaning up.
	cleanup := context.WithoutCancel(ctx)
	defer func() {
		removing, cancel := context.WithTimeout(cleanup, daemonCallTimeout)
		defer cancel()
		_ = c.Engine.Remove(removing, id)
	}()

	if err := c.Engine.Start(ctx, id); err != nil {
		return 0, failure(CodeStartFailed, fmt.Sprintf("the container could not be started: %v", err))
	}

	following, stopFollowing := context.WithCancel(cleanup)
	defer stopFollowing()
	followed := make(chan struct{})
	go func() {
		defer close(followed)
		_ = c.Engine.Logs(following, id, output.stdout(), output.stderr())
	}()

	type exit struct {
		code int
		err  error
	}
	exited := make(chan exit, 1)
	go func() {
		code, err := c.Engine.Wait(cleanup, id)
		exited <- exit{code, err}
	}()

	var result exit
	select {
	case result = <-exited:
	case <-ctx.Done():
		stopping, cancel := context.WithTimeout(cleanup, c.grace()+daemonCallTimeout)
		_ = c.Engine.Stop(stopping, id, c.grace())
		cancel()
		select {
		case result = <-exited:
		case <-time.After(daemonCallTimeout):
			// The daemon stopped answering. The deferred remove is forced, which kills
			// whatever is left; the job is reported as ended by a signal.
			result = exit{code: -1}
		}
	}

	// The output stream ends when the container does; give its last bytes a moment.
	select {
	case <-followed:
	case <-time.After(logDrain):
		stopFollowing()
		<-followed
	}

	if result.err != nil {
		if ctx.Err() != nil {
			return -1, nil // stopped from outside; the caller classifies why
		}
		return 0, failure(CodeStartFailed, fmt.Sprintf("the container's exit could not be read: %v", result.err))
	}
	return result.code, nil
}

// grace is the configured grace, or the default.
func (c *Container) grace() time.Duration {
	if c.Grace <= 0 {
		return DefaultGrace
	}
	return c.Grace
}
