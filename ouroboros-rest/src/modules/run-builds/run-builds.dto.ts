/**
 * What the engine sends to submit, read and cancel a run's build (AJ.3,
 * [#265](https://github.com/NobuData/ouroboros/issues/265)).
 *
 * camelCase and fenced, like the stage transitions it sits beside (`ingest.dto.ts`): every write
 * carries an idempotency key and, from an engine that started the run, the epoch.
 *
 * **There is no repository and no ref.** A run builds its own repository at its own branch
 * (`runs.github_repo_id`, `runs.branch_name`); the engine names only the commit it pushed there,
 * the pool, and optionally the command. A body cannot point a run's build at another repository.
 */

import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
} from "class-validator";

import { IsArgv, POOL_SHAPE } from "../farm/dispatch/jobs.dto";
import { FencedRequestDto, STAGE_KEY_PATTERN } from "../ingest/ingest.dto";
import { BASE_COMMIT_PATTERN } from "../ingest/run-execution.dto";

/** The highest stage attempt — AP.1's, as the stage transitions accept it. */
export const MAX_STAGE_ATTEMPT = 11;

/** The longest reason a cancellation may carry. */
export const MAX_CANCEL_REASON_LENGTH = 500;

/** `POST /internal/runs/:id/builds` — a build stage's job. */
export class SubmitRunBuildDto extends FencedRequestDto {
  /** The build stage — a DSL node id, `run_stages.stage_key`. */
  @Matches(STAGE_KEY_PATTERN, { message: "stageKey must be a DSL node id" })
  @MaxLength(64)
  @IsString()
  stageKey!: string;

  /**
   * The stage's attempt. With the run and the stage it names one submission
   * (`build_jobs_run_stage_key`, V152): resending it answers the job it already created.
   */
  @Max(MAX_STAGE_ATTEMPT)
  @Min(1)
  @IsInt()
  attempt!: number;

  /** The pool to build in, by name — the stage's `runner_pool`. */
  @Matches(POOL_SHAPE, { message: "pool must be a pool name" })
  @IsString()
  pool!: string;

  /** The commit the engine pushed to the run's branch — forty lower-case hex digits. */
  @Matches(BASE_COMMIT_PATTERN, { message: "commit must be forty lower-case hex digits" })
  @IsString()
  commit!: string;

  /** argv; the pool's `default_command` when absent. */
  @Validate(IsArgv)
  @IsArray()
  @IsOptional()
  command?: string[];
}

/** `POST /internal/runs/:id/builds/:jobId/cancel` — give up on a build. */
export class CancelRunBuildDto extends FencedRequestDto {
  /** Why, in the engine's words — recorded on nothing; logged with the cancellation. */
  @MaxLength(MAX_CANCEL_REASON_LENGTH)
  @IsString()
  @IsOptional()
  reason?: string;
}

/** `/internal/runs/:id/builds/:jobId` — the run and one of its builds. */
export class RunBuildParams {
  /** `runs.id`. */
  @IsUUID()
  id!: string;

  /** `build_jobs.id` — the job the submission answered, or any attempt of its retry chain. */
  @IsUUID()
  jobId!: string;
}
