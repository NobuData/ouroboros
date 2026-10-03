/**
 * The body of `PATCH /api/v1/settings/workspace` — the workspace card's two editable fields
 * (BQ.4, [#483](https://github.com/NobuData/ouroboros/issues/483)).
 *
 * Both optional, which is what PATCH means everywhere in this service: send what changed, and a
 * body carrying nothing changes nothing and reads back the current state. `@ValidateIf` rather
 * than `@IsOptional()` for `settings.dto.ts`'s reason: absence skips validation, an explicit
 * `null` is refused with a `422` naming the field instead of reaching a `not null` column.
 *
 * Region and training data are deliberately **not** here. They are deployment truth rather than
 * workspace settings, and a field the server would ignore is the silently dead control decision
 * S6 forbids — `forbidNonWhitelisted` answers `422` for either.
 *
 * Every refusal is the validation pipe's `422 validation_failed` with `details.fields.<field>`,
 * which is what lets the card attach the message to the input that caused it.
 */

import { IsString, Matches, MaxLength, ValidateIf } from "class-validator";

import { DOMAIN_PATTERN } from "../tenancy/tenancy.dto";

/** The longest workspace name the card accepts. */
export const WORKSPACE_NAME_MAX_LENGTH = 100;

/**
 * A workspace name: no leading or trailing whitespace, and no control characters anywhere.
 *
 * Refused rather than trimmed, for `tenancy.dto.ts`'s reason: a value stored differently from the
 * value sent is the beginning of a client that cannot predict what a `GET` returns.
 */
export const WORKSPACE_NAME_PATTERN = /^[^\s\p{Cc}](?:[^\p{Cc}]*[^\s\p{Cc}])?$/u;

/** `PATCH /api/v1/settings/workspace`. */
export class PatchWorkspaceDto {
  /** The organization's display name. */
  @ValidateIf((body: PatchWorkspaceDto) => body.name !== undefined)
  @IsString({ message: "name must be text" })
  @MaxLength(WORKSPACE_NAME_MAX_LENGTH, {
    message: `name must be at most ${WORKSPACE_NAME_MAX_LENGTH} characters`,
  })
  @Matches(WORKSPACE_NAME_PATTERN, {
    message: "name must not be empty, start or end with a space, or contain control characters",
  })
  name?: string;

  /**
   * The tenant domain, lower-cased — it **replaces** the primary. The previous primary is removed
   * and every other domain is left alone (user decision on #483).
   */
  @ValidateIf((body: PatchWorkspaceDto) => body.domain !== undefined)
  @IsString({ message: "domain must be text" })
  @MaxLength(253, { message: "domain must be at most 253 characters" })
  @Matches(DOMAIN_PATTERN, { message: "domain must be a lower-case domain name" })
  domain?: string;
}
