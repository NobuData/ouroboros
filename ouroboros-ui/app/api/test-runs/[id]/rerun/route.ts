/**
 * `GET /api/test-runs/:id/rerun` — the test-results head's re-run gate poll, on this origin
 * ([#335](https://github.com/NobuData/ouroboros/issues/335)).
 *
 * Whether *Re-run failed* and *Re-run full suite* could be placed now, asked of the service with
 * the visitor's session. Polled, because a runner coming online is exactly the change the
 * disabled buttons are waiting for.
 */

import { pollResponse } from "@/app/api/poll-response";
import { RERUN_GATE_UNAVAILABLE_CODE, readGateForPoll } from "@/app/api/test-results-read";

/**
 * Answer one poll.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the attempt's id.
 * @returns The gate, a `401` for an ended session, or a `502` saying why it failed.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readGateForPoll(id), RERUN_GATE_UNAVAILABLE_CODE);
}
