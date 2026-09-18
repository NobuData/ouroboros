package telemetry

import (
	"fmt"
	"os"
	"runtime"
)

// Host is the machine, as a `hello` describes it.
type Host struct {
	// Hostname is what the machine calls itself — the name the runners table shows.
	// Not trusted for identity, only for recognition.
	Hostname string

	// Arch is the architecture as the PROTOCOL names it, which is not what Go names
	// it: see [Arch].
	Arch string

	// CPUs is the usable core count, after any limit the operator or the container
	// runtime has imposed.
	CPUs int

	// MemoryMB is installed memory in mebibytes.
	MemoryMB int
}

// Describe is this machine.
//
// Every field is required by the protocol, so a fact that cannot be established is an
// error rather than a zero: an agent that enrolled claiming one core and no memory
// would be given work sized for it.
func Describe() (Host, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return Host{}, fmt.Errorf("read the hostname: %w", err)
	}

	arch, err := Arch()
	if err != nil {
		return Host{}, err
	}

	memoryMB, err := TotalMemoryMB()
	if err != nil {
		return Host{}, err
	}

	return Host{
		Hostname: hostname,
		Arch:     arch,
		// NumCPU honours the CPU affinity mask the process was started with, which is
		// how a container limit and a taskset both reach this number.
		CPUs:     runtime.NumCPU(),
		MemoryMB: memoryMB,
	}, nil
}

// Arch is the running platform as the runner protocol names it.
//
// The protocol's three values are mockup 08's runners table and ci/runner's
// cross-compile matrix, and they are not Go's spelling: `linux/x86_64` is what an
// operator reading a runner row expects to see, and `linux/amd64` is what Go calls the
// same machine. The mapping lives here, once, rather than at every call site that has
// to produce one — and a platform outside the three is an error rather than a
// best-effort string, because a pool dispatches work on the strength of this value.
func Arch() (string, error) {
	return archFor(runtime.GOOS, runtime.GOARCH)
}

// archFor is [Arch] over arguments rather than over the runtime, which is what lets the
// mapping be tested for all three targets from whichever one the tests happen to run
// on. A mapping only exercisable on the machine that compiled it is a mapping whose
// other two rows are untested.
func archFor(goos, goarch string) (string, error) {
	switch platform := goos + "/" + goarch; platform {
	case "linux/arm64":
		return "linux/arm64", nil
	case "linux/amd64":
		return "linux/x86_64", nil
	case "darwin/arm64":
		return "darwin/arm64", nil
	default:
		return "", fmt.Errorf(
			"%s is not one of the three architectures the farm builds for "+
				"(linux/arm64, linux/amd64, darwin/arm64)", platform)
	}
}
