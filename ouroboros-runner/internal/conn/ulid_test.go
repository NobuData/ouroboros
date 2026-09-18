package conn

import (
	"bytes"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// fixedClock is a clock a test moves by hand.
type fixedClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fixedClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fixedClock) Set(at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = at
}

// TestNewIDIsAULID asserts the minted shape is the one the validator accepts — the
// same regular expression every envelope id is judged by.
func TestNewIDIsAULID(t *testing.T) {
	for range 100 {
		id := NewID()
		if !ulidRe.MatchString(id) {
			t.Fatalf("%q is not a ULID", id)
		}
	}
}

// TestMintEncodesTheMillisecond asserts the first ten characters are the mint time —
// the property that makes ids sort by time at all. 1469918176385 is the worked example
// of the ULID specification, whose time half is 01ARYZ6S41.
func TestMintEncodesTheMillisecond(t *testing.T) {
	clock := &fixedClock{now: time.UnixMilli(1469918176385)}
	minter := NewIDMinter(clock.Now, bytes.NewReader(make([]byte, 10)))

	id, err := minter.Mint()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if want := "01ARYZ6S41" + strings.Repeat("0", 16); id != want {
		t.Errorf("got %s, want %s", id, want)
	}
}

// TestMintIsMonotonicInsideOneMillisecond is the case the durable outbox depends on:
// ids minted in the same millisecond still sort in mint order, because the random half
// is incremented rather than redrawn.
func TestMintIsMonotonicInsideOneMillisecond(t *testing.T) {
	clock := &fixedClock{now: time.UnixMilli(1_700_000_000_000)}
	minter := NewIDMinter(clock.Now, bytes.NewReader(bytes.Repeat([]byte{0xAB}, 10)))

	var ids []string
	for range 1000 {
		id, err := minter.Mint()
		if err != nil {
			t.Fatalf("mint: %v", err)
		}
		ids = append(ids, id)
	}
	if !sort.StringsAreSorted(ids) {
		t.Fatal("ids minted in one millisecond do not sort in mint order")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Fatalf("minted %s twice", id)
		}
		seen[id] = true
	}
}

// TestMintSurvivesAClockSteppingBackwards asserts an NTP correction cannot make a later
// frame's id sort before an earlier one's.
func TestMintSurvivesAClockSteppingBackwards(t *testing.T) {
	clock := &fixedClock{now: time.UnixMilli(1_700_000_000_500)}
	minter := NewIDMinter(clock.Now, bytes.NewReader(bytes.Repeat([]byte{0x11}, 20)))

	first, err := minter.Mint()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	clock.Set(time.UnixMilli(1_700_000_000_000))
	second, err := minter.Mint()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if second <= first {
		t.Errorf("an id minted after the clock stepped back sorts first: %s <= %s", second, first)
	}
}

// TestMintCarriesAcrossTheRandomHalf asserts the increment carries out of the low 64
// bits into the high 16, and out of the whole random half into the next millisecond,
// rather than wrapping to a smaller id.
func TestMintCarriesAcrossTheRandomHalf(t *testing.T) {
	clock := &fixedClock{now: time.UnixMilli(1_700_000_000_000)}

	low := append([]byte{0x00, 0x00}, bytes.Repeat([]byte{0xFF}, 8)...)
	minter := NewIDMinter(clock.Now, bytes.NewReader(low))
	before, _ := minter.Mint()
	after, err := minter.Mint()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if after <= before {
		t.Errorf("the low-word carry wrapped: %s <= %s", after, before)
	}

	all := bytes.Repeat([]byte{0xFF}, 10)
	minter = NewIDMinter(clock.Now, bytes.NewReader(all))
	before, _ = minter.Mint()
	after, err = minter.Mint()
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if after <= before || after[:10] == before[:10] {
		t.Errorf("a full carry should move to the next millisecond: %s after %s", after, before)
	}
}

// TestMintReportsAFailedEntropySource asserts an id is never minted from a short read:
// an id that is not random is one that can collide with another agent's.
func TestMintReportsAFailedEntropySource(t *testing.T) {
	clock := &fixedClock{now: time.UnixMilli(1_700_000_000_000)}
	minter := NewIDMinter(clock.Now, bytes.NewReader([]byte{1, 2, 3}))

	if _, err := minter.Mint(); err == nil {
		t.Fatal("expected a short entropy read to be an error")
	}
}

// TestNewIDIsSafeForConcurrentUse mints from several goroutines at once — the
// heartbeat, the executor and the connection loop all do — and asserts no id repeats.
// The race detector (`make test`) is the other half of this assertion.
func TestNewIDIsSafeForConcurrentUse(t *testing.T) {
	const writers, each = 8, 500
	results := make(chan string, writers*each)
	var wg sync.WaitGroup
	for range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range each {
				results <- NewID()
			}
		}()
	}
	wg.Wait()
	close(results)

	seen := map[string]bool{}
	for id := range results {
		if seen[id] {
			t.Fatalf("minted %s twice", id)
		}
		seen[id] = true
	}
}

// failingReader is an entropy source that has stopped working.
type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("no entropy") }

// TestNewIDPanicsWithoutEntropy pins the documented behaviour of the package-level
// minter, by swapping in a broken source for the length of the test.
func TestNewIDPanicsWithoutEntropy(t *testing.T) {
	saved := defaultMinter
	defaultMinter = NewIDMinter(func() time.Time { return time.UnixMilli(1) }, failingReader{})
	defer func() { defaultMinter = saved }()

	defer func() {
		if recover() == nil {
			t.Error("expected NewID to panic when the entropy source fails")
		}
	}()
	NewID()
}
