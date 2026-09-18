package state

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/secret"
)

// ErrNotEnrolled is returned when the directory holds no runner.
var ErrNotEnrolled = errors.New("this machine is not enrolled")

// ErrAlreadyEnrolled is returned by an enrollment into a directory that already holds a
// runner. Enrolling again spends a token and creates a second runner row; replacing an
// identity is something an operator does deliberately, by removing the directory.
var ErrAlreadyEnrolled = errors.New("this state directory already holds an enrolled runner")

// Record is who this runner is — everything about its identity that is not secret.
//
// It is written 0600 like everything else here, but it could be read aloud: it holds
// ids, names, dates and the farm CA's PUBLIC certificate. The private key is in
// identity.pem and the bearer secret in bearer.token, so printing a Record, logging
// one, or pasting one into a bug report discloses nothing that authenticates.
type Record struct {
	// RunnerID is the control plane's id for this runner — the certificate's CN.
	RunnerID string `json:"runner_id"`
	// Name is what the runner was enrolled as, unique in its workspace.
	Name string `json:"name"`
	// Tenant is the workspace the operator said they were enrolling into (`--tenant`).
	// Recorded, not sent: the registration takes its workspace from the token, and
	// has no field a caller could name one in.
	Tenant string `json:"tenant"`
	// Pool is the pool the operator named (`--pool`) — what `hello.pool` reports.
	Pool string `json:"pool"`
	// PoolID is the control plane's id for the pool the token enrolled into.
	PoolID string `json:"pool_id"`
	// Server is the control plane's base URL, https://.
	Server string `json:"server"`
	// SecurityMode is decision B3's answer for this runner.
	SecurityMode conn.SecurityMode `json:"security_mode"`

	// Serial is the live certificate's serial, lowercase hex. Empty in bearer mode.
	Serial string `json:"serial,omitempty"`
	// NotAfter is when the live certificate stops being valid.
	NotAfter time.Time `json:"not_after,omitzero"`
	// RenewAfter is when to start asking for a new one — published by the control
	// plane with each certificate, so re-tuning it never needs a new agent build.
	RenewAfter time.Time `json:"renew_after,omitzero"`

	// AuthorityPEM is the farm CA's certificate: public, and pinned.
	AuthorityPEM string `json:"authority_pem"`
	// AuthorityFingerprint is SHA-256 over the CA's DER, lowercase hex — the pin. Every
	// load of the identity recomputes it from AuthorityPEM and refuses a mismatch.
	AuthorityFingerprint string `json:"authority_fingerprint"`

	// EnrolledAt and RenewedAt are for the operator reading this file.
	EnrolledAt time.Time `json:"enrolled_at"`
	RenewedAt  time.Time `json:"renewed_at,omitzero"`
}

// Identity is a loaded, verified identity: the record, and in mTLS mode the key pair
// the TLS handshake presents.
//
// It is never logged whole. [Identity.LogValue] is what log/slog records for it — the
// runner id, the mode and the certificate's serial and expiry — so a log line that
// mentions an identity cannot carry its key.
type Identity struct {
	Record Record

	// Certificate is the client certificate and its private key, as crypto/tls wants
	// them. Empty in bearer-fallback mode.
	Certificate tls.Certificate
	// Leaf is the parsed client certificate. Nil in bearer-fallback mode.
	Leaf *x509.Certificate
	// Authority is the pinned farm CA.
	Authority *x509.Certificate
	// Bearer is the fallback secret. Empty in mTLS mode.
	Bearer secret.Secret
}

// LogValue is what an Identity looks like in a log: never its key.
func (i Identity) LogValue() slog.Value {
	attrs := []slog.Attr{
		slog.String("runner", i.Record.RunnerID),
		slog.String("security_mode", string(i.Record.SecurityMode)),
	}
	if i.Leaf != nil {
		attrs = append(attrs,
			slog.String("serial", i.Record.Serial),
			slog.Time("not_after", i.Leaf.NotAfter))
	}
	return slog.GroupValue(attrs...)
}

// String is the same, for fmt.
func (i Identity) String() string {
	return fmt.Sprintf("runner %s (%s)", i.Record.RunnerID, i.Record.SecurityMode)
}

// Enrollment is what a successful registration leaves to be written.
type Enrollment struct {
	Record Record
	// IdentityPEM is the certificate followed by its private key. Empty in bearer mode.
	IdentityPEM []byte
	// Bearer is the fallback secret. Empty in mTLS mode.
	Bearer secret.Secret
}

// Enrolled reports whether the directory holds a runner.
func (d *Dir) Enrolled() (bool, error) {
	return d.exists(recordFile)
}

// SaveEnrollment writes a new runner's identity.
//
// The record is written LAST, because its presence is what "enrolled" means: a crash
// part-way leaves a directory that is not enrolled — and an identity file that the
// next enrollment overwrites — rather than a runner.json pointing at a key that was
// never written.
func (d *Dir) SaveEnrollment(enrollment Enrollment) error {
	enrolled, err := d.Enrolled()
	if err != nil {
		return err
	}
	if enrolled {
		return fmt.Errorf("%w: %s", ErrAlreadyEnrolled, d.path)
	}

	switch enrollment.Record.SecurityMode {
	case conn.SecurityMTLS:
		if len(enrollment.IdentityPEM) == 0 {
			return errors.New("an mTLS enrollment has no certificate to save")
		}
		if _, err := parseIdentity(enrollment.IdentityPEM, enrollment.Record); err != nil {
			return err
		}
		if err := d.writeFile(identityFile, enrollment.IdentityPEM); err != nil {
			return err
		}
	case conn.SecurityBearerFallback:
		if enrollment.Bearer.Empty() {
			return errors.New("a bearer-fallback enrollment has no secret to save")
		}
		if err := d.writeFile(bearerFile, []byte(enrollment.Bearer.Reveal())); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown security mode %q", enrollment.Record.SecurityMode)
	}

	return d.saveRecord(enrollment.Record)
}

// SaveRenewal replaces the certificate and key with a renewed pair, and the record's
// certificate fields with the new certificate's.
//
// identity.pem is written first and runner.json second. A crash between the two leaves a
// new certificate beside a record describing the old one, which [Dir.LoadIdentity]
// recognises by the serial and reconciles — the other order would leave a record
// describing a certificate that does not exist, beside one the control plane has
// already superseded.
func (d *Dir) SaveRenewal(record Record, identityPEM []byte) error {
	if record.SecurityMode != conn.SecurityMTLS {
		return errors.New("only an mTLS identity is renewed")
	}
	if _, err := parseIdentity(identityPEM, record); err != nil {
		return err
	}
	if err := d.writeFile(identityFile, identityPEM); err != nil {
		return err
	}
	return d.saveRecord(record)
}

// Record reads runner.json.
func (d *Dir) Record() (Record, error) {
	return readRecord(d.path)
}

// PeekRecord reads runner.json from a state directory WITHOUT opening it — no lock, no
// clean-up, nothing written. It is for `ouroboros-runner hello`, which describes a runner
// that may be running right now and holding the lock. The record holds nothing secret.
func PeekRecord(path string) (Record, error) {
	return readRecord(path)
}

// readRecord reads runner.json from a directory.
func readRecord(path string) (Record, error) {
	raw, err := os.ReadFile(filepath.Join(path, recordFile)) // #nosec G304 -- a fixed name inside the state directory
	if errors.Is(err, os.ErrNotExist) {
		return Record{}, fmt.Errorf("%w (no %s in %s)", ErrNotEnrolled, recordFile, path)
	}
	if err != nil {
		return Record{}, fmt.Errorf("read %s: %w", recordFile, err)
	}
	var record Record
	if err := json.Unmarshal(raw, &record); err != nil {
		return Record{}, fmt.Errorf("read %s: %w", recordFile, err)
	}
	return record, nil
}

// saveRecord writes runner.json.
func (d *Dir) saveRecord(record Record) error {
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s: %w", recordFile, err)
	}
	return d.writeFile(recordFile, append(raw, '\n'))
}

// LoadIdentity reads and VERIFIES the identity — on every connection, not once at
// start-up, so a renewal written a minute ago is the certificate presented now, and a
// state directory somebody edited by hand is refused before it is presented to anyone.
//
// Verified means: the farm CA's fingerprint is the pinned one; the key is the
// certificate's; the certificate was issued by the pinned CA for client authentication;
// and it names this runner. What it does not check is expiry — an expired certificate
// is loaded, and refused by the caller with a message about expiry rather than a
// generic verification failure.
func (d *Dir) LoadIdentity() (Identity, error) {
	record, err := d.Record()
	if err != nil {
		return Identity{}, err
	}

	switch record.SecurityMode {
	case conn.SecurityBearerFallback:
		raw, err := d.readFile(bearerFile)
		if err != nil {
			return Identity{}, fmt.Errorf("read the bearer secret: %w", err)
		}
		authority, err := verifyPin(record)
		if err != nil {
			return Identity{}, err
		}
		token := strings.TrimSpace(string(raw))
		if token == "" {
			return Identity{}, fmt.Errorf("%s is empty", bearerFile)
		}
		return Identity{Record: record, Authority: authority, Bearer: secret.Secret(token)}, nil

	case conn.SecurityMTLS:
		raw, err := d.readFile(identityFile)
		if err != nil {
			return Identity{}, fmt.Errorf("read the client certificate: %w", err)
		}
		identity, err := parseIdentity(raw, record)
		if err == nil {
			return identity, nil
		}
		// A certificate the record does not describe is a renewal a crash cut short
		// between its two writes. Anything else is not something to repair.
		if !errors.Is(err, errSerialMismatch) {
			return Identity{}, err
		}
		return d.reconcile(record, raw)

	default:
		return Identity{}, fmt.Errorf("%s names an unknown security mode %q", recordFile, record.SecurityMode)
	}
}

// reconcile completes a renewal whose record write was lost: identity.pem holds the new
// certificate, runner.json still describes the old one.
//
// The new certificate's serial and expiry are read from the certificate itself. When to
// renew it is not in the certificate, so the control plane's lead time is carried over
// from the record — the gap between the old certificate's expiry and its renew-after —
// which is the value the control plane published last time and almost certainly still
// publishes. The CA is the pinned one: a renewal that also rotated the authority and then
// crashed cannot be reconciled, and the load fails rather than guess.
func (d *Dir) reconcile(record Record, raw []byte) (Identity, error) {
	certificate, err := tls.X509KeyPair(raw, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("read %s: %w", identityFile, err)
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return Identity{}, fmt.Errorf("read %s: %w", identityFile, err)
	}

	lead := record.NotAfter.Sub(record.RenewAfter)
	record.Serial = serialHex(leaf)
	record.NotAfter = leaf.NotAfter.UTC()
	record.RenewAfter = leaf.NotAfter.Add(-lead).UTC()
	record.RenewedAt = leaf.NotBefore.UTC()

	identity, err := parseIdentity(raw, record)
	if err != nil {
		return Identity{}, fmt.Errorf("%s and %s disagree and cannot be reconciled: %w", identityFile, recordFile, err)
	}
	if err := d.saveRecord(record); err != nil {
		return Identity{}, err
	}
	return identity, nil
}

// errSerialMismatch is a certificate the record does not describe.
var errSerialMismatch = errors.New("the certificate is not the one the record describes")

// parseIdentity reads a combined PEM and verifies it against a record.
func parseIdentity(raw []byte, record Record) (Identity, error) {
	authority, err := verifyPin(record)
	if err != nil {
		return Identity{}, err
	}

	// The same bytes for both arguments: X509KeyPair takes the CERTIFICATE blocks from
	// the first and the PRIVATE KEY block from the second, and checks that they match.
	certificate, err := tls.X509KeyPair(raw, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("read %s: %w", identityFile, err)
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return Identity{}, fmt.Errorf("read %s: %w", identityFile, err)
	}
	certificate.Leaf = leaf

	if serialHex(leaf) != record.Serial {
		return Identity{}, fmt.Errorf("%w: %s holds serial %s, %s names %s",
			errSerialMismatch, identityFile, serialHex(leaf), recordFile, record.Serial)
	}
	if leaf.Subject.CommonName != record.RunnerID {
		return Identity{}, fmt.Errorf("%s is issued to %q, not to this runner (%s)",
			identityFile, leaf.Subject.CommonName, record.RunnerID)
	}

	roots := x509.NewCertPool()
	roots.AddCert(authority)
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:       roots,
		KeyUsages:   []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		CurrentTime: leaf.NotBefore, // expiry is the caller's to report, by name
	}); err != nil {
		return Identity{}, fmt.Errorf("%s was not issued by the pinned farm CA: %w", identityFile, err)
	}

	return Identity{Record: record, Certificate: certificate, Leaf: leaf, Authority: authority}, nil
}

// verifyPin parses the recorded CA and checks it against its pinned fingerprint.
func verifyPin(record Record) (*x509.Certificate, error) {
	authority, err := ParseAuthority(record.AuthorityPEM)
	if err != nil {
		return nil, err
	}
	if got := Fingerprint(authority); got != record.AuthorityFingerprint {
		return nil, fmt.Errorf("the farm CA in %s does not match its pin (sha256 %s, pinned %s)",
			recordFile, got, record.AuthorityFingerprint)
	}
	return authority, nil
}

// ParseAuthority reads a farm CA certificate from PEM, and refuses one that is not a CA.
func ParseAuthority(text string) (*x509.Certificate, error) {
	block, rest := pem.Decode([]byte(text))
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("the farm CA is not a PEM certificate")
	}
	if len(bytes.TrimSpace(rest)) > 0 {
		return nil, errors.New("the farm CA carries more than one certificate")
	}
	authority, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("read the farm CA: %w", err)
	}
	if !authority.IsCA {
		return nil, errors.New("the farm CA certificate is not a CA")
	}
	return authority, nil
}

// Fingerprint is SHA-256 over a certificate's DER, lowercase hex — the control plane's
// own spelling of a pin (`AuthorityResource.fingerprint`).
func Fingerprint(certificate *x509.Certificate) string {
	digest := sha256.Sum256(certificate.Raw)
	return hex.EncodeToString(digest[:])
}

// serialHex is a certificate's serial as the control plane stores it: lowercase hex,
// with its leading zeros — the DER integer's magnitude, which is what `runner_certificates`
// records and what a revocation names.
func serialHex(certificate *x509.Certificate) string {
	return hex.EncodeToString(certificate.SerialNumber.Bytes())
}

// SerialHex is [serialHex], for the enrollment client to compare a response's `serial`
// with the certificate it came with.
func SerialHex(certificate *x509.Certificate) string { return serialHex(certificate) }

// sessionRe is a session id's published shape.
var sessionRe = regexp.MustCompile(`^sess_[0-9A-HJKMNP-TV-Z]{26}$`)

// SaveSession records the session the gateway granted, for the next hello's `resume`.
func (d *Dir) SaveSession(id string) error {
	if !sessionRe.MatchString(id) {
		return fmt.Errorf("refusing to record %q as a session id", id)
	}
	return d.writeFile(sessionFile, []byte(id+"\n"))
}

// Session is the last session the gateway granted, or "" if there is none worth
// naming. A file that does not hold a session id is ignored rather than trusted — the
// worst a missing resume costs is `ack.resumed: false`, and delivery does not depend on
// it (docs/RUNNER_PROTOCOL.md § 5).
func (d *Dir) Session() string {
	raw, err := d.readFile(sessionFile)
	if err != nil {
		return ""
	}
	id := strings.TrimSpace(string(raw))
	if !sessionRe.MatchString(id) {
		return ""
	}
	return id
}
