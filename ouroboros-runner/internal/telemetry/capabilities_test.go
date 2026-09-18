package telemetry

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// shortDir is a temporary directory with a path short enough for a unix socket, whose
// name is capped at about a hundred bytes.
func shortDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "ds")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

// fakeDaemon serves an HTTP handler on a unix socket, as the Docker Engine does, and
// returns the socket's path.
func fakeDaemon(t *testing.T, handler http.HandlerFunc) string {
	t.Helper()
	socket := filepath.Join(shortDir(t), "docker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: time.Second}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	return socket
}

// TestDockerReachableAsksTheDaemon is the answered-not-assumed rule: a daemon that pings
// is present, and nothing else is.
func TestDockerReachableAsksTheDaemon(t *testing.T) {
	answering := fakeDaemon(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_ping" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("OK"))
	})
	failing := fakeDaemon(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "daemon is starting", http.StatusServiceUnavailable)
	})
	impostor := fakeDaemon(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("hello from something else"))
	})
	notASocket := filepath.Join(shortDir(t), "docker.sock")
	if err := os.WriteFile(notASocket, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	if !DockerReachable(ctx, []string{answering}) {
		t.Error("a daemon answering its ping was reported absent")
	}
	for name, socket := range map[string]string{
		"a daemon answering 503":        failing,
		"a server that is not a daemon": impostor,
		"a file that is not a socket":   notASocket,
		"a socket that does not exist":  filepath.Join(shortDir(t), "missing.sock"),
	} {
		if DockerReachable(ctx, []string{socket}) {
			t.Errorf("%s was reported as a reachable daemon", name)
		}
	}
	if !DockerReachable(ctx, []string{failing, notASocket, answering}) {
		t.Error("expected the sockets to be tried in turn until one answers")
	}
}

// TestAHungDaemonDoesNotHoldTheAgent asserts a socket that accepts and never answers is
// "no", within the caller's deadline.
func TestAHungDaemonDoesNotHoldTheAgent(t *testing.T) {
	release := make(chan struct{})
	hung := fakeDaemon(t, func(http.ResponseWriter, *http.Request) { <-release })
	defer close(release)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	started := time.Now()
	if DockerReachable(ctx, []string{hung}) {
		t.Error("a hung daemon was reported reachable")
	}
	if elapsed := time.Since(started); elapsed > probeTimeout+time.Second {
		t.Errorf("the probe took %v", elapsed)
	}
}

// TestDockerSocketsHonoursDockerHost asserts the operator's own DOCKER_HOST is tried
// first, and that the per-user sockets are included.
func TestDockerSocketsHonoursDockerHost(t *testing.T) {
	t.Setenv("DOCKER_HOST", "unix:///srv/custom/docker.sock")
	t.Setenv("XDG_RUNTIME_DIR", "/run/user/1000")

	sockets := DockerSockets()
	if sockets[0] != "/srv/custom/docker.sock" {
		t.Errorf("expected DOCKER_HOST first, got %v", sockets)
	}
	want := map[string]bool{
		"/var/run/docker.sock":              false,
		"/run/podman/podman.sock":           false,
		"/run/user/1000/podman/podman.sock": false,
	}
	for _, socket := range sockets {
		if _, ok := want[socket]; ok {
			want[socket] = true
		}
	}
	for socket, found := range want {
		if !found {
			t.Errorf("expected %s among %v", socket, sockets)
		}
	}

	// A TCP DOCKER_HOST is not a socket to stat, and is not added.
	t.Setenv("DOCKER_HOST", "tcp://127.0.0.1:2375")
	if DockerSockets()[0] == "tcp://127.0.0.1:2375" {
		t.Error("a TCP DOCKER_HOST was treated as a socket path")
	}
}

// TestCcacheOnPathLooksAtPath asserts the answer comes from PATH, as an operator's shell
// would find it.
func TestCcacheOnPathLooksAtPath(t *testing.T) {
	bin := t.TempDir()
	t.Setenv("PATH", bin)
	if CcacheOnPath() {
		t.Fatal("found a ccache on an empty PATH")
	}
	if err := os.WriteFile(filepath.Join(bin, "ccache"), []byte("#!/bin/sh\n"), 0o700); err != nil { // #nosec G306 -- an executable fixture
		t.Fatal(err)
	}
	if !CcacheOnPath() {
		t.Error("expected the ccache on PATH to be found")
	}
}
