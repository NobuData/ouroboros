package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
)

// The command, as a process.
//
// Everything in this file runs `ouroboros-runner` as a real child process — this test
// binary re-executed with mainMarker set, so it runs main() and nothing else — against
// the in-process farm. That is the only way to test what the issue asks to be tested at
// this level: a kill -9 and a restart, a SIGTERM and the bye it becomes, an exit status
// a service manager would record, and the socket table of a running agent.

// mainMarker switches this test binary into being the command.
const mainMarker = "OUROBOROS_RUNNER_TEST_MAIN"

// TestMain runs main() instead of the suite when the marker is set.
func TestMain(m *testing.M) {
	if os.Getenv(mainMarker) == "1" {
		main()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// process is one running command.
type process struct {
	t      *testing.T
	cmd    *exec.Cmd
	output *lockedBuffer
	exited chan error
}

// lockedBuffer is a child's combined output, safe to read while it is still writing.
type lockedBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

// command is the agent command with the given arguments, in an environment holding
// nothing of the developer's own OURO_RUNNER_* settings.
func command(t *testing.T, args ...string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], args...) // #nosec G204 G702 -- this test binary, re-executed
	for _, variable := range os.Environ() {
		if !strings.HasPrefix(variable, "OURO_RUNNER_") && !strings.HasPrefix(variable, mainMarker+"=") {
			cmd.Env = append(cmd.Env, variable)
		}
	}
	cmd.Env = append(cmd.Env, mainMarker+"=1")
	return cmd
}

// execute runs a command to completion and returns its combined output and exit code.
func execute(t *testing.T, args ...string) (string, int) {
	t.Helper()
	cmd := command(t, args...)
	output, err := cmd.CombinedOutput()
	if err != nil && cmd.ProcessState == nil {
		t.Fatalf("run %v: %v", args, err)
	}
	return string(output), cmd.ProcessState.ExitCode()
}

// spawn starts a long-lived command.
func spawn(t *testing.T, args ...string) *process {
	t.Helper()
	cmd := command(t, args...)
	output := &lockedBuffer{}
	cmd.Stdout, cmd.Stderr = output, output
	if err := cmd.Start(); err != nil {
		t.Fatalf("start %v: %v", args, err)
	}
	p := &process{t: t, cmd: cmd, output: output, exited: make(chan error, 1)}
	go func() { p.exited <- cmd.Wait() }()
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		<-p.exited
	})
	return p
}

// signal sends a signal and waits for the process to exit, returning its exit code.
func (p *process) signal(sig syscall.Signal) int {
	p.t.Helper()
	if err := p.cmd.Process.Signal(sig); err != nil {
		p.t.Fatalf("signal: %v", err)
	}
	return p.wait()
}

// wait waits for the process to exit and returns its exit code.
func (p *process) wait() int {
	p.t.Helper()
	select {
	case err := <-p.exited:
		p.exited <- err // for the cleanup
		return p.cmd.ProcessState.ExitCode()
	case <-time.After(30 * time.Second):
		p.t.Fatalf("the agent did not exit\n%s", p.output)
		return -1
	}
}

// awaitFarm waits for the farm to observe something.
func awaitFarm(t *testing.T, farm *farmtest.Farm, what string, output *lockedBuffer, condition func(farmtest.Observed) bool) farmtest.Observed {
	t.Helper()
	observed, ok := farm.WaitFor(30*time.Second, condition)
	if !ok {
		t.Fatalf("timed out waiting for %s\nagent output:\n%s", what, output)
	}
	return observed
}

// farmFiles is a farm with its server CA written where a child can read it.
func farmFiles(t *testing.T) (*farmtest.Farm, string) {
	t.Helper()
	farm := farmtest.NewFarm(t)
	serverCA := filepath.Join(t.TempDir(), "server-ca.pem")
	if err := farm.WriteServerCA(serverCA); err != nil {
		t.Fatal(err)
	}
	return farm, serverCA
}

// TestTheAgentEndToEnd is the issue's acceptance criteria, in the order an operator
// would meet them, against the command as a process:
//
//  1. enroll — and the same token refused a second time;
//  2. connect and heartbeat, holding no listening socket while it does;
//  3. killed with SIGKILL holding an unacknowledged job.finish, restarted, resumed, and
//     the frame delivered exactly once despite a second drop mid-delivery;
//  4. SIGTERM becomes a bye, and exit status 0;
//  5. key material 0600, and in no line of any output;
//  6. revoked, and refused at connect with a line saying why, and exit status 1.
func TestTheAgentEndToEnd(t *testing.T) {
	farm, serverCA := farmFiles(t)
	stateDir := filepath.Join(t.TempDir(), "state")
	token := farm.MintToken("pool-a", 1)
	var everything strings.Builder

	// 1. Enroll, and observe single-use enforcement.
	output, code := execute(t, "enroll", "--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-a",
		"--token", token, "--name", "forge-01", "--state-dir", stateDir, "--server-ca", serverCA)
	everything.WriteString(output)
	if code != 0 {
		t.Fatalf("enroll exited %d:\n%s", code, output)
	}
	output, code = execute(t, "enroll", "--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-a",
		"--token", token, "--name", "forge-02", "--state-dir", filepath.Join(t.TempDir(), "second"), "--server-ca", serverCA)
	everything.WriteString(output)
	if code == 0 || !strings.Contains(output, "farm_enrollment_refused") {
		t.Fatalf("a second enrollment with the same token exited %d:\n%s", code, output)
	}

	// 2. Connect, heartbeat, and listen on nothing.
	agent := spawn(t, "run", "--state-dir", stateDir, "--server-ca", serverCA)
	observed := awaitFarm(t, farm, "a hello and two heartbeats", agent.output, func(o farmtest.Observed) bool {
		return len(o.Hellos) == 1 && len(o.Heartbeats) >= 2
	})
	if hello := observed.Hellos[0]; hello.SecurityMode != conn.SecurityMTLS || hello.Pool != "pool-a" || hello.Resume != "" {
		t.Errorf("hello: %+v", hello)
	}
	assertNoListeningSockets(t, agent.cmd.Process.Pid)
	session := waitForSession(t, stateDir)

	// 3. Killed holding an unacknowledged job.finish. The frame is placed in the outbox
	// the way the executor persists one — named for its envelope id, 0600 — while the
	// agent is down, exactly as if it had been written the moment before the kill.
	agent.signal(syscall.SIGKILL)
	everything.WriteString(agent.output.String())
	frame := unacknowledgedFinish(t, stateDir)
	farm.DropOnFinish(1) // and the first delivery after the restart dies before its receipt

	agent = spawn(t, "run", "--state-dir", stateDir, "--server-ca", serverCA)
	observed = awaitFarm(t, farm, "the re-send, the drop, the re-send, and the duplicate receipt", agent.output,
		func(o farmtest.Observed) bool { return o.Duplicates == 1 })
	if observed.Hellos[1].Resume != session {
		t.Errorf("the restarted agent resumed %q, want the session it had, %q", observed.Hellos[1].Resume, session)
	}
	if observed.Recorded != 1 || len(observed.Finishes) != 2 {
		t.Errorf("expected one finished job from two deliveries, got %d from %d", observed.Recorded, len(observed.Finishes))
	}
	for i, delivered := range observed.FinishFrames {
		if !bytes.Equal(delivered, frame) {
			t.Errorf("delivery %d was not the persisted frame byte for byte:\n%s\n%s", i, delivered, frame)
		}
	}
	waitForEmptyOutbox(t, stateDir, agent.output)

	// 4. SIGTERM is a bye, and a clean exit.
	byes := len(observed.Byes)
	if code := agent.signal(syscall.SIGTERM); code != 0 {
		t.Errorf("SIGTERM exited %d:\n%s", code, agent.output)
	}
	everything.WriteString(agent.output.String())
	observed = awaitFarm(t, farm, "the bye", agent.output, func(o farmtest.Observed) bool { return len(o.Byes) > byes })
	if bye := observed.Byes[len(observed.Byes)-1]; bye.Reason != conn.ByeShutdown || bye.Detail != "SIGTERM received" {
		t.Errorf("bye: %+v", bye)
	}
	if len(observed.Violations) > 0 {
		t.Errorf("the agent wrote frames the contract refuses: %v", observed.Violations)
	}

	// 5. Key material: 0600, and never in any output.
	for _, name := range []string{"identity.pem", "runner.json", "session"} {
		info, err := os.Stat(filepath.Join(stateDir, name))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("%s is %v, want 0600", name, info.Mode().Perm())
		}
	}
	assertNoSecretIn(t, everything.String(), stateDir, token)

	// 6. Revoked: refused at connect, with a line saying why, and not retried.
	record, err := state.PeekRecord(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	farm.RevokeRunner(record.RunnerID)
	revoked := spawn(t, "run", "--state-dir", stateDir, "--server-ca", serverCA)
	if code := revoked.wait(); code != 1 {
		t.Errorf("a revoked runner exited %d, want 1", code)
	}
	logged := revoked.output.String()
	if !strings.Contains(logged, "level=ERROR") || !strings.Contains(logged, "revoked") ||
		!strings.Contains(logged, "enroll this machine again") {
		t.Errorf("expected a clear refusal line:\n%s", logged)
	}
}

// TestTheBearerFallbackNeedsItsFlagAtEveryStart is decision B3's fallback through the
// command: asked for at enrollment, refused at `run` without the flag, and reported in
// the hello with it.
func TestTheBearerFallbackNeedsItsFlagAtEveryStart(t *testing.T) {
	farm, serverCA := farmFiles(t)
	farm.AllowBearerFallback()
	stateDir := filepath.Join(t.TempDir(), "state")
	token := farm.MintToken("pool-a", 1)

	output, code := execute(t, "enroll", "--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-a",
		"--token", token, "--name", "forge-01", "--state-dir", stateDir, "--server-ca", serverCA, "--bearer-fallback")
	if code != 0 || !strings.Contains(output, "BEARER FALLBACK") || !strings.Contains(output, "--bearer-fallback") {
		t.Fatalf("enroll exited %d:\n%s", code, output)
	}

	output, code = execute(t, "run", "--state-dir", stateDir, "--server-ca", serverCA)
	if code == 0 || !strings.Contains(output, "--bearer-fallback") {
		t.Fatalf("run without the flag exited %d:\n%s", code, output)
	}
	if farm.Observe().Connections != 0 {
		t.Error("a bearer runner connected without the flag")
	}

	agent := spawn(t, "run", "--state-dir", stateDir, "--server-ca", serverCA, "--bearer-fallback")
	observed := awaitFarm(t, farm, "a bearer-fallback hello", agent.output, func(o farmtest.Observed) bool {
		return len(o.Heartbeats) >= 1
	})
	if observed.Hellos[0].SecurityMode != conn.SecurityBearerFallback || observed.Transports[0] != "bearer" {
		t.Errorf("hello %q on %q", observed.Hellos[0].SecurityMode, observed.Transports[0])
	}
	if code := agent.signal(syscall.SIGTERM); code != 0 {
		t.Errorf("SIGTERM exited %d", code)
	}
	bearer, err := os.ReadFile(filepath.Join(stateDir, "bearer.token"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(agent.output.String()+output, strings.TrimSpace(string(bearer))) {
		t.Error("the bearer secret reached the output")
	}
}

// unacknowledgedFinish writes a job.finish into the outbox as the executor would have,
// and returns its bytes.
func unacknowledgedFinish(t *testing.T, stateDir string) []byte {
	t.Helper()
	raw, err := os.ReadFile("../../../schemas/runner-protocol/fixtures/valid/job-finish.json")
	if err != nil {
		t.Fatal(err)
	}
	envelope, diags := conn.Decode(raw)
	if len(diags) > 0 {
		t.Fatal(diags)
	}
	id := conn.NewID()
	frame, err := conn.Encode(conn.NewFrame(id, conn.TypeJobFinish, envelope.Payload))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateDir, "outbox", id+".frame"), frame, 0o600); err != nil { // #nosec G703 -- the test's own temporary directory
		t.Fatal(err)
	}
	return frame
}

// waitForSession waits for the agent to record the session the gateway granted.
func waitForSession(t *testing.T, stateDir string) string {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if raw, err := os.ReadFile(filepath.Join(stateDir, "session")); err == nil && len(raw) > 0 {
			return strings.TrimSpace(string(raw))
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("no session was recorded")
	return ""
}

// waitForEmptyOutbox waits for a receipted frame's file to be removed.
func waitForEmptyOutbox(t *testing.T, stateDir string, output *lockedBuffer) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		entries, err := os.ReadDir(filepath.Join(stateDir, "outbox"))
		if err != nil {
			t.Fatal(err)
		}
		pending := 0
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".frame") {
				pending++
			}
		}
		if pending == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("the outbox still holds a receipted frame\n%s", output)
}

// assertNoSecretIn fails if any line of the private key, or the enrollment token, is in
// the text.
func assertNoSecretIn(t *testing.T, text, stateDir, token string) {
	t.Helper()
	identity, err := os.ReadFile(filepath.Join(stateDir, "identity.pem"))
	if err != nil {
		t.Fatal(err)
	}
	keyStart := bytes.Index(identity, []byte("-----BEGIN PRIVATE KEY-----"))
	if keyStart < 0 {
		t.Fatal("identity.pem holds no private key")
	}
	for _, line := range strings.Split(string(identity[keyStart:]), "\n") {
		if strings.HasPrefix(line, "-----") || len(line) < 16 {
			continue
		}
		if strings.Contains(text, line) {
			t.Errorf("a line of the private key reached the output: %s", line)
		}
	}
	if strings.Contains(text, token) {
		t.Error("the enrollment token reached the output")
	}
	if strings.Contains(text, "PRIVATE KEY") {
		t.Error("a private key block reached the output")
	}
}
