/**
 * `GET /api/runs/:id` — the run console's poll, on this origin
 * ([#309](https://github.com/NobuData/ouroboros/issues/309)).
 *
 * The browser cannot reach `ouroboros-rest` itself, so the console's loop asks here and this
 * asks the service with the visitor's session, exactly as the planning batch's route does.
 */

import { pollResponse } from "@/app/api/poll-response";
import { RUN_UNAVAILABLE_CODE, readRunConsole } from "@/app/api/run-console";

/**
 * Answer one poll.
 *
 * @param _request The request. Unread — the session travels in its cookies, which the
 *   anonymous client forwards.
 * @param context The route's parameters: the run's id.
 * @returns The snapshot, a `401` for an ended session, or a `502` saying why it failed.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return pollResponse(await readRunConsole(id), RUN_UNAVAILABLE_CODE);
}
