/**
 * The investigation lifecycle's own refusals (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)).
 *
 * The rest of what these routes can answer is raised by what they call: the estimator's
 * `investigation_kind_not_found`, `research_tool_unknown` and `research_tools_required`
 * (`research.errors.ts`), the loop's `investigation_not_cancellable`,
 * `investigation_researcher_unavailable` and `investigation_tools_unavailable`
 * (`loop/investigation-loop.errors.ts`), and the engine's `engine_unavailable`.
 */

import { ConflictError, ForbiddenError } from "../../errors/error.envelope";
import { INVESTIGATION_LOOP_ERRORS } from "../loop/investigation-loop.errors";

export const LIFECYCLE_ERRORS = {
  /** Only the person who started an investigation, or an administrator, may cancel it. `403`. */
  cancelForbidden: "investigation_cancel_forbidden",
  /** Routing resolves no researcher, so nothing was created. `409` — the loop's own code. */
  researcherUnrouted: INVESTIGATION_LOOP_ERRORS.researcherUnavailable,
} as const;

/**
 * `403` — the caller neither started the investigation nor administers the workspace.
 *
 * @param investigation - `RS-127`.
 * @returns The error.
 */
export function cancelForbidden(investigation: string): ForbiddenError {
  return new ForbiddenError(
    LIFECYCLE_ERRORS.cancelForbidden,
    "Only the person who started this investigation, or a workspace owner or admin, may cancel it.",
    { investigation, required: ["starter", "owner", "admin"] },
  );
}

/**
 * `409` — routing resolves no model for `research`, so an investigation could not run. Raised
 * before anything is created; the code is the loop's own, so a client handles one refusal.
 *
 * @param kind - The kind that was asked for.
 * @returns The error.
 */
export function researcherUnrouted(kind: string): ConflictError {
  return new ConflictError(
    LIFECYCLE_ERRORS.researcherUnrouted,
    "Routing resolves no model for research in this workspace. Add a route for the research task kind.",
    { kind },
  );
}
