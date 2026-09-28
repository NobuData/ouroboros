/**
 * What the criteria & evidence routes answer with — AX.3
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)), shaped for the acceptance criteria
 * matrix (AY.4, [#366](https://github.com/NobuData/ouroboros/issues/366)).
 *
 * ```
 * DOES THE PR DO WHAT THE TICKET SAYS?
 * Telemetry frames must arrive in ISR order under load          ← claim
 *     test_frame_order_under_load (…) · hunk telemetry_buf.c:41–66   ← evidence[].displayText
 *                                                    ✓ verified ← status
 * Flake must not reappear across temperature range
 *     rig runs at 22°C only — thermal chamber not in bench      ← waiver.reason
 *                              waived · annotated on PR ↗       ← waiver.annotation.url
 * ```
 *
 * Each evidence row carries its composed line **and** its typed reference, so the matrix renders
 * without a join and a click can still go to the case, the measurement or the hunk.
 */

import type {
  PrCriterion,
  PrCriterionEvidence,
  PrCriterionSource,
  PrCriterionStatus,
  PrEvidenceKind,
  PrWaiver,
  PrWaiverAnnotationState,
} from "../../db/schema";
import type { PrCommentMode } from "../../ticket-sources/ticket-source.pr";

/** The typed reference of one evidence row — exactly the fields of its kind are non-null. */
export interface EvidenceRefResource {
  readonly testCaseId: string | null;
  readonly hilMeasurementId: string | null;
  readonly testArtifactId: string | null;
  readonly revisionId: string | null;
  readonly path: string | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
}

/** One evidence row. */
export interface EvidenceResource {
  readonly id: string;
  readonly criterionId: string;
  readonly kind: PrEvidenceKind;
  /** The composed mono line the matrix prints. */
  readonly displayText: string;
  readonly ref: EvidenceRefResource;
  readonly createdAt: string;
}

/** Where a waiver stands on the host PR (decision V9). */
export interface WaiverAnnotationResource {
  /** `pending_pr_plane` — not posted; `annotated` — posted; `failed` — the host refused it. */
  readonly state: PrWaiverAnnotationState;
  /** The host's comment id, when annotated. */
  readonly commentId: string | null;
  /** What the `waived · annotated on PR ↗` pill links to; null when the host did not say. */
  readonly url: string | null;
  readonly annotatedAt: string | null;
}

/** A criterion's AS.4 waiver. */
export interface CriterionWaiverResource {
  readonly id: string;
  readonly reason: string;
  /** Who waived; null once the person is removed. */
  readonly author: string | null;
  readonly createdAt: string;
  readonly annotation: WaiverAnnotationResource;
}

/** One row of the matrix. */
export interface CriterionResource {
  readonly id: string;
  readonly prId: string;
  readonly claim: string;
  /** `plan` or `manual` — `extracted` is AZ.2's (#372). */
  readonly source: PrCriterionSource;
  readonly status: PrCriterionStatus;
  readonly sortOrder: number;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Oldest first. */
  readonly evidence: readonly EvidenceResource[];
  /** The waiver, exactly when `status` is `waived`. */
  readonly waiver: CriterionWaiverResource | null;
}

/** How many criteria stand where. */
export interface CriteriaCountsResource {
  readonly total: number;
  readonly verified: number;
  readonly waived: number;
  readonly unverified: number;
}

/** `GET /api/v1/pull-requests/{id}/criteria` — the matrix. */
export interface CriteriaMatrixResource {
  readonly prId: string;
  /**
   * Whether the import has a plan to read: the PR has a ticket and a plan draft with a body was
   * pushed as it. The matrix shows *Import from plan* exactly when this is true (#366).
   */
  readonly planContext: boolean;
  readonly counts: CriteriaCountsResource;
  /** In the matrix's order. */
  readonly criteria: readonly CriterionResource[];
}

/** `POST /api/v1/pull-requests/{id}/criteria/import`. */
export interface CriteriaImportResource {
  /** The plan draft the criteria were read from. */
  readonly draftId: string;
  /** The rows written, `plan`-sourced, in the plan's order. */
  readonly imported: readonly CriterionResource[];
  /** Claims the PR already had, word for word — skipped, so an import can be repeated. */
  readonly alreadyPresent: readonly string[];
  /** Items longer than a claim may be — reported, never cut into a different claim. */
  readonly tooLong: readonly string[];
}

/** What the host did with the annotation, on this request. */
export interface AnnotationOutcomeResource {
  /** `annotated` or `failed`. */
  readonly state: Exclude<PrWaiverAnnotationState, "pending_pr_plane">;
  /** `created` the first time, `edited` on a re-waive, `unchanged` when nothing moved. Null on failure. */
  readonly mode: PrCommentMode | null;
  /** Why the host refused, on failure: a stable code and a sentence. Null on success. */
  readonly error: { readonly code: string; readonly message: string } | null;
}

/** `POST /api/v1/pull-requests/{id}/criteria/{criterionId}/waive`. */
export interface CriterionWaivedResource {
  readonly criterion: CriterionResource;
  readonly annotation: AnnotationOutcomeResource;
}

/**
 * An evidence row as the API describes it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function evidenceResource(row: PrCriterionEvidence): EvidenceResource {
  return {
    id: row.id,
    criterionId: row.criterion_id,
    kind: row.kind,
    displayText: row.display_text,
    ref: {
      testCaseId: row.test_case_id,
      hilMeasurementId: row.hil_measurement_id,
      testArtifactId: row.test_artifact_id,
      revisionId: row.revision_id,
      path: row.hunk_path,
      lineStart: row.hunk_line_start,
      lineEnd: row.hunk_line_end,
    },
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * A waiver row as the matrix reads it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function waiverResource(row: PrWaiver): CriterionWaiverResource {
  return {
    id: row.id,
    reason: row.reason,
    author: row.author,
    createdAt: row.created_at.toISOString(),
    annotation: {
      state: row.annotation_state,
      commentId: row.annotation_comment_id,
      url: row.annotation_url,
      annotatedAt: row.annotated_at?.toISOString() ?? null,
    },
  };
}

/**
 * A criterion with its evidence and waiver.
 *
 * @param row - The criterion.
 * @param evidence - Its evidence rows, oldest first.
 * @param waiver - Its waiver row, when waived.
 * @returns The resource.
 */
export function criterionResource(
  row: PrCriterion,
  evidence: readonly PrCriterionEvidence[],
  waiver: PrWaiver | undefined,
): CriterionResource {
  return {
    id: row.id,
    prId: row.pr_id,
    claim: row.claim,
    source: row.source,
    status: row.status,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    evidence: evidence.map(evidenceResource),
    waiver: waiver === undefined ? null : waiverResource(waiver),
  };
}

/**
 * The matrix's counts.
 *
 * @param criteria - The rows.
 * @returns How many are verified, waived and unverified.
 */
export function criteriaCounts(criteria: readonly CriterionResource[]): CriteriaCountsResource {
  const count = (status: PrCriterionStatus): number =>
    criteria.filter((row) => row.status === status).length;

  return {
    total: criteria.length,
    verified: count("verified"),
    waived: count("waived"),
    unverified: count("unverified"),
  };
}
