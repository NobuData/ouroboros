package farmtest

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/ws"
)

// discardLogger swallows the test server's own log lines.
func discardLogger() *log.Logger { return log.New(io.Discard, "", 0) }

// helloTimeout is how long the farm waits for the first frame.
const helloTimeout = 5 * time.Second

// gateway is GET /api/v1/farm/agent: authenticate the transport, upgrade, read the
// hello, answer it, and then play the gateway's half of the session — heartbeats,
// terminal frames and their receipts, declines, and bye.
//
// Every frame it reads is judged by conn.Decode and by direction. A frame the contract
// refuses is recorded as a violation and ends the connection, so a suite passing against
// this farm is a suite whose agent wrote only frames the protocol allows.
func (f *Farm) gateway(w http.ResponseWriter, r *http.Request) {
	transport, ok := f.authenticate(w, r)
	if !ok {
		return
	}

	agent, err := ws.Upgrade(w, r)
	if err != nil {
		return
	}
	defer func() { _ = agent.Close() }()

	f.mu.Lock()
	if f.current != nil {
		_ = f.current.Close() // a second connection from the runner replaces the first
	}
	f.current = agent
	f.observed.Connections++
	f.notifyLocked()
	f.mu.Unlock()

	hello, ok := f.readHello(agent)
	if !ok {
		return
	}

	f.mu.Lock()
	refusal := f.refuseNext
	f.refuseNext = nil
	if refusal == nil && f.refusal == RefuseWithFrame && transport.serial != "" && !f.liveLocked(transport.serial) {
		f.observed.Refused = append(f.observed.Refused, "frame:"+transport.serial)
		refusal = &conn.RefusePayload{Code: conn.RefuseIdentityRevoked, Detail: "this runner's certificate has been revoked"}
	}
	f.observed.Hellos = append(f.observed.Hellos, hello)
	f.observed.Transports = append(f.observed.Transports, transport.mode)
	f.notifyLocked()
	f.mu.Unlock()

	if refusal != nil {
		_ = f.write(agent, conn.TypeRefuse, *refusal)
		_ = agent.WriteClose(ws.CloseNormal, "refused")
		return
	}

	if !f.acknowledge(agent, hello, transport.runnerID) {
		return
	}
	f.serve(agent)
}

// transport is what the connection proved before a single frame: which runner, and how.
type transport struct {
	runnerID string
	serial   string
	mode     string
}

// authenticate reads the connection's identity — the client certificate, or in the
// fallback the bearer secret on the upgrade request — and answers 401 for anything
// else.
func (f *Farm) authenticate(w http.ResponseWriter, r *http.Request) (transport, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	defer f.notifyLocked()

	if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
		serial := Serial(r.TLS.PeerCertificates[0])
		certificate, known := f.certificates[serial]
		if !known || (f.refusal == RefuseWithStatus && !f.liveLocked(serial)) {
			f.observed.Refused = append(f.observed.Refused, "status:"+serial)
			writeError(w, http.StatusUnauthorized, "farm_identity_refused", "This certificate is not a live runner identity.")
			return transport{}, false
		}
		return transport{runnerID: certificate.runnerID, serial: serial, mode: "mtls"}, true
	}

	if bearer, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		if runnerID, known := f.bearers[bearer]; known {
			return transport{runnerID: runnerID, mode: "bearer"}, true
		}
	}
	f.observed.Refused = append(f.observed.Refused, "no-identity")
	writeError(w, http.StatusUnauthorized, "farm_client_certificate_required",
		"This endpoint is authenticated by the runner's client certificate, and none was presented.")
	return transport{}, false
}

// readHello reads the first frame, which must be a legal hello.
func (f *Farm) readHello(agent *ws.Conn) (conn.HelloPayload, bool) {
	_ = agent.SetReadDeadline(time.Now().Add(helloTimeout))
	envelope, _, ok := f.read(agent)
	_ = agent.SetReadDeadline(time.Time{})
	if !ok {
		return conn.HelloPayload{}, false
	}
	if envelope.Type != conn.TypeHello {
		f.violation(agent, fmt.Sprintf("the first frame was %s, not hello", envelope.Type))
		return conn.HelloPayload{}, false
	}
	var hello conn.HelloPayload
	if err := envelope.Into(&hello); err != nil {
		f.violation(agent, err.Error())
		return conn.HelloPayload{}, false
	}
	return hello, true
}

// acknowledge answers a hello: the session it resumes if the farm still holds it, or a
// new one.
func (f *Farm) acknowledge(agent *ws.Conn, hello conn.HelloPayload, runnerID string) bool {
	f.mu.Lock()
	session, resumed := "", false
	if hello.Resume != "" && f.sessions[hello.Resume] == runnerID {
		session, resumed = hello.Resume, true
	} else {
		session = "sess_" + conn.NewID()
		f.sessions[session] = runnerID
	}
	pool := f.runners[runnerID].pool
	limits := f.limits
	f.mu.Unlock()

	return f.write(agent, conn.TypeAck, conn.AckPayload{
		Session:  session,
		Protocol: conn.Version,
		Resumed:  resumed,
		Runner:   conn.AckRunner{ID: "rnr_" + conn.NewID(), Name: hello.Hostname, Pool: pool},
		Limits:   limits,
	}) == nil
}

// serve is the rest of the session.
func (f *Farm) serve(agent *ws.Conn) {
	for {
		envelope, raw, ok := f.read(agent)
		if !ok {
			return
		}
		switch envelope.Type {
		case conn.TypeHeartbeat:
			var heartbeat conn.HeartbeatPayload
			_ = envelope.Into(&heartbeat)
			f.record(func(o *Observed) { o.Heartbeats = append(o.Heartbeats, heartbeat) })

		case conn.TypeJobFinish:
			if !f.finish(agent, envelope, raw) {
				return
			}

		case conn.TypeJobDecline:
			var decline conn.JobDeclinePayload
			_ = envelope.Into(&decline)
			f.record(func(o *Observed) { o.Declines = append(o.Declines, decline) })

		case conn.TypeBye:
			var bye conn.ByePayload
			_ = envelope.Into(&bye)
			f.record(func(o *Observed) { o.Byes = append(o.Byes, bye) })
			_ = agent.WriteClose(ws.CloseNormal, "")
			return

		case conn.TypeHello:
			f.violation(agent, "a second hello on one connection")
			return

		default:
			// job.accept, job.start, job.progress and log.chunk are the executors'
			// (#246, #247). This build writes none of them.
			f.violation(agent, fmt.Sprintf("an unexpected %s", envelope.Type))
			return
		}
	}
}

// finish records a terminal frame in the ledger, and then answers it — or, when a test
// asked for the drop, kills the socket instead: RECORDED and never receipted, which is
// exactly the case where only the agent's re-send and the ledger's dedup stand between
// one finished job and two.
func (f *Farm) finish(agent *ws.Conn, envelope *conn.Envelope, raw []byte) bool {
	duplicate := f.ledger.Record(envelope.ID)

	f.mu.Lock()
	f.observed.Finishes = append(f.observed.Finishes, envelope.ID)
	f.observed.FinishFrames = append(f.observed.FinishFrames, raw)
	if duplicate {
		f.observed.Duplicates++
	}
	drop := f.dropOnFinish > 0
	if drop {
		f.dropOnFinish--
	}
	f.notifyLocked()
	f.mu.Unlock()

	if drop {
		_ = agent.Close()
		return false
	}
	return f.write(agent, conn.TypeReceipt, conn.ReceiptPayload{
		Of: envelope.ID, OfType: string(conn.TypeJobFinish), Duplicate: duplicate,
	}) == nil
}

// read reads and judges one frame from the agent, returning it decoded and as the exact
// bytes that arrived.
func (f *Farm) read(agent *ws.Conn) (*conn.Envelope, []byte, bool) {
	raw, err := agent.ReadMessage()
	if err != nil {
		return nil, nil, false
	}
	envelope, diags := conn.Decode(raw)
	if len(diags) > 0 {
		f.violation(agent, fmt.Sprintf("an illegal frame: %v", diags))
		return nil, nil, false
	}
	if !envelope.Type.SentBy(conn.FromAgent) {
		f.violation(agent, fmt.Sprintf("%s is not the agent's to send", envelope.Type))
		return nil, nil, false
	}
	return envelope, raw, true
}

// write sends one frame from the gateway.
func (f *Farm) write(agent *ws.Conn, messageType conn.Type, payload any) error {
	encoded, err := conn.Encode(conn.NewFrame(conn.NewID(), messageType, payload))
	if err != nil {
		return err
	}
	return agent.WriteText(encoded)
}

// violation records a frame the contract refuses and closes the connection.
func (f *Farm) violation(agent *ws.Conn, what string) {
	f.record(func(o *Observed) { o.Violations = append(o.Violations, what) })
	_ = agent.WriteClose(ws.CloseProtocolError, "protocol violation")
}

// record changes the observations and wakes every waiter.
func (f *Farm) record(change func(*Observed)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	change(&f.observed)
	f.notifyLocked()
}
