/**
 * What the engine sends to open a live run's draft pull request (DI.3,
 * [#1311](https://github.com/NobuData/ouroboros/issues/1311)).
 *
 * snake_case on the wire, like the rest of #160's execution contract (`run-execution.dto.ts`) and
 * DI.2's push (`run-push.dto.ts`). **Nothing about the PR is a field**: the branches, the title,
 * the body and the draft flag are all the control plane's, read from the run's own rows — the
 * engine only says *open it now*, under its epoch and a key.
 */

import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { MAX_EXEC_EPOCH, MAX_IDEMPOTENCY_KEY_LENGTH } from "./ingest.dto";

/** `POST /internal/runs/:id/pull-request`. */
export class OpenPullRequestDto {
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
}
