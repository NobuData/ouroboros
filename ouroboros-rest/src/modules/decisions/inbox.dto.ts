/**
 * The Needs-You routes' parameters, query and bodies, as `class-validator` classes (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464)).
 */

import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

import { MAX_SNOOZE_MINUTES } from "./inbox.queue";

/** A value with no leading or trailing whitespace. */
const TRIMMED = /^\S(.*\S)?$/s;

/** One item. */
export class InboxItemParams {
  /** `decision_items.id`. */
  @IsUUID()
  id!: string;
}

/** `GET /api/v1/inbox/resolved`'s query. */
export class InboxResolvedQuery {
  /** A UTC day, `YYYY-MM-DD`; today when absent. */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { message: "day must be YYYY-MM-DD" })
  day?: string;
}

/** A snooze — one item, or all of them. */
export class InboxSnoozeDto {
  /** For how long, in minutes: 1 to a week. *Snooze all 1h* sends 60, the default. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SNOOZE_MINUTES)
  minutes?: number;

  /** Why, optional — shown to whoever finds the item snoozed. */
  @IsOptional()
  @IsString()
  @Matches(TRIMMED, { message: "reason must not be empty or padded with whitespace" })
  @MaxLength(500)
  reason?: string;
}
