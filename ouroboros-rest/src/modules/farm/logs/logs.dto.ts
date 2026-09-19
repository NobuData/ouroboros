/**
 * The query string of `GET /api/v1/farm/jobs/:id/log`.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)).
 */

import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** The largest offset worth asking for: V040's ceiling on a job's log, 256 MiB. */
export const MAX_LOG_OFFSET = 268_435_456;

/** `?after=` — where to read from. */
export class ReadLogQuery {
  /**
   * The offset a reader last reached — the `nextOffset` it was given — or absent for the start.
   * An integer, transformed by the pipe, so `?after=abc` is a `422` naming the field rather than
   * a read from nowhere.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_LOG_OFFSET)
  after?: number;
}
