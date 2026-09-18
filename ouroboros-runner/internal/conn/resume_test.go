package conn

import (
	"bytes"
	"sync"
	"testing"
)

// The two halves of resume, asserted against the sentence the contract is written in: a
// job.finish sent as a socket drops must not become two finished jobs.

// TestLedgerDeduplicatesByID is the receiver's half. The second copy of a terminal
// frame's id is a duplicate, and every copy after it is too — because the agent keeps
// re-sending until it hears a receipt, and a receipt lost twice means a frame sent three
// times.
func TestLedgerDeduplicatesByID(t *testing.T) {
	const finish = "01KE7PDZMQDPKXES55PN5RZM7Q"
	ledger := NewLedger()

	if ledger.Record(finish) {
		t.Error("the first copy of a frame is not a duplicate")
	}
	for attempt := 2; attempt <= 4; attempt++ {
		if !ledger.Record(finish) {
			t.Errorf("copy %d of the same id was not reported as a duplicate", attempt)
		}
	}
	if ledger.Len() != 1 {
		t.Errorf("expected one finished job on the ledger, got %d", ledger.Len())
	}

	// A different job is a different frame, whatever else it has in common.
	if ledger.Record("01KE7B4TECGD3HCS900QAD3JZG") {
		t.Error("a different id was reported as a duplicate")
	}
	if ledger.Len() != 2 {
		t.Errorf("expected two finished jobs on the ledger, got %d", ledger.Len())
	}
}

// TestOutboxReSendsByteForByte is the sender's half, and the byte-for-byte part is the
// whole of it.
//
// The receiver recognises a re-send by the envelope id inside it. Re-encoding the frame
// from the job record is how that id — or a timestamp, or a float's formatting — quietly
// changes, and a re-send that is not recognised is a second finished job. So the Outbox
// stores the bytes that went out and hands those same bytes back.
func TestOutboxReSendsByteForByte(t *testing.T) {
	const id = "01KE7PDZMQDPKXES55PN5RZM7Q"
	sent := readFixture(t, "valid/job-finish.json")

	outbox := NewOutbox()
	outbox.Add(id, sent)

	pending := outbox.Pending()
	if len(pending) != 1 {
		t.Fatalf("expected one pending frame, got %d", len(pending))
	}
	if !bytes.Equal(pending[0], sent) {
		t.Error("the frame handed back is not the frame that was sent")
	}

	// Stored rather than aliased: a caller that reuses its buffer must not be able to
	// change what will be re-sent.
	pending[0][0] = 'X'
	if again := outbox.Pending(); !bytes.Equal(again[0], sent) {
		t.Error("mutating the returned frame changed what the outbox holds")
	}
}

// TestOutboxKeepsMintOrder asserts two jobs that finished in a known order are re-sent
// in that order, so a control plane reading its own log sees the sequence that happened
// rather than a map iteration.
func TestOutboxKeepsMintOrder(t *testing.T) {
	first := readFixture(t, "valid/job-finish.json")
	second := readFixture(t, "valid/job-finish-failed.json")

	outbox := NewOutbox()
	outbox.Add("01KE7PDZMQDPKXES55PN5RZM7Q", first)
	outbox.Add("01KE7B4TECGD3HCS900QAD3JZG", second)

	pending := outbox.Pending()
	if len(pending) != 2 {
		t.Fatalf("expected two pending frames, got %d", len(pending))
	}
	if !bytes.Equal(pending[0], first) || !bytes.Equal(pending[1], second) {
		t.Error("the frames came back out of mint order")
	}

	// A receipt for the first leaves the second where it was, still next.
	outbox.Receipt("01KE7PDZMQDPKXES55PN5RZM7Q")
	pending = outbox.Pending()
	if len(pending) != 1 || !bytes.Equal(pending[0], second) {
		t.Errorf("expected only the unacknowledged frame to remain, got %d frame(s)", len(pending))
	}
}

// TestOutboxIgnoresWhatItDoesNotHold covers the two calls a reconnection makes that
// would otherwise be errors: re-adding a frame that is still pending, and a receipt
// arriving twice.
//
// Both happen in normal operation. A socket that dropped after the receipt was written
// but before it was read delivers that receipt again on the next connection, and an
// agent replaying its own queue may hand the same frame back. Neither is a fault, and
// neither may lose or duplicate a frame.
func TestOutboxIgnoresWhatItDoesNotHold(t *testing.T) {
	const id = "01KE7PDZMQDPKXES55PN5RZM7Q"
	sent := readFixture(t, "valid/job-finish.json")

	outbox := NewOutbox()
	outbox.Add(id, sent)
	outbox.Add(id, []byte(`{"v":1}`)) // the first copy is the one that will be re-sent

	if outbox.Len() != 1 {
		t.Fatalf("expected one pending frame after a repeated add, got %d", outbox.Len())
	}
	if !bytes.Equal(outbox.Pending()[0], sent) {
		t.Error("a repeated add replaced the frame that had already been sent")
	}

	outbox.Receipt(id)
	outbox.Receipt(id)                           // the same receipt, redelivered
	outbox.Receipt("01KE7B4TECGD3HCS900QAD3JZG") // a receipt for something else
	if outbox.Len() != 0 {
		t.Errorf("expected an empty outbox, got %d frame(s)", outbox.Len())
	}
	if pending := outbox.Pending(); len(pending) != 0 {
		t.Errorf("expected nothing pending, got %d frame(s)", len(pending))
	}
}

// TestResumeIsConcurrencySafe asserts what the types promise, because the executor
// finishes jobs on one goroutine and the connection loop re-sends them on another.
//
// Run with -race, which is how ci/runner runs the suite, this is the test that would
// fail if a lock were dropped.
func TestResumeIsConcurrencySafe(t *testing.T) {
	const writers = 8
	const perWriter = 50

	outbox := NewOutbox()
	ledger := NewLedger()
	frame := readFixture(t, "valid/job-finish.json")

	var group sync.WaitGroup
	for range writers {
		group.Add(1)
		go func() {
			defer group.Done()
			for range perWriter {
				// Every goroutine works on the same id, which is the contended case:
				// one job finishing while the connection loop re-sends it.
				const id = "01KE7PDZMQDPKXES55PN5RZM7Q"
				outbox.Add(id, frame)
				_ = outbox.Pending()
				_ = outbox.Len()
				ledger.Record(id)
				_ = ledger.Len()
			}
		}()
	}
	group.Wait()

	if ledger.Len() != 1 {
		t.Errorf("expected one distinct frame on the ledger, got %d", ledger.Len())
	}
	if outbox.Len() != 1 {
		t.Errorf("expected one pending frame, got %d", outbox.Len())
	}
}

// TestOutboxEntriesCarryTheirIDs asserts Entries is Pending with the ids beside it: the
// same order, the same bytes, and copies rather than the stored buffers.
func TestOutboxEntriesCarryTheirIDs(t *testing.T) {
	outbox := NewOutbox()
	outbox.Add("01KE7PDZMQDPKXES55PN5RZM7Q", []byte("first"))
	outbox.Add("01KE7PDZMQDPKXES55PN5RZM7R", []byte("second"))

	entries := outbox.Entries()
	if len(entries) != 2 || entries[0].ID != "01KE7PDZMQDPKXES55PN5RZM7Q" ||
		string(entries[1].Frame) != "second" {
		t.Fatalf("got %+v", entries)
	}
	entries[0].Frame[0] = 'X'
	if string(outbox.Pending()[0]) != "first" {
		t.Error("editing an entry edited the queued frame")
	}
}

// TestValidID is the envelope-id shape, exported for the outbox's file names.
func TestValidID(t *testing.T) {
	if !ValidID("01KE7PDZMQDPKXES55PN5RZM7Q") {
		t.Error("a ULID was refused")
	}
	for _, bad := range []string{"", "../../etc/passwd", "01KE7PDZMQDPKXES55PN5RZM7", "01KE7PDZMQDPKXES55PN5RZM7U"} {
		if ValidID(bad) {
			t.Errorf("%q was accepted", bad)
		}
	}
}
