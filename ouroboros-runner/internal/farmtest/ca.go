// Package farmtest is an in-process farm for the agent's suites: a farm CA, the two
// enrollment routes, and a gateway that speaks the runner protocol over mTLS.
//
// It exists because the agent's real counterpart does not yet: the enrollment API is
// shipped (AH.2, [#250]) but the gateway is AH.3 ([#251]), in TypeScript, in another
// work stream. So this is the other half the agent is tested against — and it is held
// to the same contract rather than to the agent's own opinions. Every frame it reads is
// judged by conn.Decode against docs/RUNNER_PROTOCOL.md; every certificate it issues
// has the shape the control plane's farm CA issues (CN = runner id, O = workspace,
// clientAuth only, a 128-bit positive serial); every refusal it answers with is the
// control plane's own status and error code.
//
// Nothing in the agent binary imports it. It listens — on a loopback port, through
// net/http/httptest — which is exactly the thing the agent must never do, and why the
// agent's no-listener test builds the command without it.
//
// [#250]: https://github.com/NobuData/ouroboros/issues/250
// [#251]: https://github.com/NobuData/ouroboros/issues/251
package farmtest

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"time"
)

// RunnerUnit is the OU every runner certificate carries — the control plane's
// `RUNNER_UNIT`.
const RunnerUnit = "ouroboros-runner"

// The two name attributes the control plane composes beside CN, by OID — as its own
// x509/name.ts writes them. `O` is the workspace's id; `OU` says what issued the
// certificate and what for.
var (
	oidWorkspace = asn1.ObjectIdentifier{2, 5, 4, 10}
	oidUnit      = asn1.ObjectIdentifier{2, 5, 4, 11}
)

// subject is a distinguished name as the farm CA composes one: CN, then O and OU.
func subject(commonName, workspace, unit string) pkix.Name {
	return pkix.Name{
		CommonName: commonName,
		ExtraNames: []pkix.AttributeTypeAndValue{
			{Type: oidWorkspace, Value: workspace},
			{Type: oidUnit, Value: unit},
		},
	}
}

// CA is a farm certificate authority: one workspace's, as the control plane's
// farm.authority.ts keeps one.
type CA struct {
	// Certificate is the CA's self-signed certificate.
	Certificate *x509.Certificate
	// PEM is the same, PEM-encoded — what the enrollment response's `authority.certificate`
	// carries.
	PEM string
	// Workspace is the workspace id every certificate it issues names in `O`.
	Workspace string

	key *ecdsa.PrivateKey
}

// NewCA generates a farm CA for a workspace.
func NewCA(workspace string) (*CA, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, err := newSerial()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               subject("farm-ca-"+workspace, workspace, "ouroboros-farm-ca"),
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	return &CA{
		Certificate: certificate,
		PEM:         string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		Workspace:   workspace,
		key:         key,
	}, nil
}

// Fingerprint is the CA's pin: SHA-256 over its DER, lowercase hex.
func (ca *CA) Fingerprint() string {
	digest := sha256.Sum256(ca.Certificate.Raw)
	return hex.EncodeToString(digest[:])
}

// Pool is a certificate pool holding only this CA.
func (ca *CA) Pool() *x509.CertPool {
	pool := x509.NewCertPool()
	pool.AddCert(ca.Certificate)
	return pool
}

// Issue signs a runner certificate over a public key, valid over the given window.
//
// The subject is composed here and never taken from a request, as the control plane
// composes it: CN is the runner's id and O is this CA's workspace.
func (ca *CA) Issue(public crypto.PublicKey, runnerID string, notBefore, notAfter time.Time) (*x509.Certificate, string, error) {
	serial, err := newSerial()
	if err != nil {
		return nil, "", err
	}
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               subject(runnerID, ca.Workspace, RunnerUnit),
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.Certificate, public, ca.key)
	if err != nil {
		return nil, "", err
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, "", err
	}
	return certificate, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), nil
}

// SignRequest reads a PEM certificate request, verifies its self-signature, and issues
// a certificate over its key — ignoring its subject, as the control plane does.
func (ca *CA) SignRequest(requestPEM, runnerID string, notBefore, notAfter time.Time) (*x509.Certificate, string, error) {
	block, _ := pem.Decode([]byte(requestPEM))
	if block == nil || block.Type != "CERTIFICATE REQUEST" {
		return nil, "", fmt.Errorf("not a PEM certificate request")
	}
	request, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		return nil, "", err
	}
	if err := request.CheckSignature(); err != nil {
		return nil, "", err
	}
	if request.SignatureAlgorithm != x509.ECDSAWithSHA256 {
		return nil, "", fmt.Errorf("the farm CA signs ECDSA-SHA256 requests, not %s", request.SignatureAlgorithm)
	}
	key, ok := request.PublicKey.(*ecdsa.PublicKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, "", fmt.Errorf("the farm CA signs P-256 keys")
	}
	return ca.Issue(request.PublicKey, runnerID, notBefore, notAfter)
}

// IdentityPEM generates a key and a certificate over it, and returns them as the
// combined PEM internal/state keeps — for a suite that needs an enrolled identity
// without enrolling.
func (ca *CA) IdentityPEM(runnerID string, notBefore, notAfter time.Time) ([]byte, *x509.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	leaf, certificatePEM, err := ca.Issue(&key.PublicKey, runnerID, notBefore, notAfter)
	if err != nil {
		return nil, nil, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	return append([]byte(certificatePEM), keyPEM...), leaf, nil
}

// Serial is a certificate's serial as the control plane stores it: lowercase hex.
func Serial(certificate *x509.Certificate) string {
	return hex.EncodeToString(certificate.SerialNumber.Bytes())
}

// newSerial is 128 random bits, positive and with a non-zero first byte — the control
// plane's `newSerial`, so the hex the response carries and the certificate's own serial
// are the same string.
func newSerial() (*big.Int, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return nil, err
	}
	raw[0] &= 0x7f
	if raw[0] == 0 {
		raw[0] = 1
	}
	return new(big.Int).SetBytes(raw[:]), nil
}
