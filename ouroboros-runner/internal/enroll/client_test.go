package enroll

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/secret"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
)

// client is an enrollment client pointed at a farm.
func client(t *testing.T, farm *farmtest.Farm) *Client {
	t.Helper()
	server, err := ParseServer(farm.URL)
	if err != nil {
		t.Fatal(err)
	}
	return &Client{Server: server, RootCAs: farm.ServerRoots(), UserAgent: "ouroboros-runner/test"}
}

// request is an enrollment request for the farm's pool-a.
func request(token, name string) Request {
	return Request{
		Tenant: "acme-robotics", Pool: "pool-a", Token: secret.Secret(token), Name: name,
		Arch: "linux/x86_64", AgentVersion: "0.2.0", Docker: true, CPUs: 8,
	}
}

// TestEnrollmentIssuesAVerifiedIdentity is the chain end to end: a token in, a
// certificate over this agent's own key out, and the pin recorded.
func TestEnrollmentIssuesAVerifiedIdentity(t *testing.T) {
	farm := farmtest.NewFarm(t)
	enrollment, err := client(t, farm).Register(context.Background(), request(farm.MintToken("pool-a", 1), "forge-01"))
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	record := enrollment.Record
	if record.SecurityMode != conn.SecurityMTLS || record.Tenant != "acme-robotics" || record.Pool != "pool-a" ||
		record.Name != "forge-01" || record.RunnerID == "" || record.Server != farm.URL {
		t.Errorf("recorded %+v", record)
	}
	if record.AuthorityFingerprint != farm.CA.Fingerprint() || record.AuthorityPEM != farm.CA.PEM {
		t.Error("the pin is not the farm's CA")
	}
	if !record.RenewAfter.Before(record.NotAfter) || record.Serial == "" {
		t.Errorf("certificate fields: %+v", record)
	}
	if !enrollment.Bearer.Empty() {
		t.Error("an mTLS enrollment carried a bearer secret")
	}

	// And it is what internal/state accepts, which is what a connection will load.
	dir, err := state.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dir.Close() }()
	if err := dir.SaveEnrollment(enrollment); err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := dir.LoadIdentity(); err != nil {
		t.Fatalf("load: %v", err)
	}
}

// TestASecondEnrollmentWithTheSameTokenFails is the acceptance criterion: single-use
// enforcement, observed. The control plane is what enforces it; the agent's part is to
// report the refusal plainly and not to retry into it.
func TestASecondEnrollmentWithTheSameTokenFails(t *testing.T) {
	farm := farmtest.NewFarm(t)
	token := farm.MintToken("pool-a", 1)
	enrollClient := client(t, farm)

	if _, err := enrollClient.Register(context.Background(), request(token, "forge-01")); err != nil {
		t.Fatalf("the first enrollment: %v", err)
	}
	_, err := enrollClient.Register(context.Background(), request(token, "forge-02"))

	var refused *APIError
	if !errors.As(err, &refused) || refused.Status != http.StatusUnauthorized || refused.Code != CodeEnrollmentRefused {
		t.Fatalf("expected 401 %s, got %v", CodeEnrollmentRefused, err)
	}
	if !strings.Contains(err.Error(), CodeEnrollmentRefused) {
		t.Errorf("the error should name the code: %v", err)
	}
	if observed := farm.Observe(); observed.Enrollments != 1 {
		t.Errorf("expected one runner enrolled, got %d", observed.Enrollments)
	}
}

// TestTheControlPlanesRefusalsAreReported covers the other refusals an operator can
// cause, each with the control plane's own code.
func TestTheControlPlanesRefusalsAreReported(t *testing.T) {
	farm := farmtest.NewFarm(t)
	enrollClient := client(t, farm)
	ctx := context.Background()

	// A token scoped to pool-a refuses a request naming pool-b — the same opaque 401.
	wrongPool := request(farm.MintToken("pool-a", 1), "forge-01")
	wrongPool.Pool = "pool-b"
	if _, err := enrollClient.Register(ctx, wrongPool); !isCode(err, CodeEnrollmentRefused) {
		t.Errorf("wrong pool: %v", err)
	}

	// A taken name is refused with a reason, and the token survives it.
	token := farm.MintToken("pool-a", 2)
	if _, err := enrollClient.Register(ctx, request(token, "forge-01")); err != nil {
		t.Fatal(err)
	}
	if _, err := enrollClient.Register(ctx, request(token, "forge-01")); !isCode(err, CodeRunnerNameTaken) {
		t.Errorf("taken name: %v", err)
	}
	if _, err := enrollClient.Register(ctx, request(token, "forge-02")); err != nil {
		t.Errorf("the token should survive a name collision: %v", err)
	}

	// The fallback, asked for on a workspace that has not allowed it.
	fallback := request(farm.MintToken("pool-a", 1), "forge-03")
	fallback.BearerFallback = true
	if _, err := enrollClient.Register(ctx, fallback); !isCode(err, CodeFallbackNotPermitted) {
		t.Errorf("fallback not permitted: %v", err)
	}
}

// TestBearerFallbackIsAskedForAndReported covers decision B3's degraded mode: asked for
// explicitly, returned as a secret, and recorded as the weaker thing it is.
func TestBearerFallbackIsAskedForAndReported(t *testing.T) {
	farm := farmtest.NewFarm(t)
	farm.AllowBearerFallback()

	fallback := request(farm.MintToken("pool-a", 1), "forge-01")
	fallback.BearerFallback = true
	enrollment, err := client(t, farm).Register(context.Background(), fallback)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if enrollment.Record.SecurityMode != conn.SecurityBearerFallback || enrollment.Bearer.Empty() ||
		len(enrollment.IdentityPEM) != 0 || enrollment.Record.AuthorityFingerprint != farm.CA.Fingerprint() {
		t.Errorf("enrolled %+v", enrollment.Record)
	}
}

// TestValidateRefusesBeforeTheTokenIsSpent asserts a malformed request never reaches the
// control plane — a token presented with a bad name is a token an operator may have
// spent on nothing.
func TestValidateRefusesBeforeTheTokenIsSpent(t *testing.T) {
	farm := farmtest.NewFarm(t)
	enrollClient := client(t, farm)
	token := farm.MintToken("pool-a", 1)

	for name, mutate := range map[string]func(*Request){
		"no tenant":               func(r *Request) { r.Tenant = " " },
		"a pool that is no slug":  func(r *Request) { r.Pool = "Pool A" },
		"not an enrollment token": func(r *Request) { r.Token = "ghp_notours" },
		"a name that is no slug":  func(r *Request) { r.Name = "-forge" },
		"no architecture":         func(r *Request) { r.Arch = "" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := request(token, "forge-01")
			mutate(&bad)
			if _, err := enrollClient.Register(context.Background(), bad); err == nil {
				t.Fatal("expected a refusal")
			}
		})
	}
	if observed := farm.Observe(); observed.Enrollments != 0 {
		t.Error("a malformed request reached the control plane")
	}
	if _, err := enrollClient.Register(context.Background(), request(token, "forge-01")); err != nil {
		t.Errorf("the token should be unspent: %v", err)
	}
}

// TestRenewalReplacesTheCertificateWithoutAToken is renewal over the authenticated
// channel: the old certificate authenticates the request, a new one comes back, and the
// old one is dead afterwards.
func TestRenewalReplacesTheCertificateWithoutAToken(t *testing.T) {
	farm := farmtest.NewFarm(t)
	farm.SetRefusal(farmtest.RefuseWithStatus)
	enrollClient := client(t, farm)
	identity := enrolled(t, farm, enrollClient)

	renewal, err := enrollClient.Renew(context.Background(), identity)
	if err != nil {
		t.Fatalf("renew: %v", err)
	}
	if renewal.Record.Serial == identity.Record.Serial || renewal.AuthorityRotated || renewal.Record.RenewedAt.IsZero() {
		t.Errorf("renewed %+v", renewal.Record)
	}
	if farm.Observe().Renewals != 1 {
		t.Error("the farm saw no renewal")
	}

	// The certificate that was replaced cannot renew again: revocation, and supersession,
	// are final.
	_, err = enrollClient.Renew(context.Background(), identity)
	if !IsIdentityRefused(err) {
		t.Errorf("expected the superseded certificate to be refused, got %v", err)
	}
}

// TestRenewalRefusesABearerIdentity asserts there is nothing to renew without a
// certificate.
func TestRenewalRefusesABearerIdentity(t *testing.T) {
	farm := farmtest.NewFarm(t)
	identity := state.Identity{Record: state.Record{SecurityMode: conn.SecurityBearerFallback}}
	if _, err := client(t, farm).Renew(context.Background(), identity); err == nil {
		t.Error("expected a bearer identity's renewal to be refused")
	}
}

// TestTheControlPlaneIsVerified asserts a client that does not trust the server's
// certificate sends it nothing — least of all a token.
func TestTheControlPlaneIsVerified(t *testing.T) {
	farm := farmtest.NewFarm(t)
	untrusting := client(t, farm)
	untrusting.RootCAs = x509.NewCertPool()

	_, err := untrusting.Register(context.Background(), request(farm.MintToken("pool-a", 1), "forge-01"))
	var unknown x509.UnknownAuthorityError
	if !errors.As(err, &unknown) {
		t.Fatalf("expected an unknown-authority error, got %v", err)
	}
	if farm.Observe().Enrollments != 0 {
		t.Error("the token reached an unverified server")
	}
}

// TestParseServerIsHTTPSOnly asserts the token never travels in the clear.
func TestParseServerIsHTTPSOnly(t *testing.T) {
	for _, bad := range []string{
		"http://ouroboros.example.invalid",
		"ouroboros.example.invalid",
		"https://",
		"https://user:pass@ouroboros.example.invalid",
		"https://ouroboros.example.invalid/?x=1",
		"::",
	} {
		if _, err := ParseServer(bad); err == nil {
			t.Errorf("%q was accepted", bad)
		}
	}
	server, err := ParseServer(" https://ouroboros.example.invalid/base ")
	if err != nil || server.JoinPath(registrationsPath).String() != "https://ouroboros.example.invalid/base/api/v1/farm/registrations" {
		t.Errorf("got %v, %v", server, err)
	}
}

// TestAResponseIsVerifiedBeforeItIsSaved covers every check Register makes of what came
// back — each against a control plane that got one thing wrong.
func TestAResponseIsVerifiedBeforeItIsSaved(t *testing.T) {
	ca, err := farmtest.NewCA("org_test")
	if err != nil {
		t.Fatal(err)
	}
	other, err := farmtest.NewCA("org_other")
	if err != nil {
		t.Fatal(err)
	}
	foreignKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()

	// answer builds a response over the request's own key, then lets a case spoil it.
	answer := func(spoil func(body map[string]any, csr string)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			var body registrationBody
			_ = json.NewDecoder(r.Body).Decode(&body)
			leaf, certificatePEM, err := ca.SignRequest(body.CSR, "runner-1", now.Add(-time.Minute), now.Add(time.Hour))
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			response := map[string]any{
				"runnerId": "runner-1", "name": body.Name, "poolId": "pool-uuid", "securityMode": "mtls",
				"certificate": certificatePEM, "serial": farmtest.Serial(leaf),
				"renewAfter":  now.Add(30 * time.Minute).UTC().Format(time.RFC3339),
				"bearerToken": nil,
				"authority":   map[string]string{"certificate": ca.PEM, "fingerprint": ca.Fingerprint()},
			}
			spoil(response, body.CSR)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(response)
		}
	}

	for name, spoil := range map[string]func(map[string]any, string){
		"a certificate over somebody else's key": func(body map[string]any, _ string) {
			_, certificatePEM, _ := ca.Issue(&foreignKey.PublicKey, "runner-1", now.Add(-time.Minute), now.Add(time.Hour))
			body["certificate"] = certificatePEM
		},
		"a certificate from another CA": func(body map[string]any, csr string) {
			_, certificatePEM, _ := other.SignRequest(csr, "runner-1", now.Add(-time.Minute), now.Add(time.Hour))
			body["certificate"] = certificatePEM
		},
		"a fingerprint that is not the CA's": func(body map[string]any, _ string) {
			body["authority"] = map[string]string{"certificate": ca.PEM, "fingerprint": other.Fingerprint()}
		},
		"a certificate naming another runner":    func(body map[string]any, _ string) { body["runnerId"] = "runner-2" },
		"a serial that is not the certificate's": func(body map[string]any, _ string) { body["serial"] = "01" },
		"no certificate at all":                  func(body map[string]any, _ string) { body["certificate"] = nil },
		"a certificate that is not PEM":          func(body map[string]any, _ string) { body["certificate"] = "nonsense" },
		"a CA that is not a CA": func(body map[string]any, _ string) {
			body["authority"] = map[string]string{"certificate": "nonsense", "fingerprint": ""}
		},
		"a runner id of the wrong type": func(body map[string]any, _ string) { body["runnerId"] = 7 },
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewTLSServer(answer(spoil))
			defer server.Close()
			roots := x509.NewCertPool()
			roots.AddCert(server.Certificate())
			base, _ := ParseServer(server.URL)
			bad := &Client{Server: base, RootCAs: roots}

			if _, err := bad.Register(context.Background(), request("orb_enroll_x.y", "forge-01")); err == nil {
				t.Fatal("expected the response to be refused")
			}
		})
	}
}

// TestRedirectsAreNotFollowed asserts a token cannot be carried to wherever a Location
// header points.
func TestRedirectsAreNotFollowed(t *testing.T) {
	followed := false
	elsewhere := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { followed = true }))
	defer elsewhere.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL+"/steal", http.StatusTemporaryRedirect)
	}))
	defer server.Close()

	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	roots.AddCert(elsewhere.Certificate())
	base, _ := ParseServer(server.URL)
	_, err := (&Client{Server: base, RootCAs: roots}).Register(context.Background(), request("orb_enroll_x.y", "forge-01"))

	var refused *APIError
	if !errors.As(err, &refused) || refused.Status != http.StatusTemporaryRedirect {
		t.Errorf("expected the redirect to be reported, got %v", err)
	}
	if followed {
		t.Error("the redirect was followed")
	}
	if refused != nil && !strings.Contains(refused.Error(), "307") {
		t.Errorf("an error with no envelope should name its status: %v", refused)
	}
}

// TestNameFromHostname folds a hostname into the control plane's name shape.
func TestNameFromHostname(t *testing.T) {
	for hostname, want := range map[string]string{
		"shed-pi-01":            "shed-pi-01",
		"Shed-Pi.local":         "shed-pi.local",
		"build box #3":          "build-box-3",
		"--weird--":             "weird",
		"":                      "runner",
		"日本":                    "runner",
		strings.Repeat("a", 80): strings.Repeat("a", 64),
	} {
		if got := NameFromHostname(hostname); got != want {
			t.Errorf("%q: got %q, want %q", hostname, got, want)
		}
		if !ValidName(NameFromHostname(hostname)) {
			t.Errorf("%q folded to an invalid name", hostname)
		}
	}
}

// enrolled enrols a runner and loads its identity.
func enrolled(t *testing.T, farm *farmtest.Farm, enrollClient *Client) state.Identity {
	t.Helper()
	enrollment, err := enrollClient.Register(context.Background(), request(farm.MintToken("pool-a", 1), "forge-01"))
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	dir, err := state.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dir.Close() })
	if err := dir.SaveEnrollment(enrollment); err != nil {
		t.Fatal(err)
	}
	identity, err := dir.LoadIdentity()
	if err != nil {
		t.Fatal(err)
	}
	return identity
}

// isCode reports whether an error is the control plane answering with a code.
func isCode(err error, code string) bool {
	var refused *APIError
	return errors.As(err, &refused) && refused.Code == code
}
