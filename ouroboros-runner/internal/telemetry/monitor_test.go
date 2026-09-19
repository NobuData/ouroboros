package telemetry

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// The monitor's three promises, against sources a test controls: a measurement that
// cannot be taken is nil and never the last value; a failure is logged when it starts and
// when it ends, not on every pass; and a sampler that has stopped vouches for nothing.

// syncBuffer is a log sink safe for the monitor's goroutine and the test's.
type syncBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

// newTestLogger is the agent's text log, into a buffer.
func newTestLogger(sink *syncBuffer) *slog.Logger {
	return slog.New(slog.NewTextHandler(sink, nil))
}

// describeSample prints a sample's measurements, nil as nil, for a failure message.
func describeSample(sample Sample) string {
	show := func(value any) string {
		switch typed := value.(type) {
		case *float64:
			if typed != nil {
				return fmt.Sprint(*typed)
			}
		case *int:
			if typed != nil {
				return fmt.Sprint(*typed)
			}
		}
		return "nil"
	}
	return fmt.Sprintf("cpu=%s used=%s total=%s at=%v",
		show(sample.CPUPct), show(sample.MemoryUsedMB), show(sample.MemoryTotalMB), sample.At)
}

// scripted is a source whose readings the test sets between passes.
type scripted struct {
	mu      sync.Mutex
	cpu     float64
	cpuErr  error
	memory  memoryReading
	release chan struct{} // when set, a CPU reading waits for it
	reads   int           // CPU readings taken
}

func (s *scripted) set(update func(*scripted)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	update(s)
}

func (s *scripted) sources() sources {
	return sources{
		cpu: func(ctx context.Context, _ time.Duration) (float64, error) {
			s.mu.Lock()
			release := s.release
			s.mu.Unlock()
			if release != nil {
				select {
				case <-release:
				case <-ctx.Done():
					return 0, ctx.Err()
				}
			}
			s.mu.Lock()
			defer s.mu.Unlock()
			s.reads++
			return s.cpu, s.cpuErr
		},
		memory: func() memoryReading {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.memory
		},
	}
}

// healthy is a source reading 42.5% CPU and 4096 of 16384 MB.
func healthy() *scripted {
	return &scripted{cpu: 42.5, memory: memoryReading{totalMB: 16384, usedMB: 4096}}
}

// TestMeasureReportsEveryReading is the ordinary pass: every measurement present.
func TestMeasureReportsEveryReading(t *testing.T) {
	monitor := newMonitor(time.Millisecond, newTestLogger(&syncBuffer{}), healthy().sources())

	sample, ok := monitor.Measure(context.Background())
	if !ok {
		t.Fatal("the pass did not complete")
	}
	if sample.CPUPct == nil || *sample.CPUPct != 42.5 ||
		sample.MemoryUsedMB == nil || *sample.MemoryUsedMB != 4096 ||
		sample.MemoryTotalMB == nil || *sample.MemoryTotalMB != 16384 || sample.At.IsZero() {
		t.Errorf("unexpected sample: %s", describeSample(sample))
	}
}

// TestAFailedReadingIsNullNotTheLastValue is the no-stale-carry-forward criterion: a
// metric that stops being collectable becomes nil on the very next pass, and each half of
// memory fails on its own.
func TestAFailedReadingIsNullNotTheLastValue(t *testing.T) {
	source := healthy()
	monitor := newMonitor(time.Millisecond, newTestLogger(&syncBuffer{}), source.sources())
	if sample, _ := monitor.Measure(context.Background()); sample.CPUPct == nil {
		t.Fatalf("the healthy pass measured nothing: %s", describeSample(sample))
	}

	source.set(func(s *scripted) {
		s.cpuErr = errors.New("permission denied")
		s.memory.usedErr = errors.New("no MemAvailable line")
	})
	sample, _ := monitor.Measure(context.Background())
	if sample.CPUPct != nil || sample.MemoryUsedMB != nil {
		t.Errorf("a failed reading repeated a value: %s", describeSample(sample))
	}
	if sample.MemoryTotalMB == nil || *sample.MemoryTotalMB != 16384 {
		t.Errorf("a failure of memory in use took the total with it: %s", describeSample(sample))
	}
}

// TestAFailureIsLoggedOncePerCondition is the log criterion: one warning when a metric
// starts failing, silence while it keeps failing the same way, a warning again if it
// fails a different way, and one line when it recovers.
func TestAFailureIsLoggedOncePerCondition(t *testing.T) {
	logs := &syncBuffer{}
	source := healthy()
	monitor := newMonitor(time.Millisecond, newTestLogger(logs), source.sources())
	count := func(text string) int { return strings.Count(logs.String(), text) }

	for range 5 {
		monitor.Measure(context.Background())
	}
	if logs.String() != "" {
		t.Fatalf("healthy passes logged:\n%s", logs)
	}

	source.set(func(s *scripted) { s.cpuErr = errors.New("open /proc/stat: permission denied") })
	for range 100 {
		monitor.Measure(context.Background())
	}
	if got := count("cannot be measured"); got != 1 {
		t.Errorf("a hundred failing passes logged %d warnings, want 1:\n%s", got, logs)
	}
	if !strings.Contains(logs.String(), "level=WARN") || !strings.Contains(logs.String(), "metric=cpu_pct") ||
		!strings.Contains(logs.String(), "permission denied") {
		t.Errorf("the warning does not say which metric failed and why:\n%s", logs)
	}

	source.set(func(s *scripted) { s.cpuErr = errors.New("open /proc/stat: no such file or directory") })
	for range 10 {
		monitor.Measure(context.Background())
	}
	if got := count("cannot be measured"); got != 2 {
		t.Errorf("a different failure should be one more warning; got %d:\n%s", got, logs)
	}

	source.set(func(s *scripted) { s.cpuErr = nil })
	for range 10 {
		monitor.Measure(context.Background())
	}
	if got := count("can be measured again"); got != 1 {
		t.Errorf("recovery logged %d lines, want 1:\n%s", got, logs)
	}
}

// TestRunPublishesMemoryBeforeTheFirstWindow asserts the first heartbeat after start has
// something true to say: memory at once, and CPU null until a window has been measured —
// not a zero standing in for it.
func TestRunPublishesMemoryBeforeTheFirstWindow(t *testing.T) {
	source := healthy()
	release := make(chan struct{})
	source.set(func(s *scripted) { s.release = release })
	logs := &syncBuffer{}
	monitor := newMonitor(time.Hour, newTestLogger(logs), source.sources())

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		monitor.Run(ctx)
	}()
	defer func() {
		cancel()
		<-stopped
	}()

	first := waitForSample(t, monitor, func(s Sample) bool { return !s.At.IsZero() })
	if first.CPUPct != nil {
		t.Errorf("CPU was reported before a window was measured: %s", describeSample(first))
	}
	if first.MemoryTotalMB == nil || first.MemoryUsedMB == nil {
		t.Errorf("memory was not published at once: %s", describeSample(first))
	}

	release <- struct{}{}
	measured := waitForSample(t, monitor, func(s Sample) bool { return s.CPUPct != nil })
	if *measured.CPUPct != 42.5 {
		t.Errorf("expected the window's 42.5%%, got %s", describeSample(measured))
	}
	if strings.Contains(logs.String(), "cannot be measured") {
		t.Errorf("a CPU not yet measured was logged as a failure:\n%s", logs)
	}
}

// TestRunStopsWithTheContext asserts the sampler ends with the agent, mid-window.
func TestRunStopsWithTheContext(t *testing.T) {
	source := healthy()
	source.set(func(s *scripted) { s.release = make(chan struct{}) }) // a window that never closes
	monitor := newMonitor(time.Hour, newTestLogger(&syncBuffer{}), source.sources())

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		monitor.Run(ctx)
	}()
	waitForSample(t, monitor, func(s Sample) bool { return !s.At.IsZero() })
	cancel()
	select {
	case <-stopped:
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return when its context ended")
	}

	if _, ok := monitor.Measure(ctx); ok {
		t.Error("a pass on an ended context reported itself complete")
	}
}

// TestRunPacesAFailingSource asserts a CPU reading that fails at once — returning before
// its window, as an unreadable /proc/stat does — does not turn the sampler into a busy
// loop. Found running the agent in a container with /proc/stat hidden: without the pacing
// it held a core and a half re-reading a file that was not there.
func TestRunPacesAFailingSource(t *testing.T) {
	source := healthy()
	source.set(func(s *scripted) { s.cpuErr = errors.New("/proc/stat: no cpu line") })
	window := 50 * time.Millisecond
	monitor := newMonitor(window, newTestLogger(&syncBuffer{}), source.sources())

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		monitor.Run(ctx)
	}()
	time.Sleep(10 * window)
	cancel()
	<-stopped

	var reads int
	source.set(func(s *scripted) { reads = s.reads })
	// Ten windows is about ten passes; a spinning loop makes thousands.
	if reads < 2 || reads > 20 {
		t.Errorf("ten windows took %d CPU readings, want about ten", reads)
	}
}

// TestAStalledSamplerVouchesForNothing asserts a sample older than three windows is not
// reported: what the machine was doing then is not what it is doing now. The stall is
// logged once, and a fresh sample clears it.
func TestAStalledSamplerVouchesForNothing(t *testing.T) {
	logs := &syncBuffer{}
	monitor := newMonitor(time.Second, newTestLogger(logs), healthy().sources())
	clock := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	monitor.now = func() time.Time { return clock }

	if got := monitor.Latest(); !got.At.IsZero() || got.CPUPct != nil {
		t.Errorf("before any sample, expected nothing: %s", describeSample(got))
	}

	sample, _ := monitor.Measure(context.Background())
	monitor.publish(sample)
	clock = clock.Add(3 * time.Second)
	if got := monitor.Latest(); got.CPUPct == nil {
		t.Errorf("a sample three windows old should still be reported: %s", describeSample(got))
	}

	clock = clock.Add(time.Millisecond)
	for range 10 {
		if got := monitor.Latest(); got.CPUPct != nil || got.MemoryUsedMB != nil || got.MemoryTotalMB != nil {
			t.Fatalf("a stale sample was reported: %s", describeSample(got))
		}
	}
	if got := strings.Count(logs.String(), "metric=sampler"); got != 1 {
		t.Errorf("the stall was logged %d times, want 1:\n%s", got, logs)
	}

	sample, _ = monitor.Measure(context.Background())
	monitor.publish(sample)
	if got := monitor.Latest(); got.CPUPct == nil {
		t.Errorf("a fresh sample was not reported: %s", describeSample(got))
	}
	if !strings.Contains(logs.String(), "can be measured again") {
		t.Errorf("the recovery was not logged:\n%s", logs)
	}
}

// TestNewMonitorDefaults asserts a zero window is the documented default, not a busy
// loop, and that the platform sources are wired.
func TestNewMonitorDefaults(t *testing.T) {
	monitor := NewMonitor(0, nil)
	if monitor.Window() != DefaultWindow {
		t.Errorf("expected the default window %v, got %v", DefaultWindow, monitor.Window())
	}
	if monitor.sources.cpu == nil || monitor.sources.memory == nil || monitor.log == nil {
		t.Error("the platform sources or the logger are missing")
	}
}

// TestMonitorIsSafeForConcurrentUse runs the sampler, the heartbeat's reads and a failing
// source at once, for the race detector.
func TestMonitorIsSafeForConcurrentUse(t *testing.T) {
	source := healthy()
	monitor := newMonitor(time.Millisecond, newTestLogger(&syncBuffer{}), source.sources())
	ctx, cancel := context.WithCancel(context.Background())
	var group sync.WaitGroup
	group.Add(3)
	go func() { defer group.Done(); monitor.Run(ctx) }()
	go func() {
		defer group.Done()
		for ctx.Err() == nil {
			monitor.Latest()
		}
	}()
	go func() {
		defer group.Done()
		for index := 0; ctx.Err() == nil; index++ {
			source.set(func(s *scripted) {
				s.cpuErr = nil
				if index%2 == 0 {
					s.cpuErr = errors.New("flapping")
				}
			})
		}
	}()
	time.Sleep(100 * time.Millisecond)
	cancel()
	group.Wait()
}

// waitForSample polls Latest until a condition holds.
func waitForSample(t *testing.T, monitor *Monitor, condition func(Sample) bool) Sample {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		if sample := monitor.Latest(); condition(sample) {
			return sample
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out; the newest sample is %s", describeSample(monitor.Latest()))
		}
		time.Sleep(time.Millisecond)
	}
}
