/**
 * The body of `PATCH /api/v1/settings/retention` (BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * Two ways to save, one per control, and a body carries **at most one** of them:
 *
 *   * `loopDays` — the workspace card's simple select. Sets `transcripts`, `build_logs` and
 *     `artifacts` to the same tier and leaves `audit` (and every custom class) untouched.
 *   * `classes` — the advanced editor. `{ "audit": 400, "custom:chat-messages": 60 }` sets each
 *     named class individually.
 *
 * A body carrying neither changes nothing and reads back the card, which is what PATCH means
 * everywhere in this service. The shape is checked here; the per-class **bounds** are the
 * service's, because their refusal carries a reason code the card renders
 * (`422 retention_out_of_bounds`) rather than a generic field message.
 */

import { IsInt, IsObject, ValidateIf } from "class-validator";

/** `PATCH /api/v1/settings/retention`. */
export class PatchRetentionDto {
  /** The simple select: days for all three loop-data classes. */
  @ValidateIf((body: PatchRetentionDto) => body.loopDays !== undefined)
  @IsInt({ message: "loopDays must be a whole number of days" })
  loopDays?: number;

  /**
   * The advanced editor: days per class. Keys are `transcripts | build_logs | artifacts | audit`
   * or `custom:<slug>`; the service checks each key and value.
   */
  @ValidateIf((body: PatchRetentionDto) => body.classes !== undefined)
  @IsObject({ message: "classes must be an object of class → days" })
  classes?: Record<string, unknown>;
}
