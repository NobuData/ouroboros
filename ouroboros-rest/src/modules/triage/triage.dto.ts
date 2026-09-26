/**
 * What the classification & routing routes accept — AT.4
 * ([#332](https://github.com/NobuData/ouroboros/issues/332)).
 *
 * The bounds restate V055's constraints (`failure_classifications_note_shape`,
 * `pr_waivers_reason_present`), so a caller gets a `422` naming the field rather than a `500`
 * naming a constraint. Rules that depend on the class — *a correction round carries a note*,
 * *only the infra route requeues* — are the service's, because a decorator sees one field.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

import {
  FAILURE_CLASSES,
  FAILURE_SUBTYPES,
  type FailureClass,
  type FailureSubtype,
  type TestSelectionScope,
} from "../db/schema";

/** The longest note or reason — V055's 4096. */
export const MAX_NOTE_LENGTH = 4096;

/** The most cases one waiver names. */
export const MAX_WAIVED_CASES = 500;

/** Not blank and not padded, which is what V055 asks of a note and a reason. */
const TRIMMED = /^\S(.*\S)?$/s;

/** The path of every `/api/v1/test-runs/{id}/…` route. */
export class TestRunParams {
  /** `test_runs.id`, a uuid (V051). Anything else is a `422`, not a probe's `404`. */
  @IsUUID()
  id!: string;
}

/** The path of `/api/v1/test-runs/{id}/cases/{caseId}/classify`. */
export class TestCaseParams extends TestRunParams {
  /** `test_cases.id`, a uuid (V051). */
  @IsUUID()
  caseId!: string;
}

/** The Mark & Route card's toggles. */
export class ClassifyTogglesDto {
  /** *Block PR until green* — stored as an intent (T8); enforced by #358/#360. */
  @IsOptional()
  @IsBoolean()
  blockUntilGreen?: boolean;

  /** *Auto re-run physical suite after fix* — stored as an intent (T8). */
  @IsOptional()
  @IsBoolean()
  autoRerunPhysical?: boolean;

  /** `infra_rig` only: also requeue the attempt's build after flagging its runner. */
  @IsOptional()
  @IsBoolean()
  requeue?: boolean;
}

/** `POST /api/v1/test-runs/{id}/cases/{caseId}/classify`. */
export class ClassifyCaseDto {
  /** One of the four radios. What it routes to is the service's header. */
  @IsIn(FAILURE_CLASSES)
  class!: FailureClass;

  /** `unclear_requirements` — *this ticket was underspecified* (the #434 amendment). */
  @IsOptional()
  @IsIn(FAILURE_SUBTYPES)
  subtype?: FailureSubtype;

  /**
   * The correction note, injected into the next attempt's planning context. Required for
   * `product_bug` and `test_update`, which queue a correction round.
   */
  @IsOptional()
  @Matches(TRIMMED, { message: "note must not be empty or padded with whitespace" })
  @MaxLength(MAX_NOTE_LENGTH)
  @IsString()
  note?: string;

  /** The card's toggles. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ClassifyTogglesDto)
  toggles?: ClassifyTogglesDto;
}

/** `POST /api/v1/test-runs/{id}/rerun` — *Re-run failed (2)* or *Re-run full suite*. */
export class RerunDto {
  /** `failed`: the attempt's failed and error cases. `full`: every case. */
  @IsIn(["failed", "full"])
  scope!: TestSelectionScope;
}

/** `POST /api/v1/test-runs/{id}/waivers` — *Waive & annotate PR*, the waiver half. */
export class WaiveDto {
  /** Why. A waiver without a reason is not a waiver (V055). */
  @Matches(TRIMMED, { message: "reason must not be empty or padded with whitespace" })
  @MaxLength(MAX_NOTE_LENGTH)
  @IsString()
  reason!: string;

  /** The waived cases of this attempt, by id. Absent or empty waives a criterion. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WAIVED_CASES)
  @IsUUID("all", { each: true })
  caseIds?: string[];
}
