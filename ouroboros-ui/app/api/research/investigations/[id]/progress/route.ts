/**
 * `GET /api/research/investigations/:id/progress` — one investigation's progress, as
 * server-sent events on this origin (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)).
 *
 * The composer's progress surface: an `EventSource` on this address ticks the source count
 * and the spend so far while the run is in flight. The browser cannot reach `ouroboros-rest`,
 * so this streams the service's answer back over the visitor's session
 * (`app/api/research-progress.ts`), and closes the service's stream when the browser leaves.
 */

import { readInvestigationProgress } from "@/app/api/research-progress";

/** A stream is never static. */
export const dynamic = "force-dynamic";

/**
 * Answer one stream.
 *
 * @param request The request — its abort signal is the browser's leaving.
 * @param context The route's parameters: the investigation's id.
 * @returns The stream, or the refusal.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return readInvestigationProgress(id, { signal: request.signal });
}
