/**
 * What a detection request may contain ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * The repository travels as `?repo=owner/name`, validated by the onboarding wizard's own
 * {@link OnboardingRepoQuery} — one grammar for the whole `/onboarding` surface, restating V067's
 * `repo_ref` domain so a malformed reference is a `422` rather than a CHECK's `500`.
 */

import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

export { OnboardingRepoQuery as DetectionRepoQuery } from "../onboarding/onboarding.dto";

/** The largest `scan_seq` a path may name — PostgreSQL's `integer`. */
export const MAX_SCAN_SEQ = 2_147_483_647;

/** The path of `GET /api/v1/onboarding/detection/scans/{scanSeq}`. */
export class ScanSeqParams {
  /** The scan's number within the repository, from 1. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SCAN_SEQ)
  scanSeq!: number;
}
