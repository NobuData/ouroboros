package enroll

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
)

// The runner generates its own keypair (SECURITY_MODEL.md § 7.3): a P-256 key, and a
// PKCS#10 request carrying its public half. The control plane signs a certificate over
// that public key and never sees the private one — so no runner private key has ever
// existed inside Ouroboros, and there is no backup, log or database column from which
// one could be recovered.

// newKey generates a P-256 key: the curve the farm CA signs, and the only one.
func newKey() (*ecdsa.PrivateKey, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate the runner's key: %w", err)
	}
	return key, nil
}

// certificateRequest is a PEM PKCS#10 request over the key, self-signed with
// ECDSA-SHA256 — the one algorithm the farm CA accepts.
//
// The subject is the runner's name, for a human reading the request. The control plane
// discards it and composes the certificate's subject itself (CN = runner id,
// O = workspace), so nothing here can claim to be anybody.
func certificateRequest(key *ecdsa.PrivateKey, name string) (string, error) {
	der, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject:            pkix.Name{CommonName: name},
		SignatureAlgorithm: x509.ECDSAWithSHA256,
	}, key)
	if err != nil {
		return "", fmt.Errorf("compose the certificate request: %w", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der})), nil
}

// identityPEM is the combined file internal/state keeps: the issued certificate, then
// the private key in PKCS#8.
func identityPEM(certificatePEM string, key *ecdsa.PrivateKey) ([]byte, error) {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("encode the runner's key: %w", err)
	}
	combined := []byte(certificatePEM)
	if len(combined) > 0 && combined[len(combined)-1] != '\n' {
		combined = append(combined, '\n')
	}
	return append(combined, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})...), nil
}
