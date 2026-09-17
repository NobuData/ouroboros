/**
 * `GET /api/planning/batches/{id}` — one planning batch, on the origin the browser can reach
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * It exists for the reason `app/api/backlog/[id]/route.ts` does: the generator card's poll is the
 * browser asking, on a timer, for the batch it has open — so `sizing…` rows flip to effort chips
 * and a push's per-draft states land without a reload — and the browser cannot ask
 * `ouroboros-rest` itself. So this handler asks on its behalf, over the request's own cookies, and
 * answers what the service answered, with the cadence the batch calls for
 * (`app/api/planning-batch.ts`).
 *
 * No session gate, no redirect, no cache — all three for the backlog handlers' reasons.
 */

import { PLANNING_UNAVAILABLE_CODE, readPlanningBatch } from "@/app/api/planning-batch";
import { pollResponse } from "@/app/api/poll-response";

/**
 * Answer one poll.
 *
 * @param _request The poll, carrying the session it was made with.
 * @param context The batch, from the path.
 * @returns The batch as JSON with its `X-Ouro-Poll-After`, a `401` for a session that has ended, or
 *   the failure as the service reported it.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readPlanningBatch(id), PLANNING_UNAVAILABLE_CODE);
}
