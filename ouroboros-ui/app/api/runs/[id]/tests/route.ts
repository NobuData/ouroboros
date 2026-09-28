/**
 * `GET /api/runs/:id/tests` — the test-results page's timeline poll, on this origin
 * ([#335](https://github.com/NobuData/ouroboros/issues/335)).
 *
 * The browser cannot reach `ouroboros-rest` itself, so the page's loop asks here and this asks
 * the service with the visitor's session, exactly as the run console's route does.
 */

import { pollResponse } from "@/app/api/poll-response";
import { TESTS_UNAVAILABLE_CODE, readTimelineForPoll } from "@/app/api/test-results-read";

/**
 * Answer one poll.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the run's id.
 * @returns The timeline, a `401` for an ended session, or a `502` saying why it failed.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readTimelineForPoll(id), TESTS_UNAVAILABLE_CODE);
}
