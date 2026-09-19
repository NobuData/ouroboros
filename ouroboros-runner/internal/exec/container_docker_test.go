//go:build dockertest

package exec

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/telemetry"
)

// The container executor against a REAL Docker or Podman daemon — the acceptance criterion
// "a container job runs against a small image", with the pull, the exit code, the duration
// and the cancellation all as the daemon really does them.
//
// Behind the `dockertest` build tag, and run by `make test-docker`, because it needs a
// daemon and a registry: the default suite stays hermetic and runs anywhere. ci/runner still
// compiles and lints this file (see .golangci.yml's build-tags and the Makefile's
// typecheck), so it cannot rot unnoticed. On a machine with no reachable daemon it FAILS
// rather than skipping — a run that asked for the daemon and did not get one has not
// tested anything.

// dockerImage is small, public, and pinned: busybox, about 2 MB.
const dockerImage = "busybox:1.36"

// realEngine is the daemon the agent would use, or a failed test.
func realEngine(t *testing.T) *Engine {
	t.Helper()
	socket, found := telemetry.FindDocker(context.Background(), telemetry.DockerSockets())
	if !found {
		t.Fatal("no Docker or Podman daemon answered on this machine's sockets; `make test-docker` needs one")
	}
	return NewEngine(socket)
}

// realJob is a container job in the test image.
func realJob(command ...string) Job {
	return Job{
		ID: jobID(42), Kind: conn.ExecutorContainer, Image: dockerImage, Command: command,
		Workdir: "/workspace", Env: []string{"CI=true"}, Timeout: time.Minute, Limits: ShareOf(2, 512, 1),
	}
}

// TestDockerPullsWithProgressAndRunsAJob removes the image, so the pull is a real first
// pull, then runs a job in it and checks what came back.
func TestDockerPullsWithProgressAndRunsAJob(t *testing.T) {
	engine := realEngine(t)
	ctx := context.Background()
	_ = engine.call(ctx, "remove the test image", http.MethodDelete, "/images/"+dockerImage,
		url.Values{"force": {"1"}}, nil, nil)

	progress := &progressLog{}
	container := &Container{Engine: engine, Grace: 2 * time.Second}
	t.Setenv("OURO_RUNNER_TEST_SENTINEL", "the agent's own environment")
	job := realJob("sh", "-c", `echo "$1"; env; echo made > /workspace/made.txt; echo oops >&2; exit 3`, "sh", "$(id); *")
	workspace := t.TempDir()
	if err := container.Prepare(ctx, job, workspace, progress.report); err != nil {
		t.Fatalf("prepare: %v", err)
	}
	reports := progress.reports
	if len(reports) < 2 || !strings.HasPrefix(reports[0], "0 pulling "+dockerImage) ||
		!strings.HasPrefix(reports[len(reports)-1], "100 pulled "+dockerImage) {
		t.Errorf("the pull was not reported from start to end: %q", reports)
	}
	t.Logf("pull progress: %q", reports)

	stdout, stderr := &buffer{}, &buffer{}
	started := time.Now()
	code, err := container.Execute(ctx, job, workspace, Output{Stdout: stdout, Stderr: stderr})
	if err != nil || code != 3 {
		t.Fatalf("code %d, err %v\nstdout %s\nstderr %s", code, err, stdout, stderr)
	}
	t.Logf("ran in %v", time.Since(started))

	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if lines[0] != "$(id); *" {
		t.Errorf("the argument was expanded: %q", lines[0])
	}
	if !strings.Contains(stdout.String(), "CI=true") || strings.Contains(stdout.String(), "SENTINEL") {
		t.Errorf("the container's environment:\n%s", stdout)
	}
	if stderr.String() != "oops\n" {
		t.Errorf("stderr %q", stderr)
	}
	if made, err := os.ReadFile(filepath.Join(workspace, "made.txt")); err != nil || string(made) != "made\n" {
		t.Errorf("the workspace was not mounted at the workdir: %q, %v", made, err)
	}

	// Present now: no second pull.
	progress = &progressLog{}
	if err := container.Prepare(ctx, job, t.TempDir(), progress.report); err != nil || len(progress.reports) != 1 {
		t.Errorf("a present image: %v, %q", err, progress.reports)
	}
}

// TestDockerCancellationStopsTheContainer cancels a container whose build ignores SIGTERM:
// the daemon's stop waits the grace, then kills it, and the container is removed.
func TestDockerCancellationStopsTheContainer(t *testing.T) {
	engine := realEngine(t)
	container := &Container{Engine: engine, Grace: 2 * time.Second}
	job := realJob("sh", "-c", `trap '' TERM; sleep 300 & sleep 300 & echo ready; wait`)
	ctx, cancel := context.WithCancel(context.Background())
	if err := container.Prepare(ctx, job, t.TempDir(), func(int, string) {}); err != nil {
		t.Fatalf("prepare: %v", err)
	}

	stdout := &buffer{}
	go func() {
		for deadline := time.Now().Add(30 * time.Second); !strings.Contains(stdout.String(), "ready"); {
			if time.Now().After(deadline) {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		cancel()
	}()
	code, err := container.Execute(ctx, job, t.TempDir(), Output{Stdout: stdout})
	if err != nil || code != 137 {
		t.Errorf("a killed container: code %d, err %v", code, err)
	}

	// Nothing left behind: the job's container is gone.
	var listed []struct {
		ID string `json:"Id"`
	}
	filters := `{"label":["` + LabelJob + `=` + job.ID + `"]}`
	if err := engine.call(context.Background(), "list containers", http.MethodGet, "/containers/json",
		url.Values{"all": {"1"}, "filters": {filters}}, nil, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 0 {
		t.Errorf("the cancelled job's container survived: %v", listed)
	}
}
