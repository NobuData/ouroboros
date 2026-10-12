/**
 * `POST /api/workflows/:id/copilot/sessions/:sessionId/messages/:messageId/answers` — answer one
 * of a reply's questions and stream what the copilot does with it (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)).
 *
 * A chip is a control: pressing it records the answer on the reply that asked and re-enters the
 * loop, and the continuation arrives as the same server-sent events a sent message's reply does.
 * Passed through over the visitor's session (`app/api/workflow-copilot-stream.ts`); a refusal —
 * `422 copilot_answer_invalid` for a question already answered — keeps the service's envelope.
 */

import { answersPath, passCopilotWrite } from "@/app/api/workflow-copilot-stream";

/** A stream is never static. */
export const dynamic = "force-dynamic";

/**
 * Answer one question.
 *
 * @param request The request — `{ question, selected }`; its abort signal is the browser's leaving.
 * @param context The route's parameters: the workflow, the conversation, and the reply that asked.
 * @returns The stream, or the refusal.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; sessionId: string; messageId: string }> },
): Promise<Response> {
  const { id, sessionId, messageId } = await context.params;

  return passCopilotWrite(request, [id, sessionId, messageId], answersPath(id, sessionId, messageId));
}
