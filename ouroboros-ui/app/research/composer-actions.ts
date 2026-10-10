"use server";

/**
 * The server hops for the investigation composer (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)) — the calls its Client Component
 * cannot make itself. `app/sources/actions.ts` states the rule this exists under: the browser
 * cannot reach `ouroboros-rest`, so a Client Component that needs something from the API calls
 * a Server Action that calls it.
 *
 * ### Four hops
 * - **Estimate** — every change of kind or tool asks for *every depth's* estimate at once, so the
 *   Depth menu can print each option's budget and the line can switch depth without another
 *   round trip. Three calls to `POST /research/estimates`, which creates nothing.
 * - **Start**, **cancel** and one **read** of the investigation — the lifecycle's own routes.
 *
 * ### Failure posture: a value, not a throw
 * A refusal comes back as a value with the service's own code and sentence, because every one
 * of these is pressed on a page the reader is still entitled to be on. The one throw that must
 * travel is Next.js's redirect signal, for a session that expired since the page rendered.
 *
 * ### The gate is the service's
 * The card draws **Start investigation** inert for a viewer, or for a member where the workspace
 * lets only admins start — but that is presentation. The check that decides is behind the API,
 * and a reader who reaches this action anyway gets the service's `403` and starts nothing.
 *
 * **Every value this module needs is imported rather than declared**: a `"use server"` module
 * may export nothing but async functions, so the outcome types live in `composer.ts`.
 */

import { isApiError } from "@/app/api/errors";
import {
  type InvestigationDepth,
  type InvestigationEstimateRequest,
  type ScopeEstimate,
  research,
} from "@/app/api/research";

import {
  type CancelOutcome,
  type ComposerRefusal,
  DEPTHS,
  type DepthEstimates,
  type DetailOutcome,
  type EstimateOutcome,
  type StartOutcome,
  runOf,
} from "./composer";

/**
 * The service's refusal, as the card renders it.
 *
 * @param error What the client threw.
 * @returns The code and the sentence.
 * @throws Whatever is not an `ApiError` — a dropped connection, the redirect signal.
 */
function refusalOf(error: unknown): ComposerRefusal {
  if (!isApiError(error)) throw error;

  return { code: error.code, message: error.message };
}

/**
 * Estimate the composer's choices at every depth.
 *
 * @param request The kind and the tools that are on — at least one, or the service refuses.
 * @returns Each depth's estimate, or the service's refusal (an unknown kind or tool is a `404`
 *   or `422` naming the slug).
 * @throws Whatever is not an `ApiError`.
 */
export async function estimateComposer(
  request: Omit<InvestigationEstimateRequest, "depth">,
): Promise<EstimateOutcome> {
  try {
    const answers = await Promise.all(
      DEPTHS.map(
        async (depth): Promise<[InvestigationDepth, ScopeEstimate]> => [
          depth,
          await research.estimate({ ...request, depth }),
        ],
      ),
    );

    return { ok: true, estimates: Object.fromEntries(answers) as DepthEstimates };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}

/**
 * Start an investigation.
 *
 * @param body The question, the kind, the depth and the tools that are on.
 * @returns The run to follow, or the service's refusal. **A refusal means nothing was started**
 *   — or, for a dispatch the engine refused, a row the service already cancelled.
 * @throws Whatever is not an `ApiError`.
 */
export async function startInvestigation(
  body: Parameters<typeof research.start>[0],
): Promise<StartOutcome> {
  try {
    return { ok: true, run: runOf(await research.start(body)) };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}

/**
 * Stop an investigation. What it gathered is kept.
 *
 * @param investigationId The investigation.
 * @returns `cancelled` or `cancelling` and the run as it stands, or the service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function cancelInvestigation(investigationId: string): Promise<CancelOutcome> {
  try {
    const answer = await research.cancel(investigationId);
    const run = runOf({ investigation: answer.investigation, estimate: { label: "" } });

    return { ok: true, state: answer.state, run };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}

/**
 * Read an investigation — what the card does once its stream says the run has ended, for the
 * failure reason and the recorded actuals the stream does not carry.
 *
 * @param investigationId The investigation.
 * @returns The detail, or the service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function readInvestigation(investigationId: string): Promise<DetailOutcome> {
  try {
    return { ok: true, detail: await research.investigation(investigationId) };
  } catch (error) {
    return { ok: false, refusal: refusalOf(error) };
  }
}
