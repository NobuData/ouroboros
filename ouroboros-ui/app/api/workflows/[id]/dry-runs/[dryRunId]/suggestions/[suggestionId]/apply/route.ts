/**
 * `POST /api/workflows/:id/dry-runs/:dryRunId/suggestions/:suggestionId/apply` — apply a suggestion's operations to the draft (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)).
 *
 * The card's **Apply to draft**, after its preview: the answer names the revision it made. A draft that moved answers `409 dry_run_suggestion_conflict` and nothing is written. The browser cannot reach `ouroboros-rest`, so this passes the request through over the
 * visitor's session (`app/api/workflow-dry-run-pass.ts`) and answers with the service's own
 * status and body — a refusal included, so the card says the service's sentence.
 */

import { suggestionPath, passDryRun } from "@/app/api/workflow-dry-run-pass";

/** One workspace's dry run, as it is now: never static, never cached. */
export const dynamic = "force-dynamic";

/**
 * Apply the suggestion.
 *
 * @param request The request.
 * @param context The route's parameters: the workflow's id, the dry run's and the suggestion's.
 * @returns The service's answer, or this hop's own refusal.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; dryRunId: string; suggestionId: string }> }): Promise<Response> {
  const { id, dryRunId, suggestionId } = await context.params;

  return passDryRun(request, [id, dryRunId, suggestionId], suggestionPath(id, dryRunId, suggestionId, "apply"));
}
