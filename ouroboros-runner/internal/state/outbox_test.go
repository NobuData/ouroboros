package state

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// finishFixture is the protocol's worked job.finish, whose envelope id is below.
const (
	finishFixture = "../../../schemas/runner-protocol/fixtures/valid/job-finish.json"
	finishID      = "01KE7PDZMQDPKXES55PN5RZM7Q"
)

// finishFrame is the committed job.finish, carrying the given envelope id.
func finishFrame(t *testing.T, id string) []byte {
	t.Helper()
	raw, err := os.ReadFile(finishFixture)
	if err != nil {
		t.Fatalf("read the fixture: %v", err)
	}
	return bytes.Replace(raw, []byte(finishID), []byte(id), 1)
}

// TestTheOutboxSurvivesTheProcess is the reason this file exists: frames added by one
// process are re-sent, byte for byte and in mint order, by the next.
func TestTheOutboxSurvivesTheProcess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state")
	ids := []string{"01KE7PDZMQDPKXES55PN5RZM7Q", "01KE7PDZMQDPKXES55PN5RZM7R", "01KE7PDZMQDPKXES55PN5RZM7S"}

	dir, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	outbox, problems, err := dir.Outbox()
	if err != nil || len(problems) > 0 {
		t.Fatalf("open the outbox: %v %v", err, problems)
	}
	// Added out of order, to show the order on reload is the ids', not the adds'.
	for _, id := range []string{ids[2], ids[0], ids[1]} {
		if err := outbox.Add(id, finishFrame(t, id)); err != nil {
			t.Fatalf("add %s: %v", id, err)
		}
	}
	if err := outbox.Receipt(ids[1]); err != nil {
		t.Fatalf("receipt: %v", err)
	}
	_ = dir.Close() // ...the process ends

	dir, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dir.Close() }()
	reloaded, problems, err := dir.Outbox()
	if err != nil || len(problems) > 0 {
		t.Fatalf("reopen the outbox: %v %v", err, problems)
	}
	entries := reloaded.Entries()
	if len(entries) != 2 || entries[0].ID != ids[0] || entries[1].ID != ids[2] {
		t.Fatalf("reloaded %d entries: %+v", len(entries), entries)
	}
	if !bytes.Equal(entries[0].Frame, finishFrame(t, ids[0])) {
		t.Error("the reloaded frame is not byte-identical to the one added")
	}
	if reloaded.Len() != 2 {
		t.Errorf("Len is %d", reloaded.Len())
	}
}

// TestReceiptIsIdempotent asserts a receipt for a frame that is not pending — what a
// receipt duplicated by a reconnect looks like — is not an error.
func TestReceiptIsIdempotent(t *testing.T) {
	dir := open(t)
	outbox, _, err := dir.Outbox()
	if err != nil {
		t.Fatal(err)
	}
	if err := outbox.Add(finishID, finishFrame(t, finishID)); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := outbox.Receipt(finishID); err != nil {
			t.Errorf("receipt: %v", err)
		}
	}
	if err := outbox.Receipt("../../not-an-id"); err != nil {
		t.Errorf("a receipt naming nothing plausible should be ignored, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir.Path(), outboxDir, finishID+frameSuffix)); !os.IsNotExist(err) {
		t.Error("the receipted frame's file survived")
	}
}

// TestAddRefusesANameThatIsNotAnID asserts the outbox cannot be made to write outside
// itself.
func TestAddRefusesANameThatIsNotAnID(t *testing.T) {
	dir := open(t)
	outbox, _, err := dir.Outbox()
	if err != nil {
		t.Fatal(err)
	}
	if err := outbox.Add("../../escape", []byte("{}")); err == nil {
		t.Error("expected a path to be refused as an id")
	}
}

// TestAFrameTheAgentCannotVouchForIsMovedAside asserts nothing in the outbox reaches the
// gateway unless it is a legal terminal frame named for its own id — and that nothing
// is silently deleted either.
func TestAFrameTheAgentCannotVouchForIsMovedAside(t *testing.T) {
	heartbeat, err := os.ReadFile("../../../schemas/runner-protocol/fixtures/valid/heartbeat.json")
	if err != nil {
		t.Fatal(err)
	}
	for name, file := range map[string]struct {
		name  string
		frame []byte
	}{
		"not a frame at all":           {"01KE7PDZMQDPKXES55PN5RZM7Q.frame", []byte("{")},
		"a frame that is not terminal": {"01KE75YH3BXJEYV4F3EKH1QME1.frame", heartbeat},
		"a frame under another id":     {"01KE7PDZMQDPKXES55PN5RZM7R.frame", finishFrame(t, finishID)},
		"a name that is not an id":     {"latest.frame", finishFrame(t, finishID)},
	} {
		t.Run(name, func(t *testing.T) {
			dir := open(t)
			path := filepath.Join(dir.Path(), outboxDir, file.name)
			if err := os.WriteFile(path, file.frame, 0o600); err != nil {
				t.Fatal(err)
			}

			outbox, problems, err := dir.Outbox()
			if err != nil {
				t.Fatal(err)
			}
			if outbox.Len() != 0 {
				t.Error("an unvouched frame was queued for re-sending")
			}
			if len(problems) != 1 || !strings.Contains(problems[0], file.name) {
				t.Errorf("expected one problem naming %s, got %v", file.name, problems)
			}
			if _, err := os.Stat(path + ".invalid"); err != nil {
				t.Errorf("expected the file to be moved aside, not deleted: %v", err)
			}
		})
	}
}

// TestOtherFilesInTheOutboxAreIgnored asserts only `*.frame` files are frames — a file
// already moved aside is not re-examined every start.
func TestOtherFilesInTheOutboxAreIgnored(t *testing.T) {
	dir := open(t)
	if err := os.WriteFile(filepath.Join(dir.Path(), outboxDir, "old.frame.invalid"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	outbox, problems, err := dir.Outbox()
	if err != nil || len(problems) != 0 || outbox.Len() != 0 {
		t.Errorf("got %v %v %d", err, problems, outbox.Len())
	}
}
