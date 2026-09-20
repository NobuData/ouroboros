import "server-only";

/**
 * One page of a build's log, read on behalf of the live log card's stream
 * (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * `app/api/farm-page.ts` is the same seam for the page: the server's half of a poll, answering in
 * `app/poll.ts`'s four cases so that `app/api/farm/jobs/[id]/log/route.ts` can turn the answer
 * into HTTP and `app/farm/log-poll.ts` can read it back out. AH.5's read answers no `ETag`, so
 * there is no `304` and the translation is `app/api/poll-read.ts`'s.
 *
 * **The cadence is the log's own.** A page says how long to wait before the next — two seconds
 * while the build runs, fifteen once it has finished — in its body as well as its header, so the
 * hint is taken from `pollAfter` and put on the fresh answer here, with no header read at all.
 *
 * The client is `anonymousApi()`, for the reason `app/api/backlog-page.ts` gives: a poll is not
 * a render, and a `401` is an answer (*gone*) rather than a redirect.
 */

import { type BuildLog, farm } from "@/app/api/farm";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { BAD_LOG_OFFSET, UNREACHABLE_LOG, readAfter } from "@/app/farm/log-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const FARM_LOG_UNAVAILABLE_CODE = "farm_log_unavailable";

/**
 * Read one page of a build's log for a poll.
 *
 * @param id The build job, from the path.
 * @param after `?after=` exactly as the address carried it, or `null` when it carried none.
 * @param read How to make the read, given the deadline. Defaults to the typed client over the
 *   session's cookies; tests pass a stub.
 * @returns The answer — the page with its own cadence, *gone* for a session that has ended, or a
 *   sentence about why not. An `after` that is not an offset is refused here, without a read.
 *   **It does not throw**, for the reason `readForPoll` gives.
 */
export async function readFarmLog(
  id: string,
  after: string | null,
  read: (id: string, after: number, signal: AbortSignal) => Promise<BuildLog> = (
    asked,
    from,
    signal,
  ) => farm.log(asked, from, anonymousApi(), signal),
): Promise<PollAnswer<BuildLog>> {
  const from = readAfter(after);
  if (from === null) return { state: "failed", reason: BAD_LOG_OFFSET, pollAfterSeconds: null };

  const answer = await readForPoll((signal) => read(id, from, signal), UNREACHABLE_LOG);

  return answer.state === "fresh"
    ? { ...answer, pollAfterSeconds: answer.payload.pollAfter }
    : answer;
}
