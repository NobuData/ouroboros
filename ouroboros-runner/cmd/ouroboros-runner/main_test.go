package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/logship"
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

// TestHelloReportsShellUnlessRefused is `capabilities.shell` as an operator's answer
// (#246): true by default now that there is a shell executor, and false when the runner is
// started with --no-shell or OURO_RUNNER_NO_SHELL — the refusal a machine holding signing
// keys makes. A value that is not a boolean is a mistake to stop on, not a silent false.
func TestHelloReportsShellUnlessRefused(t *testing.T) {
	shell := func(getenv func(string) string, args ...string) bool {
		t.Helper()
		printed, _, err := runCommandLine(t, getenv, append([]string{"hello", "--state-dir", t.TempDir()}, args...)...)
		if err != nil {
			t.Fatalf("hello %v: %v", args, err)
		}
		var hello conn.HelloPayload
		frame, diags := conn.Decode([]byte(printed))
		if len(diags) > 0 {
			t.Fatalf("an illegal hello: %v", diags)
		}
		if err := frame.Into(&hello); err != nil {
			t.Fatal(err)
		}
		return hello.Capabilities.Shell
	}
	if !shell(env(nil)) {
		t.Error("a runner started plainly refuses shell jobs")
	}
	if shell(env(nil), "--no-shell") {
		t.Error("--no-shell still reports shell: true")
	}
	if shell(env(map[string]string{envNoShell: "true"})) {
		t.Errorf("%s=true still reports shell: true", envNoShell)
	}
	if !shell(env(map[string]string{envNoShell: "false"})) {
		t.Errorf("%s=false refuses shell jobs", envNoShell)
	}

	for _, command := range []string{"hello", "run"} {
		for _, variable := range []string{envNoShell, envKeep} {
			if command == "hello" && variable == envKeep {
				continue // hello does not read the cleanup policy
			}
			_, _, err := runCommandLine(t, env(map[string]string{variable: "maybe"}), command, "--state-dir", t.TempDir())
			if !errors.Is(err, errUsage) || !strings.Contains(err.Error(), variable) {
				t.Errorf("%s with %s=maybe: %v", command, variable, err)
			}
		}
	}
}

// TestHeartbeatPrintsThisMachine is the parity instrument (#245): the heartbeat this
// machine would send, measured over one window, validated against the contract before it
// is printed — and carrying real readings on a machine that can take them, which every
// machine ci/runner runs on can.
func TestHeartbeatPrintsThisMachine(t *testing.T) {
	printed, logged, err := runCommandLine(t, env(nil), "heartbeat", "--window", "200ms")
	if err != nil {
		t.Fatalf("heartbeat: %v\n%s", err, logged)
	}

	envelope, diags := conn.Decode([]byte(printed))
	if len(diags) > 0 {
		t.Fatalf("the printed frame is not a legal heartbeat: %v\n%s", diags, printed)
	}
	if envelope.Type != conn.TypeHeartbeat || envelope.ID != placeholderID {
		t.Errorf("expected a heartbeat with the placeholder id, got %s %s", envelope.Type, envelope.ID)
	}
	var beat conn.HeartbeatPayload
	if err := envelope.Into(&beat); err != nil {
		t.Fatal(err)
	}
	if beat.CPUPct == nil || beat.MemoryUsedMB == nil || beat.MemoryTotalMB == nil {
		t.Errorf("this machine can be measured, and a measurement is missing:\n%s\n%s", printed, logged)
	}
	if beat.State != conn.StateIdle || beat.QueueDepth != 0 || beat.Job != nil {
		t.Errorf("a machine measured by a command has no work: %+v", beat)
	}
}

// TestHeartbeatStopsWhenInterrupted asserts a Ctrl-C during the window ends the command
// with an error rather than printing a reading it did not finish taking.
func TestHeartbeatStopsWhenInterrupted(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errors.New("SIGINT received"))
	stdout := &bytes.Buffer{}
	err := run(ctx, []string{"heartbeat"}, stdout, &bytes.Buffer{}, env(nil))
	if err == nil || !strings.Contains(err.Error(), "SIGINT received") {
		t.Errorf("expected the interruption as the error, got %v", err)
	}
	if stdout.Len() > 0 {
		t.Errorf("an interrupted measurement printed a frame:\n%s", stdout)
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
		{"heartbeat", "--no-such-flag"},
		{"heartbeat", "stray-argument"},
		{"heartbeat", "--window", "1ns"},
		{"heartbeat", "--window", "2h"},
		{"run", "--no-shell=maybe"},
		{"hello", "--keep-workspace-on-failure"}, // a cleanup policy is not part of a hello
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
		"enroll", "run", "heartbeat", "--tenant", "--pool", "--token", "--bearer-fallback",
		"outbound", "nothing listens", "docs/RUNNER_PROTOCOL.md",
		envServer, envToken, envStateDir, envServerCA, envNoShell, envKeep, envLogCap,
		"--no-shell", "--keep-workspace-on-failure", "--log-cap-bytes",
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

// TestTheLogCapIsReadAndHeldToTheControlPlanesRange is the agent's own per-job output cap
// (#247): the flag, its variable, and a value outside V040's range — or one that is not a
// number — stopping the agent instead of being silently clamped, because a typo in a unit
// file should be read by the operator who made it.
func TestTheLogCapIsReadAndHeldToTheControlPlanesRange(t *testing.T) {
	capOf := func(t *testing.T, getenv func(string) string, args ...string) (int64, error) {
		t.Helper()
		var jobs jobFlags
		set := flagSet("run", io.Discard)
		if err := jobs.register(set, getenv, true); err != nil {
			return 0, err
		}
		if err := set.Parse(args); err != nil {
			return 0, err
		}
		return jobs.logCapBytes, jobs.checkLogCap()
	}

	if size, err := capOf(t, env(nil)); size != logship.DefaultCapBytes || err != nil {
		t.Errorf("by default the cap is %d, %v; want %d", size, err, logship.DefaultCapBytes)
	}
	if size, err := capOf(t, env(nil), "--log-cap-bytes", "1048576"); size != 1048576 || err != nil {
		t.Errorf("--log-cap-bytes 1048576: %d, %v", size, err)
	}
	if size, err := capOf(t, env(map[string]string{envLogCap: "131072"})); size != 131072 || err != nil {
		t.Errorf("%s=131072: %d, %v", envLogCap, size, err)
	}
	// The flag wins over the variable, as every other pair does.
	if size, err := capOf(t, env(map[string]string{envLogCap: "131072"}), "--log-cap-bytes", "262144"); size != 262144 || err != nil {
		t.Errorf("the flag did not win over %s: %d, %v", envLogCap, size, err)
	}
	for _, value := range []string{"1024", "268435457", "0"} {
		if _, err := capOf(t, env(nil), "--log-cap-bytes", value); !errors.Is(err, errUsage) ||
			!strings.Contains(err.Error(), "log-cap-bytes") {
			t.Errorf("--log-cap-bytes %s: %v; want a usage error", value, err)
		}
	}
	for _, value := range []string{"lots", "-1", "64 KiB"} {
		if _, err := capOf(t, env(map[string]string{envLogCap: value})); !errors.Is(err, errUsage) ||
			!strings.Contains(err.Error(), envLogCap) {
			t.Errorf("%s=%s: %v; want a usage error naming the variable", envLogCap, value, err)
		}
	}
	if _, _, err := runCommandLine(t, env(map[string]string{envLogCap: "enormous"}), "run", "--state-dir", t.TempDir()); !errors.Is(err, errUsage) {
		t.Errorf("run with %s=enormous: %v", envLogCap, err)
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
