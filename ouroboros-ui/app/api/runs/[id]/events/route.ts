/**
 * `GET /api/runs/:id/events?after=` — one page of a run's transcript, on this origin
 * ([#312](https://github.com/NobuData/ouroboros/issues/312)).
 *
 * The transcript card asks here for the entries past the cursor it holds, and this asks the
 * service over the visitor's session (`app/api/run-events.ts`), exactly as the farm's live log
 * route does for a build.
 */

import { pollResponse } from "@/app/api/poll-response";
import { RUN_EVENTS_UNAVAILABLE_CODE, readRunEvents } from "@/app/api/run-events";

/**
 * Answer one read.
 *
 * @param request The read, carrying the session and the cursor.
 * @param context The run, from the path.
 * @returns The page with its `X-Ouro-Poll-After`, a `401` for an ended session, or a `502`.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const after = new URL(request.url).searchParams.get("after");

  return pollResponse(await readRunEvents(id, after), RUN_EVENTS_UNAVAILABLE_CODE);
}
