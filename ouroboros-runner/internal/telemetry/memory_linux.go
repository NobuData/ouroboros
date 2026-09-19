package telemetry

import (
	"bufio"
	"errors"
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
		kibibytes, err := meminfoKibibytes(line)
		if err != nil {
			return 0, err
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

// parseMemory reads memory installed and memory in use out of a /proc/meminfo stream —
// the heartbeat's two memory figures, from one read so that they agree.
//
// In use is MemTotal minus MemAvailable: memory the kernel could not hand to a new
// process without swapping. That is the "used" procps's `top` and `free` report, and it
// leaves out the page cache, which a build machine fills and which is not pressure.
//
// The halves fail apart. A kernel older than 3.14 publishes no MemAvailable, and on one
// of those the heartbeat reports what is installed and a null for what is in use —
// never MemFree in its place, which reads a warm page cache as a machine out of memory.
func parseMemory(source io.Reader) memoryReading {
	var total, available *int
	var totalErr, availableErr error

	scanner := bufio.NewScanner(source)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			kibibytes, err := meminfoKibibytes(line)
			total, totalErr = &kibibytes, err
		case strings.HasPrefix(line, "MemAvailable:"):
			kibibytes, err := meminfoKibibytes(line)
			available, availableErr = &kibibytes, err
		}
	}
	if err := scanner.Err(); err != nil {
		failed := fmt.Errorf("%s: %w", procMeminfo, err)
		return memoryReading{totalErr: failed, usedErr: failed}
	}

	var reading memoryReading
	switch {
	case total == nil:
		reading.totalErr = fmt.Errorf("%s: no MemTotal line", procMeminfo)
	case totalErr != nil:
		reading.totalErr = totalErr
	case *total < 1024:
		reading.totalErr = fmt.Errorf("%s: MemTotal is under a mebibyte, which is not a machine", procMeminfo)
	default:
		reading.totalMB = *total / 1024
	}

	switch {
	case reading.totalErr != nil:
		reading.usedErr = errors.New("memory in use is measured against the total, which cannot be read")
	case available == nil:
		reading.usedErr = fmt.Errorf("%s: no MemAvailable line (the kernel is older than 3.14)", procMeminfo)
	case availableErr != nil:
		reading.usedErr = availableErr
	case *available > *total:
		reading.usedErr = fmt.Errorf("%s: MemAvailable is larger than MemTotal", procMeminfo)
	default:
		reading.usedMB = (*total - *available) / 1024
	}
	return reading
}

// meminfoKibibytes reads the count out of one /proc/meminfo line, holding it to the
// `Label:   <count> kB` shape.
//
// No error message quotes the count: the heartbeat logs a failure once per distinct
// message, and one that changed with every read would be logged on every pass.
func meminfoKibibytes(line string) (int, error) {
	parts := strings.Fields(line)
	label := strings.TrimSuffix(parts[0], ":")
	if len(parts) != 3 || parts[2] != "kB" {
		return 0, fmt.Errorf("%s: the %s line is not `%s: <count> kB`", procMeminfo, label, label)
	}
	kibibytes, err := strconv.Atoi(parts[1])
	if err != nil || kibibytes < 0 {
		return 0, fmt.Errorf("%s: %s is not a kibibyte count", procMeminfo, label)
	}
	return kibibytes, nil
}
