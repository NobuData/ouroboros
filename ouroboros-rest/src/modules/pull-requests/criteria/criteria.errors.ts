/**
 * The refusals of the criteria & evidence service — AX.3
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)).
 *
 * Each names what the caller can fix. A PR, criterion or evidence row of another workspace is
 * `404` like an absent one, as everywhere under tenant context. **A dangling evidence reference is
 * `422 evidence_unresolved` for every kind**, with the kind and the reference in `details` — the
 * one point where a renamed test or a hunk on the wrong revision is cheap to catch (decision V6).
 */

import type { PrEvidenceKind } from "../../db/schema";
import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";

export const CRITERIA_ERRORS = {
  /** No such PR in this workspace. */
  pullRequestNotFound: "pull_request_not_found",

  /** No such criterion on this PR. */
  criterionNotFound: "criterion_not_found",

  /** No such evidence row on this criterion. */
  evidenceNotFound: "evidence_not_found",

  /** `extracted` is AZ.2's (#372) and refused in the MVP; `plan` comes only from the import. */
  criterionSourceInvalid: "criterion_source_invalid",

  /** A reorder that is not exactly the PR's criteria, each once. */
  criteriaOrderInvalid: "criteria_order_invalid",

  /** An evidence reference that does not resolve to a row of this PR's workspace and run. */
  evidenceUnresolved: "evidence_unresolved",

  /** A hunk whose path is not in the revision's files snapshot. */
  hunkOutsideSnapshot: "hunk_outside_snapshot",

  /** Verification with no evidence (V057's `pr_criteria_verified_has_evidence`). */
  criterionEvidenceRequired: "criterion_evidence_required",

  /** A waived criterion is verified or unverified only by being waived again or deleted. */
  criterionWaived: "criterion_waived",

  /** A waiver belongs to a run (V055), and a PR no loop opened has none. */
  criterionWaiverNeedsRun: "criterion_waiver_needs_run",

  /** The PR's ticket has no pushed plan draft with a body. */
  planContextMissing: "plan_context_missing",

  /** The plan draft states no *Acceptance criteria* section. */
  planCriteriaMissing: "plan_criteria_missing",
} as const;

/**
 * @param prId - The PR asked for.
 * @returns `404 pull_request_not_found`.
 */
export function pullRequestNotFound(prId: string): NotFoundError {
  return new NotFoundError(
    CRITERIA_ERRORS.pullRequestNotFound,
    "No such pull request in this workspace.",
    { prId },
  );
}

/**
 * @param prId - The PR.
 * @param criterionId - The criterion asked for.
 * @returns `404 criterion_not_found`.
 */
export function criterionNotFound(prId: string, criterionId: string): NotFoundError {
  return new NotFoundError(CRITERIA_ERRORS.criterionNotFound, "No such criterion on this PR.", {
    prId,
    criterionId,
  });
}

/**
 * @param criterionId - The criterion.
 * @param evidenceId - The evidence asked for.
 * @returns `404 evidence_not_found`.
 */
export function evidenceNotFound(criterionId: string, evidenceId: string): NotFoundError {
  return new NotFoundError(
    CRITERIA_ERRORS.evidenceNotFound,
    "No such evidence on this criterion.",
    {
      criterionId,
      evidenceId,
    },
  );
}

/**
 * @param source - The provenance asked for.
 * @returns `422 criterion_source_invalid`.
 */
export function criterionSourceInvalid(source: string): InvalidRequestError {
  const message =
    source === "extracted"
      ? "Extracted criteria are reserved for claim extraction (AZ.2, #372) and refused in the MVP."
      : "Plan-sourced criteria come from the plan import, not from authoring.";

  return new InvalidRequestError(CRITERIA_ERRORS.criterionSourceInvalid, message, { source });
}

/**
 * @param missing - The PR's criteria the order leaves out.
 * @param unknown - Ids the order names that are not the PR's criteria, or repeats.
 * @returns `422 criteria_order_invalid`.
 */
export function criteriaOrderInvalid(
  missing: readonly string[],
  unknown: readonly string[],
): InvalidRequestError {
  return new InvalidRequestError(
    CRITERIA_ERRORS.criteriaOrderInvalid,
    "An order names every criterion of the PR exactly once.",
    { missing: [...missing], unknown: [...unknown] },
  );
}

/**
 * @param kind - The evidence kind.
 * @param reference - What the caller cited, as it was sent.
 * @param reason - Why it did not resolve, in one sentence.
 * @returns `422 evidence_unresolved`.
 */
export function evidenceUnresolved(
  kind: PrEvidenceKind,
  reference: Record<string, string | number | null>,
  reason: string,
): InvalidRequestError {
  return new InvalidRequestError(CRITERIA_ERRORS.evidenceUnresolved, reason, {
    kind,
    reference,
  });
}

/**
 * @param revisionId - The revision the hunk was cited on.
 * @param path - The path that is not in its snapshot.
 * @returns `422 hunk_outside_snapshot`.
 */
export function hunkOutsideSnapshot(revisionId: string, path: string): InvalidRequestError {
  return new InvalidRequestError(
    CRITERIA_ERRORS.hunkOutsideSnapshot,
    "That path is not in the revision's files snapshot — the revision never changed it.",
    { revisionId, path },
  );
}

/**
 * @param criterionId - The criterion.
 * @returns `409 criterion_evidence_required`.
 */
export function criterionEvidenceRequired(criterionId: string): ConflictError {
  return new ConflictError(
    CRITERIA_ERRORS.criterionEvidenceRequired,
    "Attach at least one piece of evidence before marking the criterion verified.",
    { criterionId },
  );
}

/**
 * @param criterionId - The criterion.
 * @returns `409 criterion_waived`.
 */
export function criterionWaived(criterionId: string): ConflictError {
  return new ConflictError(
    CRITERIA_ERRORS.criterionWaived,
    "The criterion is waived and annotated on the PR; waive it again with a new reason, or delete it.",
    { criterionId },
  );
}

/**
 * @param prId - The PR.
 * @returns `409 criterion_waiver_needs_run`.
 */
export function criterionWaiverNeedsRun(prId: string): ConflictError {
  return new ConflictError(
    CRITERIA_ERRORS.criterionWaiverNeedsRun,
    "A waiver belongs to the loop that opened the PR, and no loop opened this one.",
    { prId },
  );
}

/**
 * @param prId - The PR.
 * @param ticketId - Its ticket, or null.
 * @returns `409 plan_context_missing`.
 */
export function planContextMissing(prId: string, ticketId: string | null): ConflictError {
  return new ConflictError(
    CRITERIA_ERRORS.planContextMissing,
    "This PR's ticket has no planning context to import from — write the criteria instead.",
    { prId, ticketId },
  );
}

/**
 * @param prId - The PR.
 * @param draftId - The plan draft that was read.
 * @returns `409 plan_criteria_missing`.
 */
export function planCriteriaMissing(prId: string, draftId: string): ConflictError {
  return new ConflictError(
    CRITERIA_ERRORS.planCriteriaMissing,
    "The ticket's plan states no acceptance criteria section — write the criteria instead.",
    { prId, draftId },
  );
}
