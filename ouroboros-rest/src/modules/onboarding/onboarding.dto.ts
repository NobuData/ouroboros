/**
 * What an onboarding request may contain ([#385](https://github.com/NobuData/ouroboros/issues/385)).
 *
 * The repository is the wizard's context and travels as `?repo=owner/name` on every route, so a
 * second repository re-enters the wizard with independent state by naming itself. Its grammar
 * restates V067's `ouroboros.repo_ref` domain, so a malformed reference is a `422` naming the
 * field rather than a `500` from the CHECK behind it.
 *
 * Nullable `PATCH` fields use `@ValidateIf` on "present and not null" — `null` is the documented
 * way to clear a pick — while `dismissed` refuses `null`, because its column is `not null`.
 */

import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from "class-validator";

import { ONBOARDING_STEPS, type OnboardingStepNumber } from "./onboarding.derivation";

/**
 * V067's `repo_ref` domain: `owner/name`, or deeper for a nested namespace, with no `.` or `..`
 * segment (a path, not a name) — the lookahead is the domain's second clause.
 */
export const REPO_REF_PATTERN = /^(?!(?:.*\/)?\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/;

/** The domain's length bound. */
export const REPO_REF_MAX_LENGTH = 255;

/** V067's `onboarding_state_template_slug`. */
export const TEMPLATE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The query every onboarding route takes: which repository's wizard. */
export class OnboardingRepoQuery {
  /** `owner/name` — `acme-robotics/helios-firmware`. Compared case-insensitively. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repo must be owner/name, with no . or .. segment" })
  repo!: string;
}

/** The body of `PATCH /api/v1/onboarding`. Send what changed. */
export class PatchOnboardingDto {
  /** The template picked in step 3, by slug; `null` clears the pick. */
  @ValidateIf((body: PatchOnboardingDto) => body.selectedTemplate != null)
  @IsString()
  @Matches(TEMPLATE_SLUG_PATTERN, { message: "selectedTemplate must be a template slug" })
  selectedTemplate?: string | null;

  /** The canonical ticket picked for the first run; `null` clears the pick. */
  @ValidateIf((body: PatchOnboardingDto) => body.pickedTicketId != null)
  @IsUUID()
  pickedTicketId?: string | null;

  /** Stop showing the wizard for this repository (or show it again). Never `null`. */
  @ValidateIf((body: PatchOnboardingDto) => body.dismissed !== undefined)
  @IsBoolean()
  dismissed?: boolean;
}

/** The body of `POST /api/v1/onboarding/complete-step`. */
export class CompleteStepDto {
  /** The step the action bar's primary button completes — 1 to 4. */
  @Type(() => Number)
  @IsInt()
  @IsIn(ONBOARDING_STEPS)
  step!: OnboardingStepNumber;
}

/** The body of `POST /api/v1/onboarding/select-template` (BB.3, #386). */
export class SelectTemplateDto {
  /** The template picked, by slug — `quick-fixes`. */
  @IsString()
  @Matches(TEMPLATE_SLUG_PATTERN, { message: "slug must be a template slug" })
  slug!: string;
}
