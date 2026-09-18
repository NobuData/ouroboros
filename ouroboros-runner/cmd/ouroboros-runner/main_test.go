package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// TestHelloPrintsALegalFrame is what makes `ouroboros-runner hello` worth having.
//
// The command exists to answer "what does my machine claim about itself?" for an
// operator whose enrollment was refused. An answer the gateway would also refuse is
// useless, so the frame is validated before it is printed — and this suite asserts that
// the frame this machine produces really is one the published contract accepts.
func TestHelloPrintsALegalFrame(t *testing.T) {
	out := &bytes.Buffer{}
	if err := run([]string{"hello"}, out); err != nil {
		t.Fatalf("hello: %v", err)
	}

	printed := out.Bytes()
	if _, diags := conn.Decode(printed); len(diags) > 0 {
		t.Fatalf("the printed frame is not a legal hello: %v\n%s", diags, printed)
	}

	env, _ := conn.Decode(printed)
	if env.Type != conn.TypeHello {
		t.Errorf("expected a hello frame, got %s", env.Type)
	}
	if env.V != conn.Version {
		t.Errorf("expected the frame at v%d, got v%d", conn.Version, env.V)
	}
}

// TestHelloCarriesNoCredential is a standing assertion rather than a test of today's
// code.
//
// Identity is the TLS client certificate (#250), and no enrollment token travels in a
// hello. This command prints a frame an operator is being invited to paste into an
// issue, so a token appearing in it later — through a well-meant change to the payload
// — would be a secret leaked into a bug report. The contract refuses the field; this
// refuses the word.
func TestHelloCarriesNoCredential(t *testing.T) {
	out := &bytes.Buffer{}
	if err := run([]string{"hello"}, out); err != nil {
		t.Fatalf("hello: %v", err)
	}

	for _, forbidden := range []string{"token", "secret", "password", "key"} {
		if strings.Contains(strings.ToLower(out.String()), forbidden) {
			t.Errorf("the hello frame mentions %q:\n%s", forbidden, out)
		}
	}
}

// TestVersionReportsTheProtocolRange asserts the line an operator reads when a gateway
// has refused their agent for being too old. The refusal names the minimum it wants;
// this is where they read what their agent offers, without a network.
func TestVersionReportsTheProtocolRange(t *testing.T) {
	out := &bytes.Buffer{}
	if err := run([]string{"version"}, out); err != nil {
		t.Fatalf("version: %v", err)
	}

	printed := out.String()
	for _, want := range []string{"ouroboros-runner", version, "protocol", "arch", "hostname"} {
		if !strings.Contains(printed, want) {
			t.Errorf("expected the report to mention %q:\n%s", want, printed)
		}
	}
	// The range, spelled as the command spells it.
	if !strings.Contains(printed, "speaks") {
		t.Errorf("expected the protocol range to be reported:\n%s", printed)
	}
}

// TestUsage asserts a typo is an error rather than a success.
//
// A command that printed usage to stdout and exited 0 would make `ouroboros-runner
// helo` look like it had worked — on a machine where the next thing anybody checks is
// whether the agent enrolled.
func TestUsage(t *testing.T) {
	for _, args := range [][]string{
		{},
		{"helo"},
		{"connect"},
		{""},
	} {
		out := &bytes.Buffer{}
		err := run(args, out)
		if err == nil {
			t.Errorf("%q: expected an error, got:\n%s", args, out)
			continue
		}
		if !errors.Is(err, errUsage) {
			t.Errorf("%q: expected a usage error, got %v", args, err)
		}
	}

	// `help` is the one that is not a mistake.
	out := &bytes.Buffer{}
	if err := run([]string{"help"}, out); err != nil {
		t.Fatalf("help: %v", err)
	}
	if !strings.Contains(out.String(), "ouroboros-runner") {
		t.Errorf("expected usage text, got:\n%s", out)
	}
}

// TestUsageNamesWhatIsNotBuiltYet asserts the usage text still points at the issue that
// lands the connection loop.
//
// A scaffold that says nothing about what it cannot do yet is a binary somebody will
// report as broken. This is the line that makes the answer discoverable from the
// command itself.
func TestUsageNamesWhatIsNotBuiltYet(t *testing.T) {
	for _, want := range []string{"#244", "docs/RUNNER_PROTOCOL.md", "outbound"} {
		if !strings.Contains(usage, want) {
			t.Errorf("expected the usage text to mention %q", want)
		}
	}
}
