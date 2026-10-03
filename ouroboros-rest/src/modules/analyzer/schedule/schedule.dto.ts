/**
 * What the Build Analyzer's schedule routes accept (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516); the table is V080's
 * `analysis_schedules`, #506).
 *
 * The body restates V080's checks so the person typing is told which field was wrong rather than
 * handed a constraint's `500`: an ISO weekday 1–7, a UTC `HH:MM`, a weekly slot that is complete
 * whenever the weekly trigger is on, an every-N threshold of at least one build (or null, off),
 * and budgets of at least one.
 */

import { IsBoolean, IsInt, IsString, Length, Matches, Max, Min, ValidateIf } from "class-validator";

import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../../onboarding/onboarding.dto";

/** The repository rule, written once. */
const REPO_MESSAGE = "repo must be owner/name, with no . or .. segment";

/** A UTC time of day, twenty-four-hour `HH:MM`. */
export const WEEKLY_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The largest integer V080's `integer` columns hold. */
export const MAX_INT4 = 2_147_483_647;

/**
 * Whether a weekly-slot field must be checked: always when the weekly trigger is on (V080's
 * `analysis_schedules_weekly_slot`), and whenever a value is given while it is off — V080 keeps
 * the slot when the trigger is turned off, so a kept value must still be a valid one.
 *
 * @param body - The body.
 * @param value - The field's value.
 * @returns True to validate it.
 */
function slotChecked(body: PutAnalysisScheduleBody, value: unknown): boolean {
  return body.weeklyEnabled || (value !== null && value !== undefined);
}

/** `GET /api/v1/analyzer/schedule?repo=`. */
export class AnalysisScheduleQuery {
  /** The repository, `owner/name`. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: REPO_MESSAGE })
  repo!: string;
}

/**
 * `PUT /api/v1/analyzer/schedule` — the whole configuration, every field stated. A `PUT` rather
 * than a `PATCH` because the editor always saves the whole form, and a missing field is then a
 * mistake to refuse rather than a value to keep.
 */
export class PutAnalysisScheduleBody {
  /** The repository, `owner/name`. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: REPO_MESSAGE })
  repo!: string;

  /** The master switch: off, no scheduled run starts. Manual runs are unaffected. */
  @IsBoolean()
  enabled!: boolean;

  /** Whether the weekly trigger is on. */
  @IsBoolean()
  weeklyEnabled!: boolean;

  /** ISO day of week, 1 = Monday … 7 = Sunday; required when the weekly trigger is on. */
  @ValidateIf((body: PutAnalysisScheduleBody) => slotChecked(body, body.weeklyDay))
  @IsInt({ message: "weeklyDay must be an ISO weekday, 1 (Monday) to 7 (Sunday)" })
  @Min(1, { message: "weeklyDay must be an ISO weekday, 1 (Monday) to 7 (Sunday)" })
  @Max(7, { message: "weeklyDay must be an ISO weekday, 1 (Monday) to 7 (Sunday)" })
  weeklyDay!: number | null;

  /** Time of day in UTC, `HH:MM`; required when the weekly trigger is on. */
  @ValidateIf((body: PutAnalysisScheduleBody) => slotChecked(body, body.weeklyTime))
  @IsString({ message: "weeklyTime must be a UTC time such as 06:00" })
  @Matches(WEEKLY_TIME_PATTERN, { message: "weeklyTime must be a UTC time such as 06:00" })
  weeklyTime!: string | null;

  /** Run every this many finished builds; null turns the trigger off. */
  @ValidateIf((body: PutAnalysisScheduleBody) => body.everyNBuilds !== null)
  @IsInt({ message: "everyNBuilds must be a whole number of builds, or null for off" })
  @Min(1, { message: "everyNBuilds must be at least 1, or null for off" })
  @Max(MAX_INT4)
  everyNBuilds!: number | null;

  /** The most builds a run's corpus reads. */
  @IsInt()
  @Min(1)
  @Max(MAX_INT4)
  maxBuilds!: number;

  /** The most log lines a run's corpus reads. */
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  maxLogLines!: number;

  /** The compute ceiling, in seconds, a run stops at. */
  @IsInt()
  @Min(1)
  @Max(MAX_INT4)
  computeCeilingSeconds!: number;
}
