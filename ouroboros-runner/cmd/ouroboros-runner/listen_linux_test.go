package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// The agent opens no listening socket — verified, not assumed.
//
// This reads the kernel's own account of a RUNNING agent: every file descriptor it
// holds, the sockets among them, and each socket's state in the network tables. A
// listening TCP socket, a unix socket accepting connections, or an unconnected UDP
// socket — which would receive from anyone — fails the test. It also requires at least
// one ESTABLISHED TCP socket, because a check that found no sockets at all would pass
// for the wrong reason: the agent's outbound connection to the gateway has to be
// visible to it.

// soAcceptCon is __SO_ACCEPTCON: the flag /proc/net/unix sets on a listening socket.
const soAcceptCon = 0x10000

// assertNoListeningSockets fails if the process holds any socket that accepts
// connections or datagrams from strangers.
func assertNoListeningSockets(t *testing.T, pid int) {
	t.Helper()
	inodes := socketInodes(t, pid)
	if len(inodes) == 0 {
		t.Fatal("the agent holds no sockets at all; the check would prove nothing")
	}

	established := 0
	for _, table := range []string{"tcp", "tcp6"} {
		for _, row := range netTable(t, pid, table) {
			// sl local_address rem_address st tx:rx tr:when retrnsmt uid timeout inode
			if len(row) < 10 || !inodes[row[9]] {
				continue
			}
			switch row[3] {
			case "0A":
				t.Errorf("the agent is LISTENING on %s %s", table, row[1])
			case "01":
				established++
			}
		}
	}
	for _, table := range []string{"udp", "udp6"} {
		for _, row := range netTable(t, pid, table) {
			if len(row) < 10 || !inodes[row[9]] {
				continue
			}
			if strings.Trim(row[2], "0:") == "" {
				t.Errorf("the agent holds an unconnected UDP socket on %s %s", table, row[1])
			}
		}
	}
	for _, row := range netTable(t, pid, "unix") {
		// Num RefCount Protocol Flags Type St Inode Path
		if len(row) < 7 || !inodes[row[6]] {
			continue
		}
		flags, err := strconv.ParseUint(row[3], 16, 64)
		if err == nil && flags&soAcceptCon != 0 {
			t.Errorf("the agent is listening on a unix socket: %v", row)
		}
	}

	if established == 0 {
		t.Fatalf("none of the agent's %d sockets is an established TCP connection; the check saw nothing", len(inodes))
	}
}

// socketInodes is the inode of every socket the process holds, from /proc/<pid>/fd.
func socketInodes(t *testing.T, pid int) map[string]bool {
	t.Helper()
	dir := fmt.Sprintf("/proc/%d/fd", pid)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read the agent's file descriptors: %v", err)
	}
	inodes := map[string]bool{}
	for _, entry := range entries {
		target, err := os.Readlink(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue // closed between the listing and the read
		}
		if inode, ok := strings.CutPrefix(target, "socket:["); ok {
			inodes[strings.TrimSuffix(inode, "]")] = true
		}
	}
	return inodes
}

// netTable is one of /proc/<pid>/net's tables, as whitespace-separated rows without
// the header.
func netTable(t *testing.T, pid int, name string) [][]string {
	t.Helper()
	file, err := os.Open(fmt.Sprintf("/proc/%d/net/%s", pid, name))
	if os.IsNotExist(err) {
		return nil // no IPv6 on this machine, say
	}
	if err != nil {
		t.Fatalf("read /proc/net/%s: %v", name, err)
	}
	defer file.Close()

	var rows [][]string
	scanner := bufio.NewScanner(file)
	scanner.Scan() // the header
	for scanner.Scan() {
		rows = append(rows, strings.Fields(scanner.Text()))
	}
	return rows
}
