package conn

import (
	"bytes"
	"encoding/json"
	"testing"
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
	if offer.Job != "job_01KE7J4EZ3204KQXMHJRPQPWQ6" || offer.Executor != "container" ||
		offer.ExpiresAt != "2026-09-18T12:00:15.000Z" {
		t.Errorf("offer: %+v", offer)
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
	for _, frame := range []Frame{
		NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
			SentAt: "2026-09-18T12:00:00.000Z", State: StateIdle, UptimeS: 1,
			CPUPct: 0, MemoryUsedMB: 0, MemoryTotalMB: 16384, QueueDepth: 0, Job: nil,
		}),
		NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
			SentAt: "2026-09-18T12:00:00.000Z", State: StateBusy, UptimeS: 1, CPUPct: 12.5,
			MemoryUsedMB: 100, MemoryTotalMB: 16384, QueueDepth: 1,
			Job: &HeartbeatJob{ID: "job_01KE7J4EZ3204KQXMHJRPQPWQ6", Phase: "run", Pct: 40},
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

// TestIdleHeartbeatSendsNullJob pins `"job": null` — present and null, never absent.
func TestIdleHeartbeatSendsNullJob(t *testing.T) {
	encoded, err := Encode(NewFrame(NewID(), TypeHeartbeat, HeartbeatPayload{
		SentAt: "2026-09-18T12:00:00.000Z", State: StateIdle, MemoryTotalMB: 1,
	}))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"job":null`)) {
		t.Errorf("expected an explicit null job, got %s", encoded)
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
