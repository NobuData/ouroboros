package telemetry

import (
	"context"
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"time"
)

// topPath is the absolute path to macOS's top, for the reason sysctlPath is absolute: a
// `top` earlier on somebody else's PATH would be reporting whatever it liked.
const topPath = "/usr/bin/top"

// topGrace is how long top may take beyond the window it was asked to wait before it is
// killed. A top that never returns is a sampler that never publishes again, so it is
// bounded rather than trusted.
const topGrace = 15 * time.Second

// topCPU is machine-wide CPU utilisation averaged over one window, from
// `top -l 2 -n 0 -s <window>`: two samples a window apart, no process rows, and the
// second sample's CPU line is the average between them.
//
// macOS publishes CPU ticks only through the Mach host_processor_info call, which Go can
// reach only through cgo — and cgo would make this module need a C toolchain to
// cross-compile, on the one platform ci/runner cannot natively build. A subprocess with
// an absolute path and constant arguments is the cheaper trade, and it runs in the
// monitor's goroutine, never on the connection's. The locale is pinned to C so the
// figures are written with a decimal point whatever the operator's is.
func topCPU(ctx context.Context, window time.Duration) (float64, error) {
	seconds := max(1, int(math.Round(window.Seconds())))
	ctx, cancel := context.WithTimeout(ctx, time.Duration(seconds)*time.Second+topGrace)
	defer cancel()

	// #nosec G204 -- an absolute path, constant arguments, and a number this agent formatted.
	command := exec.CommandContext(ctx, topPath, "-l", "2", "-n", "0", "-s", strconv.Itoa(seconds))
	command.Env = []string{"LC_ALL=C"}
	output, err := command.Output()
	if err != nil {
		return 0, fmt.Errorf("run %s: %w", topPath, err)
	}
	return parseTopCPU(output)
}
