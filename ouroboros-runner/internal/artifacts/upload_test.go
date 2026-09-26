package artifacts

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// received is one request a fake control plane took.
type received struct {
	path, authorization string
	manifest            Manifest
	files               map[string]string
	order               []string
}

// controlPlane is an upload endpoint that records what it is sent and answers with the next
// scripted status.
type controlPlane struct {
	mu       sync.Mutex
	requests []received
	answers  []int
}

func (c *controlPlane) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	request := received{path: r.URL.Path, authorization: r.Header.Get("Authorization"), files: map[string]string{}}
	reader, err := r.MultipartReader()
	if err == nil {
		for {
			part, err := reader.NextPart()
			if err != nil {
				break
			}
			body, _ := io.ReadAll(part)
			if part.FormName() == "manifest" {
				_ = json.Unmarshal(body, &request.manifest)
			} else {
				name := rawFilename(part.Header.Get("Content-Disposition"))
				request.files[name] = string(body)
				request.order = append(request.order, name)
			}
		}
	}

	c.mu.Lock()
	c.requests = append(c.requests, request)
	status := http.StatusCreated
	if len(c.answers) > 0 {
		status, c.answers = c.answers[0], c.answers[1:]
	}
	c.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	switch status {
	case http.StatusCreated:
		_, _ = w.Write([]byte(`{"testRun":"t-1","files":[],"warnings":[{"code":"artifact_quota_exceeded",` +
			`"file":"b.log","message":"b.log was not kept: the workspace's artifact quota is full."}]}`))
	case http.StatusConflict:
		_, _ = w.Write([]byte(`{"code":"farm_artifact_upload_closed","message":"single use","details":{}}`))
	default:
		_, _ = w.Write([]byte(`{"code":"farm_artifact_upload_refused","message":"not valid","details":{}}`))
	}
}

// rawFilename is a part's filename as sent, directories kept — Part.FileName strips them, and
// the control plane keeps them.
func rawFilename(disposition string) string {
	_, params, err := mime.ParseMediaType(disposition)
	if err != nil {
		return ""
	}
	return params["filename"]
}

// fixture is a collected workspace and an uploader aimed at a fake control plane.
func fixture(t *testing.T, answers ...int) (*controlPlane, *Uploader, Collection) {
	t.Helper()
	plane := &controlPlane{answers: answers}
	server := httptest.NewServer(plane)
	t.Cleanup(server.Close)
	base, _ := url.Parse(server.URL)

	root := t.TempDir()
	write(t, root, "build/junit.xml", "<testsuites/>")
	write(t, root, "rig.csv", strings.Repeat("r", 100))
	collection, err := Collect(root, []string{"**/junit*.xml", "*.csv"}, Limits{MaxFileBytes: 40})
	if err != nil {
		t.Fatal(err)
	}
	collection.Skipped = append(collection.Skipped, Skip{Name: "big.log", SizeBytes: 9, Reason: SkipJobCap,
		Detail: "the job cap"})

	uploader := &Uploader{Client: server.Client(), Server: base, UserAgent: "ouroboros-runner/test",
		Attempts: 3, Sleep: func(context.Context, time.Duration) error { return nil }}
	return plane, uploader, collection
}

// fixtureToken is an upload token's shape; nothing honours it.
var fixtureToken = "ouro_upl_" + strings.Repeat("Yk3vQm9Z", 5)

// spec is an offer's upload.
func spec() conn.JobUpload {
	return conn.JobUpload{Path: "/api/v1/farm/jobs/0199a1f2-6b3c-7d4e-8f50-61a2b3c4d5e6/artifacts",
		Token: fixtureToken, Globs: []string{"**"},
		MaxFileBytes: 40, MaxJobBytes: 1000, MaxFiles: 10}
}

// TestUploadSendsTheManifestThenEveryFile: the manifest lists each sent file with its checksum,
// a truncation and a skip; the parts carry exactly the declared bytes; the token rides the
// Authorization header to the offer's path on the control plane's own origin.
func TestUploadSendsTheManifestThenEveryFile(t *testing.T) {
	t.Parallel()
	plane, uploader, collection := fixture(t)

	outcome, err := uploader.Upload(context.Background(), spec(), collection)
	if err != nil {
		t.Fatal(err)
	}

	if outcome.Attempts != 1 || outcome.Receipt == nil || len(outcome.Receipt.Warnings) != 1 ||
		outcome.Receipt.Warnings[0].Code != "artifact_quota_exceeded" {
		t.Fatalf("outcome %+v", outcome)
	}
	request := plane.requests[0]
	if request.path != spec().Path || request.authorization != "Bearer "+spec().Token {
		t.Fatalf("sent to %q with %q", request.path, request.authorization)
	}
	manifest := request.manifest
	if manifest.SchemaVersion != 1 || len(manifest.Files) != 2 || len(manifest.Skipped) != 1 {
		t.Fatalf("manifest %+v", manifest)
	}
	junit, rig := manifest.Files[0], manifest.Files[1]
	if junit.Name != "build/junit.xml" || junit.SizeBytes != 13 || junit.Checksum != sum("<testsuites/>") ||
		junit.Truncated != nil {
		t.Errorf("junit entry %+v", junit)
	}
	if rig.SizeBytes != 40 || rig.Truncated == nil || rig.Truncated.OriginalBytes != 100 {
		t.Errorf("rig entry %+v", rig)
	}
	if request.files["build/junit.xml"] != "<testsuites/>" || request.files["rig.csv"] != strings.Repeat("r", 40) {
		t.Errorf("files %v", request.files)
	}
	if strings.Join(request.order, ",") != "build/junit.xml,rig.csv" {
		t.Errorf("order %v", request.order)
	}
}

// TestUploadRetriesATransientFailureAndSendsTheSameManifest: a 503 is retried, with the same
// collection — the checksums are not recomputed and nothing is lost.
func TestUploadRetriesATransientFailureAndSendsTheSameManifest(t *testing.T) {
	t.Parallel()
	plane, uploader, collection := fixture(t, http.StatusServiceUnavailable, http.StatusTooManyRequests)

	outcome, err := uploader.Upload(context.Background(), spec(), collection)
	if err != nil {
		t.Fatal(err)
	}

	if outcome.Attempts != 3 || len(plane.requests) != 3 {
		t.Fatalf("attempts %d, requests %d", outcome.Attempts, len(plane.requests))
	}
	first, _ := json.Marshal(plane.requests[0].manifest)
	last, _ := json.Marshal(plane.requests[2].manifest)
	if string(first) != string(last) {
		t.Errorf("the retry sent a different manifest:\n%s\n%s", first, last)
	}
}

// TestUploadGivesUpAfterItsAttempts: a control plane that keeps failing is reported, not retried
// for ever.
func TestUploadGivesUpAfterItsAttempts(t *testing.T) {
	t.Parallel()
	_, uploader, collection := fixture(t, 503, 503, 503)

	outcome, err := uploader.Upload(context.Background(), spec(), collection)
	if err == nil || outcome.Attempts != 3 || !strings.Contains(err.Error(), "failed 3 times") {
		t.Fatalf("outcome %+v, err %v", outcome, err)
	}
}

// TestUploadDoesNotRetryARefusal: a 401 would be refused the same way again.
func TestUploadDoesNotRetryARefusal(t *testing.T) {
	t.Parallel()
	plane, uploader, collection := fixture(t, http.StatusUnauthorized)

	_, err := uploader.Upload(context.Background(), spec(), collection)

	var refused *RefusedError
	if !errors.As(err, &refused) || refused.Code != "farm_artifact_upload_refused" || len(plane.requests) != 1 {
		t.Fatalf("err %v, requests %d", err, len(plane.requests))
	}
	if strings.Contains(err.Error(), spec().Token) {
		t.Error("the refusal carries the token")
	}
}

// TestUploadTakesAReplayRefusalAsAlreadyRecorded: after a lost response, the retry is refused as
// a replay — which means the first attempt landed.
func TestUploadTakesAReplayRefusalAsAlreadyRecorded(t *testing.T) {
	t.Parallel()
	_, uploader, collection := fixture(t, http.StatusConflict)

	outcome, err := uploader.Upload(context.Background(), spec(), collection)
	if err != nil || !outcome.AlreadyClosed || outcome.Receipt != nil {
		t.Fatalf("outcome %+v, err %v", outcome, err)
	}
}

// TestUploadNeverLeavesTheControlPlane: the offer names a path, and a path that would reach
// another host is refused before anything is sent.
func TestUploadNeverLeavesTheControlPlane(t *testing.T) {
	t.Parallel()
	plane, uploader, collection := fixture(t)

	for _, path := range []string{"//collector.example.invalid/steal", "https://collector.example.invalid/x", "relative"} {
		bad := spec()
		bad.Path = path
		if _, err := uploader.Upload(context.Background(), bad, collection); err == nil {
			t.Errorf("uploaded to %q", path)
		}
	}
	if len(plane.requests) != 0 {
		t.Fatalf("%d requests were sent", len(plane.requests))
	}
}

// TestUploadStopsWhenTheAgentDoes: a cancelled context ends the retries.
func TestUploadStopsWhenTheAgentDoes(t *testing.T) {
	t.Parallel()
	_, uploader, collection := fixture(t, 503, 503, 503)
	ctx, cancel := context.WithCancel(context.Background())
	uploader.Sleep = func(ctx context.Context, _ time.Duration) error {
		cancel()
		return ctx.Err()
	}

	outcome, err := uploader.Upload(ctx, spec(), collection)
	if !errors.Is(err, context.Canceled) || outcome.Attempts != 1 {
		t.Fatalf("outcome %+v, err %v", outcome, err)
	}
}

// TestUploadFailsAFileThatShrankAfterItWasCollected: the part would not match its checksum, so
// the attempt fails rather than sending fewer bytes than declared.
func TestUploadFailsAFileThatShrankAfterItWasCollected(t *testing.T) {
	t.Parallel()
	_, uploader, collection := fixture(t)
	uploader.Attempts = 1
	if err := os.Truncate(collection.Files[0].Path, 2); err != nil {
		t.Fatal(err)
	}

	if _, err := uploader.Upload(context.Background(), spec(), collection); err == nil {
		t.Fatal("a shrunken file was uploaded")
	}
}
