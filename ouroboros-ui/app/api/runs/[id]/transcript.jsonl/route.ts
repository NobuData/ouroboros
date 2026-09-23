/**
 * `GET /api/runs/:id/transcript.jsonl` — a run's raw transcript, on this origin
 * ([#310](https://github.com/NobuData/ouroboros/issues/310)).
 *
 * The take-over dialog's *Download the transcript* link. The browser cannot reach
 * `ouroboros-rest`, so this streams the service's export back over the visitor's session
 * (`app/api/run-transcript.ts`).
 */

import { readRunTranscript } from "@/app/api/run-transcript";

/**
 * Answer one download.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the run's id.
 * @returns The file, streamed, or the refusal.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return readRunTranscript(id);
}
