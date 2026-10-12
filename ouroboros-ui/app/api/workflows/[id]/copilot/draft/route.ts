/**
 * `GET /api/workflows/:id/copilot/draft` — the stage list's poll (CE.3,
 * [#567](https://github.com/NobuData/ouroboros/issues/567)).
 *
 * The draft with who each stage is by, re-read every interval while the tab is visible and at
 * once when the reader comes back to it — which is what clears a row's `added by copilot` pill
 * after its stage is edited on the canvas, with no reload. The browser cannot reach
 * `ouroboros-rest`, so this passes the read through over the visitor's session
 * (`app/api/workflow-copilot-draft.ts`).
 */

import { answerDraftPoll } from "@/app/api/workflow-copilot-draft";

/** One workspace's draft, as it is now: never static, never cached. */
export const dynamic = "force-dynamic";

/**
 * Read the draft.
 *
 * @param request The request.
 * @param context The route's parameters: the workflow's id.
 * @returns The draft, or the poll's own account of why not.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  return answerDraftPoll(request, id);
}
