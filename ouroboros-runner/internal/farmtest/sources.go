package farmtest

import (
	"net/http"
	"time"
)

// SourceRedemption is one source-credential ticket the farm was asked to redeem ([#991]):
// `POST /api/v1/farm/jobs/<id>/source-credential`, with the ticket as the bearer.
//
// [#991]: https://github.com/NobuData/ouroboros/issues/991
type SourceRedemption struct {
	// Job is the path's job id.
	Job string
	// Authorization is the request's header, as sent.
	Authorization string
}

// SourceAnswer is how the farm answers the next redemptions.
type SourceAnswer int

const (
	// GrantSource answers 200 with the credential SetSourceCredential installed.
	GrantSource SourceAnswer = iota
	// FailSource answers 503, which an agent retries.
	FailSource
	// RefuseSource answers 401 farm_source_credential_refused, which it does not.
	RefuseSource
)

// SetSourceCredential is the git credential the farm hands over on a granted redemption.
func (f *Farm) SetSourceCredential(username, password string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sourceUsername, f.sourcePassword = username, password
}

// AnswerSources queues how the next redemptions are answered, in order; once the queue is
// empty every redemption is granted.
func (f *Farm) AnswerSources(answers ...SourceAnswer) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sourceAnswers = append(f.sourceAnswers, answers...)
}

// sourceCredential records a redemption and answers it.
func (f *Farm) sourceCredential(w http.ResponseWriter, r *http.Request) {
	redemption := SourceRedemption{Job: r.PathValue("id"), Authorization: r.Header.Get("Authorization")}

	f.mu.Lock()
	f.observed.Sources = append(f.observed.Sources, redemption)
	answer := GrantSource
	if len(f.sourceAnswers) > 0 {
		answer, f.sourceAnswers = f.sourceAnswers[0], f.sourceAnswers[1:]
	}
	username, password := f.sourceUsername, f.sourcePassword
	f.notifyLocked()
	f.mu.Unlock()

	switch answer {
	case FailSource:
		writeError(w, http.StatusServiceUnavailable, "internal_error", "the vault is unavailable")
	case RefuseSource:
		writeError(w, http.StatusUnauthorized, "farm_source_credential_refused",
			"This source credential ticket is not valid for this job.")
	default:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		writeBody(w, map[string]any{"username": username, "password": password,
			"expires_at": timestamp(time.Now().Add(10 * time.Minute))})
	}
}
