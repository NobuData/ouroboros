package conn

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestEveryTypeHasADirection asserts the direction table covers the whole closed set.
// A type with no direction would be refused from both ends — the same outcome as the
// type not existing, reached by a route nobody would look at.
func TestEveryTypeHasADirection(t *testing.T) {
	for _, messageType := range MessageTypes {
		if !messageType.SentBy(FromAgent) && !messageType.SentBy(FromGateway) {
			t.Errorf("%s has no direction", messageType)
		}
	}
	if !TypeBye.SentBy(FromAgent) || !TypeBye.SentBy(FromGateway) {
		t.Error("bye is the one type either end may send")
	}
	if TypeHello.SentBy(FromGateway) || TypeAck.SentBy(FromAgent) {
		t.Error("hello is the agent's and ack is the gateway's")
	}
	if Type("nonsense").SentBy(FromAgent) || Type("nonsense").SentBy(FromGateway) {
		t.Error("an unknown type is sent by nobody")
	}
}

// TestDirectionsMatchTheTranscripts holds the table to the recorded sessions, where
// every frame carries the `from` that sent it. The protocol document states direction
// in prose; the transcripts are where it is recorded as data.
func TestDirectionsMatchTheTranscripts(t *testing.T) {
	for _, session := range loadContract(t).Transcripts {
		var parsed frames
		if err := json.Unmarshal(readFixture(t, session.Document), &parsed); err != nil {
			t.Fatalf("parse %s: %v", session.Document, err)
		}
		for _, frame := range parsed.Frames {
			if frame.Event != "" {
				continue
			}
			env, diags := Decode(readFixture(t, frame.Message))
			if len(diags) > 0 {
				t.Fatalf("%s: %v", frame.Message, diags)
			}
			end := FromAgent
			if frame.From == "server" {
				end = FromGateway
			}
			if !env.Type.SentBy(end) {
				t.Errorf("%s: %s is sent by the %s, and the table says it may not be",
					session.Name, env.Type, frame.From)
			}
		}
	}
}

// TestIntoReadsEveryGatewayMessage reads each worked example the agent receives into its
// typed view and checks the fields the connection loop acts on.
func TestIntoReadsEveryGatewayMessage(t *testing.T) {
	var ack AckPayload
	decodeInto(t, "valid/ack.json", &ack)
	if ack.Session != "sess_01KE7MV3WKAG706QMDN23AJ3BE" || ack.Protocol != 1 || ack.Resumed {
		t.Errorf("ack: %+v", ack)
	}
	if ack.Limits.HeartbeatIntervalMS != 10000 || ack.Limits.HeartbeatJitterMS != 2000 ||
		ack.Limits.ResumeWindowMS != 300000 || ack.Runner.Pool != "arm-builders" {
		t.Errorf("ack limits: %+v", ack.Limits)
	}
	if ack.Pool == nil || ack.Pool.MaxConcurrency != 2 ||
		strings.Join(ack.Pool.EnvAllowlist, ",") != "CCACHE_DIR,MAKEFLAGS" {
		t.Errorf("ack pool: %+v", ack.Pool)
	}

	// An ack from a gateway that names no pool policy is legal, and reads as nil — which
	// the agent takes as the column defaults (#246).
	var bare AckPayload
	decodeInto(t, "valid/ack-without-pool.json", &bare)
	if bare.Pool != nil {
		t.Errorf("an ack without pool read as %+v", bare.Pool)
	}

	var refuse RefusePayload
	decodeInto(t, "valid/refuse.json", &refuse)
	if refuse.Code != RefuseVersionBelowMinimum || refuse.Minimum == nil || *refuse.Minimum != 1 ||
		refuse.RetryAfterMS != nil {
		t.Errorf("refuse: %+v", refuse)
	}

	var receipt ReceiptPayload
	decodeInto(t, "valid/receipt-duplicate.json", &receipt)
	if !receipt.Duplicate || receipt.OfType != string(TypeJobFinish) {
		t.Errorf("receipt: %+v", receipt)
	}

	var offer JobOfferPayload
	decodeInto(t, "valid/job-offer.json", &offer)
	if offer.Job != "job_01KE7J4EZ3204KQXMHJRPQPWQ6" || offer.Executor != ExecutorContainer ||
		offer.ExpiresAt != "2026-09-18T12:00:15.000Z" {
		t.Errorf("offer: %+v", offer)
	}
	if offer.Image != "registry.example.invalid/ouroboros/build-arm64:2026-09" ||
		strings.Join(offer.Command, " ") != "make -j8 all" || offer.Workdir != "/workspace" ||
		offer.Env["MAKEFLAGS"] != "--output-sync=target" || offer.TimeoutS != 3600 ||
		offer.Repository == nil || offer.Repository.Commit != "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80" {
		t.Errorf("offer executor fields: %+v", offer)
	}

	var shell JobOfferPayload
	decodeInto(t, "valid/job-offer-shell.json", &shell)
	if shell.Executor != ExecutorShell || shell.Image != "" || shell.Repository != nil ||
		shell.Env == nil || len(shell.Env) != 0 || shell.Command[0] != "./scripts/notarize.sh" {
		t.Errorf("shell offer: %+v", shell)
	}
	if offer.Attempt != 0 || shell.Attempt != 0 {
		t.Errorf("a first attempt carries no attempt number: %d, %d", offer.Attempt, shell.Attempt)
	}

	// The automatic retry of an infrastructure failure is a new job that says which
	// attempt it is (#252).
	var retry JobOfferPayload
	decodeInto(t, "valid/job-offer-retry.json", &retry)
	if retry.Attempt != 2 || retry.Job != "job_01KE7RTRY3C5B1NQ8V2ZK4M6PA" {
		t.Errorf("retry offer: %+v", retry)
	}

	var cancel JobCancelPayload
	decodeInto(t, "valid/job-cancel.json", &cancel)
	if cancel.Job != "job_01KE7J4EZ3204KQXMHJRPQPWQ6" || cancel.Reason != CancelOperator ||
		cancel.Detail == "" {
		t.Errorf("cancel: %+v", cancel)
	}

	var drain DrainPayload
	decodeInto(t, "valid/drain.json", &drain)
	if drain.Reason != "upgrade" || drain.DeadlineMS != 900000 {
		t.Errorf("drain: %+v", drain)
	}

	var bye ByePayload
	decodeInto(t, "valid/bye.json", &bye)
	if bye.Reason != ByeShutdown || bye.ReconnectAfterMS != nil {
		t.Errorf("bye: %+v", bye)
	}
}

// TestOutgoingPayloadsAreLegal encodes each message the agent writes from its typed
// struct and runs it through the validator — so a struct tag typo is a failing test
// here rather than a refusal from the gateway.
func TestOutgoingPayloadsAreLegal(t *testing.T) {
	five := 5000
	idle, busy := 0.0, 12.5
	none, used, total := 0, 100, 16384
	for _, frame := range []Frame{
		NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
			SentAt: "2026-09-18T12:00:00.000Z", State: StateIdle, UptimeS: 1,
			CPUPct: &idle, MemoryUsedMB: &none, MemoryTotalMB: &total, QueueDepth: 0, Job: nil,
		}),
		NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
			SentAt: "2026-09-18T12:00:00.000Z", State: StateBusy, UptimeS: 1, CPUPct: &busy,
			MemoryUsedMB: &used, MemoryTotalMB: &total, QueueDepth: 1,
			Job: &HeartbeatJob{ID: "job_01KE7J4EZ3204KQXMHJRPQPWQ6", Phase: "run", Pct: 40},
		}),
		// Nothing measured: the three measurements null, which the contract accepts (#245).
		NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
			SentAt: "2026-09-18T12:00:00.000Z", State: StateIdle, UptimeS: 1, QueueDepth: 2,
		}),
		NewFrame(NewID(), TypeJobDecline, JobDeclinePayload{
			Job: "job_01KE7J4EZ3204KQXMHJRPQPWQ6", Offer: "01KE76GYFT5404Q2FA41RMP9PE",
			Reason: DeclineUnsupportedExecutor, Detail: "this agent build has no container executor",
		}),
		NewFrame(NewID(), TypeBye, ByePayload{Reason: ByeShutdown, Detail: "SIGTERM received"}),
		NewFrame(NewID(), TypeBye, ByePayload{Reason: ByeError, Detail: "x", ReconnectAfterMS: &five}),
	} {
		encoded, err := Encode(frame)
		if err != nil {
			t.Fatalf("encode %s: %v", frame.Type, err)
		}
		if _, diags := Decode(encoded); len(diags) > 0 {
			t.Errorf("%s is not legal: %v\n%s", frame.Type, diags, encoded)
		}
	}
}

// TestTypedPayloadsReproduceTheGoldenFrames reads each worked example into its typed
// struct and encodes it again, asserting the committed fixture comes back BYTE FOR BYTE.
//
// The executors (#246) write job.accept, job.start, job.progress and job.finish from these
// structs, the log shipper (#247) writes log.chunk from one, and the test farm writes ack
// from one — so a field out of order, a tag typo or a
// null that became an absent key is a failure here, against the document both
// implementations read, rather than a refusal from the gateway.
func TestTypedPayloadsReproduceTheGoldenFrames(t *testing.T) {
	for _, testCase := range []struct {
		fixture string
		payload any
	}{
		{"valid/ack.json", &AckPayload{}},
		{"valid/ack-resumed.json", &AckPayload{}},
		{"valid/ack-without-pool.json", &AckPayload{}},
		{"valid/job-offer.json", &JobOfferPayload{}},
		{"valid/job-offer-shell.json", &JobOfferPayload{}},
		{"valid/job-offer-retry.json", &JobOfferPayload{}},
		{"valid/job-cancel.json", &JobCancelPayload{}},
		{"valid/job-accept.json", &JobAcceptPayload{}},
		{"valid/job-start.json", &JobStartPayload{}},
		{"valid/job-progress.json", &JobProgressPayload{}},
		{"valid/job-finish.json", &JobFinishPayload{}},
		{"valid/job-finish-failed.json", &JobFinishPayload{}},
		{"valid/log-chunk.json", &LogChunkPayload{}},
	} {
		t.Run(testCase.fixture, func(t *testing.T) {
			want := readFixture(t, testCase.fixture)
			env, diags := Decode(want)
			if len(diags) > 0 {
				t.Fatalf("decode: %v", diags)
			}
			if err := env.Into(testCase.payload); err != nil {
				t.Fatalf("into: %v", err)
			}
			encoded, err := EncodeIndent(NewFrame(env.ID, env.Type, testCase.payload))
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			if !bytes.Equal(encoded, want) {
				t.Errorf("the typed payload does not reproduce %s.\n--- got ---\n%s\n--- want ---\n%s",
					testCase.fixture, encoded, want)
			}
		})
	}
}

// TestJobFramesAreLegalForEveryOutcome encodes a job.finish for each of the five outcomes
// the executors report, with the exit code each may carry, and holds it to the contract.
func TestJobFramesAreLegalForEveryOutcome(t *testing.T) {
	zero, two, killed := 0, 2, -1
	for _, finish := range []JobFinishPayload{
		{Outcome: OutcomeSucceeded, ExitCode: &zero},
		{Outcome: OutcomeFailed, ExitCode: &two, Error: &FinishError{Code: "executor.exit", Detail: "exited with status 2"}},
		{Outcome: OutcomeCancelled, ExitCode: &killed, Error: &FinishError{Code: "executor.cancelled", Detail: "x"}},
		{Outcome: OutcomeTimedOut, ExitCode: nil, Error: &FinishError{Code: "executor.timeout", Detail: "x"}},
		{Outcome: OutcomeErrored, ExitCode: nil, Error: &FinishError{Code: "image.pull_failed", Detail: "x"}},
	} {
		finish.Job, finish.Attempt = "job_01KE7J4EZ3204KQXMHJRPQPWQ6", 1
		finish.StartedAt = Timestamp(time.Date(2026, 9, 18, 12, 0, 2, 140e6, time.UTC))
		finish.FinishedAt = Timestamp(time.Date(2026, 9, 18, 12, 4, 51, 902e6, time.UTC))
		encoded, err := Encode(NewFrame(NewID(), TypeJobFinish, finish))
		if err != nil {
			t.Fatalf("encode %s: %v", finish.Outcome, err)
		}
		if _, diags := Decode(encoded); len(diags) > 0 {
			t.Errorf("a %s finish is not legal: %v\n%s", finish.Outcome, diags, encoded)
		}
		for _, key := range []string{`"exit_code":`, `"ccache":null`, `"error":`} {
			if !bytes.Contains(encoded, []byte(key)) {
				t.Errorf("a %s finish is missing %s: %s", finish.Outcome, key, encoded)
			}
		}
	}

	// An ack naming an empty allow-list sends `[]`, never null.
	encoded, err := Encode(NewFrame(NewID(), TypeAck, AckPayload{
		Session: "sess_01KE7MV3WKAG706QMDN23AJ3BE", Protocol: 1,
		Runner: AckRunner{ID: "rnr_01KE76X95CS69B659HTXZJ0HA3", Name: "x", Pool: "x"},
		Limits: Limits{HeartbeatIntervalMS: 10000, LogChunkMaxBytes: 32768, LogRateBytesPerS: 262144,
			OfferAckMS: 5000, ResumeWindowMS: 300000},
		Pool: &AckPool{MaxConcurrency: 1, EnvAllowlist: []string{}},
	}))
	if err != nil {
		t.Fatalf("encode ack: %v", err)
	}
	if _, diags := Decode(encoded); len(diags) > 0 || !bytes.Contains(encoded, []byte(`"env_allowlist":[]`)) {
		t.Errorf("an ack with an empty allow-list: %v\n%s", diags, encoded)
	}
}

// TestTimestampIsTheContractsShape pins the one timestamp form the contract accepts: UTC,
// with milliseconds, whatever zone the clock was read in.
func TestTimestampIsTheContractsShape(t *testing.T) {
	tokyo := time.FixedZone("JST", 9*60*60)
	at := time.Date(2026, 9, 18, 21, 0, 2, 140_500_000, tokyo)
	if got := Timestamp(at); got != "2026-09-18T12:00:02.140Z" {
		t.Errorf("Timestamp = %q", got)
	}
	if !timestampRe.MatchString(Timestamp(time.Now())) {
		t.Error("Timestamp does not match the contract's pattern")
	}
}

// TestIdleHeartbeatSendsNullJob pins `"job": null` — present and null, never absent.
func TestIdleHeartbeatSendsNullJob(t *testing.T) {
	total := 1
	encoded, err := Encode(NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
		SentAt: "2026-09-18T12:00:00.000Z", State: StateIdle, MemoryTotalMB: &total,
	}))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"job":null`)) {
		t.Errorf("expected an explicit null job, got %s", encoded)
	}
}

// TestUnmeasuredHeartbeatSendsNulls pins what a heartbeat says about a measurement this
// machine could not take (#245): the key present and `null` — never absent, and never a
// zero, which is a reading.
func TestUnmeasuredHeartbeatSendsNulls(t *testing.T) {
	encoded, err := Encode(NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
		SentAt: "2026-09-18T12:00:00.000Z", State: StateIdle,
	}))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	for _, want := range []string{`"cpu_pct":null`, `"memory_used_mb":null`, `"memory_total_mb":null`} {
		if !bytes.Contains(encoded, []byte(want)) {
			t.Errorf("expected %s, got %s", want, encoded)
		}
	}
	if _, diags := Decode(encoded); len(diags) > 0 {
		t.Errorf("an unmeasured heartbeat is not legal: %v", diags)
	}

	// And a measured zero stays a zero: the pointer is what tells them apart.
	zero := 0.0
	encoded, err = Encode(NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
		SentAt: "2026-09-18T12:00:00.000Z", State: StateIdle, CPUPct: &zero,
	}))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"cpu_pct":0`)) {
		t.Errorf("a measured idle CPU was not sent as 0: %s", encoded)
	}
}

// TestValidPhase is the phase vocabulary the executors report into, which must be the
// contract's exactly: a heartbeat carrying any other phase is refused, and the session
// with it.
func TestValidPhase(t *testing.T) {
	for _, phase := range []string{PhaseFetch, PhasePrepare, PhaseRun, PhaseUpload} {
		if !ValidPhase(phase) {
			t.Errorf("%q should be a phase", phase)
		}
	}
	for _, phase := range []string{"", "compiling", "Run", "finish"} {
		if ValidPhase(phase) {
			t.Errorf("%q should not be a phase", phase)
		}
	}
	if len(phaseValues) != 4 {
		t.Errorf("the contract names %d phases; this test knows four", len(phaseValues))
	}
}

// TestRefusalFinality is the § 4.1 table: which refusals the agent may reconnect into.
func TestRefusalFinality(t *testing.T) {
	for code, final := range map[string]bool{
		RefuseVersionBelowMinimum: true,
		RefuseVersionUnsupported:  true,
		RefuseIdentityUnknown:     true,
		RefuseIdentityRevoked:     true,
		RefusePoolUnknown:         false,
		RefuseCapacityExhausted:   false,
	} {
		if got := (RefusePayload{Code: code}).Final(); got != final {
			t.Errorf("%s: Final() = %t, want %t", code, got, final)
		}
	}
	// And every code the schema enumerates is in the table above.
	for _, code := range refuseValues {
		switch code {
		case RefuseVersionBelowMinimum, RefuseVersionUnsupported, RefuseIdentityUnknown,
			RefuseIdentityRevoked, RefusePoolUnknown, RefuseCapacityExhausted:
		default:
			t.Errorf("the refusal code %s has no constant", code)
		}
	}
}

// TestIntoReportsAMismatchedView asserts reading a payload into the wrong view is an
// error rather than a zero-valued struct.
func TestIntoReportsAMismatchedView(t *testing.T) {
	env, diags := Decode(readFixture(t, "valid/ack.json"))
	if len(diags) > 0 {
		t.Fatalf("decode: %v", diags)
	}
	var wrong struct {
		Session int `json:"session"`
	}
	if err := env.Into(&wrong); err == nil {
		t.Error("expected a string session read into an int to be an error")
	}
}

// decodeInto decodes a fixture, fails on any diagnostic, and reads its payload.
func decodeInto(t *testing.T, fixture string, target any) {
	t.Helper()
	env, diags := Decode(readFixture(t, fixture))
	if len(diags) > 0 {
		t.Fatalf("%s: %v", fixture, diags)
	}
	if err := env.Into(target); err != nil {
		t.Fatalf("%s: %v", fixture, err)
	}
}
