"use server";

/**
 * The server hops for the generator card (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)) —
 * every write the card makes, and the one read that depends on a choice the reader just made.
 *
 * `app/planning/create-actions.ts` states the rule: the browser cannot reach REST, so a Client
 * Component that needs the API calls a Server Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in any call and no person.** Every batch belongs to the workspace the
 *   caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The role gates are the service's.** Drafting is `owner|admin|member` and pushing is
 *   `owner|admin`; the card draws the controls inert for anyone else, but that is presentation, and
 *   a caller who reaches these anyway gets the service's `403` and writes nothing.
 * - **What is sent is what the card composed**, and the service validates it.
 *
 * A refusal comes back as a value, not a throw, so the card stays where it is and says why. The one
 * throw that must travel is Next.js's redirect signal. A `"use server"` module may export only async
 * functions, so the sentences live in `app/planning/generator.ts`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import {
  type GeneratedPlanningBatch,
  type PlanningBatch,
  type PlanningBatchCreate,
  type PlanningDraftPatch,
  type PlanningMilestones,
  type PlanningPushResult,
  planning,
} from "@/app/api/planning";

/** What one call produced: its value, or the service's refusal. */
export type ActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/** What a push or resume produced: the run's report, and the batch as it stands afterwards. */
export interface PushOutcome {
  /** AL.3's report and the queue-small outcome. */
  readonly result: PlanningPushResult;
  /** The batch re-read after the run, or `null` when that read was refused — the poll catches up. */
  readonly batch: PlanningBatch | null;
}

/**
 * Generate a batch — **Draft tickets ⟳**.
 *
 * @param body What the card composed (`generator.ts`'s `generateBody`).
 * @returns The stored batch and the planner's notes, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function generateBatch(
  body: PlanningBatchCreate,
): Promise<ActionOutcome<GeneratedPlanningBatch>> {
  return settle(() => planning.generate(body));
}

/**
 * Regenerate a batch's unpushed drafts — **Regenerate**. Selections are preserved by local key and
 * pushed drafts are never touched; both are the service's guarantee.
 *
 * @param batchId The batch.
 * @returns The batch and the planner's notes, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function regenerateBatch(
  batchId: string,
): Promise<ActionOutcome<GeneratedPlanningBatch>> {
  return settle(() => planning.regenerate(batchId));
}

/**
 * Select, deselect or edit one draft.
 *
 * @param batchId The batch.
 * @param key The draft's local key.
 * @param body What changes.
 * @returns The batch as it now stands, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function patchDraft(
  batchId: string,
  key: string,
  body: PlanningDraftPatch,
): Promise<ActionOutcome<PlanningBatch>> {
  return settle(() => planning.patchDraft(batchId, key, body));
}

/**
 * Push a batch's selected drafts — or, with `resume`, re-run only the ones that did not land.
 *
 * The batch is read again afterwards so the card draws every row's new state from one answer rather
 * than waiting a poll interval; a refused re-read is not a failed push, so it is `null` rather than
 * a refusal.
 *
 * @param batchId The batch.
 * @param resume Whether this is **Resume push**.
 * @returns The report and the batch after it, or the push's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function pushBatch(
  batchId: string,
  resume: boolean,
): Promise<ActionOutcome<PushOutcome>> {
  const pushed = await settle(() => (resume ? planning.resumePush(batchId) : planning.push(batchId)));

  if (!pushed.ok) return pushed;

  const batch = await settle(() => planning.batch(batchId));

  return { ok: true, value: { result: pushed.value, batch: batch.ok ? batch.value : null } };
}

/**
 * A tracker's open milestones — the **Milestone ▾** options for the tracker just chosen.
 *
 * @param sourceId The ticket source.
 * @returns The milestones, or the refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function readMilestones(sourceId: string): Promise<ActionOutcome<PlanningMilestones>> {
  return settle(() => planning.milestones(sourceId));
}

/**
 * Make one call, keeping the service's refusal as a value.
 *
 * @param call The call.
 * @returns Its value, or the refusal's envelope.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
async function settle<T>(call: () => Promise<T>): Promise<ActionOutcome<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
