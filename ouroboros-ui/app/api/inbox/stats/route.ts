import { INBOX_STATS_UNAVAILABLE_CODE, readInboxStats } from "@/app/api/inbox-stats";
import { pollResponse } from "@/app/api/poll-response";

/**
 * `GET /api/inbox/stats` — the week's stat card for the `/inbox` page's poll (BO.5,
 * [#470](https://github.com/NobuData/ouroboros/issues/470)): decisions answered, the median
 * answer time and the longest loop wait, with the service's printing of each.
 *
 * @returns The poll family's response.
 */
export async function GET(): Promise<Response> {
  return pollResponse(await readInboxStats(), INBOX_STATS_UNAVAILABLE_CODE);
}
