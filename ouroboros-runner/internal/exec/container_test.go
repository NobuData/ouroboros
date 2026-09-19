package exec

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// The container executor against a fake Docker Engine API on a unix socket — the same
// transport, paths and stream formats the real daemon serves (a real one is exercised by
// the dockertest build tag; see container_docker_test.go).

// fakeEngine is a scripted daemon: which images it has, what a pull streams, and how the
// one container it runs behaves.
type fakeEngine struct {
	mu sync.Mutex
	// images the daemon already has.
	images map[string]bool
	// pullLines is what a pull streams, one JSON object per line.
	pullLines []string
	// pullStatus, when set, answers the pull request itself with that status.
	pullStatus int
	// createStatus, when set, refuses container creation with that status.
	createStatus int
	// exitCode is what the container exits with; runUntilStopped keeps it running until a
	// stop, which makes it exit 143.
	exitCode        int
	runUntilStopped bool

	// What the executor asked for.
	pulls   []url.Values
	created []ContainerSpec
	stops   []string
	removed []url.Values
	started bool

	exited chan struct{}
	once   sync.Once
}

// newFakeEngine serves a fake daemon on a short-pathed socket and returns it with an
// Engine that talks to it.
func newFakeEngine(t *testing.T) (*fakeEngine, *Engine) {
	t.Helper()
	dir, err := os.MkdirTemp("", "de") // short: a unix socket's path is capped near 100 bytes
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "docker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	fake := &fakeEngine{images: map[string]bool{}, exited: make(chan struct{})}
	server := &http.Server{Handler: http.HandlerFunc(fake.serve), ReadHeaderTimeout: time.Second}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() {
		fake.exit(0)
		_ = server.Close()
	})
	return fake, NewEngine(socket)
}

// requests is a copy of what the executor asked for, read under the daemon's lock.
type requests struct {
	pulls   []url.Values
	created []ContainerSpec
	stops   []string
	removed []url.Values
	started bool
}

// seen is what the executor has asked for so far.
func (f *fakeEngine) seen() requests {
	f.mu.Lock()
	defer f.mu.Unlock()
	return requests{
		pulls: slices.Clone(f.pulls), created: slices.Clone(f.created), stops: slices.Clone(f.stops),
		removed: slices.Clone(f.removed), started: f.started,
	}
}

// script changes how the daemon behaves, under its lock — the requests that read it arrive
// on the server's own goroutines.
func (f *fakeEngine) script(change func(*fakeEngine)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	change(f)
}

// exit ends the container, once.
func (f *fakeEngine) exit(code int) {
	f.once.Do(func() {
		f.mu.Lock()
		f.exitCode = code
		f.mu.Unlock()
		close(f.exited)
	})
}

// serve is the Engine API, the parts the executor uses.
func (f *fakeEngine) serve(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/images/") && strings.HasSuffix(path, "/json"):
		image := strings.TrimSuffix(strings.TrimPrefix(path, "/images/"), "/json")
		f.mu.Lock()
		present := f.images[image]
		f.mu.Unlock()
		if !present {
			engineError(w, http.StatusNotFound, "No such image: "+image)
			return
		}
		_, _ = w.Write([]byte(`{"Id":"sha256:abc"}`))

	case r.Method == http.MethodPost && path == "/images/create":
		f.mu.Lock()
		f.pulls = append(f.pulls, r.URL.Query())
		status, lines := f.pullStatus, f.pullLines
		f.mu.Unlock()
		if status != 0 {
			engineError(w, status, "pull access denied for "+r.URL.Query().Get("fromImage"))
			return
		}
		for _, line := range lines {
			_, _ = w.Write([]byte(line + "\n"))
		}

	case r.Method == http.MethodPost && path == "/containers/create":
		var spec ContainerSpec
		_ = json.NewDecoder(r.Body).Decode(&spec)
		f.mu.Lock()
		f.created = append(f.created, spec)
		status := f.createStatus
		f.mu.Unlock()
		if status != 0 {
			engineError(w, status, "no space left on device")
			return
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"Id":"c0ffee","Warnings":[]}`))

	case r.Method == http.MethodPost && path == "/containers/c0ffee/start":
		f.mu.Lock()
		f.started = true
		running := f.runUntilStopped
		code := f.exitCode
		f.mu.Unlock()
		if !running {
			go f.exit(code)
		}
		w.WriteHeader(http.StatusNoContent)

	case r.Method == http.MethodGet && path == "/containers/c0ffee/logs":
		w.Header().Set("Content-Type", "application/vnd.docker.multiplexed-stream")
		_, _ = w.Write(frame(1, "compiling kernel/sched.c\n"))
		_, _ = w.Write(frame(2, "warning: unused variable\n"))
		w.(http.Flusher).Flush()
		<-f.exited
		_, _ = w.Write(frame(1, "done\n"))

	case r.Method == http.MethodPost && path == "/containers/c0ffee/wait":
		<-f.exited
		f.mu.Lock()
		code := f.exitCode
		f.mu.Unlock()
		_, _ = fmt.Fprintf(w, `{"StatusCode":%d,"Error":null}`, code)

	case r.Method == http.MethodPost && path == "/containers/c0ffee/stop":
		f.mu.Lock()
		f.stops = append(f.stops, r.URL.Query().Get("t"))
		f.mu.Unlock()
		f.exit(143)
		w.WriteHeader(http.StatusNoContent)

	case r.Method == http.MethodDelete && path == "/containers/c0ffee":
		f.mu.Lock()
		f.removed = append(f.removed, r.URL.Query())
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)

	default:
		engineError(w, http.StatusNotFound, "page not found: "+r.Method+" "+path)
	}
}

// frame is one frame of the Engine API's multiplexed output stream.
func frame(stream byte, payload string) []byte {
	header := make([]byte, 8)
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(payload))) // #nosec G115 -- a short test string
	return append(header, payload...)
}

// engineError answers as the daemon does.
func engineError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": message})
}

// containerJob is a container job in the pool's pinned image.
func containerJob() Job {
	return Job{
		ID: jobID(7), Kind: conn.ExecutorContainer, Image: "registry.example.invalid/zephyr-sdk:0.17",
		Command: []string{"west", "build", "-b", "nrf52840dk", "$(id)"}, Workdir: "/workspace",
		Env: []string{"CI=true"}, Timeout: time.Minute, Limits: ShareOf(8, 16384, 2),
	}
}

// progressLog collects Progress reports.
type progressLog struct {
	mu      sync.Mutex
	reports []string
}

func (p *progressLog) report(pct int, note string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.reports = append(p.reports, fmt.Sprintf("%d %s", pct, note))
}

// TestContainerPullsAMissingImageAndReportsProgress is the acceptance criterion: a first
// pull is reported as it goes — not a stall — and pulls exactly the pinned tag.
func TestContainerPullsAMissingImageAndReportsProgress(t *testing.T) {
	t.Parallel()
	fake, engine := newFakeEngine(t)
	fake.script(func(f *fakeEngine) {
		f.pullLines = []string{
			`{"status":"Pulling from zephyr-sdk","id":"0.17"}`,
			`{"status":"Pulling fs layer","progressDetail":{},"id":"a1"}`,
			`{"status":"Downloading","progressDetail":{"current":1000000,"total":4000000},"id":"a1"}`,
			`{"status":"Pull complete","progressDetail":{},"id":"a1"}`,
			`{"status":"Digest: sha256:0123"}`,
			`{"status":"Status: Downloaded newer image for registry.example.invalid/zephyr-sdk:0.17"}`,
		}
	})
	progress := &progressLog{}
	container := &Container{Engine: engine}
	if err := container.Prepare(context.Background(), containerJob(), t.TempDir(), progress.report); err != nil {
		t.Fatalf("prepare: %v", err)
	}

	if pulls := fake.seen().pulls; len(pulls) != 1 || pulls[0].Get("fromImage") != "registry.example.invalid/zephyr-sdk" ||
		pulls[0].Get("tag") != "0.17" {
		t.Errorf("pulled %v", pulls)
	}
	reports := progress.reports
	if len(reports) < 2 || !strings.HasPrefix(reports[0], "0 pulling registry.example.invalid/zephyr-sdk:0.17") {
		t.Errorf("the pull was not reported from its start: %q", reports)
	}
	if last := reports[len(reports)-1]; last != "100 pulled registry.example.invalid/zephyr-sdk:0.17 — 4.0 MB" {
		t.Errorf("the pull's end was reported as %q", last)
	}
}

// TestContainerDoesNotPullAPresentImage asserts an image the daemon has is used as it is.
func TestContainerDoesNotPullAPresentImage(t *testing.T) {
	t.Parallel()
	fake, engine := newFakeEngine(t)
	fake.script(func(f *fakeEngine) { f.images["registry.example.invalid/zephyr-sdk:0.17"] = true })
	progress := &progressLog{}
	if err := (&Container{Engine: engine}).Prepare(context.Background(), containerJob(), t.TempDir(), progress.report); err != nil {
		t.Fatal(err)
	}
	if pulls := fake.seen().pulls; len(pulls) != 0 ||
		!slices.Equal(progress.reports, []string{"100 image registry.example.invalid/zephyr-sdk:0.17 is present"}) {
		t.Errorf("pulls %v, progress %q", pulls, progress.reports)
	}
}

// TestContainerPullFailuresAreImagePullFailed covers the two ways a pull fails — refused
// outright, and failing mid-stream as registries usually do — and a reference refused
// before it reaches the daemon at all.
func TestContainerPullFailuresAreImagePullFailed(t *testing.T) {
	t.Parallel()
	for name, script := range map[string]func(*fakeEngine){
		"refused": func(f *fakeEngine) { f.pullStatus = http.StatusNotFound },
		"failed in stream": func(f *fakeEngine) {
			f.pullLines = []string{`{"errorDetail":{"message":"manifest unknown"},"error":"manifest unknown"}`}
		},
	} {
		fake, engine := newFakeEngine(t)
		fake.script(script)
		err := (&Container{Engine: engine}).Prepare(context.Background(), containerJob(), t.TempDir(), func(int, string) {})
		var reason *Failure
		if !errors.As(err, &reason) || reason.Code != CodeImagePullFailed {
			t.Errorf("%s: %v", name, err)
		}
	}

	fake, engine := newFakeEngine(t)
	job := containerJob()
	job.Image = "../containers/create"
	err := (&Container{Engine: engine}).Prepare(context.Background(), job, t.TempDir(), func(int, string) {})
	var reason *Failure
	if !errors.As(err, &reason) || reason.Code != CodeImagePullFailed || len(fake.seen().pulls) != 0 {
		t.Errorf("an image that is not a reference: %v, pulls %v", err, fake.seen().pulls)
	}

	job = containerJob()
	job.Workdir = "relative"
	if err := (&Container{Engine: engine}).Prepare(context.Background(), job, t.TempDir(), func(int, string) {}); !errors.As(err, &reason) ||
		reason.Code != CodeWorkspaceInvalid {
		t.Errorf("a relative container workdir: %v", err)
	}
}

// TestContainerRunsTheJobAsSpecified asserts what the executor asks the daemon for — the
// argv as an exec-form CMD, the scrubbed environment, the workspace mounted at the workdir
// and nothing else, an init, the job's share of the machine — and what it gives back: the
// output demultiplexed onto its two streams, the exit code, and the container removed.
func TestContainerRunsTheJobAsSpecified(t *testing.T) {
	t.Parallel()
	fake, engine := newFakeEngine(t)
	fake.script(func(f *fakeEngine) { f.exitCode = 3 })
	workspace := t.TempDir()
	stdout, stderr := &buffer{}, &buffer{}
	code, err := (&Container{Engine: engine}).Execute(context.Background(), containerJob(), workspace,
		Output{Stdout: stdout, Stderr: stderr})
	if err != nil || code != 3 {
		t.Fatalf("code %d, err %v", code, err)
	}

	seen := fake.seen()
	spec := seen.created[0]
	job := containerJob()
	if spec.Image != job.Image || !slices.Equal(spec.Cmd, job.Command) || !slices.Equal(spec.Env, job.Env) ||
		spec.WorkingDir != "/workspace" || spec.Tty || spec.OpenStdin {
		t.Errorf("container spec: %+v", spec)
	}
	if !slices.Equal(spec.HostConfig.Binds, []string{workspace + ":/workspace"}) || !spec.HostConfig.Init ||
		spec.HostConfig.NanoCPUs != 4e9 || spec.HostConfig.Memory != 8192*1024*1024 {
		t.Errorf("host config: %+v", spec.HostConfig)
	}
	if spec.Labels[LabelJob] != jobID(7) {
		t.Errorf("labels: %v", spec.Labels)
	}
	if stdout.String() != "compiling kernel/sched.c\ndone\n" || stderr.String() != "warning: unused variable\n" {
		t.Errorf("stdout %q, stderr %q", stdout.String(), stderr.String())
	}
	if len(seen.removed) != 1 || seen.removed[0].Get("force") != "1" {
		t.Errorf("the container was not removed: %v", seen.removed)
	}
}

// TestContainerCancellationStopsIt is cancellation for a container job: the daemon's stop —
// the stop signal, then SIGKILL after the grace — and the container removed.
func TestContainerCancellationStopsIt(t *testing.T) {
	t.Parallel()
	fake, engine := newFakeEngine(t)
	fake.script(func(f *fakeEngine) { f.runUntilStopped = true })
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(100*time.Millisecond, cancel)

	code, err := (&Container{Engine: engine, Grace: 2 * time.Second}).Execute(ctx, containerJob(), t.TempDir(), Output{})
	if err != nil || code != 143 {
		t.Errorf("code %d, err %v", code, err)
	}
	if seen := fake.seen(); !slices.Equal(seen.stops, []string{"2"}) || len(seen.removed) != 1 {
		t.Errorf("stops %v, removed %v", seen.stops, seen.removed)
	}
}

// TestContainerCreateFailureIsAStartFailure asserts a container the daemon will not create
// is a job that never started.
func TestContainerCreateFailureIsAStartFailure(t *testing.T) {
	t.Parallel()
	fake, engine := newFakeEngine(t)
	fake.script(func(f *fakeEngine) { f.createStatus = http.StatusInternalServerError })
	_, err := (&Container{Engine: engine}).Execute(context.Background(), containerJob(), t.TempDir(), Output{})
	var reason *Failure
	if !errors.As(err, &reason) || reason.Code != CodeStartFailed || !strings.Contains(reason.Detail, "no space left") {
		t.Errorf("err %v", err)
	}
	if fake.seen().started {
		t.Error("a container that was not created was started")
	}
}

// TestDemultiplex splits the Engine API's multiplexed stream, and reports one that ends
// mid-frame.
func TestDemultiplex(t *testing.T) {
	stream := bytes.NewReader(append(append(frame(1, "a"), frame(2, "bb")...), frame(1, "")...))
	var stdout, stderr bytes.Buffer
	if err := demultiplex(stream, &stdout, &stderr); err != nil || stdout.String() != "a" || stderr.String() != "bb" {
		t.Errorf("err %v, stdout %q, stderr %q", err, stdout.String(), stderr.String())
	}
	truncated := frame(1, "hello")[:10]
	if err := demultiplex(bytes.NewReader(truncated), &stdout, &stderr); err == nil {
		t.Error("a stream ending mid-frame was read as complete")
	}
}

// TestEngineErrorsCarryTheDaemonsMessage asserts a refusal reads as the daemon's own words,
// and that stopping or removing a container already gone is not an error.
func TestEngineErrorsCarryTheDaemonsMessage(t *testing.T) {
	t.Parallel()
	_, engine := newFakeEngine(t)
	ctx := context.Background()
	err := engine.call(ctx, "do something", http.MethodPost, "/nowhere", nil, nil, nil)
	var refused *EngineError
	if !errors.As(err, &refused) || refused.Status != http.StatusNotFound || !strings.Contains(err.Error(), "page not found") {
		t.Errorf("err %v", err)
	}
	if !notFound(err) {
		t.Error("a 404 is not found")
	}
	if err := engine.Stop(ctx, "gone", time.Second); err != nil {
		t.Errorf("stopping a container already gone: %v", err)
	}
	if err := engine.Remove(ctx, "gone"); err != nil {
		t.Errorf("removing a container already gone: %v", err)
	}
	if present, err := engine.ImagePresent(ctx, "busybox"); present || err != nil {
		t.Errorf("an image the daemon lacks: %t, %v", present, err)
	}
	if message := errorMessage(strings.NewReader("plain text")); message != "plain text" {
		t.Errorf("a non-JSON error body: %q", message)
	}
	if message := errorMessage(strings.NewReader("")); message != "no message" {
		t.Errorf("an empty error body: %q", message)
	}
}
