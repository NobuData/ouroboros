// Package logship carries a job's output to the gateway — chunked, ordered, throttled and
// bounded — and reads the compiler-cache statistics reported with its result ([#247]).
//
// # Output
//
//	stdout ┐                      ┌─ fits ────▶ buffer ─▶ every 250ms, ≤ 8 chunks, within the
//	       ├─▶ [Log] ─▶ cap ──────┤             256 KiB    session's rate ─▶ log.chunk{seq, …}
//	stderr ┘       │              └─ full ────▶ summary mode: counted, and the count marked
//	               │                            on the next chunk sent
//	               └─ past it ──▶ the tail, in job.finish.log.dropped_bytes
//
// Three rules the protocol fixes, and one this package adds.
//
// **Chunks are base64, ordered by a `seq` that is contiguous ACROSS a reconnect.** A gap is
// therefore a lost frame, and something a receiver can notice. A [Shipper] spends a `seq`
// only when the session takes the frame: a chunk the connection has no room for keeps its
// place in the buffer instead, so a stall never looks like a lost frame.
//
// **Elision is reported, never hidden.** `dropped_bytes` says what was dropped immediately
// before a chunk, and `job.finish.log.dropped_bytes` totals it. The marker is DATA: this
// package writes no `[… N bytes elided]` line into a chunk, because the gateway ([#253])
// places every hole by position and the console draws exactly one marker for each.
//
// **A build is not stalled by its log.** Writing to a [Log] never blocks and never fails.
// When the connection cannot keep up, output goes into summary mode — counted, not kept —
// until the backlog has drained; what was counted is then marked on the next chunk.
//
// **The agent caps a job's output itself.** `--log-cap-bytes` (64 MiB by default, V040's own
// default) bounds what is ever sent, because an agent that ships four gigabytes for the
// control plane to discard has already done the damage. The cap keeps the HEAD of the log,
// as the control plane's cap does, and the rest is the log's tail.
//
// What follows from those, and is tested: every byte a job writes is either delivered or
// counted — written = `log.bytes` + `log.dropped_bytes` — and what the agent holds is
// bounded by [BufferBytes] per job however verbose the build is.
//
// # ccache
//
// Each pool has a cache directory on the runner, `<state-dir>/cache/<pool>/ccache`, kept
// across its jobs and never shared with another pool's ([Caches]). Every job runs with
// `CCACHE_DIR` set to it and `CCACHE_STATSLOG` set to a file of its own, so the statistics
// are the JOB's and not the cache's running total — even when the pool runs several jobs at
// once. A container job sees the directory at [CacheMountTarget], bind-mounted.
//
// Hits and misses are counted from that log as `ccache -s` counts them (direct and
// preprocessed hits; `cache_miss`), and checked against real ccache 4.7.5 and 4.11.2 output.
// A build that ran no ccache — or one older than 4.0, which writes no statistics log — has
// no hit rate, and reports **null**: decision B5's *not measured*, never 0%, because "there
// is no cache here" and "the cache is broken" are different facts and the stat row renders
// them differently.
//
// See conn.TypeLogChunk and ../../../docs/RUNNER_PROTOCOL.md § 4.5.
//
// [#247]: https://github.com/NobuData/ouroboros/issues/247
// [#253]: https://github.com/NobuData/ouroboros/issues/253
package logship
