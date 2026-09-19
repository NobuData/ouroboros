package farmtest

import (
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/ws"
)

// The control plane's paths. Restated rather than imported from the agent, so that a
// suite comparing the two is comparing two sources.
const (
	RegistrationsPath = "/api/v1/farm/registrations"
	RenewalPath       = "/api/v1/farm/registrations/renewal"
	GatewayPath       = "/api/v1/farm/agent"
)

// Refusal is how the farm refuses a certificate that is not a live identity. The
// control plane's gateway has not been written, so the agent is tested against every
// shape a refusal can plausibly take.
type Refusal int

const (
	// RefuseAtHandshake answers with a TLS alert — the certificate never gets as far as
	// HTTP. The farm's default, and what a gateway checking revocation in its TLS
	// layer does.
	RefuseAtHandshake Refusal = iota
	// RefuseWithStatus lets the handshake finish and answers the request with 401 and
	// `farm_identity_refused` — what the shipped renewal route does.
	RefuseWithStatus
	// RefuseWithFrame completes the upgrade and answers the hello with
	// `refuse identity.revoked` — the protocol's own refusal.
	RefuseWithFrame
)

// Farm is an in-process control plane: the farm CA, the two enrollment routes, and the
// agent gateway, on one loopback TLS server.
type Farm struct {
	// CA is the workspace's farm CA.
	CA *CA
	// URL is the control plane's base URL, https://127.0.0.1:<port>.
	URL string

	server *httptest.Server

	mu            sync.Mutex
	changed       chan struct{}
	tokens        map[string]*token
	runners       map[string]*runner
	certificates  map[string]*issued
	bearers       map[string]string
	sessions      map[string]string
	ledger        *conn.Ledger
	observed      Observed
	current       *ws.Conn
	allowFallback bool
	refusal       Refusal
	refuseNext    *conn.RefusePayload
	dropOnFinish  int
	limits        conn.Limits
	pool          *conn.AckPool
	ttl           time.Duration
	lead          time.Duration
}

// token is one enrollment token's row.
type token struct {
	pool string
	uses int
}

// runner is one enrolled runner's row.
type runner struct {
	id, name, pool string
}

// issued is one certificate's row.
type issued struct {
	runnerID   string
	revoked    bool
	superseded bool
}

// Observed is everything the farm has seen, for a test to assert on.
type Observed struct {
	Enrollments int
	Renewals    int
	Connections int
	// Hellos is every hello accepted, in order, and Transports how each connection was
	// authenticated — "mtls" or "bearer" — so a hello's claim can be checked against
	// the transport's fact.
	Hellos     []conn.HelloPayload
	Transports []string
	Heartbeats []conn.HeartbeatPayload
	// Finishes is the envelope id of every job.finish received, duplicates included,
	// and FinishFrames the exact bytes.
	Finishes     []string
	FinishFrames [][]byte
	// Recorded is how many distinct terminal frames the ledger holds — finished jobs —
	// and Duplicates how many re-sends it answered with `duplicate: true`.
	Recorded   int
	Duplicates int
	Declines   []conn.JobDeclinePayload
	// Accepts, Starts and Progress are the executors' frames (#246), and JobFrames the type
	// of every job frame in the order it arrived — accept, start, progress, finish and
	// decline — so a test can assert the sequence the protocol requires.
	Accepts   []conn.JobAcceptPayload
	Starts    []conn.JobStartPayload
	Progress  []conn.JobProgressPayload
	JobFrames []conn.Type
	Byes      []conn.ByePayload
	// Violations is every frame the farm refused, and why.
	Violations []string
	// Refused is every identity refusal the farm answered.
	Refused []string
}

// NewFarm starts a farm on a loopback port and stops it at the end of the test.
func NewFarm(tb interface {
	Helper()
	Fatalf(string, ...any)
	Cleanup(func())
}) *Farm {
	tb.Helper()
	ca, err := NewCA("org_farmtest")
	if err != nil {
		tb.Fatalf("farmtest: %v", err)
	}
	farm := &Farm{
		CA:           ca,
		changed:      make(chan struct{}),
		tokens:       map[string]*token{},
		runners:      map[string]*runner{},
		certificates: map[string]*issued{},
		bearers:      map[string]string{},
		sessions:     map[string]string{},
		ledger:       conn.NewLedger(),
		ttl:          90 * 24 * time.Hour,
		lead:         30 * 24 * time.Hour,
		limits: conn.Limits{
			HeartbeatIntervalMS: 1000,
			HeartbeatJitterMS:   0,
			LogChunkMaxBytes:    32768,
			LogRateBytesPerS:    262144,
			OfferAckMS:          5000,
			ResumeWindowMS:      300000,
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST "+RegistrationsPath, farm.register)
	mux.HandleFunc("POST "+RenewalPath, farm.renew)
	mux.HandleFunc("GET "+GatewayPath, farm.gateway)

	farm.server = httptest.NewUnstartedServer(mux)
	farm.server.TLS = &tls.Config{
		MinVersion: tls.VersionTLS12,
		ClientAuth: tls.VerifyClientCertIfGiven,
		ClientCAs:  ca.Pool(),
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return nil
			}
			serial := Serial(state.PeerCertificates[0])
			farm.mu.Lock()
			defer farm.mu.Unlock()
			if farm.refusal == RefuseAtHandshake && !farm.liveLocked(serial) {
				farm.observed.Refused = append(farm.observed.Refused, "tls:"+serial)
				farm.notifyLocked()
				return errors.New("not a live runner identity")
			}
			return nil
		},
	}
	// The farm's server log would otherwise print every refused handshake — which is
	// the point of several tests, not a problem with them.
	farm.server.Config.ErrorLog = discardLogger()
	farm.server.StartTLS()
	farm.URL = farm.server.URL

	tb.Cleanup(farm.Close)
	return farm
}

// Close stops the farm.
func (f *Farm) Close() {
	f.mu.Lock()
	if f.current != nil {
		_ = f.current.Close()
	}
	f.mu.Unlock()
	f.server.CloseClientConnections()
	f.server.Close()
}

// ServerRoots is a pool trusting the farm's TLS certificate — the agent's `--server-ca`.
func (f *Farm) ServerRoots() *x509.CertPool {
	pool := x509.NewCertPool()
	pool.AddCert(f.server.Certificate())
	return pool
}

// WriteServerCA writes the farm's TLS certificate to a file, for a subprocess agent's
// `--server-ca`.
func (f *Farm) WriteServerCA(path string) error {
	block := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: f.server.Certificate().Raw})
	return os.WriteFile(path, block, 0o600)
}

// MintToken issues an enrollment token for a pool, good for the given number of uses.
func (f *Farm) MintToken(pool string, uses int) string {
	id := make([]byte, 16)
	secretBytes := make([]byte, 32)
	_, _ = rand.Read(id)
	_, _ = rand.Read(secretBytes)
	value := "orb_enroll_" + hex.EncodeToString(id) + "." + hex.EncodeToString(secretBytes)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tokens[value] = &token{pool: pool, uses: uses}
	return value
}

// AllowBearerFallback switches the workspace's `runner_bearer_fallback` setting on.
func (f *Farm) AllowBearerFallback() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.allowFallback = true
}

// SetCertificateLifetime changes how long issued certificates live and how long before
// expiry the agent is told to renew — a short-TTL test certificate.
func (f *Farm) SetCertificateLifetime(ttl, lead time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ttl, f.lead = ttl, lead
}

// SetLimits changes the operating values the next ack sends.
func (f *Farm) SetLimits(limits conn.Limits) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.limits = limits
}

// SetPool changes the pool policy the next ack names (#246). Nil — the default — sends an
// ack with no `pool` at all, which is what an agent must read as the column defaults.
func (f *Farm) SetPool(pool *conn.AckPool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pool = pool
}

// SetRefusal changes how a dead identity is refused.
func (f *Farm) SetRefusal(refusal Refusal) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refusal = refusal
}

// RefuseNextHello answers the next hello with a refusal instead of an ack.
func (f *Farm) RefuseNextHello(refusal conn.RefusePayload) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refuseNext = &refusal
}

// DropOnFinish makes the next n job.finish frames be RECORDED and then answered with a
// dead socket instead of a receipt — the drop the whole resume design exists for.
func (f *Farm) DropOnFinish(n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.dropOnFinish = n
}

// ForgetSessions makes the farm lose every session, as a gateway restart that kept
// nothing would — the next hello naming one gets `resumed: false`.
func (f *Farm) ForgetSessions() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sessions = map[string]string{}
}

// RevokeRunner revokes every certificate a runner holds.
func (f *Farm) RevokeRunner(runnerID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, certificate := range f.certificates {
		if certificate.runnerID == runnerID {
			certificate.revoked = true
		}
	}
}

// RunnerIDs is every enrolled runner's id.
func (f *Farm) RunnerIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	ids := make([]string, 0, len(f.runners))
	for id := range f.runners {
		ids = append(ids, id)
	}
	return ids
}

// Send writes a frame to the connected agent.
func (f *Farm) Send(frame conn.Frame) error {
	encoded, err := conn.Encode(frame)
	if err != nil {
		return err
	}
	f.mu.Lock()
	current := f.current
	f.mu.Unlock()
	if current == nil {
		return errors.New("no agent is connected")
	}
	return current.WriteText(encoded)
}

// Drop kills the agent's connection without a word — a network that went away, or a
// gateway process that died.
func (f *Farm) Drop() {
	f.mu.Lock()
	current := f.current
	f.current = nil
	f.mu.Unlock()
	if current != nil {
		_ = current.Close()
	}
}

// Observe is a copy of everything seen so far.
func (f *Farm) Observe() Observed {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.snapshotLocked()
}

// WaitFor blocks until the condition holds of what the farm has seen, or the timeout
// passes. It returns the last observation and whether the condition held.
func (f *Farm) WaitFor(timeout time.Duration, condition func(Observed) bool) (Observed, bool) {
	deadline := time.After(timeout)
	for {
		f.mu.Lock()
		observed := f.snapshotLocked()
		changed := f.changed
		f.mu.Unlock()
		if condition(observed) {
			return observed, true
		}
		select {
		case <-changed:
		case <-deadline:
			return observed, false
		}
	}
}

// snapshotLocked copies the observations. The caller holds mu.
func (f *Farm) snapshotLocked() Observed {
	observed := f.observed
	observed.Hellos = append([]conn.HelloPayload(nil), f.observed.Hellos...)
	observed.Transports = append([]string(nil), f.observed.Transports...)
	observed.Heartbeats = append([]conn.HeartbeatPayload(nil), f.observed.Heartbeats...)
	observed.Finishes = append([]string(nil), f.observed.Finishes...)
	observed.FinishFrames = append([][]byte(nil), f.observed.FinishFrames...)
	observed.Declines = append([]conn.JobDeclinePayload(nil), f.observed.Declines...)
	observed.Accepts = append([]conn.JobAcceptPayload(nil), f.observed.Accepts...)
	observed.Starts = append([]conn.JobStartPayload(nil), f.observed.Starts...)
	observed.Progress = append([]conn.JobProgressPayload(nil), f.observed.Progress...)
	observed.JobFrames = append([]conn.Type(nil), f.observed.JobFrames...)
	observed.Byes = append([]conn.ByePayload(nil), f.observed.Byes...)
	observed.Violations = append([]string(nil), f.observed.Violations...)
	observed.Refused = append([]string(nil), f.observed.Refused...)
	observed.Recorded = f.ledger.Len()
	return observed
}

// notifyLocked wakes every WaitFor. The caller holds mu.
func (f *Farm) notifyLocked() {
	close(f.changed)
	f.changed = make(chan struct{})
}

// liveLocked reports whether a serial is a live identity. The caller holds mu.
func (f *Farm) liveLocked(serial string) bool {
	certificate, known := f.certificates[serial]
	return known && !certificate.revoked && !certificate.superseded
}

// writeError answers with the control plane's error envelope.
func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": code, "message": message, "details": map[string]any{}})
}

// writeJSON answers 201 with a resource.
func writeJSON(w http.ResponseWriter, resource any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(resource)
}

// timestamp is the control plane's ISO 8601 spelling.
func timestamp(at time.Time) string { return at.UTC().Format("2006-01-02T15:04:05.000Z") }

// newUUID is a random version-4 UUID — the shape of a runner row's id.
func newUUID() string {
	var raw [16]byte
	_, _ = rand.Read(raw[:])
	raw[6] = raw[6]&0x0f | 0x40
	raw[8] = raw[8]&0x3f | 0x80
	text := hex.EncodeToString(raw[:])
	return strings.Join([]string{text[:8], text[8:12], text[12:16], text[16:20], text[20:]}, "-")
}

// authority is the farm CA as the control plane returns it.
func (f *Farm) authority() map[string]string {
	return map[string]string{
		"certificate": f.CA.PEM,
		"fingerprint": f.CA.Fingerprint(),
		"notBefore":   timestamp(f.CA.Certificate.NotBefore),
		"notAfter":    timestamp(f.CA.Certificate.NotAfter),
	}
}

// register is POST /api/v1/farm/registrations.
func (f *Farm) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token        string `json:"token"`
		Name         string `json:"name"`
		Arch         string `json:"arch"`
		Pool         string `json:"pool"`
		CSR          string `json:"csr"`
		SecurityMode string `json:"securityMode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_request", "The body is not JSON.")
		return
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	defer f.notifyLocked()

	row, known := f.tokens[body.Token]
	if !known || row.uses < 1 || (body.Pool != "" && body.Pool != row.pool) {
		writeError(w, http.StatusUnauthorized, "farm_enrollment_refused", "This enrollment token cannot be used.")
		return
	}
	for _, existing := range f.runners {
		if existing.name == body.Name {
			writeError(w, http.StatusConflict, "runner_name_taken",
				fmt.Sprintf("A runner named %s is already enrolled in this workspace.", body.Name))
			return
		}
	}

	runnerID := newUUID()
	resource := map[string]any{
		"runnerId": runnerID, "name": body.Name, "poolId": "pool-" + row.pool,
		"authority": f.authority(),
	}

	if body.SecurityMode == string(conn.SecurityBearerFallback) {
		if !f.allowFallback {
			writeError(w, http.StatusForbidden, "farm_bearer_fallback_not_permitted",
				"This workspace requires runners to enrol with a client certificate.")
			return
		}
		bearer := make([]byte, 32)
		_, _ = rand.Read(bearer)
		value := "orb_bearer_" + hex.EncodeToString(bearer)
		f.bearers[value] = runnerID
		resource["securityMode"] = "bearer_fallback"
		resource["certificate"], resource["serial"], resource["notAfter"], resource["renewAfter"] = nil, nil, nil, nil
		resource["bearerToken"] = value
	} else {
		now := time.Now()
		leaf, certificatePEM, err := f.CA.SignRequest(body.CSR, runnerID, now.Add(-5*time.Minute), now.Add(f.ttl))
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, "farm_invalid_csr", err.Error())
			return
		}
		f.certificates[Serial(leaf)] = &issued{runnerID: runnerID}
		resource["securityMode"] = "mtls"
		resource["certificate"] = certificatePEM
		resource["serial"] = Serial(leaf)
		resource["notAfter"] = timestamp(leaf.NotAfter)
		resource["renewAfter"] = timestamp(leaf.NotAfter.Add(-f.lead))
		resource["bearerToken"] = nil
	}

	row.uses--
	f.runners[runnerID] = &runner{id: runnerID, name: body.Name, pool: row.pool}
	f.observed.Enrollments++
	writeJSON(w, resource)
}

// renew is POST /api/v1/farm/registrations/renewal — authenticated by the certificate
// being replaced, and by nothing else.
func (f *Farm) renew(w http.ResponseWriter, r *http.Request) {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
		writeError(w, http.StatusUnauthorized, "farm_client_certificate_required",
			"This endpoint is authenticated by the runner's client certificate, and none was presented.")
		return
	}
	var body struct {
		CSR string `json:"csr"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_request", "The body is not JSON.")
		return
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	defer f.notifyLocked()

	serial := Serial(r.TLS.PeerCertificates[0])
	if !f.liveLocked(serial) {
		f.observed.Refused = append(f.observed.Refused, "renewal:"+serial)
		writeError(w, http.StatusUnauthorized, "farm_identity_refused", "This certificate is not a live runner identity.")
		return
	}
	runnerID := f.certificates[serial].runnerID
	now := time.Now()
	leaf, certificatePEM, err := f.CA.SignRequest(body.CSR, runnerID, now.Add(-5*time.Minute), now.Add(f.ttl))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "farm_invalid_csr", err.Error())
		return
	}
	f.certificates[serial].superseded = true
	f.certificates[Serial(leaf)] = &issued{runnerID: runnerID}
	f.observed.Renewals++
	writeJSON(w, map[string]any{
		"certificate": certificatePEM,
		"serial":      Serial(leaf),
		"notAfter":    timestamp(leaf.NotAfter),
		"renewAfter":  timestamp(leaf.NotAfter.Add(-f.lead)),
		"authority":   f.authority(),
	})
}
