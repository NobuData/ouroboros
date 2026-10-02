/**
 * What the digest's two writes accept (#440).
 */

import { IsBoolean, IsInt, Matches, Max, Min, ValidateIf } from "class-validator";

/** `PUT /api/v1/insights/digest/subscription`. */
export class PutDigestSubscriptionDto {
  /** True to receive this workspace's weekly digest, false to stop. */
  @IsBoolean()
  subscribed!: boolean;
}

/** `PATCH /api/v1/insights/digest/schedule`. A field left out keeps its value. */
export class PatchDigestScheduleDto {
  /** ISO day of week, 1 = Monday … 7 = Sunday — `insights_digest_schedules_weekly_day_range`. */
  @ValidateIf((body: PatchDigestScheduleDto) => body.weeklyDay !== undefined)
  @IsInt()
  @Min(1)
  @Max(7)
  weeklyDay?: number;

  /** Time of day in UTC, twenty-four-hour `HH:MM`. */
  @ValidateIf((body: PatchDigestScheduleDto) => body.weeklyTime !== undefined)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "weeklyTime must be a UTC time such as 09:00" })
  weeklyTime?: string;
}
