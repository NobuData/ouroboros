/**
 * The refusals of the classification & routing service — AT.4
 * ([#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * Each names what the caller can fix. An attempt or a case of another workspace is `404` like an
 * absent one, as everywhere under tenant context.
 */

import type { TestCaseStatus } from "../db/schema";
import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

export const TRIAGE_ERRORS = {
  /** No such attempt in this workspace. */
  testRunNotFound: "test_run_not_found",

  /** No such case in this attempt. */
  testCaseNotFound: "test_case_not_found",

  /** A case that passed or was skipped has nothing to classify (V055). */
  testCaseNotFailing: "test_case_not_failing",

  /** A correction round with no correction: `product_bug` and `test_update` carry a note. */
  classificationNoteRequired: "classification_note_required",

  /** A toggle that belongs to another class — `requeue` is the infra route's. */
  classificationToggleInvalid: "classification_toggle_invalid",

  /** A re-run whose case set is empty: *Re-run failed* on an attempt with nothing failed. */
  rerunNothingSelected: "rerun_nothing_selected",

  /** No attempt of the run was built on the farm, so there is no build to re-run. */
  rerunSourceMissing: "rerun_source_missing",

  /** A waiver naming a case that is not in this attempt. */
  waiverCasesInvalid: "waiver_cases_invalid",
} as const;

/**
 * @param testRunId - The attempt asked for.
 * @returns `404 test_run_not_found`.
 */
export function testRunNotFound(testRunId: string): NotFoundError {
  return new NotFoundError(TRIAGE_ERRORS.testRunNotFound, "No such test run in this workspace.", {
    testRunId,
  });
}

/**
 * @param testRunId - The attempt.
 * @param caseId - The case asked for.
 * @returns `404 test_case_not_found`.
 */
export function testCaseNotFound(testRunId: string, caseId: string): NotFoundError {
  return new NotFoundError(TRIAGE_ERRORS.testCaseNotFound, "No such test case in this test run.", {
    testRunId,
    caseId,
  });
}

/**
 * @param caseId - The case.
 * @param status - What it is.
 * @returns `409 test_case_not_failing`.
 */
export function testCaseNotFailing(caseId: string, status: TestCaseStatus): ConflictError {
  return new ConflictError(
    TRIAGE_ERRORS.testCaseNotFailing,
    `The case is ${status}; only a failed, error or flaky case can be classified.`,
    { caseId, status },
  );
}

/**
 * @param failureClass - The class that queues a correction round.
 * @returns `422 classification_note_required`.
 */
export function classificationNoteRequired(failureClass: string): InvalidRequestError {
  return new InvalidRequestError(
    TRIAGE_ERRORS.classificationNoteRequired,
    "Say what the next attempt should do differently — the note is its planning context.",
    { class: failureClass, field: "note" },
  );
}

/**
 * @param toggle - The toggle.
 * @param failureClass - The class it was sent with.
 * @returns `422 classification_toggle_invalid`.
 */
export function classificationToggleInvalid(
  toggle: string,
  failureClass: string,
): InvalidRequestError {
  return new InvalidRequestError(
    TRIAGE_ERRORS.classificationToggleInvalid,
    `${toggle} applies only to an infra_rig classification.`,
    { class: failureClass, field: `toggles.${toggle}` },
  );
}

/**
 * @param testRunId - The attempt.
 * @param scope - `failed` or `full`.
 * @returns `409 rerun_nothing_selected`.
 */
export function rerunNothingSelected(testRunId: string, scope: string): ConflictError {
  return new ConflictError(
    TRIAGE_ERRORS.rerunNothingSelected,
    scope === "failed" ? "Nothing failed in this test run." : "This test run has no cases.",
    { testRunId, scope },
  );
}

/**
 * @param testRunId - The attempt.
 * @returns `409 rerun_source_missing`.
 */
export function rerunSourceMissing(testRunId: string): ConflictError {
  return new ConflictError(
    TRIAGE_ERRORS.rerunSourceMissing,
    "No attempt of this run was built on the farm, so there is no build to re-run.",
    { testRunId },
  );
}

/**
 * @param caseIds - The ids that are not cases of the attempt.
 * @returns `422 waiver_cases_invalid`.
 */
export function waiverCasesInvalid(caseIds: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    TRIAGE_ERRORS.waiverCasesInvalid,
    "A waiver names only cases of this test run.",
    { caseIds: [...caseIds] },
  );
}
