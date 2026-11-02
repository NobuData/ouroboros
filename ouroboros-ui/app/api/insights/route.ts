/**
 * `GET /api/insights?range=` — the insights page, on the origin the browser can reach
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * `app/api/farm/route.ts`'s reasoning holds here: the browser cannot call `ouroboros-rest`
 * itself, so this handler forwards the request's own session and answers what the service
 * answered. **There is no session gate here**: a visitor with no session gets a plain `401`
 * rather than a redirect a `fetch` nobody sees would follow.
 *
 * It takes two things from the request — the range and the data origin — parsed by the same
 * functions the page uses (`app/insights/range.ts`, `app/origin/origin-server.ts`), so a value the
 * service does not answer is the default here exactly as it is on the page, and never a `422`
 * passed through to the screen.
 */

import { INSIGHTS_UNAVAILABLE_CODE, readInsightsPage } from "@/app/api/insights-page";
import { pollResponse } from "@/app/api/poll-response";
import { RANGE_PARAM, parseRange } from "@/app/insights/range";
import { ORIGIN_PARAM } from "@/app/origin/origin";
import { readOriginFilter } from "@/app/origin/origin-server";

/**
 * Answer one poll.
 *
 * @param request The poll's request; its `range` parameter names the window.
 * @returns The page, a plain `401` when the session is over, or the failure as the service
 *   reported it — each in the shape `app/insights/insights-poll.ts` reads back.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const range = parseRange(params.get(RANGE_PARAM));
  const origin = await readOriginFilter(params.get(ORIGIN_PARAM));

  return pollResponse(await readInsightsPage(range, origin), INSIGHTS_UNAVAILABLE_CODE);
}
