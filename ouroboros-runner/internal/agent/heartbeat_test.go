package agent

import (
	"sync"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/telemetry"
)

// The heartbeat's telemetry and presence (#245): what the connection loop reports about
// this machine and its work, against the in-process farm, which judges every frame by
// the published contract.

// sampled is a Telemetry that always reports one sample.
type sampled telemetry.Sample

func (s sampled) Latest() telemetry.Sample { return telemetry.Sample(s) }

// measuring is a machine at a fixed load: cpu percent, and memory used of total, in MiB.
func measuring(cpu float64, usedMB, totalMB int) Telemetry {
	return sampled{At: time.Now(), CPUPct: &cpu, MemoryUsedMB: &usedMB, MemoryTotalMB: &totalMB}
}

// productionLimits are the gateway's own operating values (#251): a heartbeat every ten
// seconds, give or take two.
var productionLimits = conn.Limits{
	HeartbeatIntervalMS: 10000,
	HeartbeatJitterMS:   2000,
	LogChunkMaxBytes:    32768,
	LogRateBytesPerS:    262144,
	OfferAckMS:          5000,
	ResumeWindowMS:      300000,
}

// TestTheFirstHeartbeatArrivesWithinOneInterval is the first acceptance criterion: a
// runner is visible server-side within one heartbeat interval of the agent starting —
// because the first beat is sent the moment the session opens, not an interval after it.
func TestTheFirstHeartbeatArrivesWithinOneInterval(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	farm.SetLimits(productionLimits)
	dir := enrolled(t, farm, false)

	began := time.Now()
	h := start(t, farm, dir, nil)
	observed := h.until("the first heartbeat", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	interval := time.Duration(productionLimits.HeartbeatIntervalMS) * time.Millisecond
	if elapsed := time.Since(began); elapsed >= interval {
		t.Errorf("the first heartbeat took %v, longer than the %v interval", elapsed, interval)
	}
	if beat := observed.Heartbeats[0]; beat.CPUPct == nil || beat.MemoryTotalMB == nil {
		t.Errorf("the first heartbeat carried no telemetry: %+v", beat)
	}
}

// TestAMetricThatCannotBeMeasuredIsSentAsNull is the null criterion through the whole
// connection: an agent whose platform measured nothing sends `null` for each measurement
// — never a zero — and the farm, judging by the published contract, accepts every beat.
func TestAMetricThatCannotBeMeasuredIsSentAsNull(t *testing.T) {
	t.Parallel()
	for name, source := range map[string]Telemetry{
		"nothing measured":   sampled{},
		"no telemetry wired": nil,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			farm := farmtest.NewFarm(t)
			h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Telemetry = source })

			observed := h.until("two heartbeats", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 2 })
			for _, beat := range observed.Heartbeats {
				if beat.CPUPct != nil || beat.MemoryUsedMB != nil || beat.MemoryTotalMB != nil {
					t.Errorf("an unmeasured metric was sent as a value: %+v", beat)
				}
			}
			if len(observed.Violations) > 0 {
				t.Errorf("the farm refused a heartbeat with nulls: %v", observed.Violations)
			}
		})
	}
}

// TestAMeasurementThatStopsIsNotCarriedForward asserts the heartbeat reads the telemetry
// fresh at every beat: a measurement that disappears between two beats is null in the
// second, not the first beat's value again.
func TestAMeasurementThatStopsIsNotCarriedForward(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	source := &switchable{}
	source.set(measuring(82, 14200, 32000).Latest())
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) { c.Telemetry = source })

	h.until("a measured heartbeat", func(o farmtest.Observed) bool {
		return len(o.Heartbeats) >= 1 && o.Heartbeats[0].CPUPct != nil && *o.Heartbeats[0].CPUPct == 82
	})
	source.set(telemetry.Sample{})
	observed := h.until("a heartbeat after the CPU stopped being measurable", func(o farmtest.Observed) bool {
		last := o.Heartbeats[len(o.Heartbeats)-1]
		return last.CPUPct == nil
	})
	if last := observed.Heartbeats[len(observed.Heartbeats)-1]; last.MemoryUsedMB != nil || last.MemoryTotalMB != nil {
		t.Errorf("the last heartbeat repeated a measurement it no longer had: %+v", last)
	}
}

// switchable is a Telemetry a test changes between beats.
type switchable struct {
	mu     sync.Mutex
	sample telemetry.Sample
}

func (s *switchable) set(sample telemetry.Sample) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sample = sample
}

func (s *switchable) Latest() telemetry.Sample {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sample
}

// TestHeartbeatReportsTheWorkload is the queue criterion through the connection: the
// workload the executors keep is what the heartbeat carries — `busy`, the running job's
// phase and progress, and a queue depth counting only the jobs accepted and not started.
func TestHeartbeatReportsTheWorkload(t *testing.T) {
	t.Parallel()
	farm := farmtest.NewFarm(t)
	h := start(t, farm, enrolled(t, farm, false), nil)
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	const running, waiting, behind = "job_01KE7J4EZ3204KQXMHJRPQPWQ6", "job_01KE7J4EZ3204KQXMHJRPQPWQ7", "job_01KE7J4EZ3204KQXMHJRPQPWQ8"
	work := h.agent.Workload()
	work.Accepted(running)
	work.Accepted(waiting)
	work.Accepted(behind)
	if err := work.Started(running, conn.PhaseFetch); err != nil {
		t.Fatal(err)
	}
	if err := work.Progress(running, conn.PhaseRun, 62); err != nil {
		t.Fatal(err)
	}

	// A beat may fall between Started and Progress; the one asserted on is after both.
	observed := h.until("a busy heartbeat in the run phase", func(o farmtest.Observed) bool {
		last := o.Heartbeats[len(o.Heartbeats)-1]
		return last.State == conn.StateBusy && last.Job != nil && last.Job.Phase == conn.PhaseRun
	})
	beat := observed.Heartbeats[len(observed.Heartbeats)-1]
	if beat.QueueDepth != 2 {
		t.Errorf("one running and two waiting is q:2, got q:%d", beat.QueueDepth)
	}
	if beat.Job == nil || *beat.Job != (conn.HeartbeatJob{ID: running, Phase: conn.PhaseRun, Pct: 62}) {
		t.Errorf("the running job: %+v", beat.Job)
	}

	work.Finished(running)
	work.Finished(waiting) // cancelled before it started
	observed = h.until("an idle heartbeat again", func(o farmtest.Observed) bool {
		return o.Heartbeats[len(o.Heartbeats)-1].State == conn.StateIdle
	})
	if beat := observed.Heartbeats[len(observed.Heartbeats)-1]; beat.QueueDepth != 1 || beat.Job != nil {
		t.Errorf("after the finish and the cancellation: %+v", beat)
	}
	if len(observed.Violations) > 0 {
		t.Errorf("the farm refused a heartbeat: %v", observed.Violations)
	}
}

// TestNewHeartbeat is the heartbeat's own rules, one at a time: measurements passed
// through as measured or as null, the state's precedence, and uptime counted from the
// process's start.
func TestNewHeartbeat(t *testing.T) {
	started := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	now := started.Add(41*24*time.Hour + 500*time.Millisecond)
	measured := measuring(4.5, 1280, 16384).Latest()

	idle := NewHeartbeat(now, started, measured, &Workload{}, false)
	if idle.State != conn.StateIdle || idle.QueueDepth != 0 || idle.Job != nil {
		t.Errorf("an agent with no work: %+v", idle)
	}
	if idle.UptimeS != 41*24*60*60 {
		t.Errorf("41 days is %d seconds, got %d", 41*24*60*60, idle.UptimeS)
	}
	if idle.SentAt != "2026-10-29T12:00:00.500Z" {
		t.Errorf("sent_at: %q", idle.SentAt)
	}
	if *idle.CPUPct != 4.5 || *idle.MemoryUsedMB != 1280 || *idle.MemoryTotalMB != 16384 {
		t.Errorf("the measurements were not passed through: %+v", idle)
	}

	unmeasured := NewHeartbeat(now, started, telemetry.Sample{}, &Workload{}, false)
	if unmeasured.CPUPct != nil || unmeasured.MemoryUsedMB != nil || unmeasured.MemoryTotalMB != nil {
		t.Errorf("an unmeasured sample became values: %+v", unmeasured)
	}

	var busy Workload
	busy.Accepted(job(1))
	if err := busy.Started(job(1), conn.PhasePrepare); err != nil {
		t.Fatal(err)
	}
	if got := NewHeartbeat(now, started, measured, &busy, false); got.State != conn.StateBusy || got.Job == nil {
		t.Errorf("an agent running a job: %+v", got)
	}
	if got := NewHeartbeat(now, started, measured, &busy, true); got.State != conn.StateDraining || got.Job == nil {
		t.Errorf("a drained agent finishing its job still says draining, and still reports the job: %+v", got)
	}

	if got := NewHeartbeat(started.Add(-time.Minute), started, measured, &Workload{}, false); got.UptimeS != 0 {
		t.Errorf("a clock that stepped back gave uptime %d", got.UptimeS)
	}

	for _, payload := range []conn.HeartbeatPayload{idle, unmeasured, NewHeartbeat(now, started, measured, &busy, true)} {
		encoded, err := conn.Encode(conn.NewFrame(conn.NewID(), conn.TypeHeartbeat, payload))
		if err != nil {
			t.Fatal(err)
		}
		if _, diags := conn.Decode(encoded); len(diags) > 0 {
			t.Errorf("an illegal heartbeat: %v\n%s", diags, encoded)
		}
	}
}
