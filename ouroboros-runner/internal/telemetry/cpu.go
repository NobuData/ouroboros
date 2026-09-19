package telemetry

import (
	"errors"
	"math"
)

// cpuTimes is the machine's cumulative CPU time, in the platform's ticks: how much of it
// has passed, and how much of that was idle. Utilisation is the difference between two of
// these, never one on its own — a single reading is the average since boot.
type cpuTimes struct {
	idle, total uint64
}

// The two windows that cannot be averaged. Their texts are fixed, because a failure is
// logged once per distinct text.
var (
	errNoTimePassed = errors.New("no CPU time passed during the window")
	errCountersBack = errors.New("the CPU counters went backwards during the window (a CPU taken offline?)")
)

// utilisation is the busy share of the CPU time that passed between two readings, as a
// percentage to one decimal place.
//
// A window whose counters went backwards is an error rather than a clamped number: a
// counter reset or a CPU taken offline mid-window leaves nothing true to average, and
// the heartbeat says null for that window instead of inventing a figure.
func utilisation(before, after cpuTimes) (float64, error) {
	if after.total < before.total || after.idle < before.idle {
		return 0, errCountersBack
	}
	total := after.total - before.total
	if total == 0 {
		return 0, errNoTimePassed
	}
	idle := min(after.idle-before.idle, total)
	return roundTenth(100 * float64(total-idle) / float64(total)), nil
}

// roundTenth rounds a percentage to one decimal place and holds it to 0–100. A tenth of
// a percent is finer than any meter draws, and it keeps the float a heartbeat carries
// short.
func roundTenth(pct float64) float64 {
	return min(max(math.Round(pct*10)/10, 0), 100)
}
