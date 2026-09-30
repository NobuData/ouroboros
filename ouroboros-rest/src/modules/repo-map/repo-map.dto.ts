/**
 * The shape the repo-map route accepts (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415)).
 */

import { IsString, Length, Matches } from "class-validator";

import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../onboarding/onboarding.dto";

/** `POST /api/v1/knowledge/repo-map/regenerate`. */
export class RegenerateRepoMapBody {
  /** `owner/name` — a repository a connected source covers. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repo must be owner/name, with no . or .. segment" })
  repo!: string;
}
