import "server-only";

/**
 * The build farm page, read on behalf of the screen's poll
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * `app/api/planning-batch.ts` is the same seam for the generator card: the server's half of a
 * poll, answering in `app/poll.ts`'s four cases so that `app/api/farm/route.ts` can turn the
 * answer into HTTP and `app/farm/farm-poll.ts` can read it back out. AH.6's read answers no
 * `ETag` — it is `no-store`, every figure a claim about the present — so there is no `304` for
 * the typed client's middleware to turn into a throw, and the translation is
 * `app/api/poll-read.ts`'s.
 *
 * **With one addition: the cadence is the service's.** `GET /api/v1/farm` carries
 * `X-Ouro-Poll-After` — the fleet's ten-second heartbeat — and `readForPoll` knows nothing about
 * headers, so the hint is read beside the body (`farm.observe`) and put on the fresh answer here.
 * A page that polled a ten-second fleet on the contract's fifteen-second default would be a
 * page whose *4/5* lagged the table it counts.
 *
 * The client is `anonymousApi()`, for the reason `app/api/backlog-page.ts` gives: a poll is not
 * a render, and a `401` is an answer (*gone*) rather than a redirect a `fetch` nobody sees would
 * follow into a login page.
 */

import { type FarmObservation, type FarmPage, farm } from "@/app/api/farm";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_FARM } from "@/app/farm/farm-poll";
import type { PollAnswer } from "@/app/poll";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const FARM_UNAVAILABLE_CODE = "farm_unavailable";

/**
 * Read the farm page for a poll.
 *
 * @param read How to make the read, given the deadline. Defaults to the typed client over the
 *   session's cookies; tests pass a stub.
 * @returns The answer — the page with the service's cadence, *gone* for a session that has
 *   ended, or a sentence about why not. **It does not throw**, for the reason `readForPoll`
 *   gives.
 */
export async function readFarmPage(
  read: (signal: AbortSignal) => Promise<FarmObservation> = (signal) =>
    farm.observe(anonymousApi(), signal),
): Promise<PollAnswer<FarmPage>> {
  const answer = await readForPoll(read, UNREACHABLE_FARM);

  return answer.state === "fresh"
    ? { ...answer, payload: answer.payload.page, pollAfterSeconds: answer.payload.pollAfterSeconds }
    : answer;
}
