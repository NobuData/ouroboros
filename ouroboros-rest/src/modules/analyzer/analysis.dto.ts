/**
 * What the Build Analyzer's run routes accept (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510)).
 *
 * A repository is named by its `owner/name`, held to the same pattern every other repository
 * parameter is; one this workspace does not have is a `404`, not a run.
 */

import { IsString, IsUUID, Length, Matches } from "class-validator";

import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../onboarding/onboarding.dto";

/** The repository rule, written once. */
const REPO_MESSAGE = "repo must be owner/name, with no . or .. segment";

/** `POST /api/v1/analyzer/runs` — *Run analysis now*. */
export class StartAnalysisBody {
  /** The repository to analyze, `owner/name`. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: REPO_MESSAGE })
  repo!: string;
}

/** `GET /api/v1/analyzer/runs/latest?repo=`. */
export class LatestAnalysisQuery {
  /** The repository, `owner/name`. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: REPO_MESSAGE })
  repo!: string;
}

/** `:id` — an analysis run. */
export class AnalysisRunIdParams {
  @IsUUID()
  id!: string;
}
