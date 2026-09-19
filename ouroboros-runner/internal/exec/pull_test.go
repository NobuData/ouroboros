package exec

import (
	"strings"
	"testing"
	"time"
)

// TestSplitReference is an image reference as the pull API wants it. The tag is never
// empty, because an empty tag pulls every tag of the repository.
func TestSplitReference(t *testing.T) {
	for image, want := range map[string][2]string{
		"busybox":                              {"busybox", "latest"},
		"busybox:1.36":                         {"busybox", "1.36"},
		"zephyrprojectrtos/ci:v0.27.4":         {"zephyrprojectrtos/ci", "v0.27.4"},
		"registry.acme.dev:5000/sdk":           {"registry.acme.dev:5000/sdk", "latest"},
		"registry.acme.dev:5000/sdk:0.17":      {"registry.acme.dev:5000/sdk", "0.17"},
		"busybox@sha256:abc123":                {"busybox", "sha256:abc123"},
		"busybox:1.36@sha256:abc123":           {"busybox", "sha256:abc123"},
		"registry.acme.dev:5000/sdk@sha256:ff": {"registry.acme.dev:5000/sdk", "sha256:ff"},
	} {
		repository, tag := SplitReference(image)
		if repository != want[0] || tag != want[1] {
			t.Errorf("SplitReference(%q) = %q, %q; want %q, %q", image, repository, tag, want[0], want[1])
		}
	}
}

// TestValidReference holds a server-supplied image to the shape of a reference before it
// is put into an API path.
func TestValidReference(t *testing.T) {
	for _, image := range []string{
		"busybox", "busybox:1.36", "registry.acme.dev:5000/team/sdk:0.17", "busybox@sha256:abc",
		"registry.example.invalid/ouroboros/build-arm64:2026-09",
	} {
		if !ValidReference(image) {
			t.Errorf("%q should be a valid reference", image)
		}
	}
	for _, image := range []string{
		"", "../containers/create", "busybox/../../_ping", "busybox/./x", "a//b", "/busybox",
		"busybox?x=1", "busybox#frag", "busy box", "busybox;rm", "-rf",
	} {
		if ValidReference(image) {
			t.Errorf("%q should not be a valid reference", image)
		}
	}
}

// TestPullProgressIsBytesAcrossLayers turns a real pull's event sequence into one
// percentage and one line, never reaching 100 until the pull is over.
func TestPullProgressIsBytesAcrossLayers(t *testing.T) {
	clock := time.Unix(0, 0)
	tracker := newPullTracker("zephyr-sdk:0.17", func() time.Time { return clock })
	event := func(id, status string, current, total int64) PullEvent {
		var e PullEvent
		e.ID, e.Status = id, status
		e.Progress.Current, e.Progress.Total = current, total
		return e
	}

	if pct, note := tracker.begin(); pct != 0 || note != "pulling zephyr-sdk:0.17" {
		t.Errorf("begin = %d, %q", pct, note)
	}
	if tracker.observe(event("0.17", "Pulling from zephyr-sdk", 0, 0)) {
		t.Error("an event in the same second as the opening report was reported again")
	}
	tracker.observe(event("a", "Pulling fs layer", 0, 0))
	tracker.observe(event("b", "Already exists", 0, 0))
	// The containerd image store reports the manifest and config blobs this way. They
	// are not layers.
	tracker.observe(event("m", "Download complete", 0, 0))
	if tracker.observe(event("a", "Downloading", 250_000_000, 1_000_000_000)) {
		t.Error("an event inside the second was reported")
	}
	clock = clock.Add(time.Second)
	if !tracker.observe(event("a", "Downloading", 500_000_000, 1_000_000_000)) {
		t.Error("an event a second later was not reported")
	}
	pct, note := tracker.report()
	if pct != 50 || note != "pulling zephyr-sdk:0.17 — 500.0 MB of 1000.0 MB, 1 of 2 layers" {
		t.Errorf("report = %d, %q", pct, note)
	}
	if len(tracker.layers) != 2 {
		t.Errorf("only a and b are layers — not the `Pulling from` line, not a manifest blob: %v", tracker.layers)
	}

	tracker.observe(event("a", "Download complete", 0, 0))
	if pct, _ := tracker.report(); pct != 99 {
		t.Errorf("a downloaded but unextracted pull reads %d, not 99", pct)
	}
	tracker.observe(event("a", "Pull complete", 0, 0))
	if pct, note := tracker.complete(); pct != 100 || note != "pulled zephyr-sdk:0.17 — 1000.0 MB" {
		t.Errorf("complete = %d, %q", pct, note)
	}
}

// TestPullProgressWithoutSizes is a daemon that reports no byte counts: the line counts
// finished layers, and the percentage follows them.
func TestPullProgressWithoutSizes(t *testing.T) {
	tracker := newPullTracker("busybox", time.Now)
	for _, status := range []string{"Pulling fs layer", "Pull complete"} {
		var e PullEvent
		e.ID, e.Status = "a", status
		tracker.observe(e)
	}
	var e PullEvent
	e.ID, e.Status = "b", "Pulling fs layer"
	tracker.observe(e)
	if pct, note := tracker.report(); pct != 50 || note != "pulling busybox, 1 of 2 layers" {
		t.Errorf("report = %d, %q", pct, note)
	}
	if _, note := newPullTracker("busybox", time.Now).report(); note != "pulling busybox" {
		t.Errorf("before any event: %q", note)
	}
}

// TestNotesAreHeldToTheContract asserts a note never exceeds the 256 characters a
// job.progress allows, whatever the image is called.
func TestNotesAreHeldToTheContract(t *testing.T) {
	long := strings.Repeat("é", 400)
	if got := []rune(truncateNote(long)); len(got) != noteMax {
		t.Errorf("a note of %d runes", len(got))
	}
	if got := []rune(truncateDetail(strings.Repeat("x", 2000))); len(got) != detailMax {
		t.Errorf("a detail of %d runes", len(got))
	}
	if truncateNote("short") != "short" || truncateDetail("short") != "short" {
		t.Error("a short text was changed")
	}
}
