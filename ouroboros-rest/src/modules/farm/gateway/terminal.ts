/**
 * What a `job.finish` does to its `build_jobs` row.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). The protocol has five
 * outcomes and V040's lifecycle has three terminal statuses an agent can cause, so this is the
 * translation — and the one place the two vocabularies' disagreements are settled:
 *
 * ```
 * outcome      exit      status      exit_code stored
 * succeeded    0         succeeded   0
 * succeeded    ≠ 0       failed      as sent     the agent contradicted itself; the code wins
 * failed       ≠ 0       failed      as sent
 * failed       0         failed      null        V040: a failure is not exit 0
 * cancelled    any       canceled    as sent
 * timed_out    any       failed      as sent, or null for 0
 * errored      any       failed      as sent, or null for 0
 * ```
 *
 * **`errored` and `timed_out` become `failed` here, and the distinction is not lost.** Whether an
 * infrastructure-classed failure is *retried* — the `3 retried` on mockup 08's stat row — is
 * AH.4's retry policy ([#252](https://github.com/NobuData/ouroboros/issues/252)), and
 * {@link TerminalState.infrastructure} is the one fact it needs from the frame: `errored`, the
 * agent failing to run the job at all. `timed_out` is not one — a build that ran past its budget
 * is information about the build — and neither is a non-zero exit, which is `failed` and stays
 * `failed`: a repository whose build is broken must never read as retried.
 * The two `failed`-with-`0` rows store `null` because `build_jobs_failure_is_not_exit_zero`
 * refuses a failure that exited cleanly, and a refused write would lose the whole result.
 *
 * **ccache is converted, not copied.** The protocol reports sizes in MiB and a hit rate; V040
 * stores bytes and the two counters the stat row's weighted rate is computed from. A summary that
 * counted no objects at all is stored as `null` — decision **B5**'s *not measured* — because
 * `build_ccache_stats_valid` refuses `0/0`, which the stat row would divide by.
 */

import type { BuildJobStatus } from "../../db/schema";
import type { JobFinishPayload } from "../protocol/protocol.messages";
import { MIB } from "./gateway.policy";

/** The terminal statuses an agent's `job.finish` can put a job in. */
export type TerminalStatus = Extract<BuildJobStatus, "succeeded" | "failed" | "canceled">;

/** `build_jobs.ccache_stats`, as V040's `build_ccache_stats_valid` accepts it. */
export interface CcacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly size_bytes: number;
  readonly max_size_bytes: number;
}

/** The columns a `job.finish` writes, before the times the repository adds. */
export interface TerminalState {
  readonly status: TerminalStatus;
  readonly exitCode: number | null;
  readonly ccacheStats: CcacheStats | null;
  /**
   * Whether the failure is the farm's rather than the build's — the agent could not run the job
   * at all (`errored`). Such a job is retried once by AH.4's policy instead of being `failed`.
   */
  readonly infrastructure: boolean;
}

/**
 * Translate a `job.finish` into the row's terminal state.
 *
 * @param finish - The payload, already judged by the codec.
 * @returns The state to write.
 */
export function terminalState(finish: JobFinishPayload): TerminalState {
  const exit = finish.exit_code;
  const status: TerminalStatus =
    finish.outcome === "cancelled"
      ? "canceled"
      : finish.outcome === "succeeded" && exit === 0
        ? "succeeded"
        : "failed";

  return {
    status,
    exitCode: status === "failed" && exit === 0 ? null : exit,
    ccacheStats: ccacheOf(finish.ccache),
    infrastructure: finish.outcome === "errored",
  };
}

/**
 * The ccache summary as V040 stores it.
 *
 * @param ccache - The payload's `ccache`.
 * @returns The stored document, or `null` when there was no cache or it counted nothing.
 */
function ccacheOf(ccache: JobFinishPayload["ccache"]): CcacheStats | null {
  if (!ccache || ccache.hits + ccache.misses === 0) return null;

  return {
    hits: ccache.hits,
    misses: ccache.misses,
    size_bytes: ccache.size_mb * MIB,
    max_size_bytes: ccache.max_size_mb * MIB,
  };
}
