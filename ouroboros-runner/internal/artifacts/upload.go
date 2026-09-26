package artifacts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// ManifestSchemaVersion is the manifest version this agent writes.
const ManifestSchemaVersion = 1

// The two multipart field names the control plane reads.
const (
	manifestField = "manifest"
	fileField     = "file"
)

// Retry defaults: a transient failure — the network, a 5xx, a 429 — is retried this many times
// in all, the wait doubling from the first delay up to the ceiling.
const (
	DefaultAttempts   = 5
	DefaultFirstDelay = 2 * time.Second
	DefaultMaxDelay   = 30 * time.Second
	// DefaultAttemptTimeout bounds one attempt: 256 MiB over a slow lab uplink is minutes, and a
	// request that has said nothing for longer than this is not going to.
	DefaultAttemptTimeout = 15 * time.Minute
)

// quoteEscaper escapes a filename for a quoted Content-Disposition parameter, as mime/multipart's
// own CreateFormFile does: a backslash and a double quote, and nothing else — a name is UTF-8
// and is sent as UTF-8.
var quoteEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`)

// closedCode is the refusal a replay of an accepted upload's token earns — for this agent, the
// news that an earlier attempt whose response was lost did land.
const closedCode = "farm_artifact_upload_closed"

// Manifest is the first part of every upload: every file sent, and every file matched and not
// sent, with the reason.
type Manifest struct {
	SchemaVersion int             `json:"schema_version"`
	Files         []ManifestEntry `json:"files"`
	Skipped       []Skip          `json:"skipped"`
}

// ManifestEntry is one sent file: its name, the bytes sent, and their checksum.
type ManifestEntry struct {
	Name      string      `json:"name"`
	SizeBytes int64       `json:"size_bytes"`
	Checksum  string      `json:"checksum"`
	Truncated *Truncation `json:"truncated,omitempty"`
}

// ManifestOf is the manifest for a collection.
func ManifestOf(collection Collection) Manifest {
	manifest := Manifest{SchemaVersion: ManifestSchemaVersion, Files: []ManifestEntry{},
		Skipped: append([]Skip{}, collection.Skipped...)}
	for _, file := range collection.Files {
		manifest.Files = append(manifest.Files, ManifestEntry{Name: file.Name, SizeBytes: file.Size,
			Checksum: file.Checksum, Truncated: file.Truncated})
	}
	return manifest
}

// Receipt is what an accepted upload answers with — the parts this agent reports.
type Receipt struct {
	// TestRun is the attempt the results were parsed into.
	TestRun string `json:"testRun"`
	// Files is every collected file, stored, truncated or skipped.
	Files []struct {
		Name   string `json:"name"`
		Status string `json:"status"`
		Reason string `json:"reason,omitempty"`
	} `json:"files"`
	// Warnings are the job warnings the page renders — a quota breach among them.
	Warnings []struct {
		Code    string `json:"code"`
		File    string `json:"file"`
		Message string `json:"message"`
	} `json:"warnings"`
}

// Outcome is how an upload ended.
type Outcome struct {
	// Receipt is the control plane's receipt; nil when AlreadyClosed.
	Receipt *Receipt
	// AlreadyClosed is an attempt refused as a replay: an earlier attempt, whose response never
	// arrived, was accepted.
	AlreadyClosed bool
	// Attempts is how many requests it took.
	Attempts int
}

// RefusedError is the control plane refusing an upload for good — a token that is not valid, a
// manifest it will not take, a file past a cap. Retrying it would be refused the same way.
type RefusedError struct {
	Status  int
	Code    string
	Message string
}

func (e *RefusedError) Error() string {
	return fmt.Sprintf("the control plane refused the upload: HTTP %d %s: %s", e.Status, e.Code, e.Message)
}

// Uploader sends collections to the control plane.
type Uploader struct {
	// Client makes the requests. Its transport carries the agent's TLS configuration.
	Client *http.Client
	// Server is the control plane's base URL — the one the agent dials.
	Server *url.URL
	// UserAgent names this build.
	UserAgent string
	// Attempts, FirstDelay and MaxDelay pace retries. Zero means the defaults.
	Attempts             int
	FirstDelay, MaxDelay time.Duration
	// AttemptTimeout bounds one request, upload and answer. Zero means DefaultAttemptTimeout.
	AttemptTimeout time.Duration
	// Sleep waits between attempts. Nil waits on a timer, or until ctx ends.
	Sleep func(ctx context.Context, d time.Duration) error
}

// Upload sends a collection to the path an offer named, retrying transient failures.
//
// Each attempt sends the whole collection: the control plane keeps nothing from an attempt it
// did not accept, so there is never half an upload to continue from. What carries across
// attempts is the collection itself — the files, their caps and their checksums, computed once
// — so every retry sends the manifest the first one did.
func (u *Uploader) Upload(ctx context.Context, spec conn.JobUpload, collection Collection) (Outcome, error) {
	target, err := u.target(spec.Path)
	if err != nil {
		return Outcome{}, err
	}
	manifest, err := json.Marshal(ManifestOf(collection))
	if err != nil {
		return Outcome{}, fmt.Errorf("the manifest could not be written: %w", err)
	}

	attempts := u.Attempts
	if attempts <= 0 {
		attempts = DefaultAttempts
	}
	delay := u.FirstDelay
	if delay <= 0 {
		delay = DefaultFirstDelay
	}
	ceiling := u.MaxDelay
	if ceiling <= 0 {
		ceiling = DefaultMaxDelay
	}

	var last error
	for attempt := 1; attempt <= attempts; attempt++ {
		outcome, err := u.send(ctx, target, spec.Token, manifest, collection)
		outcome.Attempts = attempt
		if err == nil {
			return outcome, nil
		}
		var refused *RefusedError
		if errors.As(err, &refused) || ctx.Err() != nil {
			return outcome, err
		}
		last = err
		if attempt < attempts {
			if err := u.sleep(ctx, delay); err != nil {
				return Outcome{Attempts: attempt}, err
			}
			delay = min(delay*2, ceiling)
		}
	}
	return Outcome{Attempts: attempts}, fmt.Errorf("the upload failed %d times; the last: %w", attempts, last)
}

// target is the upload URL: the offer's path, on the control plane's own origin.
func (u *Uploader) target(path string) (string, error) {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return "", fmt.Errorf("the offer's upload path %q is not a path on the control plane", path)
	}
	target := u.Server.JoinPath(path)
	if target.Host != u.Server.Host || target.Scheme != u.Server.Scheme {
		return "", fmt.Errorf("the offer's upload path %q leaves the control plane", path)
	}
	return target.String(), nil
}

// send makes one attempt: the manifest, then each file, streamed as one multipart body.
func (u *Uploader) send(ctx context.Context, target, token string, manifest []byte, collection Collection) (Outcome, error) {
	timeout := u.AttemptTimeout
	if timeout <= 0 {
		timeout = DefaultAttemptTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	body, writer := io.Pipe()
	form := multipart.NewWriter(writer)
	go func() {
		_ = writer.CloseWithError(writeForm(form, manifest, collection))
	}()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, body)
	if err != nil {
		_ = body.Close()
		return Outcome{}, err
	}
	request.Header.Set("Content-Type", form.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("User-Agent", u.UserAgent)

	response, err := u.Client.Do(request)
	if err != nil {
		_ = body.Close()
		return Outcome{}, fmt.Errorf("the upload request failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	answer, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))

	switch {
	case response.StatusCode == http.StatusCreated:
		var receipt Receipt
		if err := json.Unmarshal(answer, &receipt); err != nil {
			return Outcome{}, fmt.Errorf("the control plane's receipt could not be read: %w", err)
		}
		return Outcome{Receipt: &receipt}, nil
	case response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500:
		return Outcome{}, fmt.Errorf("the control plane answered HTTP %d", response.StatusCode)
	default:
		refused := refusalOf(response.StatusCode, answer)
		if refused.Code == closedCode {
			return Outcome{AlreadyClosed: true}, nil
		}
		return Outcome{}, refused
	}
}

// writeForm writes the manifest field and every file part, each file exactly the bytes its
// manifest entry declared.
func writeForm(form *multipart.Writer, manifest []byte, collection Collection) error {
	field, err := form.CreateFormField(manifestField)
	if err != nil {
		return err
	}
	if _, err := field.Write(manifest); err != nil {
		return err
	}
	for _, file := range collection.Files {
		if err := writeFile(form, file); err != nil {
			return err
		}
	}
	return form.Close()
}

// writeFile writes one file part: the first Size bytes of the file, and an error if there are
// fewer — a file that shrank since it was collected would fail its checksum anyway.
func writeFile(form *multipart.Writer, file File) error {
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fileField,
		quoteEscaper.Replace(file.Name)))
	header.Set("Content-Type", "application/octet-stream")
	part, err := form.CreatePart(header)
	if err != nil {
		return err
	}
	source, err := os.Open(file.Path) // #nosec G304 -- a file Collect found under the collection root
	if err != nil {
		return err
	}
	defer func() { _ = source.Close() }()
	copied, err := io.Copy(part, io.LimitReader(source, file.Size))
	if err != nil {
		return err
	}
	if copied != file.Size {
		return fmt.Errorf("%s shrank from %d to %d bytes after it was collected", file.Name, file.Size, copied)
	}
	return nil
}

// refusalOf is a refusal, read from the control plane's error envelope when there is one.
func refusalOf(status int, body []byte) *RefusedError {
	var envelope struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(body, &envelope)
	if envelope.Code == "" {
		envelope.Code = "unknown"
	}
	return &RefusedError{Status: status, Code: envelope.Code, Message: envelope.Message}
}

// sleep waits between attempts, or until ctx ends.
func (u *Uploader) sleep(ctx context.Context, d time.Duration) error {
	if u.Sleep != nil {
		return u.Sleep(ctx, d)
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
