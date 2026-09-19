package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/logship"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/telemetry"
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
	return spawnWith(t, nil, args...)
}

// spawnWith starts a long-lived command with extra environment variables.
func spawnWith(t *testing.T, extra []string, args ...string) *process {
	t.Helper()
	cmd := command(t, args...)
	cmd.Env = append(cmd.Env, extra...)
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

// TestTheRunningAgentReportsThisMachine is the telemetry criterion through the command as
// a process (#245): the heartbeats a running agent sends carry this machine's real
// measurements — a CPU figure averaged over the monitor's window, and memory that agrees
// with what `hello` reports as installed — and every one of them is a frame the contract
// accepts.
func TestTheRunningAgentReportsThisMachine(t *testing.T) {
	farm, serverCA := farmFiles(t)
	stateDir := filepath.Join(t.TempDir(), "state")
	output, code := execute(t, "enroll", "--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-a",
		"--token", farm.MintToken("pool-a", 1), "--name", "forge-01", "--state-dir", stateDir, "--server-ca", serverCA)
	if code != 0 {
		t.Fatalf("enroll exited %d:\n%s", code, output)
	}

	agent := spawn(t, "run", "--state-dir", stateDir, "--server-ca", serverCA)
	observed := awaitFarm(t, farm, "a heartbeat with a CPU reading", agent.output, func(o farmtest.Observed) bool {
		return len(o.Heartbeats) > 0 && o.Heartbeats[len(o.Heartbeats)-1].CPUPct != nil
	})
	beat := observed.Heartbeats[len(observed.Heartbeats)-1]
	if *beat.CPUPct < 0 || *beat.CPUPct > 100 {
		t.Errorf("CPU %v is outside 0–100", *beat.CPUPct)
	}
	installed, err := telemetry.TotalMemoryMB()
	if err != nil {
		t.Fatal(err)
	}
	if beat.MemoryTotalMB == nil || *beat.MemoryTotalMB != installed {
		t.Errorf("the heartbeat's total memory %v disagrees with the %d MB hello reports", beat.MemoryTotalMB, installed)
	}
	if beat.MemoryUsedMB == nil || *beat.MemoryUsedMB < 1 || *beat.MemoryUsedMB > installed {
		t.Errorf("memory in use %v is not a reading of a %d MB machine", beat.MemoryUsedMB, installed)
	}
	if beat.State != conn.StateIdle || beat.QueueDepth != 0 || beat.Job != nil {
		t.Errorf("an agent with no work: %+v", beat)
	}

	if code := agent.signal(syscall.SIGTERM); code != 0 {
		t.Errorf("SIGTERM exited %d:\n%s", code, agent.output)
	}
	if violations := farm.Observe().Violations; len(violations) > 0 {
		t.Errorf("the agent wrote frames the contract refuses: %v", violations)
	}
	if strings.Contains(agent.output.String(), "cannot be measured") {
		t.Errorf("a metric this machine can measure was reported as failing:\n%s", agent.output)
	}
}

// TestTheRunningAgentRunsAShellJob is the shell executor through the command, as a process
// (#246): an offer accepted, started in a workspace under the state directory, and finished
// with the command's exit code and a duration — with the cleanup policy and the pool's
// allow-list read from where an operator and the gateway set them.
//
// The job prints its own environment to a file and fails, so the workspace is kept
// (OURO_RUNNER_KEEP_WORKSPACE_ON_FAILURE) and the file can be read: it holds the one
// variable the pool allows, and nothing of the agent's — though the agent was started with
// a sentinel in its environment.
func TestTheRunningAgentRunsAShellJob(t *testing.T) {
	farm, serverCA := farmFiles(t)
	farm.SetPool(&conn.AckPool{MaxConcurrency: 1, EnvAllowlist: []string{"CI"}})
	stateDir := filepath.Join(t.TempDir(), "state")
	output, code := execute(t, "enroll", "--server", farm.URL, "--tenant", "acme-robotics", "--pool", "pool-b",
		"--token", farm.MintToken("pool-b", 1), "--name", "anvil-mac", "--state-dir", stateDir, "--server-ca", serverCA)
	if code != 0 {
		t.Fatalf("enroll exited %d:\n%s", code, output)
	}

	agent := spawnWith(t, []string{envKeep + "=true", "OURO_TEST_SENTINEL=the agent's own"},
		"run", "--state-dir", stateDir, "--server-ca", serverCA)
	observed := awaitFarm(t, farm, "the connection", agent.output, func(o farmtest.Observed) bool {
		return len(o.Hellos) == 1 && len(o.Heartbeats) >= 1
	})
	if !observed.Hellos[0].Capabilities.Shell {
		t.Fatalf("the runner does not advertise shell jobs: %+v", observed.Hellos[0].Capabilities)
	}

	job := "job_01KE7EWKB1TJFC3BXKZPY4FRD2"
	if err := farm.Send(conn.NewFrame(conn.NewID(), conn.TypeJobOffer, map[string]any{
		"job": job, "pool": "pool-b", "executor": "shell",
		"command": []string{"sh", "-c", "env > env.txt; sleep 0.2; exit 3"}, "workdir": "/",
		"env":        map[string]string{"CI": "true", "HOME": "/root"},
		"repository": nil, "timeout_s": 60, "expires_at": conn.Timestamp(time.Now().Add(time.Minute)),
	})); err != nil {
		t.Fatal(err)
	}
	observed = awaitFarm(t, farm, "the job's finish", agent.output, func(o farmtest.Observed) bool {
		return len(o.Finishes) == 1
	})
	if !slices.Equal(observed.JobFrames, []conn.Type{conn.TypeJobAccept, conn.TypeJobStart, conn.TypeJobFinish}) {
		t.Errorf("job frames: %v", observed.JobFrames)
	}
	envelope, diags := conn.Decode(observed.FinishFrames[0])
	if len(diags) > 0 {
		t.Fatalf("an illegal finish: %v", diags)
	}
	var finish conn.JobFinishPayload
	if err := envelope.Into(&finish); err != nil {
		t.Fatal(err)
	}
	started, _ := time.Parse(time.RFC3339Nano, finish.StartedAt)
	finished, _ := time.Parse(time.RFC3339Nano, finish.FinishedAt)
	if finish.Outcome != conn.OutcomeFailed || finish.ExitCode == nil || *finish.ExitCode != 3 ||
		finished.Sub(started) < 200*time.Millisecond {
		t.Errorf("finish: %+v", finish)
	}

	workspace := filepath.Join(stateDir, "work", job)
	if observed.Starts[0].Workspace != workspace {
		t.Errorf("started in %s, want %s", observed.Starts[0].Workspace, workspace)
	}
	printed, err := os.ReadFile(filepath.Join(workspace, "env.txt")) // kept: the job failed
	if err != nil {
		t.Fatalf("the failed job's workspace was not kept: %v\n%s", err, agent.output)
	}
	names := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSpace(string(printed)), "\n") {
		name, _, _ := strings.Cut(line, "=")
		names[name] = true
	}
	// CI is the pool's; PWD, SHLVL and _ are what the job's own sh exports about itself; and
	// the two CCACHE_ variables are the agent's own (#247), which it sets on every job —
	// never the offer's, and never another pool's directory.
	allowed := map[string]bool{"CI": true, "PWD": true, "SHLVL": true, "_": true,
		logship.EnvCcacheDir: true, logship.EnvCcacheStatsLog: true}
	for name := range names {
		if !allowed[name] {
			t.Errorf("the job saw %s, which the pool does not allow:\n%s", name, printed)
		}
	}
	if !names["CI"] {
		t.Errorf("the job did not see the allowed CI:\n%s", printed)
	}
	cache := filepath.Join(stateDir, "cache", "pool-b", "ccache")
	if !strings.Contains(string(printed), logship.EnvCcacheDir+"="+cache+"\n") {
		t.Errorf("the job did not run against its pool's cache (%s):\n%s", cache, printed)
	}
	if info, err := os.Stat(cache); err != nil || !info.IsDir() {
		t.Errorf("the pool's cache directory was not made: %v", err)
	}

	if code := agent.signal(syscall.SIGTERM); code != 0 {
		t.Errorf("SIGTERM exited %d:\n%s", code, agent.output)
	}
	if violations := farm.Observe().Violations; len(violations) > 0 {
		t.Errorf("the agent wrote frames the contract refuses: %v", violations)
	}
	if !strings.Contains(agent.output.String(), "dropped=[HOME]") {
		t.Errorf("the dropped variable was not logged:\n%s", agent.output)
	}
}
