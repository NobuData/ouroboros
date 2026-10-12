/**
 * `POST /api/workflows/:id/dry-runs/:dryRunId/cancel` — stop a dry run that is in flight (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)).
 *
 * The rows so far are kept; a run that has already ended answers `409 dry_run_not_running`. The browser cannot reach `ouroboros-rest`, so this passes the request through over the
 * visitor's session (`app/api/workflow-dry-run-pass.ts`) and answers with the service's own
 * status and body — a refusal included, so the card says the service's sentence.
 */

import { dryRunPath, passDryRun } from "@/app/api/workflow-dry-run-pass";

/** One workspace's dry run, as it is now: never static, never cached. */
export const dynamic = "force-dynamic";

/**
 * Cancel the dry run.
 *
 * @param request The request.
 * @param context The route's parameters: the workflow's id and the dry run's.
 * @returns The service's answer, or this hop's own refusal.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; dryRunId: string }> }): Promise<Response> {
  const { id, dryRunId } = await context.params;

  return passDryRun(request, [id, dryRunId], dryRunPath(id, dryRunId, "cancel"));
}
