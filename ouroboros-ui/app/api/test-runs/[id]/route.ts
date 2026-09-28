/**
 * `GET /api/test-runs/:id` — the test-results page's poll of one attempt's page, on this origin
 * ([#337](https://github.com/NobuData/ouroboros/issues/337)).
 *
 * The suites card's rows and their cases, asked of the service with the visitor's session.
 * Polled, because a running build's suites fill in as its results parse.
 */

import { pollResponse } from "@/app/api/poll-response";
import { TEST_RUN_PAGE_UNAVAILABLE_CODE, readPageForPoll } from "@/app/api/test-results-read";

/**
 * Answer one poll.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the attempt's id.
 * @returns The attempt's page, a `401` for an ended session, or a `502` saying why it failed.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readPageForPoll(id), TEST_RUN_PAGE_UNAVAILABLE_CODE);
}
