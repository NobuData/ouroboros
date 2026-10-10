/**
 * What the engine sends to have a dry-run stage estimated (CD.3,
 * [#561](https://github.com/NobuData/ouroboros/issues/561)) — `openapi.internal.yaml`'s
 * `ReplayEstimateRequest`.
 *
 * The bounds are the sources': a pool's name and a command are held to the lengths the farm and
 * the workflow DSL give them, and a suite set to a size no real test run approaches.
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

import type { ReplayKind } from "./replay.formulas";

/** The longest pool name accepted. */
export const MAX_POOL_NAME = 120;

/** The longest command accepted — the workflow DSL's own bound on a stage's command. */
export const MAX_COMMAND = 2000;

/** The most suites a set may name. */
export const MAX_SUITES = 64;

/** The longest suite name accepted. */
export const MAX_SUITE_NAME = 200;

const KINDS: readonly ReplayKind[] = ["build", "test"];

export class ReplayEstimateDto {
  /** What to estimate. */
  @IsIn(KINDS)
  kind!: ReplayKind;

  /** The stage's runner pool, by name. Required for a build. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_POOL_NAME)
  runnerPool?: string;

  /** The stage's command. A build without one takes its pool's default. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_COMMAND)
  command?: string;

  /** A test stage's suite set. Without one, the set the repository last measured. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SUITES)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(MAX_SUITE_NAME, { each: true })
  suites?: string[];
}
