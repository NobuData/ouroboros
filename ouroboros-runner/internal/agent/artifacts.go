package agent

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/artifacts"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
)

// uploadArtifacts gets a finished job's results off this machine ([#330]) — called by the
// executor's runner after the command ends and before the workspace is removed, so the job's
// finish is not reported until its manifest is closed.
//
// Its transfer is a job-scoped HTTPS request to the control plane, never the control socket;
// what the socket carries is a `job.progress` in the `upload` phase and the heartbeat's phase,
// so a long upload does not read as a stall. What happened is written to the job's own log on
// the `runner` stream and to the agent's log — the counts and the warnings, never the token.
//
// A job that was cancelled or never ran uploads nothing: the gateway took it back, or there
// was no command to produce anything.
//
// [#330]: https://github.com/NobuData/ouroboros/issues/330
func (a *Agent) uploadArtifacts(ctx context.Context, spec *conn.JobUpload, job exec.Job, workspace string,
	result exec.Result, runnerLog io.Writer) {
	if spec == nil {
		return
	}
	if result.Outcome == conn.OutcomeCancelled || result.Outcome == conn.OutcomeErrored {
		a.log.Info("a job that did not run to an end uploads no artifacts", "job", job.ID, "outcome", result.Outcome)
		return
	}

	root := workspace
	if job.Kind == conn.ExecutorShell {
		resolved, err := exec.ResolveWorkdir(workspace, job.Workdir)
		if err != nil {
			a.log.Warn("the job's working directory could not be resolved; no artifacts were uploaded",
				"job", job.ID, "error", err)
			return
		}
		root = resolved
	}

	collection, err := artifacts.Collect(root, spec.Globs, artifacts.Limits{
		MaxFileBytes: spec.MaxFileBytes, MaxJobBytes: spec.MaxJobBytes, MaxFiles: spec.MaxFiles,
	})
	if err != nil {
		a.log.Warn("the job's artifacts could not be collected", "job", job.ID, "error", err)
		runnerLine(runnerLog, "artifacts: none were collected: %v", err)
		return
	}

	_ = a.workload.Progress(job.ID, conn.PhaseUpload, 0)
	a.notify(conn.NewFrame(conn.NewID(), conn.TypeJobProgress, conn.JobProgressPayload{
		Job: job.ID, Phase: conn.PhaseUpload, Pct: 0,
		Note: truncateNote(fmt.Sprintf("uploading %d artifacts", len(collection.Files))),
	}))
	a.log.Info("uploading a job's artifacts", "job", job.ID, "files", len(collection.Files),
		"bytes", collection.Bytes(), "skipped", len(collection.Skipped))

	uploader, err := a.uploader()
	if err != nil {
		a.log.Warn("the job's artifacts could not be uploaded", "job", job.ID, "error", err)
		runnerLine(runnerLog, "artifacts: not uploaded: %v", err)
		return
	}
	outcome, err := uploader.Upload(ctx, *spec, collection)
	_ = a.workload.Progress(job.ID, conn.PhaseUpload, 100)

	switch {
	case err != nil:
		a.log.Warn("the job's artifacts were not uploaded", "job", job.ID, "attempts", outcome.Attempts,
			"error", err)
		runnerLine(runnerLog, "artifacts: not uploaded after %d attempt(s): %v", outcome.Attempts, err)
	case outcome.AlreadyClosed:
		a.log.Info("the control plane already holds this job's artifacts: an earlier attempt landed",
			"job", job.ID, "attempts", outcome.Attempts)
		runnerLine(runnerLog, "artifacts: already recorded by an earlier attempt")
	default:
		a.reportUpload(job.ID, collection, outcome, runnerLog)
	}
}

// reportUpload logs an accepted upload: what was kept and every warning, which the page shows too.
func (a *Agent) reportUpload(jobID string, collection artifacts.Collection, outcome artifacts.Outcome, runnerLog io.Writer) {
	receipt := outcome.Receipt
	a.log.Info("uploaded a job's artifacts", "job", jobID, "files", len(collection.Files),
		"bytes", collection.Bytes(), "warnings", len(receipt.Warnings), "attempts", outcome.Attempts)
	runnerLine(runnerLog, "artifacts: uploaded %d file(s), %d byte(s); %d warning(s)", len(collection.Files),
		collection.Bytes(), len(receipt.Warnings))
	for _, warning := range receipt.Warnings {
		a.log.Warn("an artifact upload warning", "job", jobID, "code", warning.Code, "file", warning.File)
		runnerLine(runnerLog, "artifacts: %s: %s", warning.Code, warning.Message)
	}
}

// uploader is an HTTPS client for the control plane, with the TLS this runner's socket uses:
// the gateway verified against the configured roots and, in mTLS mode, this runner's
// certificate presented — read fresh, so an upload after a renewal presents the new one.
func (a *Agent) uploader() (*artifacts.Uploader, error) {
	identity, err := a.config.Dir.LoadIdentity()
	if err != nil {
		return nil, fmt.Errorf("the runner's identity cannot be loaded: %w", err)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = a.tlsConfig(identity)
	return &artifacts.Uploader{
		Client:     &http.Client{Transport: transport},
		Server:     a.config.Server,
		UserAgent:  "ouroboros-runner/" + a.config.Version,
		Attempts:   a.config.UploadAttempts,
		FirstDelay: a.config.UploadRetryDelay,
	}, nil
}

// runnerLine writes one line of the agent's own to a job's log.
func runnerLine(w io.Writer, format string, args ...any) {
	if w == nil {
		return
	}
	_, _ = fmt.Fprintf(w, "ouroboros-runner: "+format+"\n", args...)
}

// noteMax is the protocol's bound on `job.progress.note`.
const noteMax = 256

// truncateNote bounds a progress note to the protocol's length, on a rune boundary.
func truncateNote(note string) string {
	runes := []rune(strings.TrimSpace(note))
	if len(runes) <= noteMax {
		return string(runes)
	}
	return string(runes[:noteMax-1]) + "…"
}
