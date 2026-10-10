/**
 * `GET /api/research/investigations/:id/brief/export` — one brief as a Markdown file, on this
 * origin (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630)).
 *
 * The brief card's **Export brief ↗**: a download link. The browser cannot reach
 * `ouroboros-rest`, so this passes the service's file back over the visitor's session with the
 * brief's own file name (`app/api/brief-export.ts`).
 */

import { readBriefExport } from "@/app/api/brief-export";

/** A download is never static. */
export const dynamic = "force-dynamic";

/**
 * Answer one export.
 *
 * @param _request The request. Unread — the session travels in its cookies.
 * @param context The route's parameters: the investigation's id.
 * @returns The file, or the refusal.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return readBriefExport(id);
}
