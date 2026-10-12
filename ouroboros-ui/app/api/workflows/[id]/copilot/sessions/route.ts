/**
 * `POST /api/workflows/:id/copilot/sessions` — start a workflow's conversation (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)).
 *
 * There is no conversation until the first message: the card calls this once, then sends. The
 * browser cannot reach `ouroboros-rest`, so this passes the request through over the visitor's
 * session (`app/api/workflow-copilot-stream.ts`) and answers with the service's session, or its
 * refusal — `403` for a member, `409 copilot_session_active` when one is already open.
 */

import { passCopilotWrite, sessionsPath } from "@/app/api/workflow-copilot-stream";

/** A write is never static. */
export const dynamic = "force-dynamic";

/**
 * Start the conversation.
 *
 * @param request The request.
 * @param context The route's parameters: the workflow's id.
 * @returns The session, or the refusal.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  return passCopilotWrite(request, [id], sessionsPath(id));
}
