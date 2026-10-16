package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/secret"
)

// The source credential hand-over ([#991], decision L9).
//
// An offer for a private repository carries `repository.credential`: not the git
// credential, but a single-use ticket for it. Just before the checkout the agent redeems the
// ticket — one POST to the path the offer named, on the control plane's own origin, over the
// same TLS the socket uses — and is answered once with the credential the checkout presents
// through GIT_ASKPASS. The credential lives in this process for the length of the fetch and
// nowhere else: not in the offer, not in a log, not in the tree, not in the job's environment.
//
// [#991]: https://github.com/NobuData/ouroboros/issues/991

// The pacing of a redemption's retries. A refusal is never retried; a 429, a 5xx or a
// network failure is, a few times, quickly — the job is waiting.
const (
	sourceAttempts   = 3
	sourceFirstDelay = 500 * time.Millisecond
	sourceMaxDelay   = 4 * time.Second
	sourceTimeout    = 30 * time.Second
)

// sourceRefusedCode is the control plane's one answer to a ticket it will not honour.
const sourceRefusedCode = "farm_source_credential_refused"

// sourceTicket is an offer's ticket, or nil for a repository cloned anonymously — or no
// repository at all.
func sourceTicket(repository *conn.JobRepository) *conn.JobSourceCredential {
	if repository == nil {
		return nil
	}
	return repository.Credential
}

// redeemSource obtains the job's source credential, when its offer carried a ticket.
//
// It returns the credential — nil for a job with no ticket — or the failure the job is to
// be reported under instead of running. Either way the job's log says what happened, on the
// `runner` stream, in words that hold no secret.
func (a *Agent) redeemSource(ctx context.Context, job exec.Job, ticket *conn.JobSourceCredential,
	runnerLog io.Writer) (*exec.SourceCredential, *exec.Failure) {
	if ticket == nil {
		return nil, nil
	}
	a.log.Info("redeeming a job's source credential", "job", job.ID)
	credential, err := a.redeem(ctx, ticket)
	if err != nil {
		var refused *sourceRefusedError
		detail := "the source credential could not be obtained: " + err.Error()
		if errors.As(err, &refused) {
			detail = "the control plane refused the source credential"
		}
		a.log.Warn("a job's source credential was not obtained; the job did not run", "job", job.ID, "error", err)
		runnerLine(runnerLog, "checkout failed — %s", detail)
		return nil, &exec.Failure{Code: exec.CodeCheckoutFailed, Detail: detail}
	}
	runnerLine(runnerLog, "source credential obtained for this checkout")
	return credential, nil
}

// neverRan is the result of a job that was accepted and could not be run at all: no
// workspace, no command, one failure. The clock is read twice so the finish is well-formed.
func (a *Agent) neverRan(reason *exec.Failure) exec.Result {
	at := a.config.Now()
	return exec.Result{Outcome: conn.OutcomeErrored, StartedAt: at, FinishedAt: at, Error: reason}
}

// sourceRefusedError is the control plane refusing a ticket for good.
type sourceRefusedError struct {
	status  int
	code    string
	message string
}

func (e *sourceRefusedError) Error() string {
	return fmt.Sprintf("the control plane refused the ticket: HTTP %d %s: %s", e.status, e.code, e.message)
}

// sourceAnswer is the control plane's answer to a redeemed ticket.
type sourceAnswer struct {
	Username  string        `json:"username"`
	Password  secret.Secret `json:"password"`
	ExpiresAt string        `json:"expires_at"`
}

// redeem is the call: the ticket as the bearer, the path on the origin the agent already
// dials, retried on transient failure and never on a refusal.
func (a *Agent) redeem(ctx context.Context, ticket *conn.JobSourceCredential) (*exec.SourceCredential, error) {
	target, err := a.originPath(ticket.Path, "source credential")
	if err != nil {
		return nil, err
	}
	client, err := a.httpClient()
	if err != nil {
		return nil, err
	}

	delay := sourceFirstDelay
	var last error
	for attempt := 1; attempt <= sourceAttempts; attempt++ {
		credential, err := a.redeemOnce(ctx, client, target, ticket.Token)
		if err == nil {
			return credential, nil
		}
		var refused *sourceRefusedError
		if errors.As(err, &refused) || ctx.Err() != nil {
			return nil, err
		}
		last = err
		if attempt < sourceAttempts {
			if err := sleep(ctx, delay); err != nil {
				return nil, err
			}
			delay = min(delay*2, sourceMaxDelay)
		}
	}
	return nil, fmt.Errorf("the redemption failed %d times; the last: %w", sourceAttempts, last)
}

// redeemOnce makes one attempt.
func (a *Agent) redeemOnce(ctx context.Context, client *http.Client, target string, token secret.Secret) (*exec.SourceCredential, error) {
	ctx, cancel := context.WithTimeout(ctx, sourceTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, http.NoBody)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token.Reveal())
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "ouroboros-runner/"+a.config.Version)

	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("the redemption request failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))

	switch {
	case response.StatusCode == http.StatusOK:
		var answer sourceAnswer
		if err := json.Unmarshal(body, &answer); err != nil || answer.Password.Empty() {
			return nil, errors.New("the control plane's answer carried no credential")
		}
		username := answer.Username
		if username == "" {
			username = "x-access-token"
		}
		return &exec.SourceCredential{Username: username, Password: answer.Password}, nil
	case response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500:
		return nil, fmt.Errorf("the control plane answered HTTP %d", response.StatusCode)
	default:
		var envelope struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(body, &envelope)
		if envelope.Code == "" {
			envelope.Code = sourceRefusedCode
		}
		return nil, &sourceRefusedError{status: response.StatusCode, code: envelope.Code, message: envelope.Message}
	}
}

// originPath resolves a path an offer named against the origin this agent dials — and only
// that origin, so no offer can aim a credential at another host.
func (a *Agent) originPath(path, what string) (string, error) {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return "", fmt.Errorf("the offer's %s path %q is not a path on the control plane", what, path)
	}
	target := a.config.Server.JoinPath(path)
	if target.Host != a.config.Server.Host || target.Scheme != a.config.Server.Scheme {
		return "", fmt.Errorf("the offer's %s path %q leaves the control plane", what, path)
	}
	return target.String(), nil
}

// httpClient is an HTTPS client for the control plane with the TLS this runner's socket
// uses — the gateway verified against the configured roots and, in mTLS mode, this runner's
// certificate presented, read fresh so a call after a renewal presents the new one.
func (a *Agent) httpClient() (*http.Client, error) {
	identity, err := a.config.Dir.LoadIdentity()
	if err != nil {
		return nil, fmt.Errorf("the runner's identity cannot be loaded: %w", err)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = a.tlsConfig(identity)
	return &http.Client{Transport: transport}, nil
}

// sleep waits, or returns early when ctx ends.
func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
