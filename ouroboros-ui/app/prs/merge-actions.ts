"use server";

/**
 * The server hop for the Merge plan card — its edits, *Merge when all gates green*, *Disarm* and
 * *Merge now* ([#369](https://github.com/NobuData/ouroboros/issues/369), over AX.4's
 * [#360](https://github.com/NobuData/ouroboros/issues/360)).
 *
 * `head-actions.ts` states the rule this exists under, and it matters most here, because these
 * are the actions that end in an irreversible merge:
 *
 * - **The role gate is the service's.** Arming, merging and editing are `owner` or `admin` — or a
 *   `member` whose PR's pinned workflow auto-merges — and disarming is any contributor's. The
 *   page draws no control a reader may not use, and one who calls this anyway gets the service's
 *   `403`, handed back as a refusal.
 * - **Whether a PR can merge is the service's.** The confirmation states what the page read; the
 *   executor re-checks the gates, the head and the host inside the transaction that holds the PR,
 *   and nothing here can merge around it.
 * - **Only the plan's five editable fields are sent.** An edit is rebuilt from the fields it
 *   may carry, so this hop cannot change a strategy, arm a plan or write a result.
 * - **Ids and the message are checked before they are sent.**
 *
 * A refusal is a value, because the page is one the reader is still entitled to be on. A refusal
 * by the re-check carries its designed code, so the card says *which* check failed.
 */

import { isApiError } from "@/app/api/errors";
import { isPullRequestId, pullRequests } from "@/app/api/pull-requests";

import { MAX_COMMIT_MESSAGE_LENGTH } from "./merge-message";
import {
  ACTION_INVALID,
  ACTION_INVALID_CODE,
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  type MergeOutcome,
  type MergeRefusal,
  type PlanEdit,
  type PlanOutcome,
  RECHECK_FAILED_CODE,
} from "./outcomes";

/** The refusal for a request that could not have come from the page. */
const INVALID: MergeRefusal = {
  ok: false,
  status: 422,
  code: ACTION_INVALID_CODE,
  reason: ACTION_INVALID,
  recheck: null,
};

/**
 * What a failed call is handed back as.
 *
 * @param error What the call threw.
 * @returns The refusal, in the service's own words when it answered — with the re-check's code
 *   and whether it disarmed, when the re-check is what refused.
 * @throws Whatever is not an `ApiError` or a dropped connection — Next.js's redirect signal for an
 *   ended session above all.
 */
function refusalOf(error: unknown): MergeRefusal {
  if (isApiError(error)) {
    const { reason, disarmed } = error.details as { reason?: unknown; disarmed?: unknown };

    return {
      ok: false,
      status: error.status,
      code: error.code,
      reason: error.message,
      recheck:
        error.code === RECHECK_FAILED_CODE && typeof reason === "string"
          ? { code: reason, disarmed: disarmed === true }
          : null,
    };
  }

  if (error instanceof TypeError) {
    return {
      ok: false,
      status: 502,
      code: ACTION_UNREACHABLE_CODE,
      reason: ACTION_UNREACHABLE,
      recheck: null,
    };
  }

  throw error;
}

/**
 * An edit, rebuilt from only the fields it may carry.
 *
 * @param edit What arrived.
 * @returns The fields that were sent, each checked — or `null` for anything the card could not
 *   have built: no field at all, a message that is empty, padded or too long, a toggle that is
 *   not a boolean, or an epic that is neither an id nor `null`.
 */
function editOf(edit: unknown): PlanEdit | null {
  if (typeof edit !== "object" || edit === null) return null;

  const { commitMessage, closeTicket, commentEvidence, backAnnotateEpic, epicId } =
    edit as Partial<Record<keyof PlanEdit, unknown>>;
  const sent: { -readonly [Field in keyof PlanEdit]: PlanEdit[Field] } = {};

  if (commitMessage !== undefined) {
    if (
      typeof commitMessage !== "string" ||
      commitMessage.length === 0 ||
      commitMessage.length > MAX_COMMIT_MESSAGE_LENGTH ||
      commitMessage.trim() !== commitMessage
    ) {
      return null;
    }

    sent.commitMessage = commitMessage;
  }

  for (const [field, value] of [
    ["closeTicket", closeTicket],
    ["commentEvidence", commentEvidence],
    ["backAnnotateEpic", backAnnotateEpic],
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== "boolean") return null;

    sent[field] = value;
  }

  if (epicId !== undefined) {
    if (epicId !== null && !isPullRequestId(epicId)) return null;

    sent.epicId = epicId;
  }

  return Object.keys(sent).length === 0 ? null : sent;
}

/**
 * Edit a PR's merge plan — the message, a toggle or the epic.
 *
 * @param prId The PR.
 * @param edit What to change.
 * @returns The plan, as edited — or the reason nothing changed.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function editPlan(prId: string, edit: PlanEdit): Promise<PlanOutcome> {
  const sent = editOf(edit);

  if (!isPullRequestId(prId) || sent === null) return INVALID;

  try {
    return { ok: true, answer: await pullRequests.editMergePlan(prId, sent) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Arm a PR's merge plan against the revision the confirmation stated.
 *
 * @param prId The PR.
 * @param revisionId The revision whose gates the reader looked at.
 * @returns The armed plan — or the reason nothing was armed.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function armPlan(prId: string, revisionId: string): Promise<PlanOutcome> {
  if (!isPullRequestId(prId) || !isPullRequestId(revisionId)) return INVALID;

  try {
    return { ok: true, answer: await pullRequests.armMergePlan(prId, revisionId) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Disarm a PR's merge plan.
 *
 * @param prId The PR.
 * @returns The plan, disarmed — or the reason it was not.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function disarmPlan(prId: string): Promise<PlanOutcome> {
  if (!isPullRequestId(prId)) return INVALID;

  try {
    return { ok: true, answer: await pullRequests.disarmMergePlan(prId) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Merge a PR now, through the executor's re-check.
 *
 * @param prId The PR.
 * @returns What the merge did — or why the re-check refused it.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function mergeNow(prId: string): Promise<MergeOutcome> {
  if (!isPullRequestId(prId)) return INVALID;

  try {
    return { ok: true, answer: await pullRequests.merge(prId) };
  } catch (error) {
    return refusalOf(error);
  }
}
