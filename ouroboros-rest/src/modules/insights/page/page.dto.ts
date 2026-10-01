/**
 * What `GET /api/v1/insights` accepts (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)).
 */

import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../../onboarding/onboarding.dto";
import { METRIC_RANGES, type MetricRange } from "../metrics/metrics.window";

export class InsightsQuery {
  /**
   * `7d`, `30d` or `90d`; `30d` when absent. Anything else — the mockup's `custom` included,
   * which is BL.3's — is refused with `422 validation_failed` naming the field.
   */
  @IsOptional()
  @IsIn(METRIC_RANGES)
  range?: MetricRange;

  /** One repository's `owner/name`; the whole workspace when absent. Compared lower-case. */
  @IsOptional()
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repo must be owner/name, with no . or .. segment" })
  repo?: string;
}
