/**
 * What the engine sends to push a run's branch, and to report how the push ended (DI.2,
 * [#1310](https://github.com/NobuData/ouroboros/issues/1310)).
 *
 * snake_case on the wire, like the rest of #160's execution contract (`run-execution.dto.ts`).
 * The **refspec is not a field**: the engine names the branch it believes is the run's, and the
 * control plane builds the one refspec it will allow from the run's own row.
 */

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import { MAX_EXEC_EPOCH, MAX_IDEMPOTENCY_KEY_LENGTH } from "./ingest.dto";
import { BASE_COMMIT_PATTERN } from "./run-execution.dto";

/** The longest branch name a push may name — git's own practical ceiling. */
export const MAX_BRANCH_LENGTH = 255;

/** The longest reason a failed push may carry — the host's own words, trimmed. */
export const MAX_PUSH_REASON_LENGTH = 2000;

/** How a granted push ended. */
export const PUSH_OUTCOMES = ["pushed", "failed"] as const;

/** One of {@link PUSH_OUTCOMES}. */
export type PushOutcome = (typeof PUSH_OUTCOMES)[number];

/** What both push requests carry: the key and, from an engine that started the run, the epoch. */
abstract class PushRequestDto {
  /** The caller's name for this submission. */
  @Matches(/^\S(.*\S)?$/, {
    message: "idempotency_key must not be empty or padded with whitespace",
  })
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  @MinLength(1)
  @IsString()
  idempotency_key!: string;

  /** `runs.exec_epoch`, as the start answered it. A different one is `409 fenced`. */
  @Max(MAX_EXEC_EPOCH)
  @Min(1)
  @IsInt()
  @IsOptional()
  epoch?: number;

  /** The run's branch, as the engine names it — refused unless it is the run's own. */
  @MaxLength(MAX_BRANCH_LENGTH)
  @MinLength(1)
  @IsString()
  branch!: string;
}

/** `POST /internal/runs/:id/push`. */
export class RequestPushDto extends PushRequestDto {
  /** The commit the push would leave the branch at — forty lower-case hex digits. */
  @Matches(BASE_COMMIT_PATTERN, { message: "head_sha must be forty lower-case hex digits" })
  @IsString()
  head_sha!: string;

  /**
   * The change-set the engine last reported (`PUT …/files` answered it) — the diff the push
   * publishes, which the guardrail service must already have judged.
   */
  @Max(MAX_EXEC_EPOCH)
  @Min(1)
  @IsInt()
  change_set_seq!: number;

  /**
   * Accepted only so that a request asking for force is refused by name (`409
   * force_push_refused`) rather than as an unknown field: a run's branch never moves backwards.
   */
  @IsBoolean()
  @IsOptional()
  force?: boolean;
}

/** `POST /internal/runs/:id/push/result`. */
export class ReportPushResultDto extends PushRequestDto {
  /** Whether the host accepted the push. */
  @IsIn(PUSH_OUTCOMES)
  outcome!: PushOutcome;

  /** Where the branch now points — required when `pushed`, absent when `failed`. */
  @Matches(BASE_COMMIT_PATTERN, { message: "pushed_sha must be forty lower-case hex digits" })
  @IsString()
  @ValidateIf(
    (dto: ReportPushResultDto) => dto.outcome === "pushed" || dto.pushed_sha !== undefined,
  )
  pushed_sha?: string;

  /** The host's reason, in its own words — required when `failed`, absent when `pushed`. */
  @MaxLength(MAX_PUSH_REASON_LENGTH)
  @MinLength(1)
  @IsString()
  @ValidateIf((dto: ReportPushResultDto) => dto.outcome === "failed" || dto.reason !== undefined)
  reason?: string;
}
