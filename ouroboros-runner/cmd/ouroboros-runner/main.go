// Command ouroboros-runner is the Ouroboros build farm agent.
//
// It runs on hardware the customer owns, connects OUTBOUND to the farm gateway over
// mTLS, registers itself, and then takes the work it is offered — which is the whole
// point: no inbound ports, no firewall exception, no address anyone has to expose.
//
// It does not do that yet. This build is the module's scaffold ([#243]), and the
// connection loop, the enrollment exchange and the executors are the issues that follow
// ([#244], [#246]). What it has today is the protocol: the contract every one of those
// implements against, and two commands that make it inspectable from a shell.
//
// Usage:
//
//	ouroboros-runner version    # the build, the protocol range it speaks, this machine
//	ouroboros-runner hello      # the hello frame this machine would send, as JSON
//
// `hello` is not a placeholder. It is the frame the enrollment exchange begins with,
// built from this machine's real facts and validated against the published contract
// before it is printed — so an operator diagnosing an enrollment that a gateway refused
// can see exactly what their machine says about itself, and a version floor refusal can
// be checked against the range printed here without a network at all.
//
// [#243]: https://github.com/NobuData/ouroboros/issues/243
// [#244]: https://github.com/NobuData/ouroboros/issues/244
// [#246]: https://github.com/NobuData/ouroboros/issues/246
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/telemetry"
)

// version is this agent's own semver, stamped at link time by the Makefile from the
// module's VERSION file. The default is what an unstamped `go build` produces, and it
// says so rather than claiming a release number it is not.
var version = "0.0.0-dev"

// usage is printed for `help`, for no arguments at all, and for anything unrecognised.
const usage = `ouroboros-runner — the Ouroboros build farm agent.

Usage:
  ouroboros-runner version   Print the build, the protocol range and this machine.
  ouroboros-runner hello     Print the hello frame this machine would send.

The agent connects outbound over mTLS and registers itself; nothing listens, and no
inbound port is opened. Enrollment and the connection loop land with issue #244 — see
docs/RUNNER_PROTOCOL.md for the wire contract both halves implement against.
`

func main() {
	// Parsing an empty set is what gives `ouroboros-runner -h` the usage text rather
	// than Go's default one-line report of no flags at all.
	flag.Usage = func() { fmt.Fprint(os.Stderr, usage) }
	flag.Parse()

	if err := run(flag.Args(), os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "ouroboros-runner: %v\n", err)
		os.Exit(1)
	}
}

// errUsage is the exit that is the caller's mistake rather than the agent's. It is
// separated so run can be tested without a process: a command that printed usage to
// stdout and exited 0 would make a typo look like a success.
var errUsage = errors.New("no such command")

// run is main without the process, so every command is testable.
//
// It takes the writer rather than using os.Stdout for the same reason: what these
// commands produce is a document — a frame an operator pastes into an issue — and a
// test that cannot read it can only assert that nothing crashed.
func run(args []string, out io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("%w: expected `version` or `hello`", errUsage)
	}

	switch command := args[0]; command {
	case "version":
		return printVersion(out)
	case "hello":
		return printHello(out)
	case "help":
		_, err := io.WriteString(out, usage)
		return err
	default:
		return fmt.Errorf("%w: %q — expected `version` or `hello`", errUsage, command)
	}
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
	fmt.Fprintf(report, "protocol        %d (speaks %d\u2013%d)\n", conn.Version, conn.MinVersion, conn.Version)
	fmt.Fprintf(report, "arch            %s\n", host.Arch)
	fmt.Fprintf(report, "hostname        %s\n", host.Hostname)
	fmt.Fprintf(report, "cpus            %d\n", host.CPUs)
	fmt.Fprintf(report, "memory          %d MB\n", host.MemoryMB)

	_, err = io.WriteString(out, report.String())
	return err
}

// printHello writes the hello frame this machine would send.
//
// The frame is validated against the published contract before it is printed. That is
// not a formality: this command exists to answer "what does my machine claim?", and a
// frame that the gateway would refuse is exactly the answer worth having — so it is
// reported as an error naming the field, rather than printed as though it were fine.
func printHello(out io.Writer) error {
	host, err := telemetry.Describe()
	if err != nil {
		return err
	}

	// The id is a placeholder, and deliberately a visible one: minting a real ULID per
	// frame belongs to the connection loop (#244), and a command that printed a
	// plausible id would invite somebody to replay it.
	const placeholderID = "00000000000000000000000000"

	frame := conn.NewHello(
		placeholderID,
		version,
		host.Arch,
		host.Hostname,
		"", // the pool is assigned at enrollment (#244); an agent does not name its own
		conn.Capabilities{
			// Probing for a Docker daemon and a ccache binary is the executors' work
			// (#246, #247) and is reported honestly as absent until they land, rather
			// than claimed here on the strength of a file existing.
			Docker:   false,
			Shell:    false,
			Ccache:   false,
			CPUs:     host.CPUs,
			MemoryMB: host.MemoryMB,
		},
		"", // no session to resume: this is not a reconnection
	)

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
