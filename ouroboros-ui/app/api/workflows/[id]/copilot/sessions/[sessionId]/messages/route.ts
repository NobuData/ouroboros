/**
 * `POST /api/workflows/:id/copilot/sessions/:sessionId/messages` — send a message and stream the
 * reply, as server-sent events on this origin (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)).
 *
 * The conversation card reads this with `fetch` and a stream reader: reply text and the
 * operations it applies arrive in the order the model produced them. The browser cannot reach
 * `ouroboros-rest`, so this streams the service's answer back over the visitor's session
 * (`app/api/workflow-copilot-stream.ts`) and closes the service's stream when the browser leaves.
 * A refusal before the stream opens — a closed conversation, a reply still streaming, a role
 * that may not write — keeps the service's status and envelope.
 */

import { messagesPath, passCopilotWrite } from "@/app/api/workflow-copilot-stream";

/** A stream is never static. */
export const dynamic = "force-dynamic";

/**
 * Send one message.
 *
 * @param request The request — `{ text }`; its abort signal is the browser's leaving.
 * @param context The route's parameters: the workflow's id and the conversation's.
 * @returns The stream, or the refusal.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
): Promise<Response> {
  const { id, sessionId } = await context.params;

  return passCopilotWrite(request, [id, sessionId], messagesPath(id, sessionId));
}
