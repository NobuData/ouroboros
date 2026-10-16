/**
 * The request shape of `PATCH /api/v1/settings/guardrails` (AR.1,
 * [#315](https://github.com/NobuData/ouroboros/issues/315)).
 *
 * A partial map: name only the checks whose mode should change. The global pipe's `whitelist` and
 * `forbidNonWhitelisted` make a fifth check name a `422 validation_failed`, so the vocabulary is
 * closed here as well as by V148's CHECK.
 */

import { Type } from "class-transformer";
import { IsDefined, IsIn, IsObject, IsOptional, ValidateNested } from "class-validator";

import type { GuardrailMode } from "../db/schema";

/** The two modes, as the API spells them. */
export const GUARDRAIL_MODES = ["block", "warn"] as const satisfies readonly GuardrailMode[];

/** The message every mode field refuses with. */
const MODE_MESSAGE = "must be block or warn";

/** The checks a patch may name, each optional. */
export class GuardrailModesPatchDto {
  /** Protected and out-of-scope paths. */
  @IsOptional()
  @IsIn(GUARDRAIL_MODES, { message: `allowed_paths ${MODE_MESSAGE}` })
  allowed_paths?: GuardrailMode;

  /** CI configuration touched without `touch_ci`. */
  @IsOptional()
  @IsIn(GUARDRAIL_MODES, { message: `ci_config ${MODE_MESSAGE}` })
  ci_config?: GuardrailMode;

  /** The embedded secrets ruleset. */
  @IsOptional()
  @IsIn(GUARDRAIL_MODES, { message: `secrets ${MODE_MESSAGE}` })
  secrets?: GuardrailMode;

  /** Human review required by policy or routing votes. */
  @IsOptional()
  @IsIn(GUARDRAIL_MODES, { message: `review_required ${MODE_MESSAGE}` })
  review_required?: GuardrailMode;
}

/** `PATCH /api/v1/settings/guardrails`. */
export class PatchGuardrailModesDto {
  /**
   * The checks to change. `@IsObject()` before `@ValidateNested()`, so a `modes` of `"warn"` is
   * refused as the wrong shape rather than validated as an object with no properties.
   */
  @IsDefined({ message: "modes is required" })
  @IsObject({ message: "modes must be an object" })
  @ValidateNested()
  @Type(() => GuardrailModesPatchDto)
  modes!: GuardrailModesPatchDto;
}
