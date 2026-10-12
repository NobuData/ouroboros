/**
 * `GET /api/workflows/:id/dry-runs/candidates` — the picker's ranked candidates (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)).
 *
 * Read when the picker opens: each candidate carries the service's reason for its rank. The browser cannot reach `ouroboros-rest`, so this passes the request through over the
 * visitor's session (`app/api/workflow-dry-run-pass.ts`) and answers with the service's own
 * status and body — a refusal included, so the card says the service's sentence.
 */

import { candidatesPath, passDryRun } from "@/app/api/workflow-dry-run-pass";

/** One workspace's dry run, as it is now: never static, never cached. */
export const dynamic = "force-dynamic";

/**
 * Read the candidates.
 *
 * @param request The request.
 * @param context The route's parameters: the workflow's id.
 * @returns The service's answer, or this hop's own refusal.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  return passDryRun(request, [id], candidatesPath(id));
}
