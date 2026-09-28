/**
 * `GET /api/test-runs/:id/cases/:caseId/failure` — the test-results page's poll of one case's
 * failure, on this origin ([#339](https://github.com/NobuData/ouroboros/issues/339)).
 *
 * AT.5's failure payload ([#333](https://github.com/NobuData/ouroboros/issues/333)) — the path,
 * the message and the log excerpt — asked of the service with the visitor's session.
 */

import { pollResponse } from "@/app/api/poll-response";
import { CASE_FAILURE_UNAVAILABLE_CODE, readFailureForPoll } from "@/app/api/test-results-read";

/**
 * Answer one poll.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the attempt's id and the case's.
 * @returns The case's failure, a `401` for an ended session, or a `502` saying why it failed.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; caseId: string }> },
): Promise<Response> {
  const { id, caseId } = await context.params;

  return pollResponse(await readFailureForPoll(id, caseId), CASE_FAILURE_UNAVAILABLE_CODE);
}
