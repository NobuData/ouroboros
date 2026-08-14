/**
 * What an auto-merge request may contain — the body of `PATCH /api/v1/settings/auto-merge`,
 * as a `class-validator` class.
 *
 * One field, and still optional, which is what PATCH means everywhere in this service:
 * send what changed. A body carrying nothing changes nothing and reads back the current
 * state — the same shape `preferences.dto.ts` argues for, kept here so the dashboard's one
 * write and the person's one write have one grammar between them.
 *
 * There is no CHECK to restate this time: the column is a `boolean not null`, so the type
 * *is* the constraint, and `@IsBoolean()` is what turns a `"true"` or a `1` from a client
 * into a `422` naming the field rather than a coercion nobody asked for.
 *
 * `@ValidateIf` rather than the service's usual `@IsOptional()`, and the difference is
 * `null`: `@IsOptional()` waves it through as if the field were absent, the value stays
 * `null` rather than `undefined`, and the not-`undefined` write path would hand a
 * `boolean not null` column the one non-boolean the type let past — a `500` where the
 * caller deserved a `422`. Absence alone skips validation; an explicit `null` is refused.
 */

import { IsBoolean, ValidateIf } from "class-validator";

/**
 * The body of `PATCH /api/v1/settings/auto-merge`.
 *
 * `!`-asserted rather than initialised, as everywhere in this service: `class-transformer`
 * assigns to these objects, and a default written here would be a value the pipe kept for
 * a field the client never sent.
 */
export class PatchAutoMergeDto {
  /** The switch's new position — merge on green checks without asking, or not. */
  @ValidateIf((body: PatchAutoMergeDto) => body.enabled !== undefined)
  @IsBoolean()
  enabled?: boolean;
}
