/**
 * `GET /api/farm` — the build farm page, on the origin the browser can reach
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * `app/api/dashboard/route.ts` argues why a poll is a route handler rather than a Server Action
 * or a re-render, and everything it says holds here: the browser cannot call `ouroboros-rest`
 * itself — `OURO_REST_URL` is not in the bundle and the session cookie is `HttpOnly` — so this
 * handler forwards the request's own session and answers what the service answered, with the
 * service's `X-Ouro-Poll-After` intact. **There is no session gate here** for the reason that
 * file gives: a visitor with no session gets the service's `401`, said plainly rather than
 * redirected, because a poll parsing a login page as a farm is worse than a poll being told the
 * session is over.
 *
 * It takes nothing from the request: the farm has no filter, no page and no tag to revalidate,
 * and the workspace is the session's. Route handlers are uncached by default in this version of
 * Next.js, and this one reads cookies besides.
 */

import { FARM_UNAVAILABLE_CODE, readFarmPage } from "@/app/api/farm-page";
import { pollResponse } from "@/app/api/poll-response";

/**
 * Answer one poll.
 *
 * @returns The page with the cadence the service asked for, a plain `401` when the session is
 *   over, or the failure as the service reported it — each in the shape
 *   `app/farm/farm-poll.ts` reads back.
 */
export async function GET(): Promise<Response> {
  return pollResponse(await readFarmPage(), FARM_UNAVAILABLE_CODE);
}
