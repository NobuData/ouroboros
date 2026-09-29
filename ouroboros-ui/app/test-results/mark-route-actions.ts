"use server";

/**
 * The server hop for the Mark & Route card — a classification, a waiver and the two PR toggles
 * ([#340](https://github.com/NobuData/ouroboros/issues/340), over AT.4's
 * [#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * `rerun-actions.ts` states the rule this exists under, and it matters most here, because these
 * are the actions that change what an agent does next:
 *
 * - **The role gate is the service's.** Classifying and the toggles are `owner`, `admin` or
 *   `member`; a waiver is `owner` or `admin`. The card draws no waive action for a member and no
 *   form for a viewer, and one who calls this anyway gets the service's `403`, handed back as a
 *   refusal — *hidden and refused*.
 * - **Only what the card may send is sent.** A decision is rebuilt from its class and its note,
 *   so this hop cannot requeue a build, set a subtype or carry a toggle; a toggle is one of two
 *   fields and a boolean.
 * - **Ids are checked before they are put in a path**, and **a correction round is refused
 *   without a correction** before calling out — the service refuses it too.
 *
 * A refusal is a value, because the page is one the reader is still entitled to be on.
 */

import { isApiError } from "@/app/api/errors";
import { isRunId } from "@/app/api/runs";
import { isTestCaseId, isTestRunId, testResults } from "@/app/api/test-results";

import { MAX_NOTE_LENGTH } from "./mark-route";
import { asFailureClass, isCorrection } from "./mark-route-pick";
import {
  type ClassifyOutcome,
  type IntentsOutcome,
  ROUTE_INVALID,
  ROUTE_INVALID_CODE,
  ROUTE_UNREACHABLE,
  ROUTE_UNREACHABLE_CODE,
  type RouteRefusal,
  type WaiveOutcome,
} from "./mark-route-outcomes";

/** The refusal for a request that could not have come from the card. */
const INVALID: RouteRefusal = {
  ok: false,
  status: 422,
  code: ROUTE_INVALID_CODE,
  reason: ROUTE_INVALID,
};

/**
 * What a failed call is handed back as.
 *
 * @param error What the call threw.
 * @returns The refusal, in the service's own words when it answered.
 * @throws Whatever is not an `ApiError` or a dropped connection — Next.js's redirect signal for an
 *   ended session above all.
 */
function refusalOf(error: unknown): RouteRefusal {
  if (isApiError(error)) {
    return { ok: false, status: error.status, code: error.code, reason: error.message };
  }

  if (error instanceof TypeError) {
    return { ok: false, status: 502, code: ROUTE_UNREACHABLE_CODE, reason: ROUTE_UNREACHABLE };
  }

  throw error;
}

/**
 * Text as the service stores it.
 *
 * @param value What arrived.
 * @returns The text trimmed — or `null` for anything that is not text, is blank, or is longer
 *   than the service keeps.
 */
function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return trimmed === "" || trimmed.length > MAX_NOTE_LENGTH ? null : trimmed;
}

/**
 * Classify a failing case, and route the decision.
 *
 * @param testRunId The attempt.
 * @param caseId The case.
 * @param decision The class and the note — rebuilt here from those two fields alone.
 * @returns The recorded decision with its receipt and what routing did, or the reason nothing
 *   was recorded.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function classifyFailure(
  testRunId: string,
  caseId: string,
  decision: unknown,
): Promise<ClassifyOutcome> {
  if (!isTestRunId(testRunId) || !isTestCaseId(caseId)) return INVALID;
  if (typeof decision !== "object" || decision === null) return INVALID;

  const sent = decision as { class?: unknown; note?: unknown };
  const failureClass = asFailureClass(sent.class);
  if (failureClass === null) return INVALID;

  // A note that was sent and cannot be stored is refused; one that was not sent is no note.
  const stated = sent.note !== undefined && sent.note !== null;
  const note = textOf(sent.note);
  if ((stated && note === null) || (isCorrection(failureClass) && note === null)) return INVALID;

  try {
    return {
      ok: true,
      result: await testResults.classify(testRunId, caseId, {
        class: failureClass,
        ...(note === null ? {} : { note }),
      }),
    };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Record a waiver of one failing case.
 *
 * @param testRunId The attempt.
 * @param caseId The case waived.
 * @param reason Why — required.
 * @returns The waiver, or the reason none was recorded.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function waiveFailure(
  testRunId: string,
  caseId: string,
  reason: string,
): Promise<WaiveOutcome> {
  const why = textOf(reason);
  if (!isTestRunId(testRunId) || !isTestCaseId(caseId) || why === null) return INVALID;

  try {
    return {
      ok: true,
      waiver: await testResults.waive(testRunId, { reason: why, caseIds: [caseId] }),
    };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Set one of the run's two PR toggles.
 *
 * @param runId The run.
 * @param change The toggle and what it is set to — rebuilt here from those two fields alone.
 * @returns Both toggles as stored, or the reason nothing was stored.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function setRunIntent(runId: string, change: unknown): Promise<IntentsOutcome> {
  if (!isRunId(runId) || typeof change !== "object" || change === null) return INVALID;

  const { field, value } = change as { field?: unknown; value?: unknown };
  if (field !== "blockUntilGreen" && field !== "autoRerunPhysical") return INVALID;
  if (typeof value !== "boolean") return INVALID;

  try {
    return {
      ok: true,
      intents: await testResults.setIntents(
        runId,
        field === "blockUntilGreen" ? { blockUntilGreen: value } : { autoRerunPhysical: value },
      ),
    };
  } catch (error) {
    return refusalOf(error);
  }
}
