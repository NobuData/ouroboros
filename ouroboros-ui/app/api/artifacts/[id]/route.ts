/**
 * `GET /api/artifacts/:id` — one artifact's file, on this origin
 * ([#341](https://github.com/NobuData/ouroboros/issues/341)).
 *
 * The artifacts card's **open ↗**: the inline viewer reads it as text, and a download link saves
 * it. The browser cannot reach `ouroboros-rest`, so this streams the service's answer back over
 * the visitor's session (`app/api/artifact-file.ts`).
 */

import { readArtifactFile } from "@/app/api/artifact-file";

/**
 * Answer one read.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the artifact's id.
 * @returns The file, streamed, or the refusal.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return readArtifactFile(id);
}
