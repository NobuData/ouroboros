/**
 * `GET /api/backlog` — one page of the backlog, on the origin the browser can reach
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * The second route handler in this module, and it exists for the reason the first does
 * (`app/api/dashboard/route.ts`): the table's poll is the browser asking, on a timer, for the
 * rows it is showing — *"`estimating…` must actually become `sized` when the pipeline
 * finishes, not on a timer"* — and the browser cannot ask `ouroboros-rest` itself, because
 * `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly`. So
 * this handler asks on its behalf, over the request's own cookies, and answers what the
 * service answered.
 *
 * ### The address is the query
 *
 * The browser asks with the **same query string the page was rendered from** —
 * `?repo=&labels=&state=&sort=&q=&page=` — and this handler reads it with the same two
 * functions the route does (`parseFilter`, `parsePage`). That is what keeps the poll and the
 * page one view: a parameter the page ignores, the poll ignores; a value the page falls back
 * on, the poll falls back on. It is also the whole of the input validation, and deliberately
 * so — nothing from the address reaches the service except the five controls and the page,
 * each already checked against the values the contract accepts.
 *
 * ### No session gate, no redirect, no cache
 *
 * All three for the dashboard handler's reasons: a `401` is the service's to answer and is
 * passed on as one, never as a `307` to a login page a poll would try to read as a backlog;
 * and route handlers are uncached by default, which is right for a request that reads cookies
 * and whose whole point is freshness.
 */

import { readBacklogPage } from "@/app/api/backlog-page";
import { pollResponse } from "@/app/api/poll-response";
import { parseFilter, searchParamsOf } from "@/app/issues/filter";
import { pageQuery, parsePage } from "@/app/issues/paging";

/** The code a failed read is reported under — this hop's own, not the service's. */
export const BACKLOG_UNAVAILABLE_CODE = "backlog_unavailable";

/**
 * Answer one poll.
 *
 * @param request The poll, carrying the view's query string and the session it was made with.
 * @returns The page as JSON, a `401` for a session that has ended, or the failure as the
 *   service reported it — each in the shape `app/issues/backlog-poll.ts` reads back.
 */
export async function GET(request: Request): Promise<Response> {
  const params = searchParamsOf(new URL(request.url).searchParams);
  const answer = await readBacklogPage(pageQuery(parseFilter(params), parsePage(params)));

  return pollResponse(answer, BACKLOG_UNAVAILABLE_CODE);
}
