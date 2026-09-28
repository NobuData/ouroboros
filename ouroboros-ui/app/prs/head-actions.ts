"use server";

/**
 * The server hop for *Request human review* and *Return to loop*
 * ([#363](https://github.com/NobuData/ouroboros/issues/363), over AX.5's
 * [#361](https://github.com/NobuData/ouroboros/issues/361)).
 *
 * `app/runs/control-actions.ts` states the rule this exists under: the browser cannot reach
 * `ouroboros-rest`, so a Client Component that needs to write calls a Server Action that calls
 * it. A Server Action is a POST endpoint anybody holding the page can reach with any arguments,
 * so:
 *
 * - **The role gate is the service's.** A head action is `owner`, `admin` or `member`; the page
 *   draws none for a viewer, and a viewer who calls this anyway gets the service's `403`, handed
 *   back as a refusal.
 * - **Whether a gate is red is the service's.** The dialog lists the red gates it was shown; the
 *   service re-reads them and refuses one that is not red (`422 pr_gate_not_red`).
 * - **Ids and gate keys are checked before they are sent**; anything else is refused before
 *   calling out.
 *
 * A refusal is a value, because the page is one the reader is still entitled to be on.
 */

import { isApiError } from "@/app/api/errors";
import { isPullRequestId, pullRequests } from "@/app/api/pull-requests";

import {
  ACTION_INVALID,
  ACTION_INVALID_CODE,
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  GATE_KEY_PATTERN,
  MAX_REPLAY_KEY_LENGTH,
  MAX_RETURNED_GATES,
  type ActionRefusal,
  type ReturnOutcome,
  type ReturnSelection,
  type ReviewRequestOutcome,
} from "./outcomes";

/** The refusal for a request that could not have come from the page. */
const INVALID: ActionRefusal = {
  ok: false,
  status: 422,
  code: ACTION_INVALID_CODE,
  reason: ACTION_INVALID,
};

/**
 * What a failed call is handed back as.
 *
 * @param error What the call threw.
 * @returns The refusal, in the service's own words when it answered.
 * @throws Whatever is not an `ApiError` or a dropped connection — Next.js's redirect signal for an
 *   ended session above all.
 */
function refusalOf(error: unknown): ActionRefusal {
  if (isApiError(error)) {
    return { ok: false, status: error.status, code: error.code, reason: error.message };
  }

  if (error instanceof TypeError) {
    return {
      ok: false,
      status: 502,
      code: ACTION_UNREACHABLE_CODE,
      reason: ACTION_UNREACHABLE,
    };
  }

  throw error;
}

/**
 * Whether a selection could have come from the dialog.
 *
 * @param selection What arrived.
 * @returns `true` for one to {@link MAX_RETURNED_GATES} distinct gate keys, a revision id, and a
 *   replay key that is absent or a bounded, unpadded string.
 */
function isSelection(selection: unknown): selection is ReturnSelection {
  if (typeof selection !== "object" || selection === null) return false;

  const { gates, revisionId, replayKey } = selection as Partial<ReturnSelection>;

  return (
    Array.isArray(gates) &&
    gates.length > 0 &&
    gates.length <= MAX_RETURNED_GATES &&
    new Set(gates).size === gates.length &&
    gates.every((key) => typeof key === "string" && GATE_KEY_PATTERN.test(key)) &&
    isPullRequestId(revisionId) &&
    (replayKey === undefined ||
      (typeof replayKey === "string" &&
        replayKey.length > 0 &&
        replayKey.length <= MAX_REPLAY_KEY_LENGTH &&
        replayKey.trim() === replayKey))
  );
}

/**
 * Request a human review of a PR.
 *
 * @param prId The PR.
 * @returns The approval slot and the re-evaluated gate, or the reason nothing was requested. A
 *   press on a PR whose review is already waiting answers that slot — the service opens no second
 *   one.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function requestHumanReview(prId: string): Promise<ReviewRequestOutcome> {
  if (!isPullRequestId(prId)) return INVALID;

  try {
    return { ok: true, outcome: await pullRequests.requestReview(prId) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Send the selected red gates' evidence back to the loop.
 *
 * @param prId The PR.
 * @param selection The gates, the revision they were selected on, and the press's replay key.
 * @returns The queued correction round, or the reason nothing was queued.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function returnToLoop(
  prId: string,
  selection: ReturnSelection,
): Promise<ReturnOutcome> {
  if (!isPullRequestId(prId) || !isSelection(selection)) return INVALID;

  try {
    return {
      ok: true,
      answer: await pullRequests.returnToLoop(prId, {
        gates: [...selection.gates],
        revisionId: selection.revisionId,
        ...(selection.replayKey === undefined ? {} : { idempotencyKey: selection.replayKey }),
      }),
    };
  } catch (error) {
    return refusalOf(error);
  }
}
