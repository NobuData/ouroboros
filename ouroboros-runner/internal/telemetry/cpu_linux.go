package telemetry

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// procStat is where Linux publishes cumulative CPU time. Named for error messages; the
// parser takes a reader, and the source takes the /proc it reads from.
const procStat = "/proc/stat"

// cpuCounters is how many of the `cpu` line's counters are CPU time: user, nice, system,
// idle, iowait, irq, softirq, steal. The two after them — guest and guest_nice — are
// already counted inside user and nice, so adding them would count a virtual machine's
// time twice.
const cpuCounters = 8

// parseCPUTimes reads the machine-wide `cpu` line out of a /proc/stat stream.
//
// The line is `cpu  user nice system idle iowait irq softirq steal guest guest_nice`, in
// USER_HZ ticks summed over every CPU — which is what makes the result machine-wide
// regardless of core count. Idle is idle plus iowait: a CPU waiting on a disk is a CPU
// that is not running anything, which is the same line gopsutil and procps draw.
//
// Kernels older than 2.6 wrote four counters and later ones added the rest, so fewer
// than eight is read as zeros for the missing ones; fewer than four is not the file this
// parser knows. No error message quotes a counter: a failure is logged once per distinct
// message, and one that changed with every read would be logged on every pass.
func parseCPUTimes(source io.Reader) (cpuTimes, error) {
	scanner := bufio.NewScanner(source)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 0 || fields[0] != "cpu" {
			continue
		}
		values := fields[1:]
		if len(values) < 4 {
			return cpuTimes{}, fmt.Errorf("%s: the cpu line has %d counters, fewer than the four every kernel writes",
				procStat, len(values))
		}

		var counters [cpuCounters]uint64
		for index := range min(len(values), cpuCounters) {
			ticks, err := strconv.ParseUint(values[index], 10, 64)
			if err != nil {
				return cpuTimes{}, fmt.Errorf("%s: cpu counter %d is not a tick count", procStat, index+1)
			}
			counters[index] = ticks
		}

		var times cpuTimes
		for _, ticks := range counters {
			times.total += ticks
		}
		times.idle = counters[3] + counters[4]
		return times, nil
	}
	if err := scanner.Err(); err != nil {
		return cpuTimes{}, fmt.Errorf("%s: %w", procStat, err)
	}
	return cpuTimes{}, fmt.Errorf("%s: no cpu line", procStat)
}
