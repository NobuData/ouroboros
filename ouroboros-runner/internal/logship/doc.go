// Package logship carries a job's output to the gateway: chunking, ordering, throttling
// and the ccache statistics reported with the result.
//
// Empty by design, for the reason internal/exec is: this issue ([#243]) owes the
// contract, and the shipping is [#247]'s.
//
// The contract is already strict, and the three strictest parts are the ones an
// implementation would otherwise get wrong at the last minute. Chunks are base64,
// because a build log is bytes and a compiler that prints a lone 0x80 is a compiler
// whose output is not a JSON string. They are ordered by a per-job `seq` that is 0-based
// and contiguous ACROSS a reconnect, so a gap is a lost frame and therefore something a
// receiver can notice. And elision is reported rather than hidden: `dropped_bytes` on a
// chunk says how much was dropped immediately before it, and `job.finish` carries the
// total — a console that showed a throttled log as though it were complete would be
// lying about the build. See conn.TypeLogChunk and
// ../../../docs/RUNNER_PROTOCOL.md § Output.
//
// [#243]: https://github.com/NobuData/ouroboros/issues/243
// [#247]: https://github.com/NobuData/ouroboros/issues/247
package logship
