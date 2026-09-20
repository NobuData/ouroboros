/**
 * `GET /api/farm/jobs/{id}/log?after=` — one page of a build's log, on the origin the browser
 * can reach (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * It exists for the reason `app/api/farm/route.ts` does: the live log card's stream is the
 * browser asking, every two seconds, for whatever a build printed since the offset it last
 * reached, and the browser cannot ask `ouroboros-rest` itself. So this handler asks on its
 * behalf, over the request's own cookies, and answers what the service answered with the
 * cadence the page calls for (`app/api/farm-log.ts`).
 *
 * No session gate, no redirect, no cache — all three for that handler's reasons.
 */

import { FARM_LOG_UNAVAILABLE_CODE, readFarmLog } from "@/app/api/farm-log";
import { pollResponse } from "@/app/api/poll-response";

/**
 * Answer one poll.
 *
 * @param request The poll, carrying the session it was made with and the offset to read from.
 * @param context The build job, from the path.
 * @returns The page as JSON with its `X-Ouro-Poll-After`, a `401` for a session that has ended,
 *   or the failure as the service reported it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const after = new URL(request.url).searchParams.get("after");

  return pollResponse(await readFarmLog(id, after), FARM_LOG_UNAVAILABLE_CODE);
}
