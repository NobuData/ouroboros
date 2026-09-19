package telemetry

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// sysctlPath is the absolute path to sysctl, not a name resolved through PATH: this
// runs on a machine somebody else administers, and a `sysctl` earlier on their PATH
// than the system one would be reporting the memory of whatever it liked.
const sysctlPath = "/usr/sbin/sysctl"

// TotalMemoryMB is installed memory in mebibytes, from `sysctl hw.memsize`.
//
// macOS has no /proc. A single read of one integer at start-up is made through the
// sysctl command, exactly once per process: [Describe] is called when the agent starts
// and its answer is carried in every `hello` after that. The heartbeat's reads, which
// repeat every few seconds, are made in-process instead — see [sysctlMemory].
func TotalMemoryMB() (int, error) {
	// #nosec G204 -- an absolute path and constant arguments: nothing here comes from outside.
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

// reclaimablePageCounts are the kernel's page counts for memory macOS can hand to a new
// process without paging anything out: free pages, speculative read-ahead, file-backed
// pages (the page cache), and purgeable pages an application has said it can lose.
var reclaimablePageCounts = []string{
	"vm.page_free_count",
	"vm.page_speculative_count",
	"vm.page_pageable_external_count",
	"vm.page_purgeable_count",
}

// sysctlMemory is memory installed and in use, read in-process through the syscall
// package's sysctl — no subprocess, and no cgo, on every heartbeat pass.
//
// In use is installed memory minus what is reclaimable, which is Activity Monitor's
// "Memory Used": application memory, wired memory and the compressor. It leaves out the
// page cache for the reason Linux's MemAvailable does. (`top`'s PhysMem "used" counts
// everything that is not free, cache included, so it reads higher on any machine that
// has been building.) The page counts are in the kernel's page size, which is
// hw.pagesize — what [os.Getpagesize] reads.
func sysctlMemory() memoryReading {
	var reading memoryReading

	raw, err := syscall.Sysctl("hw.memsize")
	if err == nil {
		var installed uint64
		installed, err = decodeSysctlUint64("hw.memsize", raw)
		reading.totalMB = int(installed / (1024 * 1024)) // #nosec G115 -- 2^64 bytes is 2^44 MiB, well inside an int
		if err == nil && installed < 1024*1024 {
			err = errors.New("hw.memsize is under a mebibyte, which is not a machine")
		}
	}
	if err != nil {
		reading.totalErr = fmt.Errorf("read installed memory: %w", err)
		reading.usedErr = errors.New("memory in use is measured against the total, which cannot be read")
		return reading
	}

	var reclaimable uint64
	for _, name := range reclaimablePageCounts {
		pages, err := syscall.SysctlUint32(name)
		if err != nil {
			reading.usedErr = fmt.Errorf("read %s: %w", name, err)
			return reading
		}
		reclaimable += uint64(pages)
	}
	pageSize := uint64(os.Getpagesize())                         // #nosec G115 -- hw.pagesize, a positive power of two
	reclaimableMB := int(reclaimable * pageSize / (1024 * 1024)) // #nosec G115 -- four 32-bit page counts, far inside an int
	if reclaimableMB > reading.totalMB {
		reading.usedErr = errors.New("the reclaimable page counts add up to more than is installed")
		return reading
	}
	reading.usedMB = reading.totalMB - reclaimableMB
	return reading
}
