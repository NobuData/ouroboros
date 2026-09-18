package telemetry

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// sysctlPath is the absolute path to sysctl, not a name resolved through PATH: this
// runs on a machine somebody else administers, and a `sysctl` earlier on their PATH
// than the system one would be reporting the memory of whatever it liked.
const sysctlPath = "/usr/sbin/sysctl"

// TotalMemoryMB is installed memory in mebibytes, from `sysctl hw.memsize`.
//
// macOS has no /proc, and the alternative to a subprocess is a cgo call into
// sysctlbyname — which would make this module need a C toolchain to cross-compile, on
// the one platform ci/runner cannot natively build. A single read of one integer at
// start-up is the cheaper trade, and it is made exactly once per process: [Describe] is
// called when the agent starts and its answer is carried in every `hello` after that.
func TotalMemoryMB() (int, error) {
	out, err := exec.Command(sysctlPath, "-n", "hw.memsize").Output()
	if err != nil {
		return 0, fmt.Errorf("read installed memory from %s: %w", sysctlPath, err)
	}

	bytes, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s hw.memsize returned %q, not a byte count: %w",
			sysctlPath, strings.TrimSpace(string(out)), err)
	}
	if bytes < 1024*1024 {
		return 0, fmt.Errorf("%s hw.memsize is %d, which is not a machine", sysctlPath, bytes)
	}
	return int(bytes / (1024 * 1024)), nil
}
