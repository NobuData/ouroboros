package telemetry

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// procMeminfo is where Linux publishes installed memory. It is named only so that an
// error message can say which file it could not read; the parser below takes a reader,
// so a test needs no override of it.
const procMeminfo = "/proc/meminfo"

// TotalMemoryMB is installed memory in mebibytes, read from /proc/meminfo.
//
// MemTotal rather than MemAvailable: what the protocol asks for is what the machine
// HAS, so that a pool can size a job against it. What is free right now is the
// heartbeat's business ([#245]) and changes between one and the next.
//
// [#245]: https://github.com/NobuData/ouroboros/issues/245
func TotalMemoryMB() (int, error) {
	file, err := os.Open(procMeminfo)
	if err != nil {
		return 0, fmt.Errorf("read installed memory: %w", err)
	}
	defer file.Close()

	return parseMemTotalMB(file)
}

// parseMemTotalMB reads MemTotal out of a /proc/meminfo stream.
//
// The line is `MemTotal:       16321092 kB` — a label, whitespace, a kibibyte count and
// a unit that has been `kB` for the whole life of the file. The unit is checked anyway,
// because a silently misread memory size is an agent that enrols claiming sixteen
// gigabytes of RAM or sixteen megabytes, and neither is obviously wrong in a log.
func parseMemTotalMB(source io.Reader) (int, error) {
	scanner := bufio.NewScanner(source)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 3 || parts[2] != "kB" {
			return 0, fmt.Errorf("%s: cannot read %q as a MemTotal line", procMeminfo, line)
		}
		kibibytes, err := strconv.Atoi(parts[1])
		if err != nil {
			return 0, fmt.Errorf("%s: %q is not a kibibyte count: %w", procMeminfo, parts[1], err)
		}
		if kibibytes < 1024 {
			return 0, fmt.Errorf("%s: MemTotal is %d kB, which is not a machine", procMeminfo, kibibytes)
		}
		return kibibytes / 1024, nil
	}
	if err := scanner.Err(); err != nil {
		return 0, fmt.Errorf("%s: %w", procMeminfo, err)
	}
	return 0, fmt.Errorf("%s: no MemTotal line", procMeminfo)
}
