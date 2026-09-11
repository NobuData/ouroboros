import "server-only";

/**
 * One issue in full, read on behalf of the detail panel's poll
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * `app/api/backlog-page.ts` is the same seam for the table: the server's half of a poll,
 * answering in `app/poll.ts`'s four cases so that `app/api/backlog/[id]/route.ts` can turn the
 * answer into HTTP and `app/issues/detail-poll.ts` can read it back out. M.2's read answers no
 * `ETag` and no cadence hint — every answer is a `200` or a refusal — so the read goes through
 * `app/api/backlog.ts` like every other call to that operation, and the translation is
 * `app/api/poll-read.ts`'s.
 *
 * ### Why the panel polls at all
 *
 * The ticket's sharpest lines are *"`estimating` (skeleton breakdown that flips live)"* and
 * *"Re-estimate round-trips: button → `estimating…` → the new version renders without a manual
 * refresh"*. Both are the table's argument one issue narrower: what the panel draws must be the
 * last answer about the issue it has open, and the browser cannot ask `ouroboros-rest` itself —
 * `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly`. So the
 * browser asks this origin for the one issue, on the same cadence the table asks for its page,
 * and this reads it with the client that does not redirect (`anonymousApi()`, for the reason
 * the listing's reader gives).
 *
 * ### The id is the service's to refuse
 *
 * Nothing about `{id}` is checked here beyond its being a string the path carried. The service
 * validates the shape and answers `404` for an id this workspace cannot see, and both arrive
 * as a *failed* answer carrying the service's own sentence — which is what a panel opened on
 * a row the backlog has since lost should say.
 */

import { type IssueDetail, backlog } from "@/app/api/backlog";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { UNREACHABLE_ISSUE } from "@/app/issues/detail-poll";
import type { PollAnswer } from "@/app/poll";

/**
 * Read one issue for a poll.
 *
 * @param id The issue's `github_issues.id`, as the path carried it.
 * @param read How to make the read. Defaults to the typed client over the session's cookies;
 *   tests pass a stub.
 * @returns The answer — the issue, *gone* for a session that has ended, or a sentence about
 *   why not.
 */
export async function readIssueDetail(
  id: string,
  read: (id: string, signal: AbortSignal) => Promise<IssueDetail> = (asked, signal) =>
    backlog.detail(asked, anonymousApi(), signal),
): Promise<PollAnswer<IssueDetail>> {
  return readForPoll((signal) => read(id, signal), UNREACHABLE_ISSUE);
}
