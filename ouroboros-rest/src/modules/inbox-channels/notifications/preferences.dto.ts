/**
 * `PATCH /api/v1/inbox/notifications` — the body, as a `class-validator` class (BN.3,
 * [#463](https://github.com/NobuData/ouroboros/issues/463)).
 *
 * Every field is optional and none is nullable: an absent field keeps what is stored, and an
 * explicit `null` is refused (`@ValidateIf` rather than `@IsOptional`, which would wave `null`
 * through to a NOT NULL column).
 */

import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  Matches,
  ValidateIf,
} from "class-validator";

import { DIGEST_TIME_PATTERN } from "./digest.schedule";

/** The most kinds one person may mute (V100's `notification_preferences_muted_kinds_bounded`). */
export const MAX_MUTED_KINDS = 64;

/** A decision kind id's grammar: an MVP kind, an amendment kind, or `custom:<slug>`. */
const KIND_ID = /^(custom:)?[a-z][a-z0-9_]{0,62}$/;

/** Present, then held to its rule; absent, then skipped. */
const present = (_object: object, value: unknown) => value !== undefined;

/** A change to the caller's notification preferences in this workspace. */
export class PatchNotificationPreferencesDto {
  /** Whether the daily digest is mailed. */
  @ValidateIf(present)
  @IsBoolean()
  digestEnabled?: boolean;

  /** When the digest leaves — `HH:MM`, UTC. */
  @ValidateIf(present)
  @IsString()
  @Matches(DIGEST_TIME_PATTERN, { message: "digestTime must be HH:MM (UTC)" })
  digestTime?: string;

  /** `err` — mail each err-severity item as it is filed; `off` — never. */
  @ValidateIf(present)
  @IsIn(["err", "off"])
  instantSeverity?: "err" | "off";

  /** Decision kinds that never mail this person. Replaces the stored list. */
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_MUTED_KINDS)
  @IsString({ each: true })
  @Matches(KIND_ID, { each: true, message: "each muted kind must be a decision kind id" })
  mutedKinds?: string[];
}
