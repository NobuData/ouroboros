/**
 * The query of `GET /api/v1/loop/readiness` (DK.1, [#1318](https://github.com/NobuData/ouroboros/issues/1318)).
 */

import { Type } from "class-transformer";
import { IsInt, IsString, Length, Matches, Max, Min, ValidateIf } from "class-validator";

import { SLUG_PATTERN } from "../workflows/slug";

/** `owner/name` — exactly two segments, neither `.` nor `..`. */
export const REPOSITORY_PATTERN = /^(?!\.\.?\/)[A-Za-z0-9._-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/;

/** The largest issue number accepted — PostgreSQL's `integer`. */
const ISSUE_NUMBER_MAX = 2_147_483_647;

export class LoopReadinessQuery {
  /** `owner/name` — `acme/helios`. Compared case-insensitively. */
  @IsString()
  @Length(3, 255)
  @Matches(REPOSITORY_PATTERN, { message: "repository must be owner/name" })
  repository!: string;

  /** The workflow's slug — `live-slice`. Its version in force is the one checked. */
  @IsString()
  @Length(1, 64)
  @Matches(SLUG_PATTERN, { message: "workflow must be a workflow slug" })
  workflow!: string;

  /** The issue the estimate sizes and the pull-request check asks about; absent, the pick. */
  @ValidateIf((query: LoopReadinessQuery) => query.issue !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ISSUE_NUMBER_MAX)
  issue?: number;
}
