package agent

import (
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/ws"
)

// ceilingJitter returns the top of the window, so a test sees the ceilings themselves.
func ceilingJitter(limit time.Duration) time.Duration { return limit }

// TestBackoffGrowsExponentiallyToItsCap asserts the ceilings double from Base and stop
// at Max, and that Reset starts again from the bottom.
func TestBackoffGrowsExponentiallyToItsCap(t *testing.T) {
	backoff := Backoff{Base: 100 * time.Millisecond, Max: time.Second, Jitter: ceilingJitter}
	want := []time.Duration{100, 200, 400, 800, 1000, 1000, 1000}
	for i, expected := range want {
		if got := backoff.Next(); got != expected*time.Millisecond {
			t.Errorf("attempt %d: ceiling %v, want %v", i, got, expected*time.Millisecond)
		}
	}
	backoff.Reset()
	if got := backoff.Next(); got != 100*time.Millisecond {
		t.Errorf("after Reset: %v, want the base", got)
	}
}

// TestBackoffDefaults asserts a zero Backoff is a usable one: a second, then a minute.
func TestBackoffDefaults(t *testing.T) {
	backoff := Backoff{Jitter: ceilingJitter}
	if got := backoff.Next(); got != DefaultBackoffBase {
		t.Errorf("first ceiling %v, want %v", got, DefaultBackoffBase)
	}
	for range 20 {
		backoff.Next()
	}
	if got := backoff.Next(); got != DefaultBackoffMax {
		t.Errorf("capped ceiling %v, want %v", got, DefaultBackoffMax)
	}
	// A Max below Base is read as Base: the ceiling cannot be lower than the floor.
	inverted := Backoff{Base: time.Second, Max: time.Millisecond, Jitter: ceilingJitter}
	if got := inverted.Next(); got != time.Second {
		t.Errorf("an inverted backoff gave %v", got)
	}
}

// TestADelayTheGatewayNamedIsAFloor asserts `reconnect_after_ms` is waited out, and
// spread past — including "come back now", which must not be an instant stampede.
func TestADelayTheGatewayNamedIsAFloor(t *testing.T) {
	backoff := Backoff{Base: 100 * time.Millisecond, Jitter: ceilingJitter}
	if got := backoff.After(time.Second); got != 1500*time.Millisecond {
		t.Errorf("a named second became %v, want up to 1.5s", got)
	}
	if got := backoff.After(0); got != 100*time.Millisecond {
		t.Errorf("a named zero became %v, want a spread of Base", got)
	}
	floor := Backoff{Base: 100 * time.Millisecond, Jitter: func(time.Duration) time.Duration { return 0 }}
	if got := floor.After(time.Second); got != time.Second {
		t.Errorf("with no jitter the named delay is %v, want exactly it", got)
	}
}

// TestAFleetDoesNotStampede is the acceptance criterion: a thousand agents dropped in the
// same instant by a control-plane restart come back spread across the window, not in it
// all at once.
//
// Each simulated agent draws its first reconnect delay from a fresh Backoff with the
// production jitter. The window [0, Base) is cut into ten slots, and every slot must
// hold between 5% and 15% of the fleet — a uniform spread puts 10% in each, and the
// bounds are more than five standard deviations wide, so the test is not flaky. An
// un-jittered backoff would put all thousand in one slot.
func TestAFleetDoesNotStampede(t *testing.T) {
	const fleet, slots = 1000, 10
	base := time.Second

	for attempt := range 3 {
		ceiling := base << attempt
		counts := make([]int, slots)
		for range fleet {
			backoff := Backoff{Base: base, Max: time.Minute}
			for range attempt {
				backoff.Next()
			}
			delay := backoff.Next()
			if delay < 0 || delay >= ceiling {
				t.Fatalf("attempt %d: a delay of %v is outside [0, %v)", attempt, delay, ceiling)
			}
			counts[int(delay*slots/ceiling)]++
		}
		for slot, count := range counts {
			if count < fleet*5/100 || count > fleet*15/100 {
				t.Errorf("attempt %d: slot %d of the window holds %d of %d agents — not a spread: %v",
					attempt, slot, count, fleet, counts)
			}
		}
	}
}

// TestUniformJitterIsBounded covers the default jitter's edges.
func TestUniformJitterIsBounded(t *testing.T) {
	if uniformJitter(0) != 0 || uniformJitter(-time.Second) != 0 {
		t.Error("a non-positive window must give no delay")
	}
	for range 1000 {
		if got := uniformJitter(time.Millisecond); got < 0 || got >= time.Millisecond {
			t.Fatalf("a draw of %v is outside [0, 1ms)", got)
		}
	}
}

// TestHeartbeatIntervalIsJitteredAroundTheGatewaysInterval asserts the ± of
// `heartbeat_jitter_ms`, and that a jitter wider than the interval cannot make it
// negative.
func TestHeartbeatIntervalIsJitteredAroundTheGatewaysInterval(t *testing.T) {
	session := func(interval, jitter int, draw Jitter) *session {
		return &session{
			agent:  &Agent{config: Config{Backoff: Backoff{Jitter: draw}}},
			limits: conn.Limits{HeartbeatIntervalMS: interval, HeartbeatJitterMS: jitter},
		}
	}
	top := func(limit time.Duration) time.Duration { return limit }
	bottom := func(time.Duration) time.Duration { return 0 }

	if got := session(10000, 2000, top).heartbeatInterval(); got != 12*time.Second {
		t.Errorf("the top of the window is %v, want 12s", got)
	}
	if got := session(10000, 2000, bottom).heartbeatInterval(); got != 8*time.Second {
		t.Errorf("the bottom of the window is %v, want 8s", got)
	}
	if got := session(10000, 0, top).heartbeatInterval(); got != 10*time.Second {
		t.Errorf("no jitter is %v, want exactly 10s", got)
	}
	if got := session(1000, 60000, bottom).heartbeatInterval(); got < 100*time.Millisecond {
		t.Errorf("a jitter wider than the interval gave %v", got)
	}
}

// TestHeartbeatsOfAFleetAreSpread asserts the send timing is jittered with the real draw,
// not only bounded: a thousand agents started together at the gateway's 10 s ± 2 s do not
// beat together. Their next beats land across the whole window — some in each of its four
// half-second-wide edges — rather than on one boundary, which is the fleet-wide spike the
// jitter exists to prevent.
func TestHeartbeatsOfAFleetAreSpread(t *testing.T) {
	fleet := &session{
		agent:  &Agent{config: Config{}},
		limits: conn.Limits{HeartbeatIntervalMS: 10000, HeartbeatJitterMS: 2000},
	}
	distinct := map[time.Duration]bool{}
	var early, late, nearlyNominal int
	for range 1000 {
		interval := fleet.heartbeatInterval()
		if interval < 8*time.Second || interval > 12*time.Second {
			t.Fatalf("%v is outside 10s ± 2s", interval)
		}
		distinct[interval] = true
		switch {
		case interval < 8500*time.Millisecond:
			early++
		case interval > 11500*time.Millisecond:
			late++
		case interval > 9750*time.Millisecond && interval < 10250*time.Millisecond:
			nearlyNominal++
		}
	}
	// Each band is an eighth of the window, so ~125 of a thousand; 40 is far below any
	// plausible draw and far above what a lockstep fleet would produce.
	if early < 40 || late < 40 || nearlyNominal < 40 {
		t.Errorf("the fleet is bunched: %d early, %d late, %d near the nominal 10s", early, late, nearlyNominal)
	}
	if len(distinct) < 900 {
		t.Errorf("only %d distinct intervals across a thousand agents", len(distinct))
	}
}

// remoteAlert is the error crypto/tls returns when the peer sends an alert.
func remoteAlert(text string) error {
	return &net.OpError{Op: "remote error", Err: errors.New("tls: " + text)}
}

// TestCertificateAlertsAreRecognised covers every alert a gateway can refuse a client
// certificate with, and that nothing else is mistaken for one.
func TestCertificateAlertsAreRecognised(t *testing.T) {
	for _, alert := range certificateAlerts {
		if got, ok := certificateAlert(remoteAlert(alert)); !ok || got != alert {
			t.Errorf("%q was not recognised", alert)
		}
	}
	for _, err := range []error{
		remoteAlert("handshake failure"),
		&net.OpError{Op: "dial", Err: errors.New("connection refused")},
		errors.New("tls: bad certificate"),
		&net.OpError{Op: "remote error"},
	} {
		if _, ok := certificateAlert(err); ok {
			t.Errorf("%v was taken for a certificate refusal", err)
		}
	}
}

// TestClassifyDial is the fatal-or-retry table for a failed connection attempt.
func TestClassifyDial(t *testing.T) {
	refusal := func(status int, code string) error {
		body := ""
		if code != "" {
			body = `{"code":"` + code + `","message":"x","details":{}}`
		}
		return &ws.HandshakeError{StatusCode: status, Body: []byte(body)}
	}

	for name, testCase := range map[string]struct {
		err     error
		mode    conn.SecurityMode
		fatal   bool
		mention string
	}{
		"a revoked certificate, by alert":        {remoteAlert("bad certificate"), conn.SecurityMTLS, true, "revoked"},
		"an alert on a bearer connection":        {remoteAlert("certificate required"), conn.SecurityBearerFallback, true, "--bearer-fallback"},
		"farm_identity_refused":                  {refusal(401, "farm_identity_refused"), conn.SecurityMTLS, true, "revoked"},
		"a certificate the proxy stripped":       {refusal(401, "farm_client_certificate_required"), conn.SecurityMTLS, true, "proxy"},
		"a refused bearer secret":                {refusal(401, "farm_client_certificate_required"), conn.SecurityBearerFallback, true, "bearer secret"},
		"a revoked bearer runner":                {refusal(401, "farm_identity_refused"), conn.SecurityBearerFallback, true, "bearer secret"},
		"a bare 403, which names no identity":    {refusal(403, ""), conn.SecurityMTLS, false, ""},
		"a session guard's 401":                  {refusal(401, "unauthenticated"), conn.SecurityMTLS, false, ""},
		"a bare 401 on a bearer connection":      {refusal(401, ""), conn.SecurityBearerFallback, false, ""},
		"no gateway at this address":             {refusal(404, ""), conn.SecurityMTLS, false, ""},
		"a gateway failing":                      {refusal(503, ""), conn.SecurityMTLS, false, ""},
		"a connection refused":                   {&net.OpError{Op: "dial", Err: errors.New("connection refused")}, conn.SecurityMTLS, false, ""},
		"a handshake alert about something else": {remoteAlert("handshake failure"), conn.SecurityMTLS, false, ""},
	} {
		t.Run(name, func(t *testing.T) {
			fatal := classifyDial(testCase.err, testCase.mode)
			if (fatal != nil) != testCase.fatal {
				t.Fatalf("fatal = %v, want %t", fatal, testCase.fatal)
			}
			if fatal != nil && !strings.Contains(fatal.Error(), testCase.mention) {
				t.Errorf("the reason should mention %q: %s", testCase.mention, fatal)
			}
		})
	}

	if got := dialReason(refusal(http.StatusNotFound, "")); !strings.Contains(got, "404") {
		t.Errorf("a 404 should be named: %s", got)
	}
	if got := dialReason(refusal(http.StatusUnauthorized, "unauthenticated")); !strings.Contains(got, "401") ||
		!strings.Contains(got, "unauthenticated") {
		t.Errorf("a retried refusal should name its status and code: %s", got)
	}
	if got := dialReason(refusal(http.StatusBadGateway, "")); !strings.Contains(got, "502") {
		t.Errorf("a refusal with no envelope should still name its status: %s", got)
	}
}

// TestRefusalReasonsSayWhatToDo covers the sentence each `refuse` code becomes.
func TestRefusalReasonsSayWhatToDo(t *testing.T) {
	two := 2
	for payload, mention := range map[conn.RefusePayload]string{
		{Code: conn.RefuseVersionBelowMinimum, Minimum: &two, Detail: "d"}: "protocol 2 or newer",
		{Code: conn.RefuseVersionUnsupported, Detail: "d"}:                 "a newer protocol line",
		{Code: conn.RefuseIdentityRevoked, Detail: "d"}:                    "enroll this machine again",
		{Code: conn.RefuseIdentityUnknown, Detail: "d"}:                    "does not know this runner",
		{Code: conn.RefuseCapacityExhausted, Detail: "full"}:               "full",
	} {
		if got := refusalReason(payload); !strings.Contains(got, mention) {
			t.Errorf("%s: %q does not mention %q", payload.Code, got, mention)
		}
	}
	fatal := &FatalError{Reason: "r"}
	if fatal.Error() != "r" || fatal.Unwrap() != nil {
		t.Error("a FatalError with no cause is its reason")
	}
}

// TestTruncateKeepsWholeRunes asserts a long detail is cut on a character boundary, so
// a bye's detail is still valid UTF-8 and inside the contract's bound.
func TestTruncateKeepsWholeRunes(t *testing.T) {
	if got := truncate(strings.Repeat("é", 600)); len([]rune(got)) != detailMax {
		t.Errorf("truncated to %d runes", len([]rune(got)))
	}
	if got := truncate("short"); got != "short" {
		t.Errorf("a short detail was changed: %q", got)
	}
}
