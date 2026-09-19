package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// The moving half of a heartbeat ([#245], decision B7): what this machine is doing now.
//
// Two rules shape everything here, and both are about not lying:
//
//   - A measurement this machine cannot take is NIL — sent as `null`, drawn as an em-dash
//     in the runners table. Never zero, because `0%` CPU on a machine that is mid-build is
//     worse than no reading: nobody doubts it.
//   - Nothing is carried forward. Every pass replaces every measurement, so a metric that
//     stops being collectable becomes nil on the next pass rather than repeating the last
//     value it had — a stale number renders exactly like a fresh one.
//
// And one rule about the log: a failure is reported when it starts and when it ends,
// never on every pass. A machine that cannot read its CPU cannot read it every five
// seconds, and a journal holding that sentence seventeen thousand times a day has hidden
// everything else in it.
//
// [#245]: https://github.com/NobuData/ouroboros/issues/245

// DefaultWindow is how long the CPU is watched for one reading. The utilisation a
// heartbeat reports is the average over a window like this one, not a single
// instantaneous sample — one sample is whatever the scheduler happened to be doing at
// that tick.
const DefaultWindow = 5 * time.Second

// staleWindows is how many windows old the newest sample may be before [Monitor.Latest]
// stops vouching for it. A pass takes one window; three without a new sample means the
// sampler is stuck, and what it last measured is no longer what the machine is doing.
const staleWindows = 3

// The metric names a collection failure is logged under — the heartbeat's own field
// names, so an operator can search the journal for the column that shows an em-dash.
const (
	metricCPU         = "cpu_pct"
	metricMemoryUsed  = "memory_used_mb"
	metricMemoryTotal = "memory_total_mb"
	metricSampler     = "sampler"
)

// errStale is a sampler that has stopped producing samples. Its text is fixed, because a
// condition is logged once per distinct text.
var errStale = errors.New("no sample has completed for three windows; every measurement is reported as null")

// Sample is one measurement of this machine.
//
// Every measurement is a pointer, and nil means NOT MEASURED: the platform could not
// provide it, or has not yet — which the heartbeat sends as `null`.
type Sample struct {
	// At is when the sample completed. Zero on a sample that vouches for nothing.
	At time.Time
	// CPUPct is machine-wide utilisation over one window, 0 to 100 regardless of core
	// count, to one decimal place.
	CPUPct *float64
	// MemoryUsedMB is machine-wide memory in use, in mebibytes.
	MemoryUsedMB *int
	// MemoryTotalMB is machine-wide memory installed, in mebibytes.
	MemoryTotalMB *int
}

// memoryReading is one read of machine-wide memory. The halves fail independently: a
// platform can know what is installed without being able to say what is in use.
type memoryReading struct {
	totalMB, usedMB   int
	totalErr, usedErr error
}

// sources is where a Monitor takes its readings from: the platform's (sources_linux.go,
// sources_darwin.go), or a test's.
type sources struct {
	// cpu watches the machine for one window and returns its average utilisation,
	// 0–100. It blocks for the window, and returns early with the context's error.
	cpu func(ctx context.Context, window time.Duration) (float64, error)
	// memory reads machine-wide memory now.
	memory func() memoryReading
}

// Monitor measures this machine in the background, one pass per window, and holds the
// newest sample for the heartbeat to read. It is safe for concurrent use.
type Monitor struct {
	window  time.Duration
	sources sources
	log     *slog.Logger
	now     func() time.Time

	mu     sync.Mutex
	latest Sample
	// failing is each metric's current failure, by its text; a metric absent from it is
	// being measured. It is what makes a failure one log line rather than one per pass.
	failing map[string]string
}

// NewMonitor is a monitor of this machine. A window of zero or less is [DefaultWindow];
// a nil logger is slog's default. Nothing is measured until [Monitor.Run] or
// [Monitor.Measure] is called.
func NewMonitor(window time.Duration, logger *slog.Logger) *Monitor {
	return newMonitor(window, logger, platformSources())
}

// newMonitor is [NewMonitor] over any sources — which is how a test forces a metric to
// fail.
func newMonitor(window time.Duration, logger *slog.Logger, from sources) *Monitor {
	if window <= 0 {
		window = DefaultWindow
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Monitor{window: window, sources: from, log: logger, now: time.Now, failing: map[string]string{}}
}

// Window is how long each CPU reading is averaged over.
func (m *Monitor) Window() time.Duration { return m.window }

// Run measures the machine until the context ends: memory at once, then a full sample
// every window.
//
// Memory is published before the first CPU window has closed, so a heartbeat sent the
// moment the agent connects carries the memory it can vouch for and a null CPU — nothing
// has been measured over a window yet, and saying so is the honest answer.
//
// A pass never starts sooner than a window after the last one began. A CPU reading that
// fails at once — a /proc/stat that is not there — returns without waiting out its
// window, and without the pacing the loop would spin on the failure, burning a core on
// the machine it is meant to be describing.
func (m *Monitor) Run(ctx context.Context) {
	m.publish(m.withMemory(Sample{}))
	for {
		began := time.Now()
		sample, ok := m.Measure(ctx)
		if !ok {
			return
		}
		m.publish(sample)
		if rest := m.window - time.Since(began); rest > 0 && !wait(ctx, rest) {
			return
		}
	}
}

// Measure takes one full sample — the CPU over one window, then memory — and returns it
// without publishing it. It blocks for the window, and reports false if the context
// ended before the sample was complete.
func (m *Monitor) Measure(ctx context.Context) (Sample, bool) {
	pct, err := m.sources.cpu(ctx, m.window)
	if ctx.Err() != nil {
		return Sample{}, false
	}
	sample := m.withMemory(Sample{})
	sample.CPUPct = measured(m, metricCPU, pct, err)
	return sample, true
}

// Latest is the newest sample, for a heartbeat.
//
// A sample older than three windows is not returned: the sampler has stopped, and what
// it last measured is no longer what the machine is doing — so every measurement is
// null, and the stall is logged once. Before the first sample there is nothing to vouch
// for either, and that is not a failure.
func (m *Monitor) Latest() Sample {
	m.mu.Lock()
	latest := m.latest
	m.mu.Unlock()

	if latest.At.IsZero() {
		return Sample{}
	}
	var stale error
	if m.now().Sub(latest.At) > staleWindows*m.window {
		stale = errStale
	}
	m.note(metricSampler, stale)
	if stale != nil {
		return Sample{}
	}
	return latest
}

// withMemory reads memory into a sample and stamps it complete.
func (m *Monitor) withMemory(sample Sample) Sample {
	reading := m.sources.memory()
	sample.MemoryTotalMB = measured(m, metricMemoryTotal, reading.totalMB, reading.totalErr)
	sample.MemoryUsedMB = measured(m, metricMemoryUsed, reading.usedMB, reading.usedErr)
	sample.At = m.now()
	return sample
}

// publish makes a sample the newest.
func (m *Monitor) publish(sample Sample) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.latest = sample
}

// wait blocks for a duration, or until the context ends. It reports whether the whole
// duration passed.
func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// measured is a reading as a measurement: the value, or nil when it could not be taken.
// It notes the metric's condition either way, so a failure is logged when it starts and
// when it clears, and never in between.
func measured[T any](m *Monitor, metric string, value T, err error) *T {
	m.note(metric, err)
	if err != nil {
		return nil
	}
	return &value
}

// note records a metric's condition and logs a change of it: one warning when a failure
// starts (or becomes a different failure), one line when it clears. The same failure,
// pass after pass, logs nothing more.
func (m *Monitor) note(metric string, err error) {
	m.mu.Lock()
	previous, wasFailing := m.failing[metric]
	switch {
	case err == nil && !wasFailing:
		m.mu.Unlock()
		return
	case err == nil:
		delete(m.failing, metric)
	case wasFailing && previous == err.Error():
		m.mu.Unlock()
		return
	default:
		m.failing[metric] = err.Error()
	}
	m.mu.Unlock()

	if err != nil {
		m.log.Warn("a heartbeat metric cannot be measured; it is reported as null until it can",
			"metric", metric, "error", err)
		return
	}
	m.log.Info("a heartbeat metric can be measured again", "metric", metric, "was", previous)
}
