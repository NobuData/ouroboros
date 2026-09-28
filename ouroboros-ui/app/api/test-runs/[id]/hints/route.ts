/**
 * `GET /api/test-runs/:id/hints` — the test-results page's poll of one attempt's triage hints, on
 * this origin ([#339](https://github.com/NobuData/ouroboros/issues/339)).
 *
 * AT.4's heuristic hints ([#332](https://github.com/NobuData/ouroboros/issues/332)), asked of the
 * service with the visitor's session. Polled, because a hint reads the runner's state and the
 * attempt's cases, and both move while a build runs.
 */

import { pollResponse } from "@/app/api/poll-response";
import { TRIAGE_HINTS_UNAVAILABLE_CODE, readHintsForPoll } from "@/app/api/test-results-read";

/**
 * Answer one poll.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the attempt's id.
 * @returns The attempt's hints, a `401` for an ended session, or a `502` saying why it failed.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readHintsForPoll(id), TRIAGE_HINTS_UNAVAILABLE_CODE);
}
