package agent

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/enroll"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/secret"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
)

// The connection loop, against the in-process farm (internal/farmtest): a real TLS
// server with the farm CA's client-certificate verification, the shipped enrollment
// routes' behaviour, and a gateway that judges every frame by the published contract.

// wait is how long any one expectation may take. Generous, because the race detector
// slows everything, and a test that times out is a failure with a message either way.
const wait = 15 * time.Second

// logBuffer is a log sink safe for the agent's several goroutines.
type logBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buffer.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buffer.String()
}

// harness is one running agent against one farm.
type harness struct {
	t      *testing.T
	farm   *farmtest.Farm
	dir    *state.Dir
	logs   *logBuffer
	agent  *Agent
	cancel context.CancelCauseFunc
	done   chan error
}

// enrolled enrols a runner into the farm's pool-a and returns its open state directory.
func enrolled(t *testing.T, farm *farmtest.Farm, bearer bool) *state.Dir {
	t.Helper()
	dir, err := state.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dir.Close() })

	server, _ := enroll.ParseServer(farm.URL)
	client := &enroll.Client{Server: server, RootCAs: farm.ServerRoots()}
	enrollment, err := client.Register(context.Background(), enroll.Request{
		Tenant: "acme-robotics", Pool: "pool-a", Token: secret.Secret(farm.MintToken("pool-a", 1)),
		Name: "forge-01", Arch: "linux/x86_64", AgentVersion: "0.2.0-test", BearerFallback: bearer,
	})
	if err != nil {
		t.Fatalf("enrol: %v", err)
	}
	if err := dir.SaveEnrollment(enrollment); err != nil {
		t.Fatal(err)
	}
	return dir
}

// config is a test's agent configuration: fast backoff, the farm trusted.
func config(farm *farmtest.Farm, dir *state.Dir, logs *logBuffer) Config {
	server, _ := url.Parse(farm.URL)
	renewer := &enroll.Client{Server: server, RootCAs: farm.ServerRoots()}
	return Config{
		Dir:      dir,
		Server:   server,
		RootCAs:  farm.ServerRoots(),
		Version:  "0.2.0-test",
		Arch:     "linux/x86_64",
		Hostname: "forge-01",
		Capabilities: conn.Capabilities{
			Docker: true, Shell: false, Ccache: false, CPUs: 8, MemoryMB: 16384,
		},
		Telemetry:        measuring(12.5, 2048, 16384),
		Renewer:          renewer,
		Logger:           newLogger(logs),
		Backoff:          Backoff{Base: 20 * time.Millisecond, Max: 200 * time.Millisecond},
		RenewalBackoff:   Backoff{Base: 50 * time.Millisecond, Max: 200 * time.Millisecond},
		HandshakeTimeout: 5 * time.Second,
		StableAfter:      time.Hour,
		CloseGrace:       time.Second,
	}
}

// start runs an agent in the background.
func start(t *testing.T, farm *farmtest.Farm, dir *state.Dir, adjust func(*Config)) *harness {
	t.Helper()
	logs := &logBuffer{}
	configuration := config(farm, dir, logs)
	if adjust != nil {
		adjust(&configuration)
	}
	agent, err := New(configuration)
	if err != nil {
		t.Fatalf("new agent: %v", err)
	}
	ctx, cancel := context.WithCancelCause(context.Background())
	h := &harness{t: t, farm: farm, dir: dir, logs: logs, agent: agent, cancel: cancel, done: make(chan error, 1)}
	go func() { h.done <- agent.Run(ctx) }()
	t.Cleanup(func() {
		cancel(errors.New("test over"))
		select {
		case <-h.done:
		case <-time.After(wait):
			t.Error("the agent did not stop")
		}
	})
	return h
}

// until waits for the farm to observe something, failing the test if it does not.
func (h *harness) until(what string, condition func(farmtest.Observed) bool) farmtest.Observed {
	h.t.Helper()
	observed, ok := h.farm.WaitFor(wait, condition)
	if !ok {
		h.t.Fatalf("timed out waiting for %s; observed %+v\nlogs:\n%s", what, summary(observed), h.logs)
	}
	return observed
}

// logged waits for a line containing text to reach the agent's log. The farm observes a
// frame before the agent has necessarily logged what it did with the answer, so a log
// assertion waits rather than reads once.
func (h *harness) logged(text string) {
	h.t.Helper()
	deadline := time.Now().Add(wait)
	for !strings.Contains(h.logs.String(), text) {
		if time.Now().After(deadline) {
			h.t.Fatalf("expected the log to mention %q:\n%s", text, h.logs)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// result waits for Run to return.
func (h *harness) result() error {
	h.t.Helper()
	select {
	case err := <-h.done:
		h.done <- err // for the cleanup
		return err
	case <-time.After(wait):
		h.t.Fatalf("Run did not return\nlogs:\n%s", h.logs)
		return nil
	}
}

// stop cancels the agent as a SIGTERM would, and returns what Run returned.
func (h *harness) stop() error {
	h.t.Helper()
	h.cancel(errors.New("SIGTERM received"))
	return h.result()
}

// summary is an observation without its bulkier fields, for a failure message.
func summary(o farmtest.Observed) map[string]any {
	return map[string]any{
		"connections": o.Connections, "hellos": len(o.Hellos), "heartbeats": len(o.Heartbeats),
		"finishes": len(o.Finishes), "recorded": o.Recorded, "duplicates": o.Duplicates,
		"declines": len(o.Declines), "byes": o.Byes, "violations": o.Violations, "refused": o.Refused,
		"renewals": o.Renewals,
	}
}

// finishFrame is a job.finish with a fresh envelope id — the committed worked example's
// payload.
func finishFrame(t *testing.T) conn.Frame {
	t.Helper()
	raw, err := os.ReadFile("../../../schemas/runner-protocol/fixtures/valid/job-finish.json")
	if err != nil {
		t.Fatal(err)
	}
	envelope, diags := conn.Decode(raw)
	if len(diags) > 0 {
		t.Fatal(diags)
	}
	return conn.NewFrame(conn.NewID(), conn.TypeJobFinish, envelope.Payload)
}

// TestEnrollConnectHeartbeat is the first acceptance criterion: enroll, connect,
// heartbeat — and the clean bye a SIGTERM becomes.
func TestEnrollConnectHeartbeat(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), nil)

	observed := h.until("a hello and two heartbeats", func(o farmtest.Observed) bool {
		return len(o.Hellos) >= 1 && len(o.Heartbeats) >= 2
	})

	hello := observed.Hellos[0]
	if hello.SecurityMode != conn.SecurityMTLS || observed.Transports[0] != "mtls" {
		t.Errorf("expected an mTLS hello on an mTLS transport, got %q on %q", hello.SecurityMode, observed.Transports[0])
	}
	if hello.Pool != "pool-a" || hello.Arch != "linux/x86_64" || hello.Hostname != "forge-01" ||
		!hello.Capabilities.Docker || hello.Capabilities.CPUs != 8 || hello.Agent.Version != "0.2.0-test" {
		t.Errorf("hello: %+v", hello)
	}
	if hello.Resume != "" {
		t.Errorf("a first connection has no session to resume, got %q", hello.Resume)
	}
	heartbeat := observed.Heartbeats[0]
	if heartbeat.State != conn.StateIdle || heartbeat.Job != nil || heartbeat.QueueDepth != 0 ||
		heartbeat.CPUPct == nil || *heartbeat.CPUPct != 12.5 ||
		heartbeat.MemoryUsedMB == nil || *heartbeat.MemoryUsedMB != 2048 ||
		heartbeat.MemoryTotalMB == nil || *heartbeat.MemoryTotalMB != 16384 {
		t.Errorf("heartbeat: %+v", heartbeat)
	}
	if h.dir.Session() == "" {
		t.Error("the granted session was not recorded for resume")
	}

	if err := h.stop(); err != nil {
		t.Fatalf("a SIGTERM should end the agent cleanly, got %v", err)
	}
	h.logged(`msg=stopped cause="SIGTERM received"`)
	observed = h.until("the bye", func(o farmtest.Observed) bool { return len(o.Byes) == 1 })
	if bye := observed.Byes[0]; bye.Reason != conn.ByeShutdown || bye.Detail != "SIGTERM received" || bye.ReconnectAfterMS != nil {
		t.Errorf("bye: %+v", bye)
	}
	if len(observed.Violations) > 0 {
		t.Errorf("the agent wrote frames the contract refuses: %v", observed.Violations)
	}
}

// TestADroppedConnectionReconnectsAndResumes asserts the reconnect names the session it
// had, and the gateway that still holds it gives it back.
func TestADroppedConnectionReconnectsAndResumes(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), nil)

	h.until("the first hello", func(o farmtest.Observed) bool { return len(o.Hellos) == 1 && len(o.Heartbeats) >= 1 })
	session := h.dir.Session()
	farm.Drop()
	h.logged("disconnected; reconnecting")

	observed := h.until("the reconnection", func(o farmtest.Observed) bool { return len(o.Hellos) == 2 })
	if observed.Hellos[1].Resume != session || session == "" {
		t.Errorf("the reconnection resumed %q, want %q", observed.Hellos[1].Resume, session)
	}
	h.logged("resumed=true")

	// A gateway that has forgotten the session answers resumed=false, and the agent
	// carries on regardless: resume is an optimisation, never what delivery rests on.
	farm.ForgetSessions()
	farm.Drop()
	h.until("a reconnection without the session", func(o farmtest.Observed) bool {
		return len(o.Hellos) == 3 && len(o.Heartbeats) >= 3
	})
	h.logged("resumed=false")
}

// TestAJobFinishInterruptedByADropIsDeliveredOnce is the acceptance criterion the whole
// resume design exists for: the gateway records a job.finish, the socket dies before
// the receipt, the agent reconnects and re-sends — byte for byte — and the gateway's
// ledger answers `duplicate`. One finished job, not two.
func TestAJobFinishInterruptedByADropIsDeliveredOnce(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	farm.DropOnFinish(1)
	frame := finishFrame(t)
	if err := h.agent.SendTerminal(frame); err != nil {
		t.Fatalf("send: %v", err)
	}

	observed := h.until("the re-send and its duplicate receipt", func(o farmtest.Observed) bool {
		return o.Duplicates == 1
	})
	if observed.Recorded != 1 {
		t.Errorf("expected exactly one finished job, the ledger holds %d", observed.Recorded)
	}
	if len(observed.Finishes) != 2 || observed.Finishes[0] != frame.ID || observed.Finishes[1] != frame.ID {
		t.Errorf("expected the same frame twice, got %v", observed.Finishes)
	}
	if !bytes.Equal(observed.FinishFrames[0], observed.FinishFrames[1]) {
		t.Errorf("the re-send was not byte-identical:\n%s\n%s", observed.FinishFrames[0], observed.FinishFrames[1])
	}
	waitForEmptyOutbox(t, h)
	h.logged("deduplicated")
}

// TestAReceiptWhoseFileCannotBeRemovedDoesNotEndTheSession asserts a disk problem after a
// receipt is logged rather than turned into a reconnect loop: the frame is forgotten in
// memory, and the session carries on.
func TestAReceiptWhoseFileCannotBeRemovedDoesNotEndTheSession(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	dir := enrolled(t, farm, false)
	h := start(t, farm, dir, nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	farm.DropOnFinish(1)
	if err := h.agent.SendTerminal(finishFrame(t)); err != nil {
		t.Fatal(err)
	}
	h.until("the recorded, unreceipted finish", func(o farmtest.Observed) bool { return o.Recorded == 1 })

	outbox := filepath.Join(dir.Path(), "outbox")
	if err := os.Chmod(outbox, 0o500); err != nil { // #nosec G302 -- a read-only directory, on purpose
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(outbox, 0o700) }) // #nosec G302 -- restored for TempDir's clean-up

	h.until("the duplicate receipt", func(o farmtest.Observed) bool { return o.Duplicates == 1 })
	h.logged("could not be removed")
	connections := farm.Observe().Connections
	h.until("heartbeats after the receipt", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 3 })
	if farm.Observe().Connections != connections {
		t.Error("a file that could not be removed ended the session")
	}
	if h.agent.outbox.Len() != 0 {
		t.Error("the receipted frame is still queued in memory")
	}
}

// TestTerminalFramesSurviveARestart is the same drop, with the agent killed before it can
// reconnect: the next agent — reading the same state directory — re-sends the frame.
func TestTerminalFramesSurviveARestart(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	dir := enrolled(t, farm, false)

	first := start(t, farm, dir, func(c *Config) { c.Backoff = Backoff{Base: time.Hour, Max: time.Hour} })
	first.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	farm.DropOnFinish(1)
	frame := finishFrame(t)
	if err := first.agent.SendTerminal(frame); err != nil {
		t.Fatal(err)
	}
	first.until("the recorded, unreceipted finish", func(o farmtest.Observed) bool { return o.Recorded == 1 })
	if err := first.stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}

	second := start(t, farm, dir, nil)
	observed := second.until("the re-send from the restarted agent", func(o farmtest.Observed) bool {
		return o.Duplicates == 1
	})
	if observed.Recorded != 1 || !bytes.Equal(observed.FinishFrames[0], observed.FinishFrames[1]) {
		t.Errorf("recorded %d, frames equal %t", observed.Recorded, bytes.Equal(observed.FinishFrames[0], observed.FinishFrames[1]))
	}
	waitForEmptyOutbox(t, second)
}

// TestAFrameQueuedWhileDisconnectedIsSentOnReconnect asserts a terminal frame produced
// between connections is persisted and delivered by the next one.
func TestAFrameQueuedWhileDisconnectedIsSentOnReconnect(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	dir := enrolled(t, farm, false)
	farm.RefuseNextHello(conn.RefusePayload{Code: conn.RefuseCapacityExhausted, Detail: "full", RetryAfterMS: ptr(500)})

	h := start(t, farm, dir, nil)
	h.until("the refused hello", func(o farmtest.Observed) bool { return len(o.Hellos) == 1 })
	if err := h.agent.SendTerminal(finishFrame(t)); err != nil {
		t.Fatal(err)
	}
	observed := h.until("the delivery", func(o farmtest.Observed) bool { return o.Recorded == 1 })
	if observed.Duplicates != 0 {
		t.Errorf("a frame never sent before was answered as a duplicate")
	}
	waitForEmptyOutbox(t, h)
}

// TestAFinalRefusalStopsTheAgent asserts a version-floor refusal is not reconnected
// into, and says what the operator has to do.
func TestAFinalRefusalStopsTheAgent(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.RefuseNextHello(conn.RefusePayload{
		Code: conn.RefuseVersionBelowMinimum, Minimum: ptr(2),
		Detail: "this gateway no longer speaks protocol 1; upgrade the agent",
	})
	h := start(t, farm, enrolled(t, farm, false), nil)

	err := h.result()
	var fatal *FatalError
	if !errors.As(err, &fatal) || !strings.Contains(fatal.Reason, "protocol 2 or newer") ||
		!strings.Contains(fatal.Reason, "Upgrade the agent") {
		t.Fatalf("expected a fatal version refusal, got %v", err)
	}
	if !strings.Contains(h.logs.String(), "protocol 2 or newer") {
		t.Errorf("the refusal was not logged:\n%s", h.logs)
	}
	time.Sleep(300 * time.Millisecond)
	if connections := farm.Observe().Connections; connections != 1 {
		t.Errorf("a final refusal was reconnected into: %d connections", connections)
	}
}

// TestARetryableRefusalIsRetriedWhenTheGatewaySays asserts `retry_after_ms` is a floor.
func TestARetryableRefusalIsRetriedWhenTheGatewaySays(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.RefuseNextHello(conn.RefusePayload{Code: conn.RefusePoolUnknown, Detail: "no such pool yet", RetryAfterMS: ptr(400)})
	started := time.Now()
	h := start(t, farm, enrolled(t, farm, false), nil)

	h.until("the retry", func(o farmtest.Observed) bool { return len(o.Hellos) == 2 })
	if elapsed := time.Since(started); elapsed < 400*time.Millisecond {
		t.Errorf("retried after %v, before the gateway's 400ms", elapsed)
	}
}

// TestARevokedCertificateIsRefusedAtConnect is the acceptance criterion, in every shape a
// gateway can give the refusal: a TLS alert, a 401, and the protocol's own refuse. Each
// ends the agent with a log line saying why, and none is retried.
func TestARevokedCertificateIsRefusedAtConnect(t *testing.T) {
	t.Parallel()
	for name, refusal := range map[string]farmtest.Refusal{
		"at the TLS handshake":           farmtest.RefuseAtHandshake,
		"with 401 farm_identity_refused": farmtest.RefuseWithStatus,
		"with refuse identity.revoked":   farmtest.RefuseWithFrame,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			farm := farmtest.NewFarm(t)
			farm.SetRefusal(refusal)
			dir := enrolled(t, farm, false)
			record, _ := dir.Record()
			farm.RevokeRunner(record.RunnerID)

			h := start(t, farm, dir, nil)
			err := h.result()
			var fatal *FatalError
			if !errors.As(err, &fatal) || !strings.Contains(fatal.Reason, "revoked") {
				t.Fatalf("expected a fatal revocation, got %v\nlogs:\n%s", err, h.logs)
			}
			logged := h.logs.String()
			if !strings.Contains(logged, "level=ERROR") || !strings.Contains(logged, "revoked") ||
				!strings.Contains(logged, "enroll this machine again") {
				t.Errorf("expected a clear error line:\n%s", logged)
			}
			if len(farm.Observe().Refused) == 0 {
				t.Error("the farm did not refuse anything")
			}
			time.Sleep(200 * time.Millisecond)
			if connections := farm.Observe().Connections; connections > 1 {
				t.Errorf("a revoked certificate was retried: %d connections", connections)
			}
		})
	}
}

// TestCertificateRenewalWithAShortTTLCertificate is the acceptance criterion: a
// certificate that is due within a second is renewed over mTLS without a token, the new
// one is saved, and the next connection presents it — the superseded one would be refused.
func TestCertificateRenewalWithAShortTTLCertificate(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetCertificateLifetime(8*time.Second, 7*time.Second) // renew-after is a second away
	dir := enrolled(t, farm, false)
	before, _ := dir.Record()

	h := start(t, farm, dir, nil)
	h.until("a renewal", func(o farmtest.Observed) bool { return o.Renewals >= 1 })

	after := waitForSerialChange(t, dir, before.Serial)
	if !after.NotAfter.After(before.NotAfter) || after.RenewedAt.IsZero() {
		t.Errorf("the renewed record: %+v", after)
	}
	h.logged("renewed the runner's certificate")

	// The old certificate is superseded, and the farm refuses superseded certificates at
	// the handshake: a reconnection that works is one presenting the new certificate.
	farm.Drop()
	h.until("a reconnection on the renewed certificate", func(o farmtest.Observed) bool {
		return len(o.Hellos) >= 2
	})
	for _, refused := range farm.Observe().Refused {
		if strings.HasSuffix(refused, before.Serial) {
			t.Errorf("the superseded certificate was presented after the renewal: %s", refused)
		}
	}
}

// TestARenewalRefusedForGoodStopsTheAgent asserts a renewal answered with
// farm_identity_refused — the certificate was revoked while the session was up — ends
// the agent with the revocation's own sentence.
func TestARenewalRefusedForGoodStopsTheAgent(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetRefusal(farmtest.RefuseWithStatus)
	farm.SetCertificateLifetime(8*time.Second, 7*time.Second)
	dir := enrolled(t, farm, false)
	record, _ := dir.Record()

	h := start(t, farm, dir, nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	farm.RevokeRunner(record.RunnerID)

	err := h.result()
	var fatal *FatalError
	if !errors.As(err, &fatal) || !strings.Contains(fatal.Reason, "revoked") {
		t.Fatalf("expected a fatal revocation, got %v", err)
	}
	observed := h.until("the bye saying why", func(o farmtest.Observed) bool { return len(o.Byes) == 1 })
	if observed.Byes[0].Reason != conn.ByeError {
		t.Errorf("expected bye reason error, got %+v", observed.Byes[0])
	}
}

// TestTheGatewaysByeIsHonoured asserts `reconnect_after_ms` is waited out — a gateway
// being deployed is not stampeded the moment it says goodbye.
func TestTheGatewaysByeIsHonoured(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	sent := time.Now()
	if err := farm.Send(conn.NewFrame(conn.NewID(), conn.TypeBye, conn.ByePayload{
		Reason: conn.ByeServerShutdown, Detail: "deploying", ReconnectAfterMS: ptr(500),
	})); err != nil {
		t.Fatal(err)
	}
	h.until("the reconnection", func(o farmtest.Observed) bool { return len(o.Hellos) == 2 })
	if elapsed := time.Since(sent); elapsed < 500*time.Millisecond {
		t.Errorf("reconnected after %v, before the gateway's 500ms", elapsed)
	}
	h.logged("deploying")
}

// TestAProtocolViolationFromTheGatewayIsReportedAndReconnected asserts the agent judges
// the gateway by the same contract: a frame the gateway may not send ends the session
// with a bye saying why.
func TestAProtocolViolationFromTheGatewayIsReportedAndReconnected(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	// A heartbeat is the agent's to send, never the gateway's.
	if err := farm.Send(conn.NewFrame(conn.NewID(), conn.TypeHeartbeat, conn.HeartbeatPayload{
		SentAt: "2026-09-18T12:00:00.000Z", State: conn.StateIdle,
	})); err != nil {
		t.Fatal(err)
	}
	observed := h.until("the error bye and the reconnection", func(o farmtest.Observed) bool {
		return len(o.Byes) >= 1 && len(o.Hellos) >= 2
	})
	if observed.Byes[0].Reason != conn.ByeError || !strings.Contains(observed.Byes[0].Detail, "heartbeat") {
		t.Errorf("bye: %+v", observed.Byes[0])
	}
}

// TestOffersAreDeclinedAtOnceAndDrainIsReported covers the loop's answers to the
// gateway's other messages: an offer declined immediately with a true reason, and a
// drain reflected in the heartbeat until the undrain.
func TestOffersAreDeclinedAtOnceAndDrainIsReported(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	offer := func(expires time.Time) string {
		id := conn.NewID()
		if err := farm.Send(conn.NewFrame(id, conn.TypeJobOffer, map[string]any{
			"job": "job_01KE7J4EZ3204KQXMHJRPQPWQ6", "pool": "pool-a", "executor": "container",
			"image": "registry.example.invalid/build:1", "command": []string{"make"}, "workdir": "/workspace",
			"env": map[string]string{}, "repository": nil, "timeout_s": 60,
			"expires_at": expires.UTC().Format("2006-01-02T15:04:05.000Z"),
		})); err != nil {
			t.Fatal(err)
		}
		return id
	}

	first := offer(time.Now().Add(time.Minute))
	observed := h.until("the decline", func(o farmtest.Observed) bool { return len(o.Declines) == 1 })
	if d := observed.Declines[0]; d.Offer != first || d.Reason != conn.DeclineUnsupportedExecutor || !strings.Contains(d.Detail, "container") {
		t.Errorf("decline: %+v", d)
	}

	offer(time.Now().Add(-time.Second))
	observed = h.until("the expired decline", func(o farmtest.Observed) bool { return len(o.Declines) == 2 })
	if observed.Declines[1].Reason != conn.DeclineExpired {
		t.Errorf("an expired offer was declined as %s", observed.Declines[1].Reason)
	}

	if err := farm.Send(conn.NewFrame(conn.NewID(), conn.TypeDrain, conn.DrainPayload{
		Reason: "upgrade", DeadlineMS: 1000, Detail: "agent upgrade tonight",
	})); err != nil {
		t.Fatal(err)
	}
	h.until("a draining heartbeat", func(o farmtest.Observed) bool {
		return o.Heartbeats[len(o.Heartbeats)-1].State == conn.StateDraining
	})
	offer(time.Now().Add(time.Minute))
	observed = h.until("the draining decline", func(o farmtest.Observed) bool { return len(o.Declines) == 3 })
	if d := observed.Declines[2]; d.Reason != conn.DeclineDraining || !strings.Contains(d.Detail, "agent upgrade tonight") {
		t.Errorf("decline while draining: %+v", d)
	}

	if err := farm.Send(conn.NewFrame(conn.NewID(), conn.TypeUndrain, map[string]any{})); err != nil {
		t.Fatal(err)
	}
	h.until("an idle heartbeat again", func(o farmtest.Observed) bool {
		return o.Heartbeats[len(o.Heartbeats)-1].State == conn.StateIdle
	})
}

// TestBearerFallbackRequiresTheFlagAndIsReported is decision B3's fallback: a bearer
// identity will not start without the explicit flag, and with it the hello says so.
func TestBearerFallbackRequiresTheFlagAndIsReported(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.AllowBearerFallback()
	dir := enrolled(t, farm, true)

	logs := &logBuffer{}
	if _, err := New(config(farm, dir, logs)); err == nil || !strings.Contains(err.Error(), "--bearer-fallback") {
		t.Fatalf("expected the fallback to need its flag, got %v", err)
	}

	h := start(t, farm, dir, func(c *Config) { c.BearerFallback = true })
	observed := h.until("a bearer-fallback hello", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	if observed.Hellos[0].SecurityMode != conn.SecurityBearerFallback || observed.Transports[0] != "bearer" {
		t.Errorf("hello %q on transport %q", observed.Hellos[0].SecurityMode, observed.Transports[0])
	}
	h.logged("degraded")
	identity, _ := dir.LoadIdentity()
	if strings.Contains(h.logs.String(), identity.Bearer.Reveal()) {
		t.Error("the bearer secret reached the log")
	}
}

// TestAGatewayThatIsNotThereIsRetried asserts a control plane without the agent endpoint
// — a 404 — is a reason to keep trying, not to stop.
func TestAGatewayThatIsNotThereIsRetried(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	dir := enrolled(t, farm, false)
	h := start(t, farm, dir, func(c *Config) {
		wrong := *c.Server
		wrong.Path = "/nothing-here"
		c.Server = &wrong
	})

	h.logged("could not connect; retrying")
	deadline := time.Now().Add(wait)
	for strings.Count(h.logs.String(), "HTTP 404") < 2 {
		if time.Now().After(deadline) {
			t.Fatalf("expected repeated 404 retries:\n%s", h.logs)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := h.stop(); err != nil {
		t.Errorf("expected a clean stop, got %v", err)
	}
}

// TestAnExpiredCertificateIsNotPresented asserts an agent whose certificate expired
// while it was stopped says so, rather than failing a handshake with an alert about
// nothing in particular.
func TestAnExpiredCertificateIsNotPresented(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetCertificateLifetime(time.Second, 500*time.Millisecond)
	dir := enrolled(t, farm, false)
	time.Sleep(1200 * time.Millisecond)

	h := start(t, farm, dir, func(c *Config) { c.Renewer = nil })
	err := h.result()
	var fatal *FatalError
	if !errors.As(err, &fatal) || !strings.Contains(fatal.Reason, "expired") {
		t.Fatalf("expected a fatal expiry, got %v", err)
	}
	if farm.Observe().Connections != 0 {
		t.Error("an expired certificate was presented")
	}
}

// TestSendTerminalRefusesWhatIsNotATerminalFrame asserts the outbox holds only frames
// that are the gateway's to deduplicate.
func TestSendTerminalRefusesWhatIsNotATerminalFrame(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) {
		c.Backoff = Backoff{Base: time.Hour, Max: time.Hour}
	})
	if err := h.agent.SendTerminal(conn.NewFrame(conn.NewID(), conn.TypeHeartbeat, map[string]any{})); err == nil {
		t.Error("a heartbeat was queued as terminal")
	}
	if err := h.agent.SendTerminal(conn.NewFrame(conn.NewID(), conn.TypeJobFinish, map[string]any{})); err == nil {
		t.Error("an illegal job.finish was queued")
	}
}

// TestNewRefusesAnIncompleteConfiguration covers the arguments New checks.
func TestNewRefusesAnIncompleteConfiguration(t *testing.T) {
	if _, err := New(Config{}); err == nil {
		t.Error("expected a configuration with no state directory to be refused")
	}
	dir, err := state.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dir.Close() }()
	server, _ := url.Parse("https://ouroboros.example.invalid")
	if _, err := New(Config{Dir: dir, Server: server}); !errors.Is(err, state.ErrNotEnrolled) {
		t.Errorf("expected an unenrolled directory to be refused, got %v", err)
	}
}

// TestGatewayURL is the endpoint, under a base URL with and without a path.
func TestGatewayURL(t *testing.T) {
	for base, want := range map[string]string{
		"https://ouroboros.acme.dev":      "wss://ouroboros.acme.dev/api/v1/farm/agent",
		"https://ouroboros.acme.dev/":     "wss://ouroboros.acme.dev/api/v1/farm/agent",
		"https://acme.dev:8443/ouroboros": "wss://acme.dev:8443/ouroboros/api/v1/farm/agent",
	} {
		server, _ := url.Parse(base)
		if got := (&Agent{config: Config{Server: server}}).gatewayURL(); got != want {
			t.Errorf("%s: got %s, want %s", base, got, want)
		}
	}
	if "/"+GatewayPath != farmtest.GatewayPath {
		t.Errorf("the agent dials %s and the farm serves %s", GatewayPath, farmtest.GatewayPath)
	}
}

// waitForEmptyOutbox waits for the agent's outbox to drain after a receipt.
func waitForEmptyOutbox(t *testing.T, h *harness) {
	t.Helper()
	deadline := time.Now().Add(wait)
	for h.agent.outbox.Len() != 0 {
		if time.Now().After(deadline) {
			t.Fatalf("the outbox still holds %d frame(s)", h.agent.outbox.Len())
		}
		time.Sleep(10 * time.Millisecond)
	}
	entries, err := os.ReadDir(filepath.Join(h.dir.Path(), "outbox"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".frame") {
			t.Errorf("a receipted frame's file survived: %s", entry.Name())
		}
	}
}

// waitForSerialChange waits for runner.json to describe a different certificate.
func waitForSerialChange(t *testing.T, dir *state.Dir, serial string) state.Record {
	t.Helper()
	deadline := time.Now().Add(wait)
	for {
		record, err := dir.Record()
		if err == nil && record.Serial != serial {
			return record
		}
		if time.Now().After(deadline) {
			t.Fatalf("the certificate was not replaced")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func ptr(n int) *int { return &n }

// newLogger is the agent's text log, into a buffer a test can read.
func newLogger(logs *logBuffer) *slog.Logger {
	return slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
}
