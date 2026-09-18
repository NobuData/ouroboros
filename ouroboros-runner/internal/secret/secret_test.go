package secret

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

const value = "orb_enroll_01KE7NAGMYAV6AVSA6FMTM53N1_c2VjcmV0LXZhbHVl"

// TestSecretDoesNotPrint walks every route a credential takes into a log line — the
// fmt verbs, a struct that carries it, both slog handlers, a JSON marshal — and asserts
// none of them carries the value.
func TestSecretDoesNotPrint(t *testing.T) {
	credential := Secret(value)
	carrier := struct {
		Name  string
		Token Secret
	}{"forge-01", credential}

	var rendered []string
	for _, verb := range []string{"%v", "%s", "%+v", "%#v", "%q", "%x"} {
		rendered = append(rendered, fmt.Sprintf(verb, credential), fmt.Sprintf(verb, carrier))
	}

	marshalled, err := json.Marshal(carrier)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	rendered = append(rendered, string(marshalled))

	var logs bytes.Buffer
	slog.New(slog.NewTextHandler(&logs, nil)).Info("enrolling", "token", credential, "carrier", carrier)
	slog.New(slog.NewJSONHandler(&logs, nil)).Info("enrolling", "token", credential)
	rendered = append(rendered, logs.String())

	for _, text := range rendered {
		if strings.Contains(text, value) || strings.Contains(text, fmt.Sprintf("%x", value)) {
			t.Errorf("the credential leaked: %s", text)
		}
	}
	if !strings.Contains(logs.String(), Redacted) {
		t.Errorf("expected the logs to show a redaction:\n%s", logs.String())
	}
}

// TestRevealIsTheOnlyWayOut asserts the value is still there for the one caller that
// needs it.
func TestRevealIsTheOnlyWayOut(t *testing.T) {
	if Secret(value).Reveal() != value {
		t.Error("Reveal lost the value")
	}
	if !Secret("").Empty() || Secret(value).Empty() {
		t.Error("Empty is wrong")
	}
}
