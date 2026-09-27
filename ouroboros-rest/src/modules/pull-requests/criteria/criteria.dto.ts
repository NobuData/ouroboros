/**
 * What the criteria & evidence routes accept — AX.3
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)).
 *
 * The bounds restate V057's and V055's constraints (`pr_criteria_claim_present`,
 * `pr_criteria_evidence_hunk_range`, `pr_waivers_reason_present`), so a caller gets a `422` naming
 * the field rather than a `500` naming a constraint. Whether a reference *resolves* is the
 * service's, because only a read can say.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

import { PR_EVIDENCE_KINDS, type PrCriterionSource, type PrEvidenceKind } from "../../db/schema";
import { MAX_CLAIM_LENGTH } from "./criteria.plan";

/** V055's `pr_waivers_reason_present` — at most 4096. */
export const MAX_REASON_LENGTH = 4096;

/**
 * The longest note — an analysis note is the whole of V057's display line; a qualifier on another
 * kind shares the same bound, and the composed line is cut to fit.
 */
export const MAX_EVIDENCE_NOTE_LENGTH = 512;

/** The most criteria one PR's matrix reorders at once. */
export const MAX_CRITERIA = 200;

/** The longest repository path a hunk names. */
export const MAX_HUNK_PATH = 1024;

/** `int4`'s ceiling — a hunk line past it is not a line. */
const MAX_LINE = 2_147_483_647;

/** Not blank and not padded. */
const TRIMMED = /^\S(.*\S)?$/s;

/** `test_cases.case_key` — 64 lowercase hex (decision T2). */
const CASE_KEY = /^[0-9a-f]{64}$/;

/** The path of every `/api/v1/pull-requests/{id}/criteria…` route. */
export class PullRequestParams {
  /** `pull_requests.id`, a uuid (V052). Anything else is a `422`, not a probe's `404`. */
  @IsUUID()
  id!: string;
}

/** The path of `/api/v1/pull-requests/{id}/criteria/{criterionId}…`. */
export class CriterionParams extends PullRequestParams {
  /** `pr_criteria.id`, a uuid (V057). */
  @IsUUID()
  criterionId!: string;
}

/** The path of `/api/v1/pull-requests/{id}/criteria/{criterionId}/evidence/{evidenceId}`. */
export class EvidenceParams extends CriterionParams {
  /** `pr_criteria_evidence.id`, a uuid (V057). */
  @IsUUID()
  evidenceId!: string;
}

/** `POST /api/v1/pull-requests/{id}/criteria` — manual authoring. */
export class CreateCriterionDto {
  /** The quoted claim — *Telemetry frames must arrive in ISR order under load*. */
  @Matches(TRIMMED, { message: "claim must not be empty or padded with whitespace" })
  @MaxLength(MAX_CLAIM_LENGTH)
  @IsString()
  claim!: string;

  /**
   * `manual`, the default and the only provenance authoring writes. `extracted` is reserved for
   * AZ.2 (#372) and `plan` comes from the import; both are refused by the service with
   * `criterion_source_invalid`, so the refusal names why.
   */
  @IsOptional()
  @IsIn(["plan", "manual", "extracted"])
  source?: PrCriterionSource;
}

/** `PATCH /api/v1/pull-requests/{id}/criteria/{criterionId}` — edit the claim. */
export class UpdateCriterionDto {
  /** The new wording. */
  @Matches(TRIMMED, { message: "claim must not be empty or padded with whitespace" })
  @MaxLength(MAX_CLAIM_LENGTH)
  @IsString()
  claim!: string;
}

/** `PUT /api/v1/pull-requests/{id}/criteria/order` — the matrix's row order. */
export class ReorderCriteriaDto {
  /** Every criterion of the PR, each once, first row first. */
  @IsArray()
  @ArrayMaxSize(MAX_CRITERIA)
  @IsUUID("all", { each: true })
  criterionIds!: string[];
}

/**
 * `POST /api/v1/pull-requests/{id}/criteria/{criterionId}/evidence` — one typed reference.
 *
 * `kind` decides which fields are required; the rest are ignored.
 *
 * ```
 * test_case        caseKey (64 hex), testRunId?     the case by its durable key, in the PR's run
 * hil_measurement  hilMeasurementId                 a measurement of one of the run's cases
 * build_artifact   testArtifactId                   a file one of the run's attempts uploaded
 * hunk             path, lineStart, lineEnd, revisionId?   a range of a file the revision changed
 * analysis_note    note, revisionId?                a reading of the revision's code
 * ```
 *
 * `revisionId` defaults to the PR's latest revision; `testRunId` to the latest attempt that ran
 * the case. `note` is a qualifier on every other kind — `10⁶ frames, 0 reordered`.
 */
export class AttachEvidenceDto {
  /** Which typed reference this is. */
  @IsIn(PR_EVIDENCE_KINDS)
  kind!: PrEvidenceKind;

  /** `test_case`: the case's durable key. */
  @ValidateIf((dto: AttachEvidenceDto) => dto.kind === "test_case")
  @Matches(CASE_KEY, { message: "caseKey must be 64 lowercase hex digits" })
  @IsString()
  caseKey?: string;

  /** `test_case`: the attempt to cite, when not the latest that ran the case. */
  @ValidateIf((dto: AttachEvidenceDto) => dto.kind === "test_case" && dto.testRunId !== undefined)
  @IsUUID()
  testRunId?: string;

  /** `hil_measurement`: `hil_measurements.id`. */
  @ValidateIf((dto: AttachEvidenceDto) => dto.kind === "hil_measurement")
  @IsUUID()
  hilMeasurementId?: string;

  /** `build_artifact`: `test_artifacts.id`. */
  @ValidateIf((dto: AttachEvidenceDto) => dto.kind === "build_artifact")
  @IsUUID()
  testArtifactId?: string;

  /** `hunk` and `analysis_note`: the revision, when not the latest. */
  @ValidateIf(
    (dto: AttachEvidenceDto) =>
      (dto.kind === "hunk" || dto.kind === "analysis_note") && dto.revisionId !== undefined,
  )
  @IsUUID()
  revisionId?: string;

  /** `hunk`: the repository-relative path, as the revision's snapshot names it. */
  @ValidateIf((dto: AttachEvidenceDto) => dto.kind === "hunk")
  @Matches(TRIMMED, { message: "path must not be empty or padded with whitespace" })
  @MaxLength(MAX_HUNK_PATH)
  @IsString()
  path?: string;

  /** `hunk`: the first line, at least 1. */
  @ValidateIf((dto: AttachEvidenceDto) => dto.kind === "hunk")
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE)
  lineStart?: number;

  /** `hunk`: the last line, at least `lineStart`. */
  @ValidateIf((dto: AttachEvidenceDto) => dto.kind === "hunk")
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE)
  lineEnd?: number;

  /**
   * `analysis_note`: the reading itself, required — *static K_MSGQ_DEFINE · stack analysis
   * clean*. Every other kind: an optional qualifier appended to the composed line.
   */
  @ValidateIf((dto: AttachEvidenceDto) => dto.kind === "analysis_note" || dto.note !== undefined)
  @Matches(TRIMMED, { message: "note must not be empty or padded with whitespace" })
  @MaxLength(MAX_EVIDENCE_NOTE_LENGTH)
  @IsString()
  note?: string;
}

/** `POST /api/v1/pull-requests/{id}/criteria/{criterionId}/waive` — decision V9. */
export class WaiveCriterionDto {
  /**
   * Why — *rig runs at 22°C only — thermal chamber not in bench*. Required: a waiver without a
   * reason is not a waiver (V055). Written to the AS.4 waiver and posted on the host PR.
   */
  @Matches(TRIMMED, { message: "reason must not be empty or padded with whitespace" })
  @MaxLength(MAX_REASON_LENGTH)
  @IsString()
  reason!: string;
}
