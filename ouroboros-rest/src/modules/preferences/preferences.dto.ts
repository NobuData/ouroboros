/**
 * What a preferences request may contain — the body of `PATCH /api/v1/me/preferences`, as a
 * `class-validator` class.
 *
 * One file for the same reason `tenancy.dto.ts` is one file: the decorator below restates
 * the `user_preferences_font_scale` CHECK (V007), and the pairing has to be readable in one
 * look. The database is still the authority — a DTO that admitted a sixth step would be a
 * `500` where the caller deserved a `422` — and the DTO is still the message: `@IsIn`'s
 * failure is a sentence naming the field and the five values, delivered before a connection
 * is taken from the pool.
 *
 * The vocabulary itself is imported rather than restated: `FONT_SCALES` in `db/schema.ts`
 * is the CHECK as a value, `schema.spec.ts` holds it to the `FontScale` union, and reading
 * it here means widening the scale is one migration and one union — never a third list.
 */

import { IsIn, IsOptional } from "class-validator";

import { FONT_SCALES, type FontScale } from "../db/schema";

/**
 * The body of `PATCH /api/v1/me/preferences`.
 *
 * Every field optional, which is what PATCH means: send what changed. A body carrying
 * nothing changes nothing and reads back the current state — legal, idempotent, and the
 * shape that stays true as preferences beyond the font scale arrive.
 *
 * `!`-asserted rather than initialised, as everywhere in this service: `class-transformer`
 * assigns to these objects, and a default written here would be a value the pipe kept for a
 * field the client never sent.
 */
export class PatchPreferencesDto {
  /** The reader's font-size step — one of the five § 4 names, as a string label. */
  @IsOptional()
  @IsIn(FONT_SCALES)
  fontScale?: FontScale;
}
