// Package enroll is the agent's half of decision B3's chain: a token in, a
// certificate out, and a new certificate before the old one expires.
//
// Two HTTPS routes, both shipped by the control plane (AH.2, [#250]):
//
//	POST /api/v1/farm/registrations          authenticated by the enrollment token
//	POST /api/v1/farm/registrations/renewal  authenticated by the CLIENT CERTIFICATE
//
// The first spends the token. The token is single-use (or `max_uses`-use) and the
// control plane enforces that in the statement that spends it, so a second enrollment
// with the same token fails there — this package does not, and cannot, keep a token
// "unspent" by trying again.
//
// The second is how a certificate is replaced without a second token: the request is
// authenticated by the certificate it replaces, over mTLS. Which is also what makes a
// revocation final — a revoked certificate cannot renew its way back in.
//
// Every response is verified before it is saved: the CA's fingerprint is recomputed
// from the CA, the certificate must be over this agent's own key, issued by that CA for
// client authentication, and to the runner id the response names. A response that fails
// any of that is refused, and nothing is written.
//
// [#250]: https://github.com/NobuData/ouroboros/issues/250
package enroll

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/secret"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
)

// The control plane's paths, under its `/api/v1` prefix.
const (
	registrationsPath = "api/v1/farm/registrations"
	renewalPath       = "api/v1/farm/registrations/renewal"
)

// TokenPrefix is what every enrollment token begins with — the control plane's
// `TOKEN_PREFIX`, and the mockup's `orb_enroll_••••`.
const TokenPrefix = "orb_enroll_"

// The control plane's error codes this package tells apart.
const (
	// CodeEnrollmentRefused is the one answer to all six ways a token can fail: never
	// existed, wrong secret, expired, spent, revoked, or scoped to another pool.
	CodeEnrollmentRefused = "farm_enrollment_refused"
	// CodeIdentityRefused is a certificate that is not a live identity: unknown,
	// expired, superseded or revoked.
	CodeIdentityRefused = "farm_identity_refused"
	// CodeClientCertificateRequired is a renewal that arrived with no certificate —
	// most often a proxy that terminated TLS and did not pass it through.
	CodeClientCertificateRequired = "farm_client_certificate_required"
	// CodeFallbackNotPermitted is a bearer-fallback enrollment into a workspace that
	// requires certificates.
	CodeFallbackNotPermitted = "farm_bearer_fallback_not_permitted"
	// CodeRunnerNameTaken is a name this workspace already has. The token is not spent.
	CodeRunnerNameTaken = "runner_name_taken"
)

// DefaultTimeout bounds one request.
const DefaultTimeout = 60 * time.Second

// maxResponseBytes bounds what is read of a response. An enrollment response is a
// certificate, a CA and a few ids — a few kilobytes.
const maxResponseBytes = 1 << 20

// APIError is the control plane answering with an error envelope:
// `{code, message, details}`.
//
// Its message is safe to print. The control plane writes every agent-facing message for
// a human and never puts a secret, a stack or a constraint name in one; and the six
// ways a token can fail share one message on purpose, so this error cannot say which it
// was either — the control plane's audit trail can.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("the control plane answered HTTP %d %s", e.Status, http.StatusText(e.Status))
	}
	return fmt.Sprintf("the control plane refused it: HTTP %d %s — %s", e.Status, e.Code, e.Message)
}

// IsIdentityRefused reports whether an error is the control plane refusing this runner's
// certificate — the answer that means the identity is dead and must not be retried.
func IsIdentityRefused(err error) bool {
	var refused *APIError
	return errors.As(err, &refused) && refused.Code == CodeIdentityRefused
}

// Client calls the control plane's two agent routes.
type Client struct {
	// Server is the control plane's base URL. https:// only: the first request carries
	// a token and every later one is authenticated by a certificate.
	Server *url.URL
	// RootCAs verifies the control plane's certificate. Nil means the system's roots.
	RootCAs *x509.CertPool
	// UserAgent identifies the agent build.
	UserAgent string
	// Timeout bounds one request. Zero means [DefaultTimeout].
	Timeout time.Duration
}

// ParseServer reads a control plane URL and refuses anything that is not https://.
func ParseServer(raw string) (*url.URL, error) {
	server, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("read the server url: %w", err)
	}
	if server.Scheme != "https" || server.Host == "" {
		return nil, fmt.Errorf("the server must be an https:// url, not %q", raw)
	}
	if server.User != nil || server.RawQuery != "" || server.Fragment != "" {
		return nil, fmt.Errorf("the server url is a scheme, a host and an optional path: %q", raw)
	}
	return server, nil
}

// Request is everything an enrollment sends.
type Request struct {
	// Tenant is the workspace the operator is enrolling into. Recorded, not sent — the
	// token's own row names the workspace, and the route has no field for one.
	Tenant string
	// Pool is the pool the operator named. Sent, and checked by the control plane
	// against the token's scope: a token for pool-a refuses a request naming pool-b.
	Pool string
	// Token is the enrollment token. Presented once, never written anywhere.
	Token secret.Secret
	// Name is the runner's name, unique in its workspace.
	Name string
	// Arch is the machine's architecture, as the protocol names it.
	Arch string
	// AgentVersion is this build.
	AgentVersion string
	// Docker is whether a daemon is reachable, and CPUs how many cores there are —
	// `hello`'s answers, given early so the runner row has them before it connects.
	Docker bool
	CPUs   int
	// BearerFallback asks for decision B3's degraded mode. Only ever set by an explicit
	// flag.
	BearerFallback bool
}

// Validate refuses a request that the control plane would refuse, before the token is
// presented.
func (r Request) Validate() error {
	switch {
	case strings.TrimSpace(r.Tenant) == "":
		return errors.New("--tenant is required: the workspace this runner is being enrolled into")
	case !ValidName(r.Pool):
		return fmt.Errorf("--pool %q is not a pool name (a lower-case slug of at most 64 characters)", r.Pool)
	case !strings.HasPrefix(r.Token.Reveal(), TokenPrefix):
		return fmt.Errorf("--token is not an enrollment token (it begins %s)", TokenPrefix)
	case !ValidName(r.Name):
		return fmt.Errorf("--name %q is not a runner name (a lower-case slug of at most 64 characters)", r.Name)
	case r.Arch == "":
		return errors.New("no architecture")
	}
	return nil
}

// registrationBody is `RegisterRunnerDto`, the control plane's contract for the body.
type registrationBody struct {
	Token        string `json:"token"`
	Name         string `json:"name"`
	Arch         string `json:"arch"`
	Pool         string `json:"pool"`
	CSR          string `json:"csr,omitempty"`
	SecurityMode string `json:"securityMode"`
	AgentVersion string `json:"agentVersion,omitempty"`
	Docker       bool   `json:"docker"`
	CPUCount     int    `json:"cpuCount,omitempty"`
}

// authorityResource is the control plane's `AuthorityResource`: the public half of the
// farm CA.
type authorityResource struct {
	Certificate string `json:"certificate"`
	Fingerprint string `json:"fingerprint"`
}

// enrollmentResource is the control plane's `EnrollmentResource`.
type enrollmentResource struct {
	RunnerID     string            `json:"runnerId"`
	Name         string            `json:"name"`
	PoolID       string            `json:"poolId"`
	SecurityMode conn.SecurityMode `json:"securityMode"`
	Certificate  *string           `json:"certificate"`
	Serial       *string           `json:"serial"`
	RenewAfter   *time.Time        `json:"renewAfter"`
	BearerToken  *secret.Secret    `json:"bearerToken"`
	Authority    authorityResource `json:"authority"`
}

// renewalResource is the control plane's `RenewalResource`.
type renewalResource struct {
	Certificate string            `json:"certificate"`
	Serial      string            `json:"serial"`
	RenewAfter  time.Time         `json:"renewAfter"`
	Authority   authorityResource `json:"authority"`
}

// Register enrols this machine and returns what to save.
//
// In mTLS mode it generates the key first, sends only its public half, and verifies
// that the certificate that comes back is over that key before returning the pair. In
// bearer-fallback mode there is no key; the control plane returns a secret instead, and
// still returns the CA — the agent verifies the gateway either way.
func (c *Client) Register(ctx context.Context, request Request) (state.Enrollment, error) {
	if err := request.Validate(); err != nil {
		return state.Enrollment{}, err
	}

	body := registrationBody{
		Token:        request.Token.Reveal(),
		Name:         request.Name,
		Arch:         request.Arch,
		Pool:         request.Pool,
		SecurityMode: string(conn.SecurityMTLS),
		AgentVersion: request.AgentVersion,
		Docker:       request.Docker,
		CPUCount:     request.CPUs,
	}

	var key *ecdsa.PrivateKey
	if request.BearerFallback {
		body.SecurityMode = string(conn.SecurityBearerFallback)
	} else {
		var err error
		if key, err = newKey(); err != nil {
			return state.Enrollment{}, err
		}
		if body.CSR, err = certificateRequest(key, request.Name); err != nil {
			return state.Enrollment{}, err
		}
	}

	var response enrollmentResource
	if err := c.post(ctx, registrationsPath, body, nil, &response); err != nil {
		return state.Enrollment{}, err
	}

	authority, err := verifyAuthority(response.Authority)
	if err != nil {
		return state.Enrollment{}, err
	}
	now := time.Now().UTC()
	record := state.Record{
		RunnerID:             response.RunnerID,
		Name:                 response.Name,
		Tenant:               request.Tenant,
		Pool:                 request.Pool,
		PoolID:               response.PoolID,
		Server:               c.Server.String(),
		SecurityMode:         response.SecurityMode,
		AuthorityPEM:         response.Authority.Certificate,
		AuthorityFingerprint: response.Authority.Fingerprint,
		EnrolledAt:           now,
	}

	if request.BearerFallback {
		if response.SecurityMode != conn.SecurityBearerFallback || response.BearerToken == nil || response.BearerToken.Empty() {
			return state.Enrollment{}, errors.New("asked for the bearer fallback and was not given a bearer secret")
		}
		return state.Enrollment{Record: record, Bearer: *response.BearerToken}, nil
	}

	if response.SecurityMode != conn.SecurityMTLS || response.Certificate == nil || response.Serial == nil || response.RenewAfter == nil {
		return state.Enrollment{}, errors.New("asked for a certificate and was not given one")
	}
	leaf, err := verifyIssued(*response.Certificate, key, authority, response.RunnerID, *response.Serial)
	if err != nil {
		return state.Enrollment{}, err
	}
	combined, err := identityPEM(*response.Certificate, key)
	if err != nil {
		return state.Enrollment{}, err
	}
	record.Serial = state.SerialHex(leaf)
	record.NotAfter = leaf.NotAfter.UTC()
	record.RenewAfter = response.RenewAfter.UTC()
	return state.Enrollment{Record: record, IdentityPEM: combined}, nil
}

// Renewal is a renewed identity, ready to save.
type Renewal struct {
	Record      state.Record
	IdentityPEM []byte
	// AuthorityRotated is true when the control plane returned a different CA from the
	// pinned one — how a rotated authority reaches a fleet. Worth a log line: the pin
	// changed.
	AuthorityRotated bool
}

// Renew replaces a certificate that is nearing expiry, over mTLS with the certificate
// being replaced. No token: a runner enrolled once never needs a second.
func (c *Client) Renew(ctx context.Context, identity state.Identity) (Renewal, error) {
	if identity.Record.SecurityMode != conn.SecurityMTLS {
		return Renewal{}, errors.New("only a certificate is renewed; a bearer-fallback runner has none")
	}
	key, err := newKey()
	if err != nil {
		return Renewal{}, err
	}
	requestPEM, err := certificateRequest(key, identity.Record.Name)
	if err != nil {
		return Renewal{}, err
	}

	var response renewalResource
	if err := c.post(ctx, renewalPath, map[string]string{"csr": requestPEM}, &identity.Certificate, &response); err != nil {
		return Renewal{}, err
	}

	authority, err := verifyAuthority(response.Authority)
	if err != nil {
		return Renewal{}, err
	}
	leaf, err := verifyIssued(response.Certificate, key, authority, identity.Record.RunnerID, response.Serial)
	if err != nil {
		return Renewal{}, err
	}
	combined, err := identityPEM(response.Certificate, key)
	if err != nil {
		return Renewal{}, err
	}

	record := identity.Record
	record.Serial = state.SerialHex(leaf)
	record.NotAfter = leaf.NotAfter.UTC()
	record.RenewAfter = response.RenewAfter.UTC()
	record.RenewedAt = time.Now().UTC()
	rotated := response.Authority.Fingerprint != identity.Record.AuthorityFingerprint
	record.AuthorityPEM = response.Authority.Certificate
	record.AuthorityFingerprint = response.Authority.Fingerprint
	return Renewal{Record: record, IdentityPEM: combined, AuthorityRotated: rotated}, nil
}

// post sends one JSON request and reads one JSON response, presenting a client
// certificate when one is given.
func (c *Client) post(ctx context.Context, path string, body any, certificate *tls.Certificate, into any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode the request: %w", err)
	}

	config := &tls.Config{RootCAs: c.RootCAs, MinVersion: tls.VersionTLS12}
	if certificate != nil {
		config.Certificates = []tls.Certificate{*certificate}
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig:   config,
			ForceAttemptHTTP2: false,
			// Direct, like the gateway connection: the enrollment and the connection
			// it enables should reach the control plane by the same route.
			Proxy: nil,
		},
		// A redirect would re-send a token or a certificate-authenticated request to
		// wherever a Location header pointed. Neither route redirects, so none is
		// followed.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	defer client.CloseIdleConnections()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Server.JoinPath(path).String(), bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if c.UserAgent != "" {
		request.Header.Set("User-Agent", c.UserAgent)
	}

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("reach the control plane at %s: %w", c.Server.Redacted(), err)
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("read the control plane's answer: %w", err)
	}

	if response.StatusCode < 200 || response.StatusCode > 299 {
		refused := &APIError{Status: response.StatusCode}
		var envelope struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(raw, &envelope) == nil {
			refused.Code, refused.Message = envelope.Code, envelope.Message
		}
		return refused
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("read the control plane's answer: %w", err)
	}
	return nil
}

// verifyAuthority parses the returned CA and recomputes its fingerprint — the pin is
// only worth keeping if it is the CA's own.
func verifyAuthority(resource authorityResource) (*x509.Certificate, error) {
	authority, err := state.ParseAuthority(resource.Certificate)
	if err != nil {
		return nil, err
	}
	if got := state.Fingerprint(authority); got != strings.ToLower(resource.Fingerprint) {
		return nil, fmt.Errorf("the farm CA's fingerprint is %s, not the %s the control plane named", got, resource.Fingerprint)
	}
	return authority, nil
}

// verifyIssued checks an issued certificate is the one that was asked for: over this
// agent's key, by the CA, for client authentication, to the runner the response names,
// with the serial it names.
func verifyIssued(certificatePEM string, key *ecdsa.PrivateKey, authority *x509.Certificate, runnerID, serial string) (*x509.Certificate, error) {
	block, _ := pem.Decode([]byte(certificatePEM))
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("the issued certificate is not a PEM certificate")
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("read the issued certificate: %w", err)
	}

	public, ok := leaf.PublicKey.(*ecdsa.PublicKey)
	if !ok || !public.Equal(&key.PublicKey) {
		return nil, errors.New("the issued certificate is not over this agent's key")
	}
	roots := x509.NewCertPool()
	roots.AddCert(authority)
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:     roots,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		return nil, fmt.Errorf("the issued certificate does not verify against the farm CA: %w", err)
	}
	if leaf.Subject.CommonName != runnerID {
		return nil, fmt.Errorf("the issued certificate names runner %q, not %q", leaf.Subject.CommonName, runnerID)
	}
	if !strings.EqualFold(state.SerialHex(leaf), serial) {
		return nil, fmt.Errorf("the issued certificate's serial is %s, not the %s the control plane named", state.SerialHex(leaf), serial)
	}
	return leaf, nil
}
