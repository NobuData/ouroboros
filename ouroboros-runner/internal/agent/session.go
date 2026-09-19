package agent

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/telemetry"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/ws"
)

// result is how one connection ended.
type result struct {
	// connected is true when the gateway acknowledged the hello — the difference between
	// a session that dropped and an attempt that never became one.
	connected bool
	// stable is true when the session lasted long enough that the next backoff starts
	// from the bottom again.
	stable bool
	// retryAfter is a delay the gateway named — `bye.reconnect_after_ms` or
	// `refuse.retry_after_ms` — in place of the agent's own backoff.
	retryAfter *time.Duration
	// fatal ends the loop.
	fatal *FatalError
	// reason is why, for the log.
	reason string
}

// drainState is the gateway's drain, which outlives any one connection.
type drainState struct {
	mu       sync.Mutex
	draining bool
	detail   string
}

func (d *drainState) set(draining bool, detail string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.draining, d.detail = draining, detail
}

func (d *drainState) get() (bool, string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.draining, d.detail
}

// session is one live connection.
type session struct {
	agent  *Agent
	socket *ws.Conn
	limits conn.Limits
	// written is the outbox frames already written on THIS socket, so a frame added
	// while the re-send is in progress is written once, not twice. Owned by the
	// connect goroutine.
	written map[string]bool
}

// errGatewayBye is the gateway closing the session in an orderly way.
type errGatewayBye struct{ bye conn.ByePayload }

func (e *errGatewayBye) Error() string {
	return fmt.Sprintf("the gateway said bye (%s): %s", e.bye.Reason, e.bye.Detail)
}

// errProtocol is the gateway sending something the contract does not allow.
type errProtocol struct{ what string }

func (e *errProtocol) Error() string { return "protocol violation from the gateway: " + e.what }

// connect makes one connection and holds it until it ends.
func (a *Agent) connect(ctx context.Context) result {
	identity, err := a.config.Dir.LoadIdentity()
	if err != nil {
		return result{fatal: &FatalError{Reason: "the runner's identity cannot be loaded", Err: err}}
	}
	if fatal := a.checkExpiry(identity); fatal != nil {
		return result{fatal: fatal}
	}
	mode := identity.Record.SecurityMode

	header := http.Header{}
	header.Set("User-Agent", "ouroboros-runner/"+a.config.Version)
	if mode == conn.SecurityBearerFallback {
		// The one place the bearer secret leaves this process: the upgrade request's
		// Authorization header, over TLS. Never a frame, never a log line.
		header.Set("Authorization", "Bearer "+identity.Bearer.Reveal())
	}

	socket, err := ws.Dial(ctx, a.gatewayURL(), ws.DialOptions{
		TLSConfig:        a.tlsConfig(identity),
		Header:           header,
		HandshakeTimeout: a.config.HandshakeTimeout,
	})
	if err != nil {
		if ctx.Err() != nil {
			return result{reason: "shutting down"}
		}
		if fatal := classifyDial(err, mode); fatal != nil {
			if a.renewedSince(identity) {
				return result{reason: "the certificate was renewed while connecting; reconnecting with the new one"}
			}
			return result{fatal: fatal}
		}
		return result{reason: dialReason(err)}
	}
	defer func() { _ = socket.Close() }()

	ack, outcome, ok := a.handshake(ctx, socket, identity)
	if !ok {
		return outcome
	}
	connected := a.config.Now()
	if err := a.config.Dir.SaveSession(ack.Session); err != nil {
		a.log.Warn("could not record the session for resume", "error", err)
	}
	a.pool.set(ack.Pool)
	maxConcurrency, allowlist := a.pool.get()
	a.log.Info("connected", "session", ack.Session, "resumed", ack.Resumed, "runner", ack.Runner.ID,
		"pool", ack.Runner.Pool, "security_mode", mode, "pending_terminal_frames", a.outbox.Len())
	a.log.Info("pool policy", "max_concurrency", maxConcurrency, "env_allowlist", allowlist,
		"named_by_gateway", ack.Pool != nil)
	if mode == conn.SecurityBearerFallback {
		a.log.Warn("connected in bearer-fallback mode: this runner authenticates with a secret, not a " +
			"certificate, and the farm shows it as degraded")
	}

	live := &session{agent: a, socket: socket, limits: ack.Limits, written: map[string]bool{}}
	outcome = live.hold(ctx)
	outcome.connected = true
	outcome.stable = a.config.Now().Sub(connected) >= a.config.StableAfter
	return outcome
}

// renewedSince reports whether the certificate on disk is no longer the one a connection
// attempt presented — a renewal finished while it was in flight, superseding the
// certificate the gateway then refused. That refusal is about the old certificate, not
// this runner, and the next attempt presents the new one.
func (a *Agent) renewedSince(presented state.Identity) bool {
	current, err := a.config.Dir.LoadIdentity()
	return err == nil && current.Record.Serial != presented.Record.Serial
}

// dialReason is a failed dial, for the reconnect log line.
func dialReason(err error) string {
	var refused *ws.HandshakeError
	if !errors.As(err, &refused) {
		return err.Error()
	}
	if refused.StatusCode == http.StatusNotFound {
		return "the control plane has no agent gateway at this address (HTTP 404)"
	}
	if code := errorCode(refused.Body); code != "" {
		return fmt.Sprintf("%s (%s)", refused.Error(), code)
	}
	return refused.Error()
}

// handshake writes the hello and reads the answer. It returns the ack, or how the
// connection ended instead.
func (a *Agent) handshake(ctx context.Context, socket *ws.Conn, identity state.Identity) (conn.AckPayload, result, bool) {
	hello := conn.NewHello(
		conn.NewID(), a.config.Version, a.config.Arch, a.config.Hostname, identity.Record.Pool,
		a.config.Capabilities, identity.Record.SecurityMode, a.config.Dir.Session(),
	)
	if err := write(socket, hello); err != nil {
		return conn.AckPayload{}, result{reason: "writing hello: " + err.Error()}, false
	}

	// The answer is bounded like the dial is: a gateway that upgrades and then says
	// nothing is not a gateway this agent is connected to.
	_ = socket.SetReadDeadline(time.Now().Add(a.config.HandshakeTimeout))
	stop := context.AfterFunc(ctx, func() { _ = socket.SetReadDeadline(time.Unix(1, 0)) })
	raw, err := socket.ReadMessage()
	stop()
	_ = socket.SetReadDeadline(time.Time{})
	if err != nil {
		if ctx.Err() != nil {
			return conn.AckPayload{}, result{reason: "shutting down"}, false
		}
		if _, refused := certificateAlert(err); refused && !a.renewedSince(identity) {
			return conn.AckPayload{}, result{fatal: classifyDial(err, identity.Record.SecurityMode)}, false
		}
		return conn.AckPayload{}, result{reason: "waiting for ack: " + err.Error()}, false
	}

	envelope, err := judge(raw)
	if err != nil {
		violate(socket, err)
		return conn.AckPayload{}, result{reason: err.Error()}, false
	}
	switch envelope.Type {
	case conn.TypeAck:
		var ack conn.AckPayload
		if err := envelope.Into(&ack); err != nil {
			violate(socket, &errProtocol{err.Error()})
			return conn.AckPayload{}, result{reason: err.Error()}, false
		}
		if ack.Protocol < conn.MinVersion || ack.Protocol > conn.Version {
			err := &errProtocol{fmt.Sprintf("ack chose protocol %d, outside the %d–%d this agent offered",
				ack.Protocol, conn.MinVersion, conn.Version)}
			violate(socket, err)
			return conn.AckPayload{}, result{reason: err.Error()}, false
		}
		return ack, result{}, true

	case conn.TypeRefuse:
		var refusal conn.RefusePayload
		if err := envelope.Into(&refusal); err != nil {
			return conn.AckPayload{}, result{reason: err.Error()}, false
		}
		if refusal.Final() {
			return conn.AckPayload{}, result{fatal: &FatalError{Reason: refusalReason(refusal)}}, false
		}
		outcome := result{reason: refusalReason(refusal)}
		if refusal.RetryAfterMS != nil {
			delay := time.Duration(*refusal.RetryAfterMS) * time.Millisecond
			outcome.retryAfter = &delay
		}
		return conn.AckPayload{}, outcome, false

	default:
		err := &errProtocol{fmt.Sprintf("the gateway answered hello with %s", envelope.Type)}
		violate(socket, err)
		return conn.AckPayload{}, result{reason: err.Error()}, false
	}
}

// hold is the session: re-send what is unacknowledged, heartbeat, and answer the
// gateway, until the socket dies, the gateway says bye, or the context ends.
func (s *session) hold(ctx context.Context) result {
	// Read in a goroutine: a WebSocket read cannot be selected on, and everything else
	// here has to be.
	frames := make(chan *conn.Envelope)
	readErr := make(chan error, 1)
	done := make(chan struct{})
	defer close(done)
	go s.read(frames, readErr, done)

	// The running jobs' job.start and job.progress frames reach this session through here,
	// and stop reaching it when it ends.
	notices := s.agent.notices.open()
	defer s.agent.notices.release(notices)

	// First, before anything else on this socket: every terminal frame not yet
	// receipted, byte for byte (docs/RUNNER_PROTOCOL.md § 5). Then the first heartbeat,
	// so the gateway has this agent's telemetry from the moment it is connected.
	if err := s.flush(); err != nil {
		return result{reason: "re-sending terminal frames: " + err.Error()}
	}
	if err := s.heartbeat(); err != nil {
		return result{reason: "writing a heartbeat: " + err.Error()}
	}
	heartbeat := time.NewTimer(s.heartbeatInterval())
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			// The jobs are being cancelled with the same context. Their `cancelled`
			// finishes are worth delivering on this socket rather than the next process's,
			// so the farm page does not show them running until the agent comes back.
			if !s.agent.awaitJobs(s.agent.config.JobStopWait) {
				s.agent.log.Warn("a cancelled job had not stopped in time to report before bye; " +
					"its finish is re-sent from the outbox on the next start")
			}
			if s.writeNotices(notices) == nil {
				_ = s.flush()
			}
			s.bye(ctx, readErr)
			return result{reason: "shutting down"}

		case err := <-readErr:
			return s.ended(err)

		case envelope := <-frames:
			if err := s.handle(ctx, envelope); err != nil {
				// Only the gateway's own mistake is answered with a bye saying so; a write
				// that failed is a connection that has gone, and there is nobody to tell.
				var protocol *errProtocol
				if errors.As(err, &protocol) {
					violate(s.socket, err)
				}
				return result{reason: err.Error()}
			}

		case <-heartbeat.C:
			if err := s.heartbeat(); err != nil {
				return result{reason: "writing a heartbeat: " + err.Error()}
			}
			heartbeat.Reset(s.heartbeatInterval())

		case frame := <-notices:
			if err := write(s.socket, frame); err != nil {
				return result{reason: "writing a " + string(frame.Type) + ": " + err.Error()}
			}

		case <-s.agent.queued:
			// A job posts its job.start before it queues its finish, so whatever it posted
			// is already waiting here: write it first, and the gateway never reads a
			// finish for a job it has not seen start.
			if err := s.writeNotices(notices); err != nil {
				return result{reason: "writing a job frame: " + err.Error()}
			}
			if err := s.flush(); err != nil {
				return result{reason: "writing a terminal frame: " + err.Error()}
			}
		}
	}
}

// writeNotices writes every job frame already waiting for this session, without waiting
// for more.
func (s *session) writeNotices(notices <-chan conn.Frame) error {
	for {
		select {
		case frame := <-notices:
			if err := write(s.socket, frame); err != nil {
				return err
			}
		default:
			return nil
		}
	}
}

// read is the reader goroutine: decode and judge each frame, and hand it to hold. What
// ends it — an error, or the gateway's bye — is sent once on readErr, which is buffered,
// so the reader never outlives the session waiting to be heard; and a frame it cannot
// hand over because the session has ended is dropped rather than blocked on.
func (s *session) read(frames chan<- *conn.Envelope, readErr chan<- error, done <-chan struct{}) {
	for {
		raw, err := s.socket.ReadMessage()
		if err != nil {
			readErr <- err
			return
		}
		envelope, err := judge(raw)
		if err != nil {
			readErr <- err
			return
		}
		switch envelope.Type {
		case conn.TypeReceipt:
			// Applied here rather than handed over: a receipt touches only the outbox,
			// which is safe for concurrent use, and it should stop a re-send as early
			// as it can.
			if err := s.receipt(envelope); err != nil {
				readErr <- err
				return
			}
		case conn.TypeBye:
			var bye conn.ByePayload
			if err := envelope.Into(&bye); err != nil {
				readErr <- &errProtocol{err.Error()}
				return
			}
			readErr <- &errGatewayBye{bye: bye}
			return
		default:
			select {
			case frames <- envelope:
			case <-done:
				return
			}
		}
	}
}

// ended turns the reader's error into how the session ended.
func (s *session) ended(err error) result {
	var bye *errGatewayBye
	var protocol *errProtocol
	switch {
	case errors.As(err, &bye):
		s.agent.log.Info("the gateway is closing the session", "reason", bye.bye.Reason, "detail", bye.bye.Detail,
			"reconnect_after_ms", bye.bye.ReconnectAfterMS)
		_ = s.socket.WriteClose(ws.CloseNormal, "")
		outcome := result{reason: bye.Error()}
		if bye.bye.ReconnectAfterMS != nil {
			delay := time.Duration(*bye.bye.ReconnectAfterMS) * time.Millisecond
			outcome.retryAfter = &delay
		}
		return outcome
	case errors.As(err, &protocol):
		violate(s.socket, err)
		return result{reason: err.Error()}
	default:
		return result{reason: "the connection dropped: " + err.Error()}
	}
}

// handle answers one frame from the gateway. ctx is the agent's, which an accepted job
// runs under.
func (s *session) handle(ctx context.Context, envelope *conn.Envelope) error {
	switch envelope.Type {
	case conn.TypeJobOffer:
		return s.offer(ctx, envelope)

	case conn.TypeDrain:
		var drain conn.DrainPayload
		if err := envelope.Into(&drain); err != nil {
			return &errProtocol{err.Error()}
		}
		s.agent.draining.set(true, drain.Detail)
		s.agent.log.Warn("drained: declining new work", "reason", drain.Reason, "detail", drain.Detail,
			"deadline_ms", drain.DeadlineMS)
		return nil

	case conn.TypeUndrain:
		s.agent.draining.set(false, "")
		s.agent.log.Info("undrained: taking work again")
		return nil

	default:
		// ack and refuse are only ever the answer to a hello; receipt and bye are the
		// reader's (see read).
		return &errProtocol{fmt.Sprintf("an unexpected %s mid-session", envelope.Type)}
	}
}

// offer answers a job.offer at once: a job.accept and the job started in the background,
// or a job.decline with the reason ([#246]).
//
// Either way the answer is immediate. A decline is worth far more to a dispatcher than a
// silence it has to wait `offer_ack_ms` out, and an offer this runner cannot satisfy is
// declined rather than accepted and failed — see Agent.decline for the reasons and their
// order. An accepted job is started only once its accept is on the wire: a job whose accept
// never left is one the gateway will re-offer elsewhere, and must not also run here.
//
// [#246]: https://github.com/NobuData/ouroboros/issues/246
func (s *session) offer(ctx context.Context, envelope *conn.Envelope) error {
	var offer conn.JobOfferPayload
	if err := envelope.Into(&offer); err != nil {
		return &errProtocol{err.Error()}
	}

	if reason, detail := s.agent.decline(offer); reason != "" {
		s.agent.log.Info("declined a job offer", "job", offer.Job, "executor", offer.Executor, "reason", reason,
			"detail", detail)
		return write(s.socket, conn.NewFrame(conn.NewID(), conn.TypeJobDecline, conn.JobDeclinePayload{
			Job: offer.Job, Offer: envelope.ID, Reason: reason, Detail: truncate(detail),
		}))
	}

	if err := write(s.socket, conn.NewFrame(conn.NewID(), conn.TypeJobAccept, conn.JobAcceptPayload{
		Job: offer.Job, Offer: envelope.ID,
	})); err != nil {
		return err
	}
	s.agent.log.Info("accepted a job offer", "job", offer.Job, "executor", offer.Executor, "image", offer.Image)
	s.agent.launch(ctx, offer)
	return nil
}

// receipt stops re-sending a terminal frame.
func (s *session) receipt(envelope *conn.Envelope) error {
	var receipt conn.ReceiptPayload
	if err := envelope.Into(&receipt); err != nil {
		return &errProtocol{err.Error()}
	}
	if err := s.agent.outbox.Receipt(receipt.Of); err != nil {
		// The frame is already forgotten in memory, so this process will not re-send it;
		// only its file survived. After a restart it is re-sent once and answered
		// `duplicate` — harmless — whereas ending the session over it would reconnect into
		// the same failure for ever.
		s.agent.log.Warn("a receipted frame's file could not be removed; it will be re-sent once after a restart",
			"of", receipt.Of, "error", err)
	}
	// Both answers mean the same thing — stop re-sending — and the difference is the
	// difference between a clean reconnection and a bug nobody can reproduce, so it is
	// logged.
	if receipt.Duplicate {
		s.agent.log.Info("a re-sent terminal frame was already recorded; the gateway deduplicated it",
			"of", receipt.Of, "of_type", receipt.OfType)
	} else {
		s.agent.log.Info("a terminal frame was recorded", "of", receipt.Of, "of_type", receipt.OfType)
	}
	return nil
}

// flush writes every outbox frame not yet written on this socket, in mint order, as the
// exact bytes that were persisted.
func (s *session) flush() error {
	for _, entry := range s.agent.outbox.Entries() {
		if s.written[entry.ID] {
			continue
		}
		if err := s.socket.WriteText(entry.Frame); err != nil {
			return err
		}
		s.written[entry.ID] = true
	}
	return nil
}

// heartbeat writes one heartbeat.
func (s *session) heartbeat() error {
	return write(s.socket, conn.NewFrame(conn.NewID(), conn.TypeHeartbeat, s.agent.heartbeat()))
}

// heartbeat is this agent's presence and load, now.
func (a *Agent) heartbeat() conn.HeartbeatPayload {
	var sample telemetry.Sample
	if a.config.Telemetry != nil {
		sample = a.config.Telemetry.Latest()
	}
	draining, _ := a.draining.get()
	return NewHeartbeat(a.config.Now(), a.started, sample, &a.workload, draining)
}

// NewHeartbeat is the heartbeat an agent in this condition sends ([#245]).
//
// The measurements are the sample's, and each is null when it could not be taken — never
// zero, never the last value that could be. The queue depth and the running job are the
// workload's. The state is `draining` while drained (a drained agent finishing its last
// job still says so, because that is what the dispatcher must know), `busy` while a job
// runs, and `idle` otherwise.
//
//   - now is the agent's clock, which `sent_at` reports.
//   - started is when this process started, which `uptime_s` counts from.
//
// [#245]: https://github.com/NobuData/ouroboros/issues/245
func NewHeartbeat(now, started time.Time, sample telemetry.Sample, workload *Workload, draining bool) conn.HeartbeatPayload {
	queueDepth, running := workload.Snapshot()
	status := conn.StateIdle
	if running != nil {
		status = conn.StateBusy
	}
	if draining {
		status = conn.StateDraining
	}
	return conn.HeartbeatPayload{
		SentAt:        conn.Timestamp(now),
		State:         status,
		UptimeS:       int(max(now.Sub(started), 0).Seconds()),
		CPUPct:        sample.CPUPct,
		MemoryUsedMB:  sample.MemoryUsedMB,
		MemoryTotalMB: sample.MemoryTotalMB,
		QueueDepth:    queueDepth,
		Job:           running,
	}
}

// heartbeatInterval is the gateway's interval, plus or minus its jitter — which is what
// stops a fleet started together from heartbeating in lockstep for the rest of its life.
func (s *session) heartbeatInterval() time.Duration {
	interval := time.Duration(s.limits.HeartbeatIntervalMS) * time.Millisecond
	spread := time.Duration(s.limits.HeartbeatJitterMS) * time.Millisecond
	if spread > 0 {
		interval += s.agent.config.Backoff.jitter()(2*spread) - spread
	}
	return max(interval, 100*time.Millisecond)
}

// bye is the clean goodbye — what a SIGTERM becomes. It is said before the socket goes,
// and the gateway's answering close is waited for briefly, so the bye is not lost to a
// reset.
func (s *session) bye(ctx context.Context, readErr <-chan error) {
	detail := "shutdown requested"
	if cause := context.Cause(ctx); cause != nil && !errors.Is(cause, context.Canceled) {
		detail = cause.Error()
	}
	reason := conn.ByeShutdown
	var fatal *FatalError
	if errors.As(context.Cause(ctx), &fatal) {
		reason = conn.ByeError
	}
	if err := write(s.socket, conn.NewFrame(conn.NewID(), conn.TypeBye, conn.ByePayload{
		Reason: reason, Detail: truncate(detail),
	})); err != nil {
		return
	}
	_ = s.socket.WriteClose(ws.CloseNormal, "")
	grace := time.NewTimer(s.agent.config.CloseGrace)
	defer grace.Stop()
	select {
	case <-readErr: // the gateway's answering close, or the socket ending
	case <-grace.C:
	}
	s.agent.log.Info("said bye to the gateway", "detail", detail)
}

// write encodes a frame and writes it.
func write(socket *ws.Conn, frame conn.Frame) error {
	encoded, err := conn.Encode(frame)
	if err != nil {
		return err
	}
	return socket.WriteText(encoded)
}

// judge decodes a frame from the gateway and holds it to the contract and to direction.
func judge(raw []byte) (*conn.Envelope, error) {
	envelope, diags := conn.Decode(raw)
	if len(diags) > 0 {
		return nil, &errProtocol{fmt.Sprintf("an illegal frame: %s at %q", diags[0].Code, diags[0].Path)}
	}
	if !envelope.Type.SentBy(conn.FromGateway) {
		return nil, &errProtocol{fmt.Sprintf("%s is not the gateway's to send", envelope.Type)}
	}
	return envelope, nil
}

// violate answers a gateway's protocol violation: a bye that says so, and a close.
func violate(socket *ws.Conn, err error) {
	_ = write(socket, conn.NewFrame(conn.NewID(), conn.TypeBye, conn.ByePayload{
		Reason: conn.ByeError, Detail: truncate(err.Error()),
	}))
	_ = socket.WriteClose(ws.CloseProtocolError, "protocol violation")
}

// detailMax is the longest `detail` the contract allows on a bye.
const detailMax = 512

// truncate bounds a detail to what the contract allows, on a rune boundary.
func truncate(text string) string {
	runes := []rune(text)
	if len(runes) <= detailMax {
		return text
	}
	return string(runes[:detailMax])
}
