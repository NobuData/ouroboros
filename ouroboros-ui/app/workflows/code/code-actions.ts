"use server";

/**
 * The server hops for the code editor's save — V.4
 * ([#172](https://github.com/NobuData/ouroboros/issues/172)) — and its **Validate** — V.6
 * ([#174](https://github.com/NobuData/ouroboros/issues/174)). **Publish** is S.6's shared
 * `publishWorkflow` (`draft-actions.ts`), which the visual editor calls too.
 *
 * `draft-actions.ts` states the rule this exists under: the browser cannot reach REST, so the
 * workbench's Client Component calls this Server Action, and this calls the API.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The workflow belongs to the workspace the
 *   caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The role gate is the service's.** Saving is `owner` or `admin`; a member who reaches this anyway is
 *   told `403` and nothing is written.
 * - **What is sent is not trusted here.** The slug, the etag and the text go to the service as the page
 *   composed them, and the service decides whether they are a slug, a current etag and a file that
 *   reads — a malformed one is its `422 validation_failed`, never a write.
 *
 * Refusals come back as values (`action-outcome.ts`).
 */

import { type WorkflowCode, type WorkflowCodeValidation, workflows } from "@/app/api/workflows";

import { type ActionOutcome, attempt } from "../action-outcome";

/**
 * Validate a workflow's file without publishing it — the code view's **Validate** (V.6,
 * [#174](https://github.com/NobuData/ouroboros/issues/174)).
 *
 * Every member's, as a dry run is: it writes nothing. The slug goes to the service as the page composed
 * it, and the service decides whether it names a workflow this session may read.
 *
 * @param slug The workflow's slug.
 * @returns The gate's verdict drawn as the file's diagnostics and Loop Checks; or the refusal —
 *   `engine_unavailable` when the engine could not check it. Nothing was written either way.
 * @throws Whatever is not an `ApiError`.
 */
export async function validateCode(slug: string): Promise<ActionOutcome<WorkflowCodeValidation>> {
  return attempt(() => workflows.validateCode(slug));
}

/**
 * Save a workflow's file into the shared draft — the code editor's autosave write.
 *
 * @param slug The workflow's slug.
 * @param etag The etag of the draft this text was typed over.
 * @param text The whole file.
 * @returns The file as it now reads from the draft, with the next etag; or the refusal —
 *   `workflow_code_invalid` with the parse errors, or `workflow_draft_conflict` when the draft moved.
 *   Neither refusal wrote anything.
 * @throws Whatever is not an `ApiError`.
 */
export async function saveCode(slug: string, etag: string, text: string): Promise<ActionOutcome<WorkflowCode>> {
  return attempt(() => workflows.saveCode(slug, etag, text));
}
