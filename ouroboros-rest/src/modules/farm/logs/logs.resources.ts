/**
 * A page of a build log, as the API returns it — and the shape mockup 10's full-log surface reads.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)). The live log card (AI.6, #261)
 * polls it from the `nextOffset` it last reached and appends `bytes`; the run console's **Full
 * log ↗** (mockup 10) is the same resource paged from `after=0` until `nextOffset` reaches `end`.
 * One shape for both, and recognisably the run transcript's (`?after=` → entries, `live`,
 * `pollAfter`, #304), so the two surfaces read alike.
 */

import type { Elision } from "./log.slice";

/** Everything elided after the last stored byte. */
export interface LogTail {
  /** Bytes elided there: the cap's refusals, the agent's own tail drops and the rate guard's. */
  readonly bytes: number;
  /** Chunks after the last stored one that never arrived. */
  readonly missingChunks: number;
  /** Whether the per-job cap was reached — why the log stops where it does. */
  readonly capped: boolean;
}

/** One page of a build log. */
export interface BuildLogResource {
  readonly jobId: string;
  /** Where this page starts — the `after` asked for. */
  readonly offset: number;
  /** Where the next page starts. Ask with `?after=` this; nothing is skipped or repeated. */
  readonly nextOffset: number;
  /** How many bytes are stored — the reader has everything when `nextOffset` is this. */
  readonly end: number;
  /** The page's bytes as UTF-8 text, ending on a character boundary. */
  readonly bytes: string;
  /** Whether the log can still grow: the job is not finished. Never chunk recency. */
  readonly live: boolean;
  /** Elision markers inside `[offset, nextOffset)`, one per position. */
  readonly elisions: readonly Elision[];
  /** What was elided after the last stored byte, or null when nothing was. Drawn after the text. */
  readonly tail: LogTail | null;
  /** False once the retention sweep removed the log; `bytes` is then empty for good. */
  readonly retained: boolean;
  /** How many seconds to wait before asking again — `X-Ouro-Poll-After`, in the body too. */
  readonly pollAfter: number;
}
