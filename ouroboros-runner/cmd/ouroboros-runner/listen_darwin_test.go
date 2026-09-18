package main

import (
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// The same assertion as listen_linux_test.go, on macOS, where there is no /proc: lsof's
// account of the running agent's network sockets. A LISTEN state, or a UDP socket with
// no peer, fails; at least one ESTABLISHED connection is required, so that an lsof that
// saw nothing cannot pass the test.
func assertNoListeningSockets(t *testing.T, pid int) {
	t.Helper()
	output, err := exec.Command("/usr/sbin/lsof", "-nP", "-a", "-p", strconv.Itoa(pid), "-i").CombinedOutput()
	if err != nil {
		t.Fatalf("lsof: %v\n%s", err, output)
	}

	established := 0
	for _, line := range strings.Split(string(output), "\n")[1:] {
		switch {
		case strings.Contains(line, "(LISTEN)"):
			t.Errorf("the agent is listening: %s", line)
		case strings.Contains(line, "(ESTABLISHED)"):
			established++
		case strings.Contains(line, "UDP") && !strings.Contains(line, "->"):
			t.Errorf("the agent holds an unconnected UDP socket: %s", line)
		}
	}
	if established == 0 {
		t.Fatalf("lsof shows no established connection for the agent; the check saw nothing:\n%s", output)
	}
}
