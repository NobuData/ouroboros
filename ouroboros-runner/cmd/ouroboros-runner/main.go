// Command ouroboros-runner is the Ouroboros build farm agent.
//
// It runs on hardware the customer owns, connects OUTBOUND to the farm gateway over
// mTLS, registers itself, and then takes the work it is offered — which is the whole
// point: no inbound ports, no firewall exception, no address anyone has to expose.
//
// Usage:
//
//	ouroboros-runner enroll --server URL --tenant NAME --pool NAME --token TOKEN
//	ouroboros-runner run
//	ouroboros-runner version    # the build, the protocol range it speaks, this machine
//	ouroboros-runner hello      # the hello frame this machine would send, as JSON
//	ouroboros-runner heartbeat  # the heartbeat it would send: this machine, measured now
//
// `enroll` spends a token once and leaves an identity in the state directory: a client
// certificate over a key this machine generated and never sent anywhere ([#244],
// decision B3). `run` is the long-lived process — a service manager's ExecStart — which
// holds the one outbound connection, reconnects with jittered backoff when it drops,
// renews the certificate before it expires, and says `bye` on SIGTERM.
//
// Neither listens. Nothing in this command opens a listening socket, and main_test.go
// runs the built command and reads the kernel's socket table to prove it.
//
// [#244]: https://github.com/NobuData/ouroboros/issues/244
package main

import (
	"context"
	"crypto/x509"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/agent"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/enroll"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/logship"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/secret"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/state"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/telemetry"
)

// version is this agent's own semver, stamped at link time by the Makefile from the
// module's VERSION file. The default is what an unstamped `go build` produces, and it
// says so rather than claiming a release number it is not.
var version = "0.0.0-dev"

// DefaultStateDir is where the agent keeps its identity when nothing says otherwise —
// the directory the protocol document's worked examples put workspaces under.
const DefaultStateDir = "/var/lib/ouroboros-runner"

// The environment variables the agent reads, each a fallback for the flag of the same
// meaning (docs/CONVENTIONS.md § 4: everything Ouroboros-specific is OURO_-prefixed). The
// token is here so an installer can keep it off the process list; the bearer fallback
// deliberately is not — it is a flag, stated where the agent is started, and nothing
// else.
const (
	envServer   = "OURO_RUNNER_SERVER"
	envToken    = "OURO_RUNNER_TOKEN" // #nosec G101 -- the variable's name, not a credential
	envStateDir = "OURO_RUNNER_STATE_DIR"
	envServerCA = "OURO_RUNNER_SERVER_CA"
	envNoShell  = "OURO_RUNNER_NO_SHELL"
	envKeep     = "OURO_RUNNER_KEEP_WORKSPACE_ON_FAILURE"
	envLogCap   = "OURO_RUNNER_LOG_CAP_BYTES"
)

// workDir is where job workspaces are made, inside the state directory: the path the
// protocol's own `job.start` example reports. cacheDir is beside it, one directory per
// pool, and unlike a workspace it OUTLIVES the job: a compiler cache is only worth having
// warm ([#247]).
//
// [#247]: https://github.com/NobuData/ouroboros/issues/247
const (
	workDir  = "work"
	cacheDir = "cache"
)

// usage is printed for `help`, for no arguments at all, and for anything unrecognised.
const usage = `ouroboros-runner — the Ouroboros build farm agent.

Usage:
  ouroboros-runner enroll --server URL --tenant NAME --pool NAME --token TOKEN
                          [--name NAME] [--state-dir DIR] [--server-ca FILE]
                          [--bearer-fallback]
      Spend an enrollment token once and keep the identity it buys: a client
      certificate over a key this machine generated. Nothing secret is printed.

  ouroboros-runner run [--state-dir DIR] [--server-ca FILE] [--bearer-fallback]
                       [--no-shell] [--keep-workspace-on-failure]
                       [--log-cap-bytes N]
      Connect outbound over mTLS and stay connected: heartbeat, reconnect with
      jittered backoff, renew the certificate before it expires, say bye on SIGTERM.
      Run the jobs it is offered — in a container when a Docker or Podman daemon
      answers, and on this machine directly unless --no-shell — and decline the
      ones it cannot run.

  ouroboros-runner version   Print the build, the protocol range and this machine.
  ouroboros-runner hello [--no-shell]
      Print the hello frame this machine would send.
  ouroboros-runner heartbeat [--window 5s]
      Measure this machine for one window and print the heartbeat it would send —
      CPU, memory in use and installed, each null where it cannot be measured.

The agent dials out; nothing listens, and no inbound port is opened.

Environment (each a fallback for its flag):
  OURO_RUNNER_SERVER      --server     the control plane, https://
  OURO_RUNNER_TOKEN       --token      the enrollment token, kept off the process list
  OURO_RUNNER_STATE_DIR   --state-dir  default /var/lib/ouroboros-runner
  OURO_RUNNER_SERVER_CA   --server-ca  a PEM file of roots to verify the control plane
                                       with, in place of the system's
  OURO_RUNNER_NO_SHELL    --no-shell   true: run no job directly on this machine, and say
                                       so in the hello
  OURO_RUNNER_KEEP_WORKSPACE_ON_FAILURE
                          --keep-workspace-on-failure
                                       true: leave a failed job's workspace for diagnosis
  OURO_RUNNER_LOG_CAP_BYTES
                          --log-cap-bytes
                                       the most of one job's output to send, 65536–268435456
                                       (default 67108864); the rest is reported as dropped

--bearer-fallback has no variable: the weaker mode is stated on the command line or
not at all. See docs/RUNNER_PROTOCOL.md for the wire contract.
`

func main() {
	// Parsing an empty set is what gives `ouroboros-runner -h` the usage text rather
	// than Go's default one-line report of no flags at all.
	flag.Usage = func() { fmt.Fprint(os.Stderr, usage) }
	flag.Parse()

	ctx, stop := signalContext()
	defer stop()

	if err := run(ctx, flag.Args(), os.Stdout, os.Stderr, os.Getenv); err != nil {
		fmt.Fprintf(os.Stderr, "ouroboros-runner: %v\n", err)
		stop()
		os.Exit(1) // stop has run; nothing deferred is left to lose
	}
}

// signalContext is cancelled by SIGTERM or SIGINT, with the signal as its cause — which
// is what the agent's `bye` says: `SIGTERM received`.
func signalContext() (context.Context, func()) {
	ctx, cancel := context.WithCancelCause(context.Background())
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		select {
		case received := <-signals:
			name := "SIGTERM"
			if received == syscall.SIGINT {
				name = "SIGINT"
			}
			cancel(fmt.Errorf("%s received", name))
		case <-ctx.Done():
		}
	}()
	return ctx, func() {
		signal.Stop(signals)
		cancel(nil)
	}
}

// errUsage is the exit that is the caller's mistake rather than the agent's. It is
// separated so run can be tested without a process: a command that printed usage to
// stdout and exited 0 would make a typo look like a success.
var errUsage = errors.New("no such command")

// run is main without the process, so every command is testable.
//
// It takes the writers and the environment rather than using the process's for the
// same reason: what these commands produce is a document — a frame an operator pastes
// into an issue, a log a service manager keeps — and a test that cannot read it can only
// assert that nothing crashed.
func run(ctx context.Context, args []string, stdout, stderr io.Writer, getenv func(string) string) error {
	if len(args) == 0 {
		return fmt.Errorf("%w: expected `enroll`, `run`, `version`, `hello` or `heartbeat`", errUsage)
	}

	switch command := args[0]; command {
	case "enroll":
		return enrollCommand(ctx, args[1:], stdout, stderr, getenv)
	case "run":
		return runCommand(ctx, args[1:], stderr, getenv)
	case "version":
		return printVersion(stdout)
	case "hello":
		return printHello(ctx, args[1:], stdout, getenv)
	case "heartbeat":
		return printHeartbeat(ctx, args[1:], stdout, stderr)
	case "help":
		_, err := io.WriteString(stdout, usage)
		return err
	default:
		return fmt.Errorf("%w: %q — expected `enroll`, `run`, `version`, `hello` or `heartbeat`", errUsage, command)
	}
}

// commonFlags are the flags `enroll`, `run` and `hello` share.
type commonFlags struct {
	stateDir string
	serverCA string
}

// register adds the common flags to a flag set, defaulted from the environment.
func (c *commonFlags) register(set *flag.FlagSet, getenv func(string) string) {
	set.StringVar(&c.stateDir, "state-dir", orDefault(getenv(envStateDir), DefaultStateDir),
		"where the identity is kept ("+envStateDir+")")
	set.StringVar(&c.serverCA, "server-ca", getenv(envServerCA),
		"PEM roots to verify the control plane with, in place of the system's ("+envServerCA+")")
}

// roots reads --server-ca, or returns nil for the system's roots.
func (c *commonFlags) roots() (*x509.CertPool, error) {
	if c.serverCA == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(c.serverCA)
	if err != nil {
		return nil, fmt.Errorf("read --server-ca: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(raw) {
		return nil, fmt.Errorf("--server-ca %s holds no PEM certificate", c.serverCA)
	}
	return pool, nil
}

// flagSet is a flag set that reports its own errors as usage errors rather than exiting.
func flagSet(name string, stderr io.Writer) *flag.FlagSet {
	set := flag.NewFlagSet(name, flag.ContinueOnError)
	set.SetOutput(stderr)
	set.Usage = func() { _, _ = fmt.Fprint(stderr, usage) }
	return set
}

// enrollCommand is `ouroboros-runner enroll`.
func enrollCommand(ctx context.Context, args []string, stdout, stderr io.Writer, getenv func(string) string) error {
	var common commonFlags
	var server, tenant, pool, token, name string
	var bearerFallback bool
	set := flagSet("enroll", stderr)
	common.register(set, getenv)
	set.StringVar(&server, "server", getenv(envServer), "the control plane, https:// ("+envServer+")")
	set.StringVar(&tenant, "tenant", "", "the workspace this runner is enrolled into")
	set.StringVar(&pool, "pool", "", "the pool it joins; the token must be scoped to it")
	set.StringVar(&token, "token", getenv(envToken), "the enrollment token ("+envToken+")")
	set.StringVar(&name, "name", "", "the runner's name (default: this machine's hostname, as a slug)")
	set.BoolVar(&bearerFallback, "bearer-fallback", false,
		"enrol WITHOUT a client certificate, for networks whose proxies strip one — visibly degraded")
	if err := set.Parse(args); err != nil {
		return fmt.Errorf("%w: %w", errUsage, err)
	}
	if set.NArg() > 0 {
		return fmt.Errorf("%w: unexpected %q", errUsage, set.Arg(0))
	}

	base, err := enroll.ParseServer(server)
	if err != nil {
		return fmt.Errorf("--server: %w", err)
	}
	roots, err := common.roots()
	if err != nil {
		return err
	}
	host, err := telemetry.Describe()
	if err != nil {
		return err
	}
	if name == "" {
		name = enroll.NameFromHostname(host.Hostname)
	}
	request := enroll.Request{
		Tenant: tenant, Pool: pool, Token: secret.Secret(token), Name: name,
		Arch: host.Arch, AgentVersion: version, CPUs: host.CPUs, BearerFallback: bearerFallback,
	}
	if err := request.Validate(); err != nil {
		return err
	}

	// The directory is opened — and checked — BEFORE the token is presented. A second
	// enrollment into a directory that already holds a runner would spend a token and
	// create a runner row for an identity that could not then be saved.
	dir, err := state.Open(common.stateDir)
	if err != nil {
		return err
	}
	defer func() { _ = dir.Close() }()
	if enrolled, err := dir.Enrolled(); err != nil {
		return err
	} else if enrolled {
		return fmt.Errorf("%w: %s. Remove it to enrol this machine again", state.ErrAlreadyEnrolled, common.stateDir)
	}

	logger := newLogger(stderr)
	request.Docker = telemetry.DockerReachable(ctx, telemetry.DockerSockets())
	logger.Info("enrolling", "server", base.String(), "tenant", tenant, "pool", pool, "name", name,
		"arch", host.Arch, "docker", request.Docker, "bearer_fallback", bearerFallback)

	client := &enroll.Client{Server: base, RootCAs: roots, UserAgent: "ouroboros-runner/" + version}
	enrollment, err := client.Register(ctx, request)
	if err != nil {
		return fmt.Errorf("enrollment failed: %w", err)
	}
	if err := dir.SaveEnrollment(enrollment); err != nil {
		return fmt.Errorf("enrolled, but the identity could not be saved: %w", err)
	}

	record := enrollment.Record
	logger.Info("enrolled", "runner", record.RunnerID, "name", record.Name, "security_mode", record.SecurityMode,
		"state_dir", common.stateDir)
	summary := &strings.Builder{}
	fmt.Fprintf(summary, "enrolled %s as runner %s in %s / %s\n", record.Name, record.RunnerID, record.Tenant, record.Pool)
	if record.SecurityMode == conn.SecurityMTLS {
		fmt.Fprintf(summary, "identity  client certificate %s, valid until %s, renewed from %s\n",
			record.Serial, record.NotAfter.Format(time.RFC3339), record.RenewAfter.Format(time.RFC3339))
	} else {
		fmt.Fprint(summary, "identity  BEARER FALLBACK — no client certificate; the farm shows this runner as degraded\n")
	}
	fmt.Fprintf(summary, "farm CA   sha256 %s (pinned)\n", record.AuthorityFingerprint)
	fmt.Fprintf(summary, "state     %s\n", common.stateDir)
	runLine := "ouroboros-runner run --state-dir " + common.stateDir
	if record.SecurityMode == conn.SecurityBearerFallback {
		runLine += " --bearer-fallback"
	}
	fmt.Fprintf(summary, "next      %s\n", runLine)
	_, err = io.WriteString(stdout, summary.String())
	return err
}

// runCommand is `ouroboros-runner run` — the long-lived process.
func runCommand(ctx context.Context, args []string, stderr io.Writer, getenv func(string) string) error {
	var common commonFlags
	var jobs jobFlags
	var bearerFallback bool
	set := flagSet("run", stderr)
	common.register(set, getenv)
	set.BoolVar(&bearerFallback, "bearer-fallback", false,
		"permit a runner enrolled in bearer-fallback mode to connect — required, every time, for such a runner")
	if err := jobs.register(set, getenv, true); err != nil {
		return err
	}
	if err := set.Parse(args); err != nil {
		return fmt.Errorf("%w: %w", errUsage, err)
	}
	if set.NArg() > 0 {
		return fmt.Errorf("%w: unexpected %q", errUsage, set.Arg(0))
	}
	if err := jobs.checkLogCap(); err != nil {
		return err
	}

	roots, err := common.roots()
	if err != nil {
		return err
	}
	dir, err := state.Open(common.stateDir)
	if err != nil {
		return err
	}
	defer func() { _ = dir.Close() }()
	record, err := dir.Record()
	if err != nil {
		return fmt.Errorf("%w; run `ouroboros-runner enroll` first", err)
	}
	server, err := enroll.ParseServer(record.Server)
	if err != nil {
		return fmt.Errorf("%s records the server as %q: %w", common.stateDir, record.Server, err)
	}

	host, machine, err := describe(ctx, jobs.noShell)
	if err != nil {
		return err
	}
	logger := newLogger(stderr)
	logger.Info("executors", "container", machine.capabilities.Docker, "docker_socket", machine.dockerSocket,
		"shell", machine.capabilities.Shell, "keep_workspace_on_failure", jobs.keepOnFailure,
		"log_cap_bytes", jobs.logCapBytes)

	// The heartbeat's measurements are taken in the background for as long as the agent
	// runs, so a beat reads the newest sample rather than waiting a window for one.
	monitor := telemetry.NewMonitor(telemetry.DefaultWindow, logger)
	measuring, stopMeasuring := context.WithCancel(ctx)
	defer stopMeasuring()
	go monitor.Run(measuring)

	runner, err := agent.New(agent.Config{
		Dir:            dir,
		Server:         server,
		RootCAs:        roots,
		Version:        version,
		Arch:           host.Arch,
		Hostname:       host.Hostname,
		Capabilities:   machine.capabilities,
		Executors:      machine.executors(),
		Workspaces:     &exec.Workspaces{Root: filepath.Join(common.stateDir, workDir), KeepOnFailure: jobs.keepOnFailure},
		LogCapBytes:    jobs.logCapBytes,
		CacheRoot:      filepath.Join(common.stateDir, cacheDir),
		Telemetry:      monitor,
		BearerFallback: bearerFallback,
		Renewer:        &enroll.Client{Server: server, RootCAs: roots, UserAgent: "ouroboros-runner/" + version},
		Logger:         logger,
	})
	if err != nil {
		return err
	}
	return runner.Run(ctx)
}

// jobFlags are the flags that decide which jobs this runner takes and what it leaves
// behind ([#246]).
//
// [#246]: https://github.com/NobuData/ouroboros/issues/246
type jobFlags struct {
	noShell       bool
	keepOnFailure bool
	logCapBytes   int64
}

// register adds the job flags to a flag set, defaulted from the environment. keep says
// whether --keep-workspace-on-failure belongs to this command: `hello` describes the
// machine, and a cleanup policy is not part of a hello.
func (j *jobFlags) register(set *flag.FlagSet, getenv func(string) string, keep bool) error {
	noShell, err := envBool(getenv, envNoShell)
	if err != nil {
		return err
	}
	set.BoolVar(&j.noShell, "no-shell", noShell,
		"run no job directly on this machine; the hello says shell: false ("+envNoShell+")")
	if !keep {
		return nil
	}
	keepOnFailure, err := envBool(getenv, envKeep)
	if err != nil {
		return err
	}
	set.BoolVar(&j.keepOnFailure, "keep-workspace-on-failure", keepOnFailure,
		"leave the workspace of a job that failed, timed out or errored, for diagnosis ("+envKeep+")")

	logCapBytes, err := envBytes(getenv, envLogCap, logship.DefaultCapBytes)
	if err != nil {
		return err
	}
	set.Int64Var(&j.logCapBytes, "log-cap-bytes", logCapBytes, fmt.Sprintf(
		"the most of one job's output to send, %d–%d; the rest is reported as dropped (%s)",
		logship.MinCapBytes, logship.MaxCapBytes, envLogCap))
	return nil
}

// checkLogCap holds the cap to the range the control plane's own cap uses, so a value that
// would silently be clamped stops the agent instead — in the unit file an operator reads.
func (j *jobFlags) checkLogCap() error {
	if j.logCapBytes < logship.MinCapBytes || j.logCapBytes > logship.MaxCapBytes {
		return fmt.Errorf("%w: --log-cap-bytes is %d; it must be between %d and %d",
			errUsage, j.logCapBytes, logship.MinCapBytes, logship.MaxCapBytes)
	}
	return nil
}

// envBytes reads a byte-count variable: unset or empty is the default, and anything
// strconv cannot read — or a negative number — is a usage error naming the variable.
func envBytes(getenv func(string) string, name string, fallback int64) (int64, error) {
	raw := getenv(name)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("%w: %s=%q is not a number of bytes", errUsage, name, raw)
	}
	return value, nil
}

// envBool reads a boolean variable: unset or empty is false, and anything strconv cannot
// read is a usage error naming the variable — a typo in a unit file should stop the agent,
// not quietly mean false.
func envBool(getenv func(string) string, name string) (bool, error) {
	raw := getenv(name)
	if raw == "" {
		return false, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%w: %s=%q is not true or false", errUsage, name, raw)
	}
	return value, nil
}

// machine is what this runner can do, answered by asking: the hello's capabilities, and
// the daemon socket the container executor will talk to.
type machine struct {
	capabilities conn.Capabilities
	dockerSocket string
}

// executors is one executor per capability the hello reports — built from the same probe,
// so the agent can never advertise a kind of job it cannot run (agent.New checks it again).
func (m machine) executors() map[string]exec.Executor {
	executors := map[string]exec.Executor{}
	if m.capabilities.Docker {
		executors[conn.ExecutorContainer] = &exec.Container{Engine: exec.NewEngine(m.dockerSocket)}
	}
	if m.capabilities.Shell {
		executors[conn.ExecutorShell] = &exec.Shell{}
	}
	return executors
}

// describe is this machine, as a hello describes it: the static facts, and the
// capabilities answered by asking.
//
// `docker` is a daemon answering its ping — and the socket that answered is the one the
// container executor uses. `shell` is the operator's answer rather than a probe: true
// unless --no-shell, because a machine that holds signing keys can refuse shell jobs while
// still taking container ones.
func describe(ctx context.Context, noShell bool) (telemetry.Host, machine, error) {
	host, err := telemetry.Describe()
	if err != nil {
		return telemetry.Host{}, machine{}, err
	}
	socket, docker := telemetry.FindDocker(ctx, telemetry.DockerSockets())
	return host, machine{
		capabilities: conn.Capabilities{
			Docker:   docker,
			Shell:    !noShell,
			Ccache:   telemetry.CcacheOnPath(),
			CPUs:     host.CPUs,
			MemoryMB: host.MemoryMB,
		},
		dockerSocket: socket,
	}, nil
}

// newLogger is the agent's log: text, to stderr, where a service manager's journal
// collects it.
func newLogger(stderr io.Writer) *slog.Logger {
	return slog.New(slog.NewTextHandler(stderr, nil))
}

// orDefault is a value, or a default when it is empty.
func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// printVersion reports what this build is and what it can speak.
//
// The protocol range is the line that matters operationally. A gateway may refuse an
// agent below its floor, and the refusal names the minimum it wants; this is where an
// operator reads what their agent offers, without needing the gateway to tell them.
func printVersion(out io.Writer) error {
	host, err := telemetry.Describe()
	if err != nil {
		return err
	}

	// Composed and then written once, so the report is either delivered or reported as
	// undeliverable. Six writes would be six chances to half-print it down a pipe that
	// has gone away.
	report := &strings.Builder{}
	fmt.Fprintf(report, "ouroboros-runner %s\n", version)
	fmt.Fprintf(report, "protocol        %d (speaks %d–%d)\n", conn.Version, conn.MinVersion, conn.Version)
	fmt.Fprintf(report, "arch            %s\n", host.Arch)
	fmt.Fprintf(report, "hostname        %s\n", host.Hostname)
	fmt.Fprintf(report, "cpus            %d\n", host.CPUs)
	fmt.Fprintf(report, "memory          %d MB\n", host.MemoryMB)

	_, err = io.WriteString(out, report.String())
	return err
}

// printHello writes the hello frame this machine would send.
//
// It is built the way the connection loop builds it — the same probes, and, once this
// machine is enrolled, the pool and security mode the state directory records — and
// validated against the published contract before it is printed. So when a gateway
// refuses an agent, this is how an operator sees exactly what their machine claims, and
// a frame the gateway would refuse is reported as an error naming the field rather than
// printed as though it were fine.
func printHello(ctx context.Context, args []string, out io.Writer, getenv func(string) string) error {
	var common commonFlags
	var jobs jobFlags
	set := flagSet("hello", io.Discard)
	common.register(set, getenv)
	if err := jobs.register(set, getenv, false); err != nil {
		return err
	}
	if err := set.Parse(args); err != nil {
		return fmt.Errorf("%w: %w", errUsage, err)
	}

	host, machine, err := describe(ctx, jobs.noShell)
	if err != nil {
		return err
	}
	capabilities := machine.capabilities

	// Read without taking the lock: the runner this describes may be running right now.
	// Not enrolled yet is not an error here — the frame simply names no pool and no mode.
	var pool string
	var mode conn.SecurityMode
	if record, err := state.PeekRecord(common.stateDir); err == nil {
		pool, mode = record.Pool, record.SecurityMode
	}

	frame := conn.NewHello(placeholderID, version, host.Arch, host.Hostname, pool, capabilities, mode, "")
	return printFrame(out, frame)
}

// placeholderID is the envelope id of a frame printed rather than sent. It is
// deliberately a visible placeholder: the connection loop mints a real ULID per frame,
// and a command that printed a plausible id would invite somebody to replay it.
const placeholderID = "00000000000000000000000000"

// printFrame writes a frame for an operator to read, after holding it to the published
// contract — so a frame the gateway would refuse is reported as an error naming the
// field, rather than printed as though it were fine.
func printFrame(out io.Writer, frame conn.Frame) error {
	encoded, err := conn.EncodeIndent(frame)
	if err != nil {
		return err
	}
	wire, err := conn.Encode(frame)
	if err != nil {
		return err
	}
	if _, diags := conn.Decode(wire); len(diags) > 0 {
		return fmt.Errorf("this machine cannot describe itself legally: %s at %s",
			diags[0].Code, diags[0].Path)
	}

	_, err = out.Write(encoded)
	return err
}

// printHeartbeat writes the heartbeat this machine would send, measured now ([#245]).
//
// It is the parity check the telemetry is held to: run it beside `top` (or Activity
// Monitor) and the two should agree, on each of the three platforms. It measures one
// window — `--window`, five seconds unless told otherwise, so it can be matched to top's
// own delay — and then prints the frame, validated like `hello`'s. A measurement the
// platform cannot provide is printed as the `null` the gateway would receive, and why is
// logged to stderr.
//
// It needs no network and no enrollment. The frame reports this command's own uptime,
// an empty queue and no job, because it is a measurement of the machine rather than of a
// running agent.
//
// [#245]: https://github.com/NobuData/ouroboros/issues/245
func printHeartbeat(ctx context.Context, args []string, out, stderr io.Writer) error {
	started := time.Now()
	set := flagSet("heartbeat", stderr)
	window := set.Duration("window", telemetry.DefaultWindow, "how long the CPU is watched for the reading")
	if err := set.Parse(args); err != nil {
		return fmt.Errorf("%w: %w", errUsage, err)
	}
	if set.NArg() > 0 {
		return fmt.Errorf("%w: unexpected %q", errUsage, set.Arg(0))
	}
	if *window < 100*time.Millisecond || *window > time.Minute {
		return fmt.Errorf("%w: --window %v is outside 100ms–1m", errUsage, *window)
	}

	monitor := telemetry.NewMonitor(*window, newLogger(stderr))
	sample, ok := monitor.Measure(ctx)
	if !ok {
		return fmt.Errorf("interrupted before the window closed: %w", context.Cause(ctx))
	}
	payload := agent.NewHeartbeat(time.Now(), started, sample, &agent.Workload{}, false)
	return printFrame(out, conn.NewFrame(placeholderID, conn.TypeHeartbeat, payload))
}
