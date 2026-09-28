/**
 * `GET /api/prs/:id` — the PR verification page's poll, on this origin
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * The browser cannot reach `ouroboros-rest` itself, so the page's loop asks here and this asks
 * the service with the visitor's session, exactly as the run console's route does.
 */

import { pollResponse } from "@/app/api/poll-response";
import { PR_UNAVAILABLE_CODE, readPageForPoll } from "@/app/api/pull-requests-read";

/**
 * Answer one poll.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the PR's id.
 * @returns The page, a `401` for an ended session, or a `502` saying why it failed.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readPageForPoll(id), PR_UNAVAILABLE_CODE);
}
