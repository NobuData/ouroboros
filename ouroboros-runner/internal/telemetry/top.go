package telemetry

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// parseTopCPU reads machine-wide CPU utilisation out of macOS `top -l 2 -n 0` output.
//
// Each sample top prints carries one line of the shape
//
//	CPU usage: 7.52% user, 13.87% sys, 78.60% idle
//
// and the LAST one is the reading: top's first sample has no previous one to difference
// against, so only the second is an average over the interval top was asked to wait.
// Utilisation is everything that was not idle, so a figure top adds to the line later is
// still counted.
//
// It lives outside the darwin build so the Linux CI tests it against recorded output:
// the one platform ci/runner cannot run a test on is the one whose parser most needs one.
func parseTopCPU(output []byte) (float64, error) {
	const prefix = "CPU usage:"

	var lines []string
	for _, line := range strings.Split(string(output), "\n") {
		if line = strings.TrimSpace(line); strings.HasPrefix(line, prefix) {
			lines = append(lines, line)
		}
	}
	if len(lines) < 2 {
		return 0, fmt.Errorf("top printed %d CPU usage lines, not the two a two-sample run prints", len(lines))
	}

	// Every part is held to `<figure>% <label>`, not only the idle one: a line written
	// with decimal commas splits into fragments that each look almost right, and the one
	// ending "% idle" would be read as a figure it is not.
	idle := math.NaN()
	for _, part := range strings.Split(strings.TrimPrefix(lines[len(lines)-1], prefix), ",") {
		figure, label, found := strings.Cut(strings.TrimSpace(part), "% ")
		value, err := strconv.ParseFloat(figure, 64)
		if !found || err != nil || math.IsNaN(value) || value < 0 || value > 100 {
			return 0, errors.New("top's CPU usage line is not a list of percentages")
		}
		if label == "idle" {
			idle = value
		}
	}
	if math.IsNaN(idle) {
		return 0, errors.New("top's CPU usage line has no idle figure")
	}
	return roundTenth(100 - idle), nil
}
