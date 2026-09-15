"use server";

/**
 * The server hops for the studio's draft, publish and dry-run flows — S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * `create-actions.ts` states the rule this exists under: the browser cannot reach REST —
 * `OURO_REST_URL` has no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so the studio's
 * Client Components call these Server Actions, and these call the API.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in any call and no person.** Every workflow, issue and backlog row belongs
 *   to the workspace the caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The role gates are the service's.** Saving and publishing are `owner` or `admin`; a member who
 *   reaches {@link saveDraft} anyway is told `403` and nothing is written. A dry run writes nothing and
 *   is every member's.
 * - **What is sent is what the page composed.** The draft goes as the canvas holds it, guarded by the
 *   etag the page last saw; the service decides whether that etag is still current.
 *
 * ### Failure posture: a value, not a throw
 *
 * Every refusal comes back as `{ ok: false, refusal }` for the dialog or the toolbar to draw, because a
 * rejected action would replace a page the reader is still entitled to be on. The one throw that must
 * travel is Next.js's redirect signal, for a session that expired since the page rendered.
 */

import { backlog } from "@/app/api/backlog";
import { type ErrorEnvelope, isApiError } from "@/app/api/errors";
import {
  type WorkflowDefinition,
  type WorkflowDraft,
  type WorkflowDryRunResult,
  type WorkflowVersion,
  workflows,
} from "@/app/api/workflows";

import { TICKET_LIMIT, type TicketOption, ticketOptions } from "./dry-run";

/** What one action produced: its value, or the service's refusal. */
export type ActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Run one call, turning an `ApiError` into a refusal value.
 *
 * @param work The call.
 * @returns Its value, or the service's envelope.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
async function attempt<T>(work: () => Promise<T>): Promise<ActionOutcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, refusal: { code: error.code, message: error.message, details: error.details } };
  }
}

/**
 * Save the draft — autosave's write.
 *
 * @param id The workflow's id.
 * @param etag The etag of the draft this document was edited from.
 * @param definition The whole document.
 * @returns The draft slot after the write, or the refusal — `workflow_draft_conflict` when the draft
 *   moved, which means **nothing was written**.
 * @throws Whatever is not an `ApiError`.
 */
export async function saveDraft(
  id: string,
  etag: string,
  definition: WorkflowDefinition,
): Promise<ActionOutcome<WorkflowDraft>> {
  return attempt(() => workflows.saveDraft(id, etag, definition));
}

/**
 * Publish the stored draft.
 *
 * @param id The workflow's id.
 * @param changeNote The note, or `undefined` for none — `publish.ts`' `changeNoteBody` decides.
 * @returns The version now in force, or the refusal — `workflow_definition_invalid` with the findings.
 * @throws Whatever is not an `ApiError`.
 */
export async function publishWorkflow(
  id: string,
  changeNote: string | undefined,
): Promise<ActionOutcome<WorkflowVersion>> {
  return attempt(() => workflows.publish(id, changeNote));
}

/**
 * Walk the stored draft for one issue.
 *
 * @param id The workflow's id.
 * @param issueId The issue's `github_issues.id`.
 * @returns The walk, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function dryRunWorkflow(
  id: string,
  issueId: string,
): Promise<ActionOutcome<WorkflowDryRunResult>> {
  return attempt(() => workflows.dryRun(id, issueId));
}

/**
 * The issues the dry-run picker offers: open and sized, lowest number first.
 *
 * One page of the contract's largest size — a picker is a short list to choose from, not a backlog to
 * browse, and the seeded `#485` is well inside it.
 *
 * @returns The options, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function sizedTickets(): Promise<ActionOutcome<readonly TicketOption[]>> {
  return attempt(async () => {
    const listing = await backlog.list({ state: "open", sort: "number", limit: TICKET_LIMIT });

    return ticketOptions(listing.items);
  });
}
