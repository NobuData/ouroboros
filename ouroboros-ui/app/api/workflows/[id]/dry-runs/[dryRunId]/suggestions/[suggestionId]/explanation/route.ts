/**
 * `GET /api/workflows/:id/dry-runs/:dryRunId/suggestions/:suggestionId/explanation` — how a suggestion was derived (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)).
 *
 * The card's **Explain**: the rule, its version, the evidence it computed and the scoring. The browser cannot reach `ouroboros-rest`, so this passes the request through over the
 * visitor's session (`app/api/workflow-dry-run-pass.ts`) and answers with the service's own
 * status and body — a refusal included, so the card says the service's sentence.
 */

import { suggestionPath, passDryRun } from "@/app/api/workflow-dry-run-pass";

/** One workspace's dry run, as it is now: never static, never cached. */
export const dynamic = "force-dynamic";

/**
 * Read the explanation.
 *
 * @param request The request.
 * @param context The route's parameters: the workflow's id, the dry run's and the suggestion's.
 * @returns The service's answer, or this hop's own refusal.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string; dryRunId: string; suggestionId: string }> }): Promise<Response> {
  const { id, dryRunId, suggestionId } = await context.params;

  return passDryRun(request, [id, dryRunId, suggestionId], suggestionPath(id, dryRunId, suggestionId, "explanation"));
}
