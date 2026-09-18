package state

import (
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/secret"
)

// runnerID is the id the test CA issues certificates to.
const runnerID = "7f7c9d0e-3c55-4b35-9a53-5e2c8f9b8a41"

// open opens a fresh state directory, closed at the end of the test.
func open(t *testing.T) *Dir {
	t.Helper()
	dir, err := Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = dir.Close() })
	return dir
}

// newCA is a farm CA for the test's workspace.
func newCA(t *testing.T) *farmtest.CA {
	t.Helper()
	ca, err := farmtest.NewCA("org_test")
	if err != nil {
		t.Fatalf("new CA: %v", err)
	}
	return ca
}

// mtlsEnrollment is an enrollment as the control plane would have answered it.
func mtlsEnrollment(t *testing.T, ca *farmtest.CA, ttl time.Duration) Enrollment {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Second)
	identityPEM, leaf, err := ca.IdentityPEM(runnerID, now.Add(-time.Minute), now.Add(ttl))
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	return Enrollment{
		Record: Record{
			RunnerID: runnerID, Name: "forge-01", Tenant: "acme-robotics", Pool: "pool-a",
			PoolID: "pool-uuid", Server: "https://ouroboros.example.invalid",
			SecurityMode:         conn.SecurityMTLS,
			Serial:               farmtest.Serial(leaf),
			NotAfter:             leaf.NotAfter.UTC(),
			RenewAfter:           leaf.NotAfter.Add(-ttl / 3).UTC(),
			AuthorityPEM:         ca.PEM,
			AuthorityFingerprint: ca.Fingerprint(),
			EnrolledAt:           now,
		},
		IdentityPEM: identityPEM,
	}
}

// mode is a file's permission bits.
func mode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info.Mode().Perm()
}

// TestOpenCreatesAPrivateDirectory is the first half of "key material is written 0600":
// the directory it is written into is 0700.
func TestOpenCreatesAPrivateDirectory(t *testing.T) {
	dir := open(t)
	if got := mode(t, dir.Path()); got != dirMode {
		t.Errorf("the state directory is %v, want %v", got, dirMode)
	}
	if got := mode(t, filepath.Join(dir.Path(), outboxDir)); got != dirMode {
		t.Errorf("the outbox is %v, want %v", got, dirMode)
	}
}

// TestOpenIsExclusive asserts two agents cannot share one identity.
func TestOpenIsExclusive(t *testing.T) {
	dir := open(t)
	if _, err := Open(dir.Path()); !errors.Is(err, ErrLocked) {
		t.Fatalf("expected a second Open to be refused as locked, got %v", err)
	}
	if err := dir.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	again, err := Open(dir.Path())
	if err != nil {
		t.Fatalf("expected the directory to open once released, got %v", err)
	}
	_ = again.Close()
	if err := dir.Close(); err != nil {
		t.Errorf("a second Close should be harmless, got %v", err)
	}
}

func TestOpenRefusesWhatIsNotADirectory(t *testing.T) {
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(file); err == nil {
		t.Error("expected a file to be refused as a state directory")
	}
	if _, err := Open(""); err == nil {
		t.Error("expected an empty path to be refused")
	}
}

// TestOpenRemovesInterruptedWrites asserts a crash mid-write leaves nothing behind for
// long.
func TestOpenRemovesInterruptedWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state")
	dir, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_ = dir.Close()
	for _, leftover := range []string{
		filepath.Join(path, tempPrefix+"identity.pem-123"),
		filepath.Join(path, outboxDir, tempPrefix+"01KE7PDZMQDPKXES55PN5RZM7Q.frame-9"),
	} {
		if err := os.WriteFile(leftover, []byte("half"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	dir, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dir.Close() }()
	for _, sub := range []string{path, filepath.Join(path, outboxDir)} {
		entries, _ := os.ReadDir(sub)
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), tempPrefix) {
				t.Errorf("an interrupted write survived: %s", entry.Name())
			}
		}
	}
}

// TestKeyMaterialIsWritten0600EvenUnderAPermissiveUmask is the acceptance criterion
// itself. The umask is opened all the way for the length of the test, so the mode on
// disk is the one this package set rather than one the environment happened to allow.
func TestKeyMaterialIsWritten0600EvenUnderAPermissiveUmask(t *testing.T) {
	previous := syscall.Umask(0)
	defer syscall.Umask(previous)

	dir := open(t)
	ca := newCA(t)
	if err := dir.SaveEnrollment(mtlsEnrollment(t, ca, 90*24*time.Hour)); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := dir.SaveSession("sess_01KE7MV3WKAG706QMDN23AJ3BE"); err != nil {
		t.Fatal(err)
	}
	outbox, _, err := dir.Outbox()
	if err != nil {
		t.Fatal(err)
	}
	if err := outbox.Add("01KE7PDZMQDPKXES55PN5RZM7Q", finishFrame(t, "01KE7PDZMQDPKXES55PN5RZM7Q")); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{identityFile, recordFile, sessionFile, lockFile,
		filepath.Join(outboxDir, "01KE7PDZMQDPKXES55PN5RZM7Q.frame")} {
		if got := mode(t, filepath.Join(dir.Path(), name)); got != fileMode {
			t.Errorf("%s is %v, want %v", name, got, fileMode)
		}
	}

	// And the bearer secret, in its own mode.
	bearerDir := open(t)
	enrollment := mtlsEnrollment(t, ca, time.Hour)
	enrollment.Record.SecurityMode = conn.SecurityBearerFallback
	enrollment.IdentityPEM = nil
	enrollment.Bearer = "orb_bearer_not-a-real-secret"
	if err := bearerDir.SaveEnrollment(enrollment); err != nil {
		t.Fatalf("save a bearer enrollment: %v", err)
	}
	if got := mode(t, filepath.Join(bearerDir.Path(), bearerFile)); got != fileMode {
		t.Errorf("%s is %v, want %v", bearerFile, got, fileMode)
	}
}

// TestAnEnrolledIdentityLoadsAndVerifies is the round trip: what enrollment saves is
// what a connection presents.
func TestAnEnrolledIdentityLoadsAndVerifies(t *testing.T) {
	dir := open(t)
	ca := newCA(t)
	enrollment := mtlsEnrollment(t, ca, 90*24*time.Hour)

	if enrolled, _ := dir.Enrolled(); enrolled {
		t.Fatal("a fresh directory claims to be enrolled")
	}
	if _, err := dir.LoadIdentity(); !errors.Is(err, ErrNotEnrolled) {
		t.Fatalf("expected ErrNotEnrolled, got %v", err)
	}
	if err := dir.SaveEnrollment(enrollment); err != nil {
		t.Fatalf("save: %v", err)
	}
	if enrolled, _ := dir.Enrolled(); !enrolled {
		t.Fatal("expected the directory to be enrolled")
	}

	identity, err := dir.LoadIdentity()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if identity.Leaf == nil || identity.Leaf.Subject.CommonName != runnerID ||
		identity.Record.Serial != enrollment.Record.Serial || identity.Certificate.PrivateKey == nil {
		t.Errorf("loaded %v", identity)
	}
	if _, err := os.Stat(filepath.Join(dir.Path(), bearerFile)); !os.IsNotExist(err) {
		t.Error("an mTLS enrollment wrote a bearer file")
	}

	if err := dir.SaveEnrollment(enrollment); !errors.Is(err, ErrAlreadyEnrolled) {
		t.Errorf("expected a second enrollment to be refused, got %v", err)
	}
}

// TestABearerIdentityLoads covers the fallback: no certificate, a secret instead, and
// the CA still pinned — the agent still verifies the gateway.
func TestABearerIdentityLoads(t *testing.T) {
	dir := open(t)
	enrollment := mtlsEnrollment(t, newCA(t), time.Hour)
	enrollment.Record.SecurityMode = conn.SecurityBearerFallback
	enrollment.Record.Serial = ""
	enrollment.IdentityPEM = nil
	enrollment.Bearer = "orb_bearer_not-a-real-secret"
	if err := dir.SaveEnrollment(enrollment); err != nil {
		t.Fatalf("save: %v", err)
	}

	identity, err := dir.LoadIdentity()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if identity.Bearer.Reveal() != "orb_bearer_not-a-real-secret" || identity.Leaf != nil || identity.Authority == nil {
		t.Errorf("loaded %v", identity)
	}
	if _, err := os.Stat(filepath.Join(dir.Path(), identityFile)); !os.IsNotExist(err) {
		t.Error("a bearer enrollment wrote a certificate")
	}

	if err := os.WriteFile(filepath.Join(dir.Path(), bearerFile), []byte("  \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := dir.LoadIdentity(); err == nil {
		t.Error("expected an empty bearer file to be refused")
	}
}

// TestSaveEnrollmentRefusesAnIncompleteEnrollment asserts nothing half-formed is written.
func TestSaveEnrollmentRefusesAnIncompleteEnrollment(t *testing.T) {
	ca := newCA(t)
	for name, mutate := range map[string]func(*Enrollment){
		"mTLS with no certificate":       func(e *Enrollment) { e.IdentityPEM = nil },
		"bearer with no secret":          func(e *Enrollment) { e.Record.SecurityMode = conn.SecurityBearerFallback },
		"a mode nobody has heard of":     func(e *Enrollment) { e.Record.SecurityMode = "none" },
		"a certificate for someone else": func(e *Enrollment) { e.Record.RunnerID = "someone-else" },
	} {
		t.Run(name, func(t *testing.T) {
			dir := open(t)
			enrollment := mtlsEnrollment(t, ca, time.Hour)
			mutate(&enrollment)
			if err := dir.SaveEnrollment(enrollment); err == nil {
				t.Fatal("expected a refusal")
			}
			if enrolled, _ := dir.Enrolled(); enrolled {
				t.Error("a refused enrollment left the directory enrolled")
			}
		})
	}
}

// TestLoadIdentityRefusesATamperedDirectory asserts every verification LoadIdentity
// performs is one it actually performs.
func TestLoadIdentityRefusesATamperedDirectory(t *testing.T) {
	ca := newCA(t)
	other := newCA(t)

	for name, tamper := range map[string]func(t *testing.T, dir *Dir, e Enrollment){
		"a CA that does not match its pin": func(t *testing.T, dir *Dir, e Enrollment) {
			e.Record.AuthorityFingerprint = strings.Repeat("0", 64)
			writeRecord(t, dir, e.Record)
		},
		"a CA that is not the one that issued the certificate": func(t *testing.T, dir *Dir, e Enrollment) {
			e.Record.AuthorityPEM = other.PEM
			e.Record.AuthorityFingerprint = other.Fingerprint()
			writeRecord(t, dir, e.Record)
		},
		"a key that is not the certificate's": func(t *testing.T, dir *Dir, e Enrollment) {
			foreign, _, err := ca.IdentityPEM(runnerID, time.Now().Add(-time.Minute), time.Now().Add(time.Hour))
			if err != nil {
				t.Fatal(err)
			}
			certificate := e.IdentityPEM[:bytes.Index(e.IdentityPEM, []byte("-----BEGIN PRIVATE KEY"))]
			key := foreign[bytes.Index(foreign, []byte("-----BEGIN PRIVATE KEY")):]
			writeFile(t, dir, identityFile, append(append([]byte{}, certificate...), key...))
		},
		"an unreadable identity file": func(t *testing.T, dir *Dir, _ Enrollment) {
			writeFile(t, dir, identityFile, []byte("not a certificate"))
		},
		"a missing identity file": func(t *testing.T, dir *Dir, _ Enrollment) {
			if err := os.Remove(filepath.Join(dir.Path(), identityFile)); err != nil {
				t.Fatal(err)
			}
		},
		"a record naming another runner": func(t *testing.T, dir *Dir, e Enrollment) {
			e.Record.RunnerID = "someone-else"
			writeRecord(t, dir, e.Record)
		},
		"a record with an unknown mode": func(t *testing.T, dir *Dir, e Enrollment) {
			e.Record.SecurityMode = "none"
			writeRecord(t, dir, e.Record)
		},
		"a record that is not JSON": func(t *testing.T, dir *Dir, _ Enrollment) {
			writeFile(t, dir, recordFile, []byte("{"))
		},
		"a CA that is not PEM": func(t *testing.T, dir *Dir, e Enrollment) {
			e.Record.AuthorityPEM = "nonsense"
			writeRecord(t, dir, e.Record)
		},
	} {
		t.Run(name, func(t *testing.T) {
			dir := open(t)
			enrollment := mtlsEnrollment(t, ca, time.Hour)
			if err := dir.SaveEnrollment(enrollment); err != nil {
				t.Fatalf("save: %v", err)
			}
			tamper(t, dir, enrollment)
			if identity, err := dir.LoadIdentity(); err == nil {
				t.Fatalf("expected the tampered identity to be refused, loaded %v", identity)
			}
		})
	}
}

// TestARenewalReplacesThePair is the ordinary renewal: a new key and certificate, and a
// record describing them.
func TestARenewalReplacesThePair(t *testing.T) {
	dir := open(t)
	ca := newCA(t)
	enrollment := mtlsEnrollment(t, ca, time.Hour)
	if err := dir.SaveEnrollment(enrollment); err != nil {
		t.Fatal(err)
	}

	renewed, leaf, err := ca.IdentityPEM(runnerID, time.Now().Add(-time.Minute), time.Now().Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	record := enrollment.Record
	record.Serial = farmtest.Serial(leaf)
	record.NotAfter = leaf.NotAfter.UTC()
	record.RenewAfter = leaf.NotAfter.Add(-40 * time.Minute).UTC()
	record.RenewedAt = time.Now().UTC()
	if err := dir.SaveRenewal(record, renewed); err != nil {
		t.Fatalf("renew: %v", err)
	}

	identity, err := dir.LoadIdentity()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if identity.Record.Serial != farmtest.Serial(leaf) || identity.Record.Serial == enrollment.Record.Serial {
		t.Errorf("the renewal did not take: serial %s", identity.Record.Serial)
	}

	bearer := record
	bearer.SecurityMode = conn.SecurityBearerFallback
	if err := dir.SaveRenewal(bearer, renewed); err == nil {
		t.Error("expected a bearer identity's renewal to be refused")
	}
	if err := dir.SaveRenewal(enrollment.Record, renewed); err == nil {
		t.Error("expected a renewal whose record does not describe it to be refused")
	}
}

// TestACrashBetweenTheRenewalsTwoWritesIsReconciled is the crash SaveRenewal's ordering
// exists for: the new pair is on disk and the record still describes the old one.
func TestACrashBetweenTheRenewalsTwoWritesIsReconciled(t *testing.T) {
	dir := open(t)
	ca := newCA(t)
	enrollment := mtlsEnrollment(t, ca, 3*time.Hour) // renew-after is an hour before expiry
	if err := dir.SaveEnrollment(enrollment); err != nil {
		t.Fatal(err)
	}

	renewed, leaf, err := ca.IdentityPEM(runnerID, time.Now().Add(-time.Minute), time.Now().Add(6*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, identityFile, renewed) // ...and the process died here

	identity, err := dir.LoadIdentity()
	if err != nil {
		t.Fatalf("expected the renewal to be reconciled, got %v", err)
	}
	if identity.Record.Serial != farmtest.Serial(leaf) {
		t.Errorf("reconciled to serial %s, want %s", identity.Record.Serial, farmtest.Serial(leaf))
	}
	lead := enrollment.Record.NotAfter.Sub(enrollment.Record.RenewAfter)
	if got := identity.Record.NotAfter.Sub(identity.Record.RenewAfter); got != lead {
		t.Errorf("the renewal lead changed from %v to %v", lead, got)
	}

	// And the reconciled record was written, so the next load is ordinary.
	record, err := dir.Record()
	if err != nil || record.Serial != farmtest.Serial(leaf) {
		t.Errorf("the reconciled record was not saved: %v %s", err, record.Serial)
	}

	// A certificate from a CA the record does not pin is not a renewal to reconcile.
	foreign, _, err := newCA(t).IdentityPEM(runnerID, time.Now().Add(-time.Minute), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, identityFile, foreign)
	if _, err := dir.LoadIdentity(); err == nil {
		t.Error("expected a foreign certificate to be refused rather than reconciled")
	}
}

// TestAnIdentityDoesNotLogItsKey asserts the two ways an Identity is printed carry the
// runner and never the key.
func TestAnIdentityDoesNotLogItsKey(t *testing.T) {
	dir := open(t)
	enrollment := mtlsEnrollment(t, newCA(t), time.Hour)
	if err := dir.SaveEnrollment(enrollment); err != nil {
		t.Fatal(err)
	}
	identity, err := dir.LoadIdentity()
	if err != nil {
		t.Fatal(err)
	}
	identity.Bearer = secret.Secret("orb_bearer_not-a-real-secret")

	var logs bytes.Buffer
	slog.New(slog.NewJSONHandler(&logs, nil)).Info("connecting", "identity", identity)
	slog.New(slog.NewTextHandler(&logs, nil)).Info("connecting", "identity", identity)
	printed := logs.String() + fmt.Sprint(identity) + fmt.Sprintf("%v %s", identity, identity)

	keyBody := string(enrollment.IdentityPEM[bytes.Index(enrollment.IdentityPEM, []byte("-----BEGIN PRIVATE KEY")):])
	for _, line := range strings.Split(keyBody, "\n")[1:3] {
		if strings.Contains(printed, line) {
			t.Errorf("the private key reached a log line:\n%s", printed)
		}
	}
	if strings.Contains(printed, "not-a-real-secret") {
		t.Errorf("the bearer secret reached a log line:\n%s", printed)
	}
	if !strings.Contains(printed, runnerID) {
		t.Errorf("expected the runner id in the log:\n%s", printed)
	}
}

// TestSessionRoundTrips covers `hello.resume`'s source.
func TestSessionRoundTrips(t *testing.T) {
	dir := open(t)
	if dir.Session() != "" {
		t.Error("a fresh directory has no session")
	}
	if err := dir.SaveSession("sess_01KE7MV3WKAG706QMDN23AJ3BE"); err != nil {
		t.Fatal(err)
	}
	if got := dir.Session(); got != "sess_01KE7MV3WKAG706QMDN23AJ3BE" {
		t.Errorf("got %q", got)
	}
	if err := dir.SaveSession("not a session"); err == nil {
		t.Error("expected a malformed session id to be refused")
	}
	writeFile(t, dir, sessionFile, []byte("sess_garbage\n"))
	if got := dir.Session(); got != "" {
		t.Errorf("a malformed session file should be ignored, got %q", got)
	}
}

// TestParseAuthorityRefusesWhatIsNotACA covers the pin's own shape.
func TestParseAuthorityRefusesWhatIsNotACA(t *testing.T) {
	ca := newCA(t)
	identityPEM, _, err := ca.IdentityPEM(runnerID, time.Now().Add(-time.Minute), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	leafPEM := string(identityPEM[:bytes.Index(identityPEM, []byte("-----BEGIN PRIVATE KEY"))])

	for name, text := range map[string]string{
		"a leaf certificate":    leafPEM,
		"two certificates":      ca.PEM + ca.PEM,
		"a key":                 string(identityPEM[bytes.Index(identityPEM, []byte("-----BEGIN PRIVATE KEY")):]),
		"nothing at all":        "",
		"a corrupt certificate": "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
	} {
		if _, err := ParseAuthority(text); err == nil {
			t.Errorf("%s: expected a refusal", name)
		}
	}
	if _, err := ParseAuthority(ca.PEM); err != nil {
		t.Errorf("the CA itself was refused: %v", err)
	}
}

// writeRecord overwrites runner.json directly, as a tampering hand would.
func writeRecord(t *testing.T, dir *Dir, record Record) {
	t.Helper()
	if err := dir.saveRecord(record); err != nil {
		t.Fatal(err)
	}
}

// writeFile overwrites a file in the directory directly.
func writeFile(t *testing.T, dir *Dir, name string, data []byte) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir.Path(), name), data, 0o600); err != nil {
		t.Fatal(err)
	}
}
