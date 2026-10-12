/**
 * `POST /api/workflows/:id/dry-runs/:dryRunId/suggestions/:suggestionId/ignore` — ignore a suggestion, for good (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)).
 *
 * The card's **Ignore**: the resolution is stored, so the callout does not come back. The browser cannot reach `ouroboros-rest`, so this passes the request through over the
 * visitor's session (`app/api/workflow-dry-run-pass.ts`) and answers with the service's own
 * status and body — a refusal included, so the card says the service's sentence.
 */

import { suggestionPath, passDryRun } from "@/app/api/workflow-dry-run-pass";

/** One workspace's dry run, as it is now: never static, never cached. */
export const dynamic = "force-dynamic";

/**
 * Ignore the suggestion.
 *
 * @param request The request.
 * @param context The route's parameters: the workflow's id, the dry run's and the suggestion's.
 * @returns The service's answer, or this hop's own refusal.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; dryRunId: string; suggestionId: string }> }): Promise<Response> {
  const { id, dryRunId, suggestionId } = await context.params;

  return passDryRun(request, [id, dryRunId, suggestionId], suggestionPath(id, dryRunId, suggestionId, "ignore"));
}
