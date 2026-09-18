// Package telemetry is what the agent knows about the machine it is running on.
//
// Today that is the static half: the facts a `hello` has to carry before any job has
// run — the hostname, the architecture as the protocol names it, the usable core count
// and the installed memory. Those are needed by this issue, because a `hello` cannot be
// built without them.
//
// The moving half — CPU utilisation, memory in use, queue depth, the running job's
// progress — is the heartbeat's, and it is [#245]'s to fill in. The shapes it reports
// into are already fixed by the protocol: see conn.TypeHeartbeat and
// ../../../docs/RUNNER_PROTOCOL.md § Liveness.
//
// [#245]: https://github.com/NobuData/ouroboros/issues/245
package telemetry
