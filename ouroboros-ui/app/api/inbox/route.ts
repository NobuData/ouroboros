/**
 * `GET /api/inbox` — the Needs-You queue, on the origin the browser can reach (BO.1,
 * [#466](https://github.com/NobuData/ouroboros/issues/466)).
 *
 * The same hop as `app/api/inbox/feed/route.ts`: it forwards the request's own session to
 * `GET /api/v1/inbox` and answers what the service answered — no gate of its own, never cached.
 */

import { INBOX_QUEUE_UNAVAILABLE_CODE, readInboxQueue } from "@/app/api/inbox-queue";
import { pollResponse } from "@/app/api/poll-response";

/**
 * Answer one poll.
 *
 * @returns The queue, or the failure in the shape `app/inbox/queue-poll.ts` reads back.
 */
export async function GET(): Promise<Response> {
  return pollResponse(await readInboxQueue(), INBOX_QUEUE_UNAVAILABLE_CODE);
}
