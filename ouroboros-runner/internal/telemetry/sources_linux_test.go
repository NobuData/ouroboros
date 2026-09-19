package telemetry

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestProcSourcesReadThisMachine runs the Linux sources against the real /proc: a CPU
// reading averaged over a short window, and memory that agrees with what `hello`
// reports as installed.
func TestProcSourcesReadThisMachine(t *testing.T) {
	proc := procSources("/proc")

	pct, err := proc.cpu(context.Background(), 200*time.Millisecond)
	if err != nil {
		t.Fatalf("read the CPU: %v", err)
	}
	if pct < 0 || pct > 100 {
		t.Errorf("utilisation %v is outside 0–100", pct)
	}

	memory := proc.memory()
	if memory.totalErr != nil || memory.usedErr != nil {
		t.Fatalf("read memory: total %v, used %v", memory.totalErr, memory.usedErr)
	}
	installed, err := TotalMemoryMB()
	if err != nil {
		t.Fatal(err)
	}
	if memory.totalMB != installed {
		t.Errorf("the heartbeat's total (%d MB) disagrees with hello's (%d MB)", memory.totalMB, installed)
	}
	if memory.usedMB < 0 || memory.usedMB > memory.totalMB {
		t.Errorf("%d MB in use of %d installed", memory.usedMB, memory.totalMB)
	}
}

// TestProcSourcesWithoutProc forces the condition a restricted container can present: a
// /proc without the files. Every measurement is an error — which the monitor turns into
// null — and none is a zero.
func TestProcSourcesWithoutProc(t *testing.T) {
	proc := procSources(t.TempDir())

	if pct, err := proc.cpu(context.Background(), time.Millisecond); err == nil {
		t.Errorf("expected an error from a /proc with no stat, got %v", pct)
	} else if !strings.Contains(err.Error(), "read CPU time") {
		t.Errorf("the error does not say what could not be read: %v", err)
	}
	memory := proc.memory()
	if memory.totalErr == nil || memory.usedErr == nil {
		t.Errorf("expected both memory figures to fail, got %+v", memory)
	}
}

// TestProcSourcesCPUStopsAtTheContext asserts a CPU window is abandoned, not sat out,
// when the agent is shutting down.
func TestProcSourcesCPUStopsAtTheContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	began := time.Now()
	if _, err := procSources("/proc").cpu(ctx, time.Hour); err == nil {
		t.Fatal("expected the context's error")
	}
	if elapsed := time.Since(began); elapsed > 5*time.Second {
		t.Errorf("the window was sat out for %v", elapsed)
	}
}

// TestMonitorOverProcNeverCarriesForward is the acceptance criterion end to end on the
// Linux sources: memory that stops being readable half-way through the agent's life
// becomes null on the next pass — not the last value it had — and comes back when the
// file does.
func TestMonitorOverProcNeverCarriesForward(t *testing.T) {
	root := t.TempDir()
	meminfo := filepath.Join(root, "meminfo")
	write := func() {
		t.Helper()
		if err := os.WriteFile(meminfo, []byte("MemTotal: 16777216 kB\nMemAvailable: 12582912 kB\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write()
	logs := &syncBuffer{}
	monitor := newMonitor(time.Millisecond, newTestLogger(logs), procSources(root))

	sample, _ := monitor.Measure(context.Background())
	if sample.MemoryTotalMB == nil || *sample.MemoryTotalMB != 16384 || sample.MemoryUsedMB == nil || *sample.MemoryUsedMB != 4096 {
		t.Fatalf("expected 4096 of 16384 MB, got %s", describeSample(sample))
	}

	if err := os.Remove(meminfo); err != nil {
		t.Fatal(err)
	}
	for range 3 {
		sample, _ = monitor.Measure(context.Background())
		if sample.MemoryTotalMB != nil || sample.MemoryUsedMB != nil {
			t.Fatalf("an unreadable /proc/meminfo carried a value forward: %s", describeSample(sample))
		}
	}

	write()
	sample, _ = monitor.Measure(context.Background())
	if sample.MemoryTotalMB == nil || *sample.MemoryTotalMB != 16384 {
		t.Errorf("memory did not come back with the file: %s", describeSample(sample))
	}
	if got := strings.Count(logs.String(), "metric=memory_total_mb"); got != 2 {
		t.Errorf("expected one line when memory failed and one when it recovered, got %d:\n%s", got, logs)
	}
}
