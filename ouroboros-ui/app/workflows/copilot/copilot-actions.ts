"use server";

/**
 * The server hop for the copilot's **Discard draft** (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)).
 *
 * `app/workflows/create-actions.ts` states the rule this exists under: the browser cannot reach
 * REST, so a Client Component that needs something from the API calls a Server Action that calls
 * it. **Promote** has no action here — it is the studio's one publish path,
 * `app/workflows/draft-actions.ts`' `publishWorkflow`, which the canvas and the code view call
 * too.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The workflow belongs to the workspace
 *   the caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The role gate is the service's** — `owner` or `admin`. The head draws the button inert for
 *   anyone else, but that is presentation: a member who reaches {@link discardCopilotDraft}
 *   anyway is told `403` and nothing is discarded.
 * - **Nothing is sent but the id.** What is discarded is whatever the service holds for that
 *   workflow — its draft, and its open conversation — decided there.
 *
 * ### Failure posture: a value, not a throw
 *
 * Every refusal comes back as `{ ok: false, refusal }` (`app/workflows/action-outcome.ts`), for
 * the dialog to say in words: `409 copilot_nothing_to_discard`, `409 dry_run_in_progress`.
 */

import { type CopilotDiscardResult, workflowCopilot } from "@/app/api/workflow-copilot";

import { type ActionOutcome, attempt } from "../action-outcome";

/**
 * Discard a workflow's draft and close its conversation, keeping the transcript.
 *
 * @param id The workflow's id.
 * @returns What was discarded, or the refusal — which means **nothing was discarded**.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function discardCopilotDraft(id: string): Promise<ActionOutcome<CopilotDiscardResult>> {
  return attempt(() => workflowCopilot.discard(id));
}
