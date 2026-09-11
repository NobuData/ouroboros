/**
 * `GET /api/backlog/{id}` — one issue in full, on the origin the browser can reach
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * The third route handler in this module, and it exists for the reason the second does
 * (`app/api/backlog/route.ts`): the detail panel's poll is the browser asking, on a timer,
 * for the issue it has open — so that an `estimating…` breakdown flips to the real one when
 * the pipeline finishes, and a **Re-estimate** press shows its new version without a reload —
 * and the browser cannot ask `ouroboros-rest` itself. So this handler asks on its behalf, over
 * the request's own cookies, and answers what the service answered.
 *
 * ### The address is the id
 *
 * `{id}` is `github_issues.id`, exactly as the contract's own path takes it, and it is the
 * whole of the input: nothing from the query string reaches the service. Its shape is the
 * service's to check — an id that is not one is refused there and reported here as a failed
 * read with the service's sentence, never as a `500` of this origin's.
 *
 * ### No session gate, no redirect, no cache
 *
 * All three for the other two handlers' reasons: a `401` is the service's to answer and is
 * passed on as one, never as a `307` to a login page a poll would try to read as an issue;
 * and route handlers are uncached by default, which is right for a request that reads cookies
 * and whose whole point is freshness.
 */

import { readIssueDetail } from "@/app/api/backlog-detail";
import { BACKLOG_UNAVAILABLE_CODE } from "@/app/api/backlog/route";
import { pollResponse } from "@/app/api/poll-response";

/**
 * Answer one poll.
 *
 * @param _request The poll, carrying the session it was made with.
 * @param context The issue, from the path.
 * @returns The issue as JSON, a `401` for a session that has ended, or the failure as the
 *   service reported it — each in the shape `app/issues/detail-poll.ts` reads back.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readIssueDetail(id), BACKLOG_UNAVAILABLE_CODE);
}
