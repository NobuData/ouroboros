/**
 * `POST /api/workflows/:id/dry-runs` — start a dry run of the draft (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)).
 *
 * The card's **Dry-run another issue** and its empty state's invitation: `{ticketId, draftRev, sessionId?}`. A pre-check that fails is a `201` whose run is `failed` with its findings. The browser cannot reach `ouroboros-rest`, so this passes the request through over the
 * visitor's session (`app/api/workflow-dry-run-pass.ts`) and answers with the service's own
 * status and body — a refusal included, so the card says the service's sentence.
 */

import { dryRunsPath, passDryRun } from "@/app/api/workflow-dry-run-pass";

/** One workspace's dry run, as it is now: never static, never cached. */
export const dynamic = "force-dynamic";

/**
 * Start a dry run.
 *
 * @param request The request.
 * @param context The route's parameters: the workflow's id.
 * @returns The service's answer, or this hop's own refusal.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  return passDryRun(request, [id], dryRunsPath(id));
}
