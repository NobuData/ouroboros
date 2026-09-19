package telemetry

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// platformSources reads this Linux machine through /proc.
func platformSources() sources { return procSources("/proc") }

// procSources reads the machine through a procfs mounted at root.
//
// The root is a parameter so that a test can force the conditions the heartbeat has to
// survive — a /proc that lacks a file, or one that stops being readable half-way through
// the agent's life, which is what a restricted container can look like — without an
// override of any package state.
func procSources(root string) sources {
	stat := filepath.Join(root, "stat")
	meminfo := filepath.Join(root, "meminfo")

	return sources{
		cpu: func(ctx context.Context, window time.Duration) (float64, error) {
			before, err := readCPUTimes(stat)
			if err != nil {
				return 0, err
			}
			if !wait(ctx, window) {
				return 0, ctx.Err()
			}
			after, err := readCPUTimes(stat)
			if err != nil {
				return 0, err
			}
			return utilisation(before, after)
		},
		memory: func() memoryReading {
			file, err := os.Open(meminfo) // #nosec G304 -- procSources' own root, /proc outside tests
			if err != nil {
				failed := fmt.Errorf("read memory: %w", err)
				return memoryReading{totalErr: failed, usedErr: failed}
			}
			defer file.Close()
			return parseMemory(file)
		},
	}
}

// readCPUTimes reads cumulative CPU time from a /proc/stat file.
func readCPUTimes(path string) (cpuTimes, error) {
	file, err := os.Open(path) // #nosec G304 -- procSources' own root, /proc outside tests
	if err != nil {
		return cpuTimes{}, fmt.Errorf("read CPU time: %w", err)
	}
	defer file.Close()
	return parseCPUTimes(file)
}
