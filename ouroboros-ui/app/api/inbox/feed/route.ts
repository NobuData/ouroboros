/**
 * `GET /api/inbox/feed` — the Needs-You badge's counts, on the origin the browser can reach
 * (#461).
 *
 * The same hop as `app/api/dashboard/route.ts`: the browser cannot call `ouroboros-rest` (the URL
 * is not in the bundle and the session cookie is `HttpOnly`), so this forwards the request's own
 * session and answers what the service answered — no gate of its own, no redirect, never cached.
 */

import { INBOX_UNAVAILABLE_CODE, readInboxFeed } from "@/app/api/inbox-feed";
import { pollResponse } from "@/app/api/poll-response";

/**
 * Answer one poll.
 *
 * @returns The counts, or the failure in the shape `app/shell/inbox-poll.ts` reads back.
 */
export async function GET(): Promise<Response> {
  return pollResponse(await readInboxFeed(), INBOX_UNAVAILABLE_CODE);
}
