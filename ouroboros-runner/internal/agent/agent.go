// Package agent is the connection loop: the long-lived process that holds this runner's
// one connection to the farm, and keeps holding it.
//
//	Connecting ──wss:// 443 + mTLS──▶ hello ──▶ ack ──▶ Connected
//	    ▲                                               │ heartbeat · offer ⇄ decline · receipt
//	    │                                               │ drain · undrain · bye
//	Backoff ◀── dropped / refused-for-now ──────────────┘
//	    │
//	    └── refused for good (revoked · version floor) ──▶ exit non-zero, with the reason
//
// Three promises are kept here, and each is tested rather than asserted:
//
//   - OUTBOUND ONLY. The agent dials; it never listens. There is no port, no health
//     endpoint, no metrics scrape — nothing for anything to connect to.
//     cmd/ouroboros-runner's tests run the built command and read the kernel's socket
//     table to prove it.
//   - RECONNECTION IS NORMAL. A drop is followed by a reconnect with exponential backoff
//     and full jitter (backoff.go), and the reconnect resumes: `hello.resume` names the
//     last session, and every terminal frame not yet receipted is re-sent, byte for byte,
//     from the durable outbox before anything else — so a `job.finish` interrupted by the
//     drop is delivered once, and the gateway deduplicates the copy.
//   - A CLEAN GOODBYE. Cancelling Run — a SIGTERM — sends `bye` before the socket closes,
//     so the farm page shows the runner offline deliberately rather than after a missed
//     heartbeat.
//
// The certificate is renewed here too, before it expires, over the channel it already
// authenticates (renewal is internal/enroll's HTTPS call; this decides when).
package agent

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/enroll"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
)

// GatewayPath is the agent endpoint, under the control plane's base URL. The gateway
// (AH.3, #251) serves it; docs/RUNNER_PROTOCOL.md § 1 is where it is written down.
const GatewayPath = "api/v1/farm/agent"

// Defaults for the loop's own timings. None of them is a protocol value — those arrive
// in `ack.limits` — they are how patient the agent is with a gateway that is not
// answering.
const (
	// DefaultHandshakeTimeout bounds connect, TLS, upgrade, and the wait for ack.
	DefaultHandshakeTimeout = 30 * time.Second
	// DefaultStableAfter is how long a session must last for the next drop to start
	// the backoff again from the bottom. A gateway that accepts and then drops at once
	// is failing, and should not be hammered at the first rung.
	DefaultStableAfter = 30 * time.Second
	// DefaultCloseGrace bounds the wait for the gateway's answering close frame after
	// this end says bye.
	DefaultCloseGrace = 2 * time.Second
	// DefaultRenewalRetryBase and DefaultRenewalRetryMax pace a renewal that failed for
	// a reason that may clear — a control plane being deployed, a network blip.
	DefaultRenewalRetryBase = time.Minute
	DefaultRenewalRetryMax  = time.Hour
	// maxRenewalSpread bounds the jitter added to a renewal's due time, so a rack
	// enrolled in one afternoon does not renew in one second ninety days later.
	maxRenewalSpread = time.Hour
)

// Renewer replaces a certificate. *enroll.Client is one.
type Renewer interface {
	Renew(ctx context.Context, identity state.Identity) (enroll.Renewal, error)
}

// Config is everything the loop needs. The state directory must already be open — and
// therefore locked — by the caller.
type Config struct {
	// Dir is the state directory: the identity, the session to resume, the outbox.
	Dir *state.Dir
	// Server is the control plane's base URL, https://.
	Server *url.URL
	// RootCAs verifies the gateway's certificate. Nil means the system's roots.
	RootCAs *x509.CertPool
	// Version is this agent's build, as `hello.agent.version` reports it.
	Version string
	// Arch and Hostname are the machine, as the protocol names them.
	Arch, Hostname string
	// Capabilities is `hello.capabilities` — answered by probes, not assumed.
	Capabilities conn.Capabilities
	// BearerFallback is the explicit flag that permits a bearer-fallback identity to
	// connect at all. Without it, a runner enrolled in fallback mode refuses to start:
	// the downgrade has to be stated every time the agent is started, in the unit file
	// an operator reads, rather than remembered once in a state directory.
	BearerFallback bool
	// Renewer replaces the certificate before it expires. Nil disables renewal.
	Renewer Renewer
	// Logger receives the agent's log. Nil means slog's default.
	Logger *slog.Logger

	// Backoff paces reconnection. Its zero value is the defaults.
	Backoff Backoff
	// RenewalBackoff paces a failed renewal. Its zero value is the renewal defaults.
	RenewalBackoff Backoff
	// HandshakeTimeout, StableAfter and CloseGrace override the defaults above.
	HandshakeTimeout time.Duration
	StableAfter      time.Duration
	CloseGrace       time.Duration
	// Now is the clock. Nil means time.Now.
	Now func() time.Time
}

// Agent is a runner, connecting.
type Agent struct {
	config  Config
	log     *slog.Logger
	outbox  *state.Outbox
	started time.Time

	// queued wakes the live session when a terminal frame is added, so it is written
	// now rather than at the next reconnect. Buffered by one: a wake-up that finds one
	// already pending is redundant.
	queued chan struct{}

	// draining is set by the gateway's `drain` and cleared by `undrain`. It outlives a
	// connection: a drained agent that reconnects is still drained until told otherwise.
	draining drainState
}

// New prepares an agent. It opens the outbox — logging, not failing, over any frame a
// previous process left that cannot be vouched for — and checks the identity once, so a
// state directory that cannot possibly connect is refused before the loop starts.
func New(config Config) (*Agent, error) {
	if config.Dir == nil || config.Server == nil {
		return nil, errors.New("the agent needs a state directory and a server")
	}
	if config.Logger == nil {
		config.Logger = slog.Default()
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	if config.HandshakeTimeout <= 0 {
		config.HandshakeTimeout = DefaultHandshakeTimeout
	}
	if config.StableAfter <= 0 {
		config.StableAfter = DefaultStableAfter
	}
	if config.CloseGrace <= 0 {
		config.CloseGrace = DefaultCloseGrace
	}
	if config.RenewalBackoff.Base <= 0 {
		config.RenewalBackoff.Base = DefaultRenewalRetryBase
	}
	if config.RenewalBackoff.Max <= 0 {
		config.RenewalBackoff.Max = DefaultRenewalRetryMax
	}

	identity, err := config.Dir.LoadIdentity()
	if err != nil {
		return nil, err
	}
	if identity.Record.SecurityMode == conn.SecurityBearerFallback && !config.BearerFallback {
		return nil, &FatalError{Reason: "this runner was enrolled in bearer-fallback mode, which is weaker than a " +
			"client certificate; it starts only with --bearer-fallback, so the downgrade is stated wherever the " +
			"agent is started"}
	}

	outbox, problems, err := config.Dir.Outbox()
	if err != nil {
		return nil, err
	}
	for _, problem := range problems {
		config.Logger.Error("an outbox frame could not be vouched for and will not be sent", "problem", problem)
	}

	return &Agent{
		config:  config,
		log:     config.Logger,
		outbox:  outbox,
		started: config.Now(),
		queued:  make(chan struct{}, 1),
	}, nil
}

// SendTerminal queues a terminal frame for delivery: persisted to the outbox first, then
// written to the live connection if there is one, and re-sent after every reconnect
// until the gateway's receipt arrives. It is how an executor ([#246]) reports a job.
//
// [#246]: https://github.com/NobuData/ouroboros/issues/246
func (a *Agent) SendTerminal(frame conn.Frame) error {
	if !frame.Type.Terminal() {
		return fmt.Errorf("a %s frame is not terminal", frame.Type)
	}
	encoded, err := conn.Encode(frame)
	if err != nil {
		return err
	}
	if _, diags := conn.Decode(encoded); len(diags) > 0 {
		return fmt.Errorf("refusing to queue an illegal %s frame: %s at %q", frame.Type, diags[0].Code, diags[0].Path)
	}
	if err := a.outbox.Add(frame.ID, encoded); err != nil {
		return err
	}
	select {
	case a.queued <- struct{}{}:
	default:
	}
	return nil
}

// Run holds the connection until the context ends or the agent is refused for good.
//
// It returns nil after a clean shutdown — the context was cancelled, and `bye` was sent
// if there was a connection to send it on. The context's cause, when there is one, is
// the bye's detail: `SIGTERM received`. It returns a [*FatalError] when the agent must
// not reconnect: the command logs it and exits non-zero.
func (a *Agent) Run(ctx context.Context) error {
	identity, err := a.config.Dir.LoadIdentity()
	if err != nil {
		return &FatalError{Reason: "the runner's identity cannot be loaded", Err: err}
	}
	if fatal := a.checkExpiry(identity); fatal != nil {
		return fatal
	}
	a.log.Info("starting", "identity", identity, "server", a.config.Server.String(),
		"pending_terminal_frames", a.outbox.Len())

	// A fatal renewal failure has to stop the connection loop, and say why.
	loop, stop := context.WithCancelCause(ctx)
	defer stop(nil)
	renewalDone := make(chan struct{})
	if identity.Record.SecurityMode == conn.SecurityMTLS && a.config.Renewer != nil {
		go func() {
			defer close(renewalDone)
			if fatal := a.renewLoop(loop); fatal != nil {
				stop(fatal)
			}
		}()
	} else {
		close(renewalDone)
	}

	fatal := a.connectLoop(loop)
	stop(nil)
	<-renewalDone

	var renewalFatal *FatalError
	if errors.As(context.Cause(loop), &renewalFatal) {
		return renewalFatal
	}
	if fatal != nil {
		return fatal
	}
	a.log.Info("stopped", "cause", context.Cause(ctx))
	return nil
}

// connectLoop connects, holds the session, and reconnects, until the context ends or a
// connection is refused for good.
func (a *Agent) connectLoop(ctx context.Context) *FatalError {
	backoff := a.config.Backoff
	for {
		result := a.connect(ctx)
		if result.fatal != nil {
			a.log.Error(result.fatal.Reason, "error", result.fatal.Err)
			return result.fatal
		}
		if stopped(ctx) {
			return nil
		}
		if result.stable {
			backoff.Reset()
		}

		delay := backoff.Next()
		if result.retryAfter != nil {
			delay = backoff.After(*result.retryAfter)
		}
		message := "could not connect; retrying"
		if result.connected {
			message = "disconnected; reconnecting"
		}
		a.log.Warn(message, "reason", result.reason, "in", delay.Round(time.Millisecond))

		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

// checkExpiry refuses a certificate that has already expired. Renewal needs a LIVE
// certificate to authenticate it, so an expired one is not a problem the agent can
// solve — and connecting with it would fail with a TLS alert that says nothing about
// time.
func (a *Agent) checkExpiry(identity state.Identity) *FatalError {
	if identity.Leaf == nil || a.config.Now().Before(identity.Leaf.NotAfter) {
		return nil
	}
	return &FatalError{Reason: fmt.Sprintf("this runner's certificate expired at %s, and an expired certificate "+
		"cannot be renewed. Enroll this machine again with a new token",
		identity.Leaf.NotAfter.UTC().Format(time.RFC3339))}
}

// tlsConfig is one connection's TLS: the gateway verified against the configured roots,
// and — in mTLS mode — this runner's certificate presented.
func (a *Agent) tlsConfig(identity state.Identity) *tls.Config {
	config := &tls.Config{RootCAs: a.config.RootCAs, MinVersion: tls.VersionTLS12}
	if identity.Record.SecurityMode == conn.SecurityMTLS {
		config.Certificates = []tls.Certificate{identity.Certificate}
	}
	return config
}

// gatewayURL is the agent endpoint as a wss:// URL.
func (a *Agent) gatewayURL() string {
	gateway := a.config.Server.JoinPath(GatewayPath)
	gateway.Scheme = "wss"
	return gateway.String()
}

// renewLoop replaces the certificate when it is due, for as long as the agent runs.
//
// It returns a FatalError only when the identity is dead — the control plane refused the
// certificate the renewal was authenticated by — or when the certificate expired before
// any renewal succeeded. Every other failure is retried with backoff, because the
// certificate is still good until it is not.
func (a *Agent) renewLoop(ctx context.Context) *FatalError {
	retry := a.config.RenewalBackoff
	for {
		identity, err := a.config.Dir.LoadIdentity()
		if err != nil {
			return &FatalError{Reason: "the runner's identity cannot be loaded for renewal", Err: err}
		}
		record := identity.Record

		lead := record.NotAfter.Sub(record.RenewAfter)
		due := record.RenewAfter.Add(retry.jitter()(min(maxRenewalSpread, max(lead/10, 0))))
		if !sleepUntil(ctx, a.config.Now, due) {
			return nil
		}

		renewal, err := a.config.Renewer.Renew(ctx, identity)
		if err == nil {
			if err := a.config.Dir.SaveRenewal(renewal.Record, renewal.IdentityPEM); err != nil {
				return &FatalError{Reason: "a renewed certificate could not be saved; the old one has been superseded", Err: err}
			}
			retry.Reset()
			a.log.Info("renewed the runner's certificate", "previous_serial", record.Serial,
				"serial", renewal.Record.Serial, "not_after", renewal.Record.NotAfter, "renew_after", renewal.Record.RenewAfter)
			if renewal.AuthorityRotated {
				a.log.Warn("the farm CA changed at renewal; the new one is now pinned",
					"previous_fingerprint", record.AuthorityFingerprint, "fingerprint", renewal.Record.AuthorityFingerprint)
			}
			continue
		}
		if stopped(ctx) {
			return nil // a renewal cut short by shutdown is not the agent's failure to report
		}
		if _, refused := certificateAlert(err); refused || enroll.IsIdentityRefused(err) {
			return &FatalError{Reason: revokedReason, Err: err}
		}
		if !a.config.Now().Before(record.NotAfter) {
			return &FatalError{Reason: "this runner's certificate expired before it could be renewed. " +
				"Enroll this machine again with a new token", Err: err}
		}

		delay := min(retry.Next(), max(record.NotAfter.Sub(a.config.Now()), 0))
		a.log.Warn("certificate renewal failed; retrying", "error", err, "in", delay.Round(time.Second),
			"not_after", record.NotAfter)
		if !sleepUntil(ctx, a.config.Now, a.config.Now().Add(delay)) {
			return nil
		}
	}
}

// stopped reports whether the agent has been told to stop. A failure that arrives after
// that is shutdown's doing, not something to report.
func stopped(ctx context.Context) bool { return ctx.Err() != nil }

// sleepUntil waits for an instant on the configured clock, or the context. It reports
// whether the instant arrived.
func sleepUntil(ctx context.Context, now func() time.Time, at time.Time) bool {
	wait := at.Sub(now())
	if wait <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
