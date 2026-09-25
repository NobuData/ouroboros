package farmtest

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
)

// ArtifactsPathPrefix is where a job's artifact upload answers ([#330]):
// `/api/v1/farm/jobs/<id>/artifacts`. Restated rather than imported, like the paths above.
//
// [#330]: https://github.com/NobuData/ouroboros/issues/330
const ArtifactsPathPrefix = "/api/v1/farm/jobs/"

// Upload is one artifact upload the farm received.
type Upload struct {
	// Job is the path's job id.
	Job string
	// Authorization is the request's header, as sent.
	Authorization string
	// ContentType is the request's Content-Type.
	ContentType string
	// Manifest is the manifest field, as sent.
	Manifest json.RawMessage
	// Files is every file part, by its filename, in the order they arrived.
	Files map[string][]byte
	// Order is the file parts' filenames, in the order they arrived.
	Order []string
	// FinishesBefore is how many job.finish frames the gateway had received when the upload
	// arrived — zero is the agent reporting a job's end only after its manifest is closed.
	FinishesBefore int
}

// UploadAnswer is how the farm answers the next uploads.
type UploadAnswer int

const (
	// AcceptUpload answers 201 with a receipt listing every file stored.
	AcceptUpload UploadAnswer = iota
	// FailUpload answers 503, which an agent retries.
	FailUpload
	// RefuseUpload answers 401 farm_artifact_upload_refused, which it does not.
	RefuseUpload
	// ClosedUpload answers 409 farm_artifact_upload_closed — an earlier attempt landed.
	ClosedUpload
)

// AnswerUploads queues how the next uploads are answered, in order; once the queue is empty
// every upload is accepted.
func (f *Farm) AnswerUploads(answers ...UploadAnswer) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.uploadAnswers = append(f.uploadAnswers, answers...)
}

// artifacts records an upload and answers it.
func (f *Farm) artifacts(w http.ResponseWriter, r *http.Request) {
	upload := Upload{
		Job:           r.PathValue("id"),
		Authorization: r.Header.Get("Authorization"),
		ContentType:   r.Header.Get("Content-Type"),
		Files:         map[string][]byte{},
	}
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "farm_artifact_manifest_invalid", err.Error())
		return
	}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, "farm_artifact_manifest_invalid", err.Error())
			return
		}
		body, err := io.ReadAll(part)
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, "farm_artifact_manifest_invalid", err.Error())
			return
		}
		switch part.FormName() {
		case "manifest":
			upload.Manifest = body
		case "file":
			// Part.FileName strips directories; the control plane keeps them, so read the raw
			// parameter.
			_, params, _ := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
			upload.Files[params["filename"]] = body
			upload.Order = append(upload.Order, params["filename"])
		}
	}

	f.mu.Lock()
	upload.FinishesBefore = len(f.observed.Finishes)
	f.observed.Uploads = append(f.observed.Uploads, upload)
	answer := AcceptUpload
	if len(f.uploadAnswers) > 0 {
		answer, f.uploadAnswers = f.uploadAnswers[0], f.uploadAnswers[1:]
	}
	f.notifyLocked()
	f.mu.Unlock()

	switch answer {
	case FailUpload:
		writeError(w, http.StatusServiceUnavailable, "internal_error", "the store is unavailable")
	case RefuseUpload:
		writeError(w, http.StatusUnauthorized, "farm_artifact_upload_refused",
			"This upload token is not valid for this job.")
	case ClosedUpload:
		writeError(w, http.StatusConflict, "farm_artifact_upload_closed",
			"This job's artifacts were already uploaded; an upload token is single use.")
	default:
		files := make([]map[string]string, 0, len(upload.Order))
		for _, name := range upload.Order {
			files = append(files, map[string]string{"name": name, "status": "stored"})
		}
		warnings := []map[string]string{}
		if strings.Contains(string(upload.Manifest), `"truncated"`) {
			warnings = append(warnings, map[string]string{"code": "artifact_truncated", "file": "?",
				"message": "a file was cut short"})
		}
		writeJSON(w, map[string]any{"testRun": newUUID(), "files": files, "warnings": warnings})
	}
}
