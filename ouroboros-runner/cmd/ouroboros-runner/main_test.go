package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
)

// env is an environment for run(): the given variables, and nothing from the developer's
// own shell — a suite whose result depended on an exported OURO_RUNNER_SERVER would pass
// on one machine and fail on the next.
func env(values map[string]string) func(string) string {
	return func(name string) string { return values[name] }
}

// runCommandLine runs the command in-process and returns its output.
func runCommandLine(t *testing.T, getenv func(string) string, args ...string) (string, string, error) {
	t.Helper()
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	err := run(context.Background(), args, stdout, stderr, getenv)
	return stdout.String(), stderr.String(), err
}

// TestHelloPrintsALegalFrame is what makes `ouroboros-runner hello` worth having.
//
// The command exists to answer "what does my machine claim about itself?" for an
// operator whose enrollment was refused. An answer the gateway would also refuse is
// useless, so the frame is validated before it is printed — and this suite asserts that
// the frame this machine produces really is one the published contract accepts.
func TestHelloPrintsALegalFrame(t *testing.T) {
	printed, _, err := runCommandLine(t, env(nil), "hello", "--state-dir", t.TempDir())
	if err != nil {
		t.Fatalf("hello: %v", err)
	}

	env, diags := conn.Decode([]byte(printed))
	if len(diags) > 0 {
		t.Fatalf("the printed frame is not a legal hello: %v\n%s", diags, printed)
	}
	if env.Type != conn.TypeHello {
		t.Errorf("expected a hello frame, got %s", env.Type)
	}
	if env.V != conn.Version {
		t.Errorf("expected the frame at v%d, got v%d", conn.Version, env.V)
	}
	// Not enrolled: no pool, and no security mode claimed.
	if _, claimed := env.Payload["security_mode"]; claimed {
		t.Errorf("an unenrolled machine claimed a security mode:\n%s", printed)
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
	farm := farmtest.NewFarm(t)
	farm.AllowBearerFallback()
	stateDir := enrolledCommandLine(t, farm, "--bearer-fallback")

	printed, _, err := runCommandLine(t, env(nil), "hello", "--state-dir", stateDir)
	if err != nil {
		t.Fatalf("hello: %v", err)
	}
	for _, forbidden := range []string{"token", "secret", "password", "key", "orb_"} {
		if strings.Contains(strings.ToLower(printed), forbidden) {
			t.Errorf("the hello frame mentions %q:\n%s", forbidden, printed)
		}
	}
}

// TestHelloDescribesAnEnrolledRunner asserts the frame printed is the frame the
// connection loop would send: once enrolled, the pool and the security mode are the
// state directory's.
func TestHelloDescribesAnEnrolledRunner(t *testing.T) {
	farm := farmtest.NewFarm(t)
	stateDir := enrolledCommandLine(t, farm)

	printed, _, err := runCommandLine(t, env(nil), "hello", "--state-dir", stateDir)
	if err != nil {
		t.Fatalf("hello: %v", err)
	}
	env, diags := conn.Decode([]byte(printed))
	if len(diags) > 0 {
		t.Fatalf("not legal: %v", diags)
	}
	if env.Payload["pool"] != "pool-a" || env.Payload["security_mode"] != string(conn.SecurityMTLS) {
		t.Errorf("expected pool-a over mtls:\n%s", printed)
	}
}

// TestVersionReportsTheProtocolRange asserts the line an operator reads when a gateway
// has refused their agent for being too old. The refusal names the minimum it wants;
// this is where they read what their agent offers, without a network.
func TestVersionReportsTheProtocolRange(t *testing.T) {
	printed, _, err := runCommandLine(t, env(nil), "version")
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	for _, want := range []string{"ouroboros-runner", version, "protocol", "arch", "hostname", "speaks"} {
		if !strings.Contains(printed, want) {
			t.Errorf("expected the report to mention %q:\n%s", want, printed)
		}
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
		{"enroll", "--no-such-flag"},
		{"run", "--no-such-flag"},
		{"hello", "--no-such-flag"},
		{"enroll", "stray-argument"},
		{"run", "stray-argument"},
	} {
		_, _, err := runCommandLine(t, env(nil), args...)
		if !errors.Is(err, errUsage) {
			t.Errorf("%q: expected a usage error, got %v", args, err)
		}
	}

	// `help` is the one that is not a mistake.
	printed, _, err := runCommandLine(t, env(nil), "help")
	if err != nil || !strings.Contains(printed, "ouroboros-runner") {
		t.Fatalf("help: %v\n%s", err, printed)
	}
}

// TestUsageDescribesTheAgent asserts the usage text says what an operator needs from it:
// the two verbs, the outbound-only promise, the explicit fallback flag, and where the
// wire contract is.
func TestUsageDescribesTheAgent(t *testing.T) {
	for _, want := range []string{
		"enroll", "run", "--tenant", "--pool", "--token", "--bearer-fallback",
		"outbound", "nothing listens", "docs/RUNNER_PROTOCOL.md",
		envServer, envToken, envStateDir, envServerCA,
	} {
		if !strings.Contains(usage, want) {
			t.Errorf("expected the usage text to mention %q", want)
		}
	}
}

// TestEnrollSpendsTheTokenOnceAndPrintsNoSecret is the enrollment half of the first
// acceptance criterion, through the command: the token buys one identity, is printed
// nowhere, and a second enrollment with it is refused by the control plane.
func TestEnrollSpendsTheTokenOnceAndPrintsNoSecret(t *testing.T) {
	farm := farmtest.NewFarm(t)
	token := farm.MintToken("pool-a", 1)
	serverCA := filepath.Join(t.TempDir(), "server-ca.pem")
	if err := farm.WriteServerCA(serverCA); err != nil {
		t.Fatal(err)
	}
	stateDir := filepath.Join(t.TempDir(), "state")

	stdout, stderr, err := runCommandLine(t, env(nil), "enroll",
		"--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-a", "--token", token,
		"--name", "forge-01", "--state-dir", stateDir, "--server-ca", serverCA)
	if err != nil {
		t.Fatalf("enroll: %v\n%s", err, stderr)
	}
	record, err := state.PeekRecord(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{record.RunnerID, "acme-robotics / pool-a", "ouroboros-runner run", "pinned"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("expected the summary to mention %q:\n%s", want, stdout)
		}
	}
	if strings.Contains(stdout+stderr, token) || strings.Contains(stdout+stderr, "PRIVATE KEY") {
		t.Errorf("a secret reached the output:\n%s\n%s", stdout, stderr)
	}

	// The same token, into a fresh directory: the control plane refuses it.
	_, _, err = runCommandLine(t, env(nil), "enroll",
		"--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-a", "--token", token,
		"--name", "forge-02", "--state-dir", filepath.Join(t.TempDir(), "state"), "--server-ca", serverCA)
	if err == nil || !strings.Contains(err.Error(), "farm_enrollment_refused") {
		t.Fatalf("expected the spent token to be refused, got %v", err)
	}
	if strings.Contains(err.Error(), token) {
		t.Error("the refusal quoted the token")
	}
}

// TestEnrollRefusesAnEnrolledDirectoryBeforePresentingTheToken asserts a second
// enrollment into the same directory costs nothing: it is refused before the token
// reaches the control plane.
func TestEnrollRefusesAnEnrolledDirectoryBeforePresentingTheToken(t *testing.T) {
	farm := farmtest.NewFarm(t)
	stateDir := enrolledCommandLine(t, farm)
	serverCA := filepath.Join(t.TempDir(), "server-ca.pem")
	if err := farm.WriteServerCA(serverCA); err != nil {
		t.Fatal(err)
	}

	_, _, err := runCommandLine(t, env(nil), "enroll",
		"--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-a",
		"--token", farm.MintToken("pool-a", 1), "--state-dir", stateDir, "--server-ca", serverCA)
	if !errors.Is(err, state.ErrAlreadyEnrolled) {
		t.Fatalf("expected ErrAlreadyEnrolled, got %v", err)
	}
	if enrollments := farm.Observe().Enrollments; enrollments != 1 {
		t.Errorf("the token was presented anyway: %d enrollments", enrollments)
	}
}

// TestEnrollReadsTheEnvironment asserts the token, the server and the state directory
// may come from the environment — which is how an installer keeps a token off the
// process list.
func TestEnrollReadsTheEnvironment(t *testing.T) {
	farm := farmtest.NewFarm(t)
	serverCA := filepath.Join(t.TempDir(), "server-ca.pem")
	if err := farm.WriteServerCA(serverCA); err != nil {
		t.Fatal(err)
	}
	stateDir := filepath.Join(t.TempDir(), "state")
	_, stderr, err := runCommandLine(t, env(map[string]string{
		envServer: farm.URL, envToken: farm.MintToken("pool-a", 1),
		envStateDir: stateDir, envServerCA: serverCA,
	}), "enroll", "--tenant", "acme-robotics", "--pool", "pool-a")
	if err != nil {
		t.Fatalf("enroll from the environment: %v\n%s", err, stderr)
	}
	if _, err := state.PeekRecord(stateDir); err != nil {
		t.Errorf("nothing was enrolled: %v", err)
	}
}

// TestEnrollRefusesBadArguments covers what is refused before anything is opened.
func TestEnrollRefusesBadArguments(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	notPEM := filepath.Join(t.TempDir(), "not.pem")
	if err := os.WriteFile(notPEM, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	base := []string{"enroll", "--tenant", "acme", "--pool", "pool-a", "--token", "orb_enroll_x.y", "--state-dir", stateDir}

	for name, extra := range map[string][]string{
		"no server":                   {},
		"a plain http server":         {"--server", "http://ouroboros.example.invalid"},
		"a missing server CA":         {"--server", "https://ouroboros.example.invalid", "--server-ca", "/nonexistent.pem"},
		"a server CA that is not PEM": {"--server", "https://ouroboros.example.invalid", "--server-ca", notPEM},
		"a name that is not a slug":   {"--server", "https://ouroboros.example.invalid", "--name", "Forge 01"},
	} {
		if _, _, err := runCommandLine(t, env(nil), append(base, extra...)...); err == nil {
			t.Errorf("%s: expected a refusal", name)
		}
	}
	if _, err := os.Stat(stateDir); !os.IsNotExist(err) {
		t.Error("a refused enrollment created the state directory")
	}
}

// TestRunRequiresAnEnrollment asserts `run` on a machine that was never enrolled says
// what to do.
func TestRunRequiresAnEnrollment(t *testing.T) {
	_, _, err := runCommandLine(t, env(nil), "run", "--state-dir", t.TempDir())
	if !errors.Is(err, state.ErrNotEnrolled) || !strings.Contains(err.Error(), "ouroboros-runner enroll") {
		t.Fatalf("expected a not-enrolled error naming enroll, got %v", err)
	}
}

// enrolledCommandLine enrols a runner through the command and returns its state
// directory.
func enrolledCommandLine(t *testing.T, farm *farmtest.Farm, extra ...string) string {
	t.Helper()
	serverCA := filepath.Join(t.TempDir(), "server-ca.pem")
	if err := farm.WriteServerCA(serverCA); err != nil {
		t.Fatal(err)
	}
	stateDir := filepath.Join(t.TempDir(), "state")
	args := append([]string{"enroll",
		"--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-a",
		"--token", farm.MintToken("pool-a", 1), "--name", "forge-01",
		"--state-dir", stateDir, "--server-ca", serverCA}, extra...)
	if _, stderr, err := runCommandLine(t, env(nil), args...); err != nil {
		t.Fatalf("enroll: %v\n%s", err, stderr)
	}
	return stateDir
}
