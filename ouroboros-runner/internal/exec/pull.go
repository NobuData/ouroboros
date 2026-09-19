package exec

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// referenceRe is the characters an image reference is made of — a registry host and port,
// a repository path, a tag or a digest — and nothing else. The image is server-supplied and
// goes into an API path, so it is held to this shape before it gets there.
var referenceRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/:@+-]*$`)

// ValidReference reports whether an image reference is one this executor will hand to the
// daemon: reference characters only, and no `..` path element that could steer an API path
// somewhere other than the image it names.
func ValidReference(image string) bool {
	if !referenceRe.MatchString(image) {
		return false
	}
	for _, element := range strings.Split(image, "/") {
		if element == ".." || element == "." || element == "" {
			return false
		}
	}
	return true
}

// SplitReference is an image reference as the pull API takes it: the repository, and the
// tag or digest.
//
// The tag is never empty. An empty `tag` asks the daemon to pull EVERY tag of the
// repository — so a reference with neither tag nor digest is `latest`, as the docker CLI
// reads it. A `:` before the last `/` is a registry port, not a tag; and a reference with
// both a tag and a digest is pulled by its digest, which is the one that cannot move.
func SplitReference(image string) (repository, tag string) {
	if at := strings.Index(image, "@"); at >= 0 {
		repository, digest := image[:at], image[at+1:]
		if colon := strings.LastIndex(repository, ":"); colon > strings.LastIndex(repository, "/") {
			repository = repository[:colon]
		}
		return repository, digest
	}
	if colon := strings.LastIndex(image, ":"); colon > strings.LastIndex(image, "/") {
		return image[:colon], image[colon+1:]
	}
	return image, "latest"
}

// pullReportEvery is the most often a pull reports progress: often enough that the run
// console moves, rarely enough that a many-layer pull is not a frame per daemon event.
const pullReportEvery = time.Second

// pullTracker turns the daemon's per-layer events into one percentage and one line.
//
// The daemon reports each layer separately — `Pulling fs layer`, then `Downloading` with a
// byte count and total, then `Download complete`, `Extracting` and `Pull complete` (or
// `Already exists` for a layer this machine shares with another image). The job's progress
// is the bytes downloaded over the bytes to download, across every layer whose size is
// known; a daemon that sends no sizes (Podman's compatible API, sometimes) still gets a
// line counting finished layers, and a percentage from that.
type pullTracker struct {
	image  string
	layers map[string]*layerProgress
	last   time.Time
	now    func() time.Time
}

// layerProgress is one layer's download.
type layerProgress struct {
	current, total int64
	done           bool
}

// newPullTracker tracks the pull of one image.
func newPullTracker(image string, now func() time.Time) *pullTracker {
	return &pullTracker{image: image, layers: map[string]*layerProgress{}, now: now}
}

// begin is the report a pull opens with, before the daemon has said anything. It starts
// the pacing clock, so the first event does not repeat it.
func (p *pullTracker) begin() (int, string) {
	p.last = p.now()
	return p.report()
}

// observe records one daemon event and reports whether enough time has passed since the
// last report to make another.
//
// A layer is counted from the first event that says it is one — `Pulling fs layer`,
// `Waiting`, `Downloading`, or `Already exists`. A daemon on the containerd image store
// also reports the manifest and config blobs, with nothing but `Download complete`; they
// are not layers, and counting them would leave a "2 of 3 layers" that never finishes.
func (p *pullTracker) observe(event PullEvent) bool {
	if event.ID != "" {
		layer, known := p.layers[event.ID]
		register := func() {
			if !known {
				layer, known = &layerProgress{}, true
				p.layers[event.ID] = layer
			}
		}
		switch event.Status {
		case "Pulling fs layer", "Waiting":
			register()
		case "Downloading":
			register()
			layer.current, layer.total = event.Progress.Current, max(event.Progress.Total, layer.total)
		case "Download complete", "Verifying Checksum":
			if known {
				layer.current = layer.total
			}
		case "Pull complete", "Already exists":
			register()
			layer.current, layer.done = layer.total, true
		}
	}
	if now := p.now(); p.last.IsZero() || now.Sub(p.last) >= pullReportEvery {
		p.last = now
		return true
	}
	return false
}

// report is the current percentage and line. It stays below 100 until the pull is over —
// 100 is reserved for [pullTracker.complete], so a console never shows a finished pull that
// is still going.
func (p *pullTracker) report() (int, string) {
	var current, total int64
	done := 0
	for _, layer := range p.layers {
		current, total = current+layer.current, total+layer.total
		if layer.done {
			done++
		}
	}
	layers := len(p.layers)
	pct := 0
	switch {
	case total > 0:
		pct = int(current * 100 / total)
	case layers > 0:
		pct = done * 100 / layers
	}
	pct = min(max(pct, 0), 99)

	note := fmt.Sprintf("pulling %s", p.image)
	if total > 0 {
		note += fmt.Sprintf(" — %s of %s", megabytes(current), megabytes(total))
	}
	if layers > 0 {
		note += fmt.Sprintf(", %d of %d layers", done, layers)
	}
	return pct, truncateNote(note)
}

// complete is the final report of a pull that finished.
func (p *pullTracker) complete() (int, string) {
	var total int64
	for _, layer := range p.layers {
		total += layer.total
	}
	note := fmt.Sprintf("pulled %s", p.image)
	if total > 0 {
		note += " — " + megabytes(total)
	}
	return 100, truncateNote(note)
}

// megabytes is a byte count as the docker CLI prints one: decimal megabytes, one place.
func megabytes(bytes int64) string {
	return fmt.Sprintf("%.1f MB", float64(bytes)/1e6)
}

// noteMax is the longest `job.progress` note the contract allows.
const noteMax = 256

// truncateNote bounds a progress note to what the contract allows, on a rune boundary.
func truncateNote(note string) string {
	runes := []rune(note)
	if len(runes) <= noteMax {
		return note
	}
	return string(runes[:noteMax-1]) + "…"
}
