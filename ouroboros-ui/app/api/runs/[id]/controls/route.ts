/**
 * `GET /api/runs/:id/controls` — the run console's delivery chips, on this origin
 * ([#310](https://github.com/NobuData/ouroboros/issues/310)).
 *
 * The browser cannot reach `ouroboros-rest` itself, so the head's controls poll asks here and
 * this asks the service with the visitor's session, as `app/api/runs/[id]/route.ts` does for
 * the snapshot. Submitting a control is a Server Action (`app/runs/control-actions.ts`), not
 * this route.
 */

import { pollResponse } from "@/app/api/poll-response";
import { RUN_CONTROLS_UNAVAILABLE_CODE, readRunControls } from "@/app/api/run-controls";

/**
 * Answer one poll.
 *
 * @param _request The request. Unread — the session travels in its cookies, which the
 *   anonymous client forwards.
 * @param context The route's parameters: the run's id.
 * @returns The controls with their cadence, a `401` for an ended session, or a `502` saying
 *   why the read failed.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readRunControls(id), RUN_CONTROLS_UNAVAILABLE_CODE);
}
