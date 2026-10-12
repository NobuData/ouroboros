import "server-only";

/**
 * The draft's stage list, read for its poll (CE.3,
 * [#567](https://github.com/NobuData/ouroboros/issues/567)) — over
 * `GET /api/v1/workflows/{id}/copilot/draft`.
 *
 * The list is composed from the shared draft, and the draft moves under it from two other
 * surfaces: a stage reconfigured on the canvas loses its `added by copilot` pill, and a saved
 * code edit changes its tags. A browser cannot reach `ouroboros-rest`, so the card asks this
 * origin every interval and this asks the service with the visitor's session cookies — the I.8
 * poll family (`app/api/poll-read.ts`, `app/api/poll-response.ts`), one more reader.
 *
 * ### A read, checked like the writes beside it
 *
 * It changes nothing, but it answers with one workspace's draft, so it is held to the rule the
 * conversation's writes are (`app/api/workflow-copilot-stream.ts`): a request another site made
 * is refused before anything is forwarded, and the path's id must be a uuid before a request is
 * made of it. No workspace travels — the service resolves it from the session.
 *
 * **It does not throw.** Every outcome is one of the poll's four answers, or one of this hop's
 * own two refusals.
 */

import { anonymousApi } from "@/app/api/server";
import { CACHE_CONTROL, pollResponse } from "@/app/api/poll-response";
import { readForPoll } from "@/app/api/poll-read";
import { type CopilotStageDraft, workflowCopilot } from "@/app/api/workflow-copilot";
import {
  COPILOT_ID_INVALID,
  COPILOT_REQUEST_INVALID_CODE,
  CROSS_ORIGIN,
  CROSS_ORIGIN_CODE,
  isCopilotId,
  sameOrigin,
} from "@/app/api/workflow-copilot-stream";
import type { PollAnswer } from "@/app/poll";
import { UNREACHABLE_DRAFT } from "@/app/workflows/copilot/stages";

/** The code this origin reports a failed draft read under. */
export const COPILOT_DRAFT_UNAVAILABLE_CODE = "copilot_draft_unavailable";

/** How one draft is read — the service's route by default; a test substitutes its own. */
export type DraftRead = (id: string, signal: AbortSignal) => Promise<CopilotStageDraft>;

/**
 * Read one workflow's draft from the service, over the visitor's session.
 *
 * Through the client that does not redirect: a `401` here is the poll's *gone*, said plainly,
 * rather than a login page a `fetch` nobody sees would follow.
 *
 * @param id The workflow.
 * @param signal The poll's deadline.
 * @returns The draft.
 */
async function readDraft(id: string, signal: AbortSignal): Promise<CopilotStageDraft> {
  return workflowCopilot.draft(id, anonymousApi(), signal);
}

/**
 * Read a workflow's draft for a poll.
 *
 * @param id The workflow.
 * @param read How to read it.
 * @returns The answer.
 */
export async function readCopilotDraftForPoll(id: string, read: DraftRead = readDraft): Promise<PollAnswer<CopilotStageDraft>> {
  return readForPoll((signal) => read(id, signal), UNREACHABLE_DRAFT);
}

/**
 * A refusal this hop makes itself, in the service's envelope.
 *
 * @param status The status.
 * @param code The code.
 * @param message The sentence.
 * @returns The response.
 */
function refuse(status: number, code: string, message: string): Response {
  return Response.json({ code, message, details: {} }, { status, headers: { "Cache-Control": CACHE_CONTROL } });
}

/**
 * Answer the stage list's poll.
 *
 * @param request The browser's request — only its headers are read.
 * @param id The workflow the path named.
 * @param read How to read the draft.
 * @returns The draft; a `403` for another site's request and a `422` for an id that is not a
 *   uuid, each before anything is sent; a `401` when the session has ended; or a `502` with the
 *   reason when the draft could not be read. Never a throw.
 */
export async function answerDraftPoll(request: Request, id: string, read: DraftRead = readDraft): Promise<Response> {
  if (!sameOrigin(request.headers)) return refuse(403, CROSS_ORIGIN_CODE, CROSS_ORIGIN);
  if (!isCopilotId(id)) return refuse(422, COPILOT_REQUEST_INVALID_CODE, COPILOT_ID_INVALID);

  return pollResponse(await readCopilotDraftForPoll(id, read), COPILOT_DRAFT_UNAVAILABLE_CODE);
}
