// Package telemetry is what the agent knows about the machine it is running on.
//
// There are two halves.
//
// The static half is the facts a `hello` has to carry before any job has run: the
// hostname, the architecture as the protocol names it, the usable core count and the
// installed memory ([Describe]), and the capabilities answered by probes — whether a
// Docker daemon answers, whether ccache is on PATH.
//
// The moving half is the heartbeat's ([#245]): CPU utilisation averaged over a short
// window, and memory in use and installed, measured in the background by a [Monitor]
// and read by the connection loop at every beat. A measurement the platform cannot
// provide is nil — `null` on the wire, an em-dash in the runners table — and never a
// zero or the last value that could be read. See monitor.go for the rules, and
// ../../../docs/RUNNER_PROTOCOL.md § 4.2 for the shape they report into.
//
// Each platform reads the machine its own way, with the standard library only:
//
//	linux/x86_64, linux/arm64   /proc/stat and /proc/meminfo
//	darwin/arm64                /usr/bin/top for the CPU, sysctl in-process for memory
//
// [#245]: https://github.com/NobuData/ouroboros/issues/245
package telemetry
