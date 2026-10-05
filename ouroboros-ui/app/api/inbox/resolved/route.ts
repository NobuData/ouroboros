import { INBOX_RESOLVED_UNAVAILABLE_CODE, readInboxResolved } from "@/app/api/inbox-resolved";
import { pollResponse } from "@/app/api/poll-response";
import { RESOLVED_DAY_PARAM } from "@/app/inbox/resolved-view";

/**
 * `GET /api/inbox/resolved?day=YYYY-MM-DD` — one day of the resolved list for the `/inbox` page's
 * poll (BO.3, [#468](https://github.com/NobuData/ouroboros/issues/468)). Today when `day` is
 * absent or is not a date.
 *
 * @param request The request, for its query.
 * @returns The poll family's response.
 */
export async function GET(request: Request): Promise<Response> {
  const day = new URL(request.url).searchParams.get(RESOLVED_DAY_PARAM);

  return pollResponse(await readInboxResolved(day), INBOX_RESOLVED_UNAVAILABLE_CODE);
}
