package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/enroll"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/ws"
)

// Some failures clear by themselves and some never will, and the difference is the
// difference between a loop that recovers and a loop that costs both ends forever.
//
// A dropped socket, a gateway being deployed, a 503 — those clear, and the agent
// reconnects with backoff. A revoked certificate, a protocol line the gateway no longer
// speaks, a runner the control plane has never heard of — those do not, and reconnecting
// into them fixes nothing. The agent logs WHY, in a sentence an operator can act on, and
// exits non-zero so the service manager records it (docs/RUNNER_PROTOCOL.md § 4.1,
// `refuse`).

// FatalError is a failure the agent must not reconnect into. Run returns one; the
// command exits non-zero with it.
type FatalError struct {
	// Reason is the sentence for the operator: what happened and what to do about it.
	Reason string
	// Err is the underlying cause, when there is one.
	Err error
}

func (e *FatalError) Error() string {
	if e.Err == nil {
		return e.Reason
	}
	return fmt.Sprintf("%s (%v)", e.Reason, e.Err)
}

func (e *FatalError) Unwrap() error { return e.Err }

// certificateAlerts are the TLS alerts a server sends about the CLIENT's certificate, in
// crypto/tls's spelling. Any of them on this connection means the gateway looked at this
// runner's identity and said no.
var certificateAlerts = []string{
	"bad certificate",
	"revoked certificate",
	"expired certificate",
	"unknown certificate authority",
	"unknown certificate",
	"unsupported certificate",
	"certificate required",
	"access denied",
}

// certificateAlert reports whether an error is the peer refusing this end's certificate
// with a TLS alert, and which alert.
func certificateAlert(err error) (string, bool) {
	var remote *net.OpError
	if !errors.As(err, &remote) || remote.Op != "remote error" || remote.Err == nil {
		return "", false
	}
	text := strings.TrimPrefix(remote.Err.Error(), "tls: ")
	for _, alert := range certificateAlerts {
		if text == alert {
			return alert, true
		}
	}
	return "", false
}

// errorCode reads the control plane's `{code, message, details}` envelope out of a
// refused upgrade's body, if it carries one.
func errorCode(body []byte) string {
	var envelope struct {
		Code string `json:"code"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return ""
	}
	return envelope.Code
}

// revokedReason is what the agent says when its identity is dead, however the gateway
// said so. One sentence, because the control plane deliberately does not say which of
// revoked, superseded, expired or unknown it was — that is in its audit trail — and the
// operator's next step is the same for all four.
const revokedReason = "the control plane refused this runner's certificate: it has been revoked, " +
	"superseded or has expired, or was not issued by this farm. It will not be retried — " +
	"enroll this machine again with a new token"

// classifyDial decides what a failed connection attempt means: fatal, or worth another
// try. It returns nil for "try again".
func classifyDial(err error, mode conn.SecurityMode) *FatalError {
	if alert, refused := certificateAlert(err); refused {
		if mode == conn.SecurityBearerFallback && alert == "certificate required" {
			return &FatalError{
				Reason: "the gateway requires a client certificate and this runner has none (bearer-fallback mode). " +
					"Enroll this machine again without --bearer-fallback",
				Err: err,
			}
		}
		return &FatalError{Reason: revokedReason + " (TLS alert: " + alert + ")", Err: err}
	}

	var refused *ws.HandshakeError
	if !errors.As(err, &refused) {
		return nil
	}
	// Only the control plane's own identity codes are final. A 401 or 403 without one —
	// a session guard in front of a mis-routed gateway, a proxy's own refusal — says
	// nothing about this runner's identity, and calling it a revocation would stop an
	// agent that is fine; it is logged with its status and code, and retried.
	switch code := errorCode(refused.Body); {
	case mode == conn.SecurityBearerFallback && (code == enroll.CodeIdentityRefused || code == enroll.CodeClientCertificateRequired):
		return &FatalError{
			Reason: "the control plane refused this runner's bearer secret: the runner was removed, or its workspace " +
				"no longer permits the fallback. It will not be retried — enroll this machine again",
			Err: err,
		}
	case code == enroll.CodeIdentityRefused:
		return &FatalError{Reason: revokedReason, Err: err}
	case code == enroll.CodeClientCertificateRequired:
		return &FatalError{
			Reason: "the gateway received no client certificate. A reverse proxy in front of it is terminating TLS " +
				"without passing the certificate through (docs/SECURITY_MODEL.md § 7.6); fix the proxy, or — only if it " +
				"cannot be fixed — enroll with --bearer-fallback",
			Err: err,
		}
	default:
		return nil
	}
}

// refusalReason is the log sentence for a protocol `refuse`, by code.
func refusalReason(refusal conn.RefusePayload) string {
	switch refusal.Code {
	case conn.RefuseVersionBelowMinimum, conn.RefuseVersionUnsupported:
		minimum := "a newer protocol line"
		if refusal.Minimum != nil {
			minimum = fmt.Sprintf("protocol %d or newer", *refusal.Minimum)
		}
		return fmt.Sprintf("the gateway refused this agent's protocol (%s): it requires %s, and this build "+
			"speaks %d–%d. Upgrade the agent. Gateway said: %s",
			refusal.Code, minimum, conn.MinVersion, conn.Version, refusal.Detail)
	case conn.RefuseIdentityRevoked:
		return "the control plane has revoked this runner's certificate (identity.revoked). It will not be " +
			"retried — enroll this machine again with a new token. Gateway said: " + refusal.Detail
	case conn.RefuseIdentityUnknown:
		return "the control plane does not know this runner (identity.unknown). Enroll this machine again. " +
			"Gateway said: " + refusal.Detail
	default:
		return fmt.Sprintf("the gateway refused the connection (%s): %s", refusal.Code, refusal.Detail)
	}
}
