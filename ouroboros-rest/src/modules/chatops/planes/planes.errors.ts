/**
 * The refusals the `/ouro` bindings raise themselves (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * Almost every refusal a command meets is the plane's own, thrown by the plane and relayed
 * untouched. These are the few a binding has to make *before* it can call the plane, because the
 * plane's method cannot be addressed at all: a route that does not exist has no chain to repin, and
 * a dry run needs a canonical ticket and a workflow to name. Each has a stable code — it becomes
 * `chat_commands.error_detail` — and a sentence a person can act on.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";

/** The codes, as `chat_commands.error_detail` records them. */
export const CHAT_PLANE_ERRORS = {
  /** `404` — the task kind has no route to repin. */
  routeNotConfigured: "chat_route_not_configured",
  /** `422` — the issue has no canonical ticket, which a dry run is started against. */
  ticketNotCanonical: "chat_ticket_not_canonical",
  /** `422` — no workflow was typed and none claims the ticket. */
  workflowUndecided: "chat_workflow_undecided",
} as const;

/**
 * A task kind with no route: there is no primary hop to replace.
 *
 * @param taskKind - The task kind.
 * @returns The error to throw.
 */
export function routeNotConfigured(taskKind: string): NotFoundError {
  return new NotFoundError(
    CHAT_PLANE_ERRORS.routeNotConfigured,
    `${taskKind} has no route yet, so there is no primary model to repin. Give it one on the Routing page first.`,
    { taskKind },
  );
}

/**
 * An issue the canonical ticket sync has not stored: a dry run has nothing to be started against.
 *
 * @param reference - The issue as a person names it — `helios-firmware#486`.
 * @returns The error to throw.
 */
export function ticketNotCanonical(reference: string): InvalidRequestError {
  return new InvalidRequestError(
    CHAT_PLANE_ERRORS.ticketNotCanonical,
    `${reference} is mirrored from GitHub but is not in the workspace's ticket sources yet, and a dry run needs the synced ticket. Sync the source, then try again.`,
    { reference },
  );
}

/**
 * No workflow typed, no trigger matching and no estimate suggesting one.
 *
 * @param reference - The issue as a person names it.
 * @param offered - The workflows the workspace offers.
 * @returns The error to throw.
 */
export function workflowUndecided(
  reference: string,
  offered: readonly string[],
): InvalidRequestError {
  return new InvalidRequestError(
    CHAT_PLANE_ERRORS.workflowUndecided,
    `No workflow's trigger claims ${reference} and it has no estimate to suggest one — name the workflow: /ouro dry-run ${reference} <workflow> (${offered.join(", ")}).`,
    { reference, offered },
  );
}

/**
 * The dry-run service's `workflow_draft_absent`, in a dry run's words.
 *
 * The service's own sentence is the publish route's (*"no draft to publish"*); the code and the
 * status are kept, so the record still names the plane's refusal.
 *
 * @param code - The plane's code, kept.
 * @param slug - The workflow.
 * @returns The error to throw.
 */
export function draftAbsentForDryRun(code: string, slug: string): ConflictError {
  return new ConflictError(
    code,
    `${slug} has no open draft, and a dry run rehearses a workflow's draft. Open one in Workflow Copilot, then try again.`,
    { workflow: slug },
  );
}
