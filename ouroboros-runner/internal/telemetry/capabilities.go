package telemetry

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// The capabilities a `hello` reports are ANSWERED, not assumed (docs/RUNNER_PROTOCOL.md
// § 4.1): "is docker present?" is the enrollment card's own question, and a pool that
// offered container jobs to a machine without a daemon would dispatch work that cannot
// start. So the answer is a question put to the daemon, not a file's existence.

// probeTimeout bounds one daemon probe. A socket that accepts and never answers is a
// daemon that is not reachable, and must not hold up a connection.
const probeTimeout = 2 * time.Second

// DockerSockets is where a Docker-compatible daemon listens by default, in the order
// they are tried: the Docker Engine socket, rootful and rootless Podman, and Docker
// Desktop's per-user socket on macOS. `DOCKER_HOST`, when it names a unix socket, is
// tried before all of them — it is the operator saying which daemon they mean.
func DockerSockets() []string {
	sockets := []string{"/var/run/docker.sock", "/run/podman/podman.sock"}
	if runtimeDir := os.Getenv("XDG_RUNTIME_DIR"); runtimeDir != "" {
		sockets = append(sockets,
			filepath.Join(runtimeDir, "docker.sock"),
			filepath.Join(runtimeDir, "podman", "podman.sock"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		sockets = append(sockets, filepath.Join(home, ".docker", "run", "docker.sock"))
	}
	if host := os.Getenv("DOCKER_HOST"); strings.HasPrefix(host, "unix://") {
		sockets = append([]string{strings.TrimPrefix(host, "unix://")}, sockets...)
	}
	return sockets
}

// DockerReachable reports whether any of the given sockets answers the Docker Engine
// API's ping — `GET /_ping` → `200 OK` — which Docker and Podman's compatible API both
// serve.
//
// A socket file that exists with nothing listening, or something listening that is not
// a daemon, is "no". So is a daemon this user may not talk to: a socket the agent's user
// cannot open is a daemon that cannot run this agent's jobs.
func DockerReachable(ctx context.Context, sockets []string) bool {
	for _, socket := range sockets {
		if pingDocker(ctx, socket) {
			return true
		}
	}
	return false
}

// pingDocker asks one socket for the Engine API's ping.
func pingDocker(ctx context.Context, socket string) bool {
	if _, err := os.Stat(socket); err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	client := &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socket)
		},
		// The one HTTP client in this agent that talks to a local socket: no proxy,
		// whatever the environment says, because a proxy cannot reach a unix socket.
		Proxy: nil,
	}}
	defer client.CloseIdleConnections()

	// The host is a placeholder the dialler ignores; the Engine API requires one.
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, (&url.URL{Scheme: "http", Host: "docker", Path: "/_ping"}).String(), nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 64))
	return response.StatusCode == http.StatusOK && strings.TrimSpace(string(body)) == "OK"
}

// CcacheOnPath reports whether a `ccache` binary is on PATH — which is what makes the
// cache statistics in `job.finish` possible ([#247]).
//
// [#247]: https://github.com/NobuData/ouroboros/issues/247
func CcacheOnPath() bool {
	_, err := exec.LookPath("ccache")
	return err == nil
}
