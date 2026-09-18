// Package exec runs a job: the container and shell executors, the workspace that is
// created for a job and removed after it, and cancellation.
//
// Empty by design. This issue ([#243]) owes the module its conventions and the wire
// contract, not its behaviour, and the executors are [#246]'s — where the questions are
// about Docker, workspace lifetime and killing a process tree rather than about the
// protocol.
//
// What is already decided here is the shape of the work, because the protocol fixed it:
// `job.offer` carries an executor kind, an argv array and never a shell string, an
// image that is required for a container job and forbidden for a shell one, and a
// wall-clock budget whose expiry is reported as the `timed_out` outcome. See
// conn.TypeJobOffer and ../../../docs/RUNNER_PROTOCOL.md § Dispatch.
//
// [#243]: https://github.com/NobuData/ouroboros/issues/243
// [#246]: https://github.com/NobuData/ouroboros/issues/246
package exec
