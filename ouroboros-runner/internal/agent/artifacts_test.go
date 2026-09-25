package agent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/artifacts"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
)

// A job's artifact upload (#330), against the in-process farm: a job whose offer carries an
// upload leaves its results by HTTPS before its finish is reported, never on the socket; a
// retry survives a transient failure; a refusal and a replay are reported without failing
// the job; and a job with no upload, or one that was cancelled, uploads nothing.

// uploadToken is the offer's single-use token in these tests — its shape; nothing honours it.
var uploadToken = "ouro_upl_" + strings.Repeat("Yk3vQm9Z", 5)

// withUpload adds an upload to an offer.
func withUpload() func(map[string]any) {
	return func(p map[string]any) {
		p["upload"] = map[string]any{
			"path":           farmtest.ArtifactsPathPrefix + "0199a1f2-6b3c-7d4e-8f50-61a2b3c4d5e6/artifacts",
			"token":          uploadToken,
			"expires_at":     conn.Timestamp(time.Now().Add(time.Hour)),
			"globs":          []string{"**/junit*.xml", "captures/*.csv"},
			"max_file_bytes": 1024,
			"max_job_bytes":  1 << 20,
			"max_files":      16,
		}
	}
}

// producing is a shell executor whose job leaves a JUnit report and an oversize capture in its
// working directory.
func producing() *fakeExecutor {
	return &fakeExecutor{kind: conn.ExecutorShell, produce: func(workspace string) error {
		root := filepath.Join(workspace, "workspace")
		for name, contents := range map[string]string{
			"build/junit-build3.xml":         `<testsuites><testsuite name="unit"/></testsuites>`,
			"captures/rig-capture-estop.csv": strings.Repeat("t,v\n", 600),
			"notes.md":                       "not collected",
		} {
			path := filepath.Join(root, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
				return err
			}
			if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
				return err
			}
		}
		return nil
	}}
}

// shellHarness starts an agent with the producing shell executor.
func shellHarness(t *testing.T, farm *farmtest.Farm, executor *fakeExecutor) *harness {
	t.Helper()
	dir := enrolled(t, farm, false)
	h := start(t, farm, dir, func(c *Config) {
		c.Capabilities.Shell = true
		c.Executors[conn.ExecutorShell] = executor
		c.UploadAttempts = 3
		c.UploadRetryDelay = time.Millisecond
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	return h
}

// shellOffer is a shell job run in `/workspace` under its workspace, with an upload.
func shellOffer() func(map[string]any) {
	return func(p map[string]any) {
		withUpload()(p)
		p["command"] = []string{"west", "twister"}
	}
}

// TestAJobUploadsItsArtifactsBeforeItsFinish is the path end to end: the globs' files, capped
// and checksummed, go to the offer's path with its token — and the finish comes after.
func TestAJobUploadsItsArtifactsBeforeItsFinish(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := shellHarness(t, farm, producing())

	offerJob(t, farm, 1, conn.ExecutorShell, shellOffer())
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if len(observed.Uploads) != 1 {
		t.Fatalf("uploads: %d", len(observed.Uploads))
	}
	upload := observed.Uploads[0]
	if upload.FinishesBefore != 0 {
		t.Error("the finish was reported before the manifest was closed")
	}
	if upload.Authorization != "Bearer "+uploadToken || !strings.HasPrefix(upload.ContentType, "multipart/form-data") {
		t.Errorf("sent with %q, %q", upload.Authorization, upload.ContentType)
	}
	if strings.Join(upload.Order, ",") != "build/junit-build3.xml,captures/rig-capture-estop.csv" {
		t.Fatalf("files %v", upload.Order)
	}
	if len(upload.Files["captures/rig-capture-estop.csv"]) != 1024 {
		t.Errorf("the capture was not cut to the per-file cap: %d", len(upload.Files["captures/rig-capture-estop.csv"]))
	}
	var manifest artifacts.Manifest
	if err := json.Unmarshal(upload.Manifest, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Files[1].Truncated == nil || manifest.Files[1].Truncated.OriginalBytes != 2400 {
		t.Errorf("manifest %+v", manifest.Files[1])
	}

	var uploading bool
	for _, progress := range observed.Progress {
		uploading = uploading || (progress.Phase == conn.PhaseUpload && progress.Job == job(1))
	}
	if !uploading {
		t.Error("no job.progress in the upload phase")
	}
	if finish := finishes(t, observed)[0]; finish.Outcome != conn.OutcomeSucceeded {
		t.Errorf("finish %+v", finish)
	}
	h.logged("uploaded a job's artifacts")
	h.logged("code=artifact_truncated")
	if strings.Contains(h.logs.String(), uploadToken) {
		t.Error("the upload token reached the agent's log")
	}
	var runnerLine bool
	for _, chunk := range observed.Chunks {
		runnerLine = runnerLine || chunk.Stream == conn.StreamRunner
	}
	if !runnerLine {
		t.Error("the job's log carries no runner line about its artifacts")
	}
}

// TestAFailedBuildStillUploadsItsResults: the failing test report is the one that matters most.
func TestAFailedBuildStillUploadsItsResults(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	executor := producing()
	executor.execute = func(context.Context, exec.Job) (int, error) { return 2, nil }
	h := shellHarness(t, farm, executor)

	offerJob(t, farm, 1, conn.ExecutorShell, shellOffer())
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if len(observed.Uploads) != 1 || finishes(t, observed)[0].Outcome != conn.OutcomeFailed {
		t.Fatalf("uploads %d, finish %+v", len(observed.Uploads), finishes(t, observed))
	}
}

// TestAnUploadIsRetriedThroughATransientFailure: a 503 is retried and the retry lands, before
// the finish.
func TestAnUploadIsRetriedThroughATransientFailure(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.AnswerUploads(farmtest.FailUpload, farmtest.FailUpload)
	h := shellHarness(t, farm, producing())

	offerJob(t, farm, 1, conn.ExecutorShell, shellOffer())
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if len(observed.Uploads) != 3 || observed.Uploads[2].FinishesBefore != 0 {
		t.Fatalf("uploads %d", len(observed.Uploads))
	}
	if string(observed.Uploads[0].Manifest) != string(observed.Uploads[2].Manifest) {
		t.Error("the retry sent a different manifest")
	}
	h.logged("uploaded a job's artifacts")
}

// TestARefusedUploadIsReportedAndTheJobStillFinishes: the build's result is not held hostage by
// its artifacts — the refusal is logged, once, and the finish follows.
func TestARefusedUploadIsReportedAndTheJobStillFinishes(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.AnswerUploads(farmtest.RefuseUpload)
	h := shellHarness(t, farm, producing())

	offerJob(t, farm, 1, conn.ExecutorShell, shellOffer())
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if len(observed.Uploads) != 1 || finishes(t, observed)[0].Outcome != conn.OutcomeSucceeded {
		t.Fatalf("uploads %d, finish %+v", len(observed.Uploads), finishes(t, observed))
	}
	h.logged("farm_artifact_upload_refused")
}

// TestAReplayRefusalIsTakenAsAlreadyRecorded: an attempt whose response was lost landed, and the
// retry's replay refusal says so.
func TestAReplayRefusalIsTakenAsAlreadyRecorded(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.AnswerUploads(farmtest.ClosedUpload)
	h := shellHarness(t, farm, producing())

	offerJob(t, farm, 1, conn.ExecutorShell, shellOffer())
	h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	h.logged("the control plane already holds this job's artifacts")
}

// TestAJobWithNoUploadUploadsNothing: an offer without `upload` — a build no run is attributed
// to — sends nothing anywhere.
func TestAJobWithNoUploadUploadsNothing(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := shellHarness(t, farm, producing())

	offerJob(t, farm, 1, conn.ExecutorShell, func(p map[string]any) { p["command"] = []string{"make"} })
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if len(observed.Uploads) != 0 {
		t.Fatalf("uploads %d", len(observed.Uploads))
	}
}

// TestACancelledJobUploadsNothing: the gateway took the job back; its results are nobody's.
func TestACancelledJobUploadsNothing(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	executor := producing()
	executor.execute = blockUntilCancelled
	h := shellHarness(t, farm, executor)

	offerJob(t, farm, 1, conn.ExecutorShell, shellOffer())
	h.until("the start", func(o farmtest.Observed) bool { return len(o.Starts) == 1 })
	if err := farm.Send(conn.NewFrame(conn.NewID(), conn.TypeJobCancel, conn.JobCancelPayload{
		Job: job(1), Reason: conn.CancelOperator, Detail: "stopped from the console",
	})); err != nil {
		t.Fatal(err)
	}
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if len(observed.Uploads) != 0 || finishes(t, observed)[0].Outcome != conn.OutcomeCancelled {
		t.Fatalf("uploads %d, finish %+v", len(observed.Uploads), finishes(t, observed))
	}
}
