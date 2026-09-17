import "server-only";

/**
 * One planning batch, read on behalf of the generator card's poll
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * `app/api/backlog-detail.ts` is the same seam for the issue panel: the server's half of a poll,
 * answering in `app/poll.ts`'s four cases so that `app/api/planning/batches/[id]/route.ts` can turn
 * the answer into HTTP and `app/planning/batch-poll.ts` can read it back out. AL.4's batch read
 * answers no `ETag` and no cadence hint, so the translation is `app/api/poll-read.ts`'s — with one
 * addition: **the cadence is decided here**, from the batch itself, because only the batch knows
 * whether the estimator is still working on it (`batchPollSeconds`).
 *
 * The client is `anonymousApi()`, for the reason `app/api/backlog-detail.ts` gives: a poll is not a
 * render, and a `401` is an answer rather than a redirect.
 */

import { type PlanningBatch, planning } from "@/app/api/planning";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_BATCH, batchPollSeconds } from "@/app/planning/batch-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const PLANNING_UNAVAILABLE_CODE = "planning_unavailable";

/**
 * Read one batch for a poll.
 *
 * @param id The batch's id, as the path carried it. Its shape is the service's to refuse.
 * @param read How to make the read. Defaults to the typed client over the session's cookies; tests
 *   pass a stub.
 * @returns The answer — the batch with its cadence, *gone* for a session that has ended, or a
 *   sentence about why not.
 */
export async function readPlanningBatch(
  id: string,
  read: (id: string, signal: AbortSignal) => Promise<PlanningBatch> = (asked, signal) =>
    planning.batch(asked, anonymousApi(), signal),
): Promise<PollAnswer<PlanningBatch>> {
  const answer = await readForPoll((signal) => read(id, signal), UNREACHABLE_BATCH);

  return answer.state === "fresh"
    ? { ...answer, pollAfterSeconds: batchPollSeconds(answer.payload) }
    : answer;
}
