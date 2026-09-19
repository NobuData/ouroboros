package exec

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Engine is the part of the Docker Engine API the container executor needs, spoken over
// the daemon's unix socket: inspect and pull an image; create, start, follow, wait for,
// stop and remove a container.
//
// It is written rather than imported, for the reason internal/ws is (this module keeps no
// dependencies), and it talks to the SAME socket the `hello` probe pinged
// (telemetry.FindDocker) — so `capabilities.docker: true` and "the container executor can
// reach its daemon" are one fact, not two. Podman serves the same API on its own socket,
// which is why this is the Engine API and not the docker CLI: a machine with Podman and no
// `docker` binary still runs container jobs.
//
// The paths are unversioned, which both daemons answer with their current API.
type Engine struct {
	client *http.Client
}

// NewEngine is a client for the daemon listening on a unix socket.
func NewEngine(socket string) *Engine {
	return &Engine{client: &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socket)
		},
		// A unix socket, so no proxy whatever the environment says — the same rule the
		// capability probe follows.
		Proxy: nil,
	}}}
}

// EngineError is a daemon answering a request with an error: its status, and the message
// it gave.
type EngineError struct {
	Operation string
	Status    int
	Message   string
}

// Error is the daemon's answer, as one line.
func (e *EngineError) Error() string {
	return fmt.Sprintf("%s: the daemon answered %d: %s", e.Operation, e.Status, e.Message)
}

// notFound reports whether an error is the daemon saying the thing asked about does not
// exist.
func notFound(err error) bool {
	var refused *EngineError
	return errors.As(err, &refused) && refused.Status == http.StatusNotFound
}

// request makes one API call and returns the open response for a 2xx — or 304, which the
// Engine API uses for "already in that state" — and an *EngineError for anything else.
func (e *Engine) request(ctx context.Context, operation, method, path string, query url.Values, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("%s: encode the request: %w", operation, err)
		}
		reader = bytes.NewReader(encoded)
	}
	// The host is a placeholder the dialler ignores; HTTP requires one.
	target := url.URL{Scheme: "http", Host: "docker", Path: path, RawQuery: query.Encode()}
	request, err := http.NewRequestWithContext(ctx, method, target.String(), reader)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", operation, err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := e.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", operation, err)
	}
	if response.StatusCode/100 == 2 || response.StatusCode == http.StatusNotModified {
		return response, nil
	}
	defer func() { _ = response.Body.Close() }()
	return nil, &EngineError{Operation: operation, Status: response.StatusCode, Message: errorMessage(response.Body)}
}

// call makes an API call whose answer is only its status, or a JSON document read into
// into (when into is non-nil).
func (e *Engine) call(ctx context.Context, operation, method, path string, query url.Values, body, into any) error {
	response, err := e.request(ctx, operation, method, path, query, body)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if into == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(into); err != nil {
		return fmt.Errorf("%s: read the answer: %w", operation, err)
	}
	return nil
}

// errorMessage is the `message` of an Engine API error body, or the body itself.
func errorMessage(body io.Reader) string {
	raw, _ := io.ReadAll(io.LimitReader(body, 4096))
	var answer struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &answer) == nil && answer.Message != "" {
		return answer.Message
	}
	if text := strings.TrimSpace(string(raw)); text != "" {
		return text
	}
	return "no message"
}

// ImagePresent reports whether the daemon already has an image.
func (e *Engine) ImagePresent(ctx context.Context, image string) (bool, error) {
	err := e.call(ctx, "inspect image "+image, http.MethodGet, "/images/"+image+"/json", nil, nil, nil)
	switch {
	case err == nil:
		return true, nil
	case notFound(err):
		return false, nil
	default:
		return false, err
	}
}

// PullEvent is one line of the daemon's pull progress stream.
type PullEvent struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Progress struct {
		Current int64 `json:"current"`
		Total   int64 `json:"total"`
	} `json:"progressDetail"`
	Error       string `json:"error"`
	ErrorDetail struct {
		Message string `json:"message"`
	} `json:"errorDetail"`
}

// Pull pulls an image, calling report for every progress event the daemon streams. A pull
// the daemon reports failing — mid-stream, which is how it reports most of them — is an
// error.
func (e *Engine) Pull(ctx context.Context, image string, report func(PullEvent)) error {
	repository, tag := SplitReference(image)
	query := url.Values{"fromImage": {repository}, "tag": {tag}}
	response, err := e.request(ctx, "pull "+image, http.MethodPost, "/images/create", query, nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()

	decoder := json.NewDecoder(bufio.NewReader(response.Body))
	for {
		var event PullEvent
		if err := decoder.Decode(&event); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("pull %s: read the progress stream: %w", image, err)
		}
		if message := firstNonEmpty(event.ErrorDetail.Message, event.Error); message != "" {
			return &EngineError{Operation: "pull " + image, Status: http.StatusOK, Message: message}
		}
		report(event)
	}
}

// ContainerSpec is the container a job runs in — the Engine API's create body, reduced to
// what this executor sets.
type ContainerSpec struct {
	Image      string            `json:"Image"`
	Cmd        []string          `json:"Cmd"`
	Env        []string          `json:"Env"`
	WorkingDir string            `json:"WorkingDir"`
	Labels     map[string]string `json:"Labels"`
	Tty        bool              `json:"Tty"`
	OpenStdin  bool              `json:"OpenStdin"`
	HostConfig HostConfig        `json:"HostConfig"`
}

// HostConfig is the part of a container's host configuration this executor sets.
type HostConfig struct {
	Binds    []string `json:"Binds"`
	Init     bool     `json:"Init"`
	NanoCPUs int64    `json:"NanoCpus,omitempty"`
	Memory   int64    `json:"Memory,omitempty"`
}

// Create creates a container and returns its id.
func (e *Engine) Create(ctx context.Context, spec ContainerSpec) (string, error) {
	var created struct {
		ID string `json:"Id"`
	}
	if err := e.call(ctx, "create a container", http.MethodPost, "/containers/create", nil, spec, &created); err != nil {
		return "", err
	}
	if created.ID == "" {
		return "", errors.New("create a container: the daemon answered with no id")
	}
	return created.ID, nil
}

// Start starts a created container.
func (e *Engine) Start(ctx context.Context, id string) error {
	return e.call(ctx, "start the container", http.MethodPost, "/containers/"+id+"/start", nil, nil, nil)
}

// Logs follows a container's output until the container stops (or ctx ends), writing
// stdout and stderr to their own writers.
//
// A container without a TTY answers with the Engine API's multiplexed stream: each frame an
// 8-byte header — the stream (1 stdout, 2 stderr), three zero bytes, and the payload's
// length big-endian — then the payload. Following from the start, rather than attaching,
// means nothing the command printed before the follow began is lost.
func (e *Engine) Logs(ctx context.Context, id string, stdout, stderr io.Writer) error {
	query := url.Values{"follow": {"1"}, "stdout": {"1"}, "stderr": {"1"}}
	response, err := e.request(ctx, "follow the container's output", http.MethodGet, "/containers/"+id+"/logs", query, nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return demultiplex(bufio.NewReader(response.Body), stdout, stderr)
}

// demultiplex splits the Engine API's multiplexed stream into its two writers. It returns
// nil at a clean end of stream.
func demultiplex(stream io.Reader, stdout, stderr io.Writer) error {
	var header [8]byte
	for {
		if _, err := io.ReadFull(stream, header[:]); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("read the output stream: %w", err)
		}
		size := int64(binary.BigEndian.Uint32(header[4:]))
		destination := stdout
		if header[0] == 2 {
			destination = stderr
		}
		if _, err := io.CopyN(destination, stream, size); err != nil {
			return fmt.Errorf("read the output stream: %w", err)
		}
	}
}

// Wait blocks until a container is no longer running and returns its exit status.
func (e *Engine) Wait(ctx context.Context, id string) (int, error) {
	var answer struct {
		StatusCode int `json:"StatusCode"`
		Error      *struct {
			Message string `json:"Message"`
		} `json:"Error"`
	}
	if err := e.call(ctx, "wait for the container", http.MethodPost, "/containers/"+id+"/wait", nil, nil, &answer); err != nil {
		return 0, err
	}
	if answer.Error != nil && answer.Error.Message != "" {
		return 0, fmt.Errorf("wait for the container: %s", answer.Error.Message)
	}
	return answer.StatusCode, nil
}

// Stop stops a container the way `docker stop` does: its stop signal (SIGTERM unless the
// image says otherwise), and SIGKILL after grace. A container that is already stopped is
// not an error.
func (e *Engine) Stop(ctx context.Context, id string, grace time.Duration) error {
	seconds := strconv.Itoa(int(max(grace.Round(time.Second), time.Second) / time.Second))
	err := e.call(ctx, "stop the container", http.MethodPost, "/containers/"+id+"/stop", url.Values{"t": {seconds}}, nil, nil)
	if notFound(err) {
		return nil
	}
	return err
}

// Remove removes a container, killing it first if it is somehow still running, along with
// its anonymous volumes. A container already gone is not an error.
func (e *Engine) Remove(ctx context.Context, id string) error {
	err := e.call(ctx, "remove the container", http.MethodDelete, "/containers/"+id, url.Values{"force": {"1"}, "v": {"1"}}, nil, nil)
	if notFound(err) {
		return nil
	}
	return err
}

// firstNonEmpty is the first of its arguments that is not empty.
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
