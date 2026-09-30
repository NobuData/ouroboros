/**
 * The shapes `/api/v1/fact-proposers` accepts (BF.3,
 * [#412](https://github.com/NobuData/ouroboros/issues/412)).
 */

import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

/** The most suppressions one read returns. */
export const MAX_SUPPRESSIONS_PAGE = 200;

/** The default page of suppressions. */
export const DEFAULT_SUPPRESSIONS_PAGE = 50;

/** `POST /api/v1/fact-proposers/backfill` — which run's sources to propose from. */
export class BackfillProposersBody {
  @IsUUID()
  runId!: string;
}

/** `GET /api/v1/fact-proposers/suppressions?limit=`. */
export class ListSuppressionsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SUPPRESSIONS_PAGE)
  limit?: number;
}
