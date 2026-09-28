"use server";

/**
 * The server hop for the acceptance criteria matrix
 * ([#366](https://github.com/NobuData/ouroboros/issues/366), over AX.3's
 * [#359](https://github.com/NobuData/ouroboros/issues/359)): *Add claim*, *Import from plan*,
 * *Attach evidence* and the picker's read, *Verify*, and *Waive*.
 *
 * `head-actions.ts` states the rule this exists under, and it holds here unchanged:
 *
 * - **The role gate is the service's.** Authoring, citing and verifying are `owner`, `admin` or
 *   `member`; waiving is `owner` or `admin`. The page draws no control a reader may not use, and
 *   one who calls this anyway gets the service's `403`, handed back as a refusal.
 * - **Whether a reference resolves is the service's.** The picker offers only rows that exist;
 *   the service resolves each again and refuses one that does not (`422 evidence_unresolved`).
 * - **Whether a claim has evidence is the service's.** *Verify* is inert on the page while
 *   nothing is cited; the service refuses it regardless (`409 criterion_evidence_required`).
 * - **Ids, claims, reasons and references are checked before they are sent**; anything that
 *   could not have come from the page is refused before calling out.
 *
 * A refusal is a value, because the page is one the reader is still entitled to be on.
 */

import { isApiError } from "@/app/api/errors";
import {
  type AttachEvidenceRequest,
  isPullRequestId,
  pullRequests,
} from "@/app/api/pull-requests";
import { testResults } from "@/app/api/test-results";

import {
  CASE_KEY_PATTERN,
  MAX_QUALIFIER_LENGTH,
  NO_ATTEMPT_TO_CITE,
  NO_RUN_TO_CITE,
  attemptOptions,
  noOptions,
  pickerAttempt,
} from "./evidence-options";
import { isHunk } from "./hunk";
import {
  ACTION_INVALID,
  ACTION_INVALID_CODE,
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  MAX_CLAIM_LENGTH,
  MAX_WAIVE_REASON_LENGTH,
  type ActionRefusal,
  type CriterionOutcome,
  type ImportOutcome,
  type OptionsOutcome,
  type WaiveOutcome,
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
 * Whether a value is text the service would accept — a claim, a reason, a qualifier.
 *
 * @param value What arrived.
 * @param limit The most characters it may have.
 * @returns `true` for a string that is neither empty, padded nor over the limit.
 */
function isText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    value.trim() === value
  );
}

/**
 * The reference a request carries, rebuilt from only the fields its kind has.
 *
 * @param request What arrived.
 * @returns The reference to send — one of the picker's three kinds, each field checked — or
 *   `null` for anything the picker could not have built.
 */
function referenceOf(request: unknown): AttachEvidenceRequest | null {
  if (typeof request !== "object" || request === null) return null;

  const { kind, caseKey, testRunId, hilMeasurementId, revisionId, note, path, lineStart, lineEnd } =
    request as Partial<AttachEvidenceRequest>;

  if (note !== undefined && !isText(note, MAX_QUALIFIER_LENGTH)) return null;

  const qualifier = note === undefined ? {} : { note };

  switch (kind) {
    case "test_case":
      return typeof caseKey === "string" &&
        CASE_KEY_PATTERN.test(caseKey) &&
        isPullRequestId(testRunId)
        ? { kind, caseKey, testRunId, ...qualifier }
        : null;
    case "hil_measurement":
      return isPullRequestId(hilMeasurementId) ? { kind, hilMeasurementId, ...qualifier } : null;
    case "hunk": {
      const hunk = { path, lineStart, lineEnd };
      if (!isHunk(hunk)) return null;
      if (revisionId !== undefined && !isPullRequestId(revisionId)) return null;

      return { kind, ...hunk, ...(revisionId === undefined ? {} : { revisionId }), ...qualifier };
    }
    default:
      return null;
  }
}

/**
 * Add a claim to a PR's matrix — `manual`, unverified, last.
 *
 * @param prId The PR.
 * @param claim The claim, neither empty nor padded.
 * @returns The claim, or the reason nothing was written.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function addClaim(prId: string, claim: string): Promise<CriterionOutcome> {
  if (!isPullRequestId(prId) || !isText(claim, MAX_CLAIM_LENGTH)) return INVALID;

  try {
    return { ok: true, answer: await pullRequests.createCriterion(prId, claim) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Import the acceptance criteria the ticket's plan states.
 *
 * @param prId The PR.
 * @returns What was written and what was not, or the reason nothing was — a PR with no plan to
 *   read answers `409 plan_context_missing`.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function importFromPlan(prId: string): Promise<ImportOutcome> {
  if (!isPullRequestId(prId)) return INVALID;

  try {
    return { ok: true, answer: await pullRequests.importCriteria(prId) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Read what the evidence picker offers: the tests and the measurements of the attempt the PR's
 * latest revision was judged on.
 *
 * The PR is read here rather than trusted from the page, so the rows offered are the rows of
 * *this* PR's run and revision whatever the caller holds.
 *
 * @param prId The PR.
 * @returns The options — with the reason there are none for a PR no loop opened or a run never
 *   tested — or the reason they could not be read.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function readEvidenceOptions(prId: string): Promise<OptionsOutcome> {
  if (!isPullRequestId(prId)) return INVALID;

  try {
    const page = await pullRequests.page(prId);
    const run = page.pullRequest.run;
    if (run === null) return { ok: true, answer: noOptions(NO_RUN_TO_CITE) };

    const attempt = pickerAttempt(page, (await testResults.timeline(run.id)).attempts);
    if (attempt === null) return { ok: true, answer: noOptions(NO_ATTEMPT_TO_CITE) };

    return { ok: true, answer: attemptOptions(attempt, await testResults.page(attempt.id)) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Cite one piece of evidence for a claim.
 *
 * @param prId The PR.
 * @param criterionId The claim.
 * @param request The reference — a test, a measurement or a hunk.
 * @returns The claim with the citation among its evidence, or the reason nothing was cited.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function attachEvidence(
  prId: string,
  criterionId: string,
  request: AttachEvidenceRequest,
): Promise<CriterionOutcome> {
  const reference = referenceOf(request);

  if (!isPullRequestId(prId) || !isPullRequestId(criterionId) || reference === null) {
    return INVALID;
  }

  try {
    return { ok: true, answer: await pullRequests.attachEvidence(prId, criterionId, reference) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Mark a claim verified.
 *
 * @param prId The PR.
 * @param criterionId The claim.
 * @returns The claim, verified, or the reason it was not — a claim with no evidence answers
 *   `409 criterion_evidence_required`.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function verifyClaim(prId: string, criterionId: string): Promise<CriterionOutcome> {
  if (!isPullRequestId(prId) || !isPullRequestId(criterionId)) return INVALID;

  try {
    return { ok: true, answer: await pullRequests.verifyCriterion(prId, criterionId) };
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Waive a claim, and annotate the host PR.
 *
 * @param prId The PR.
 * @param criterionId The claim.
 * @param reason Why, neither empty nor padded.
 * @returns The claim, waived, and what the host did with the annotation — or the reason nothing
 *   was waived. Waiving again edits the same host comment; the service keys it by the claim.
 * @throws Whatever is not an `ApiError` or a dropped connection.
 */
export async function waiveClaim(
  prId: string,
  criterionId: string,
  reason: string,
): Promise<WaiveOutcome> {
  if (
    !isPullRequestId(prId) ||
    !isPullRequestId(criterionId) ||
    !isText(reason, MAX_WAIVE_REASON_LENGTH)
  ) {
    return INVALID;
  }

  try {
    return { ok: true, answer: await pullRequests.waiveCriterion(prId, criterionId, reason) };
  } catch (error) {
    return refusalOf(error);
  }
}
