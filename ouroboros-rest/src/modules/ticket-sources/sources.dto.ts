/**
 * What a source-management request may contain, as `class-validator` classes
 * (Q.4, [#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * **These decorators restate V030's CHECKs, deliberately** — `provider-connections.dto.ts`'s
 * argument, one table over. The database is still the authority: `ticket_sources_kind`,
 * `ticket_sources_status` and `ticket_sources_display_name_present` are what actually stop a
 * sixth kind, a fourth status or a blank name being stored. Restating them here changes only
 * *who says no and how*: a `422` naming the field rather than a constraint violation surfacing
 * as `500 internal_error`.
 *
 * ---------------------------------------------------------------------------
 * **`config` is validated in two places and neither is redundant.**
 *
 * Here it is checked for *shape* — an object of strings and lists of strings, bounded —
 * because that is what `class-validator` can say about a value whose keys depend on which
 * provider the body names. What each field *means* is the provider's `configSchema()`, and
 * `ticket-source.config.ts`'s `sourceConfigViolations` is where the submission meets it. The
 * bounds here are the cheap refusal in front of that: a body with fifty thousand keys, or a
 * list of a million entries, is refused before the schema check has to walk it.
 *
 * ---------------------------------------------------------------------------
 * **`status` on a `PATCH` admits two of V030's three values, on purpose.** `active` and
 * `paused` are a person's choices; `error` is the loop's report, written by the sync and
 * cleared by the next one that succeeds. A client that could set `error` could paint a source
 * red with no reason under it, which is exactly the state V031 exists to make impossible.
 */

import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

import { TICKET_SOURCE_KINDS, type TicketSourceKind, type TicketSourceStatus } from "../db/schema";
import { IsTrimmed, MAX_SECRET_LENGTH } from "../provider-connections/provider-connections.dto";
import { PageQuery } from "../tenancy/pagination";
import type { TicketSourceConfigValue } from "./ticket-source.config";

/** The longest `display_name` V030 will store — `ticket_sources_display_name_present`'s bound. */
export const MAX_DISPLAY_NAME_LENGTH = 128;

/**
 * How many settings one source configuration may carry — **twenty**, as a provider
 * connection's is.
 *
 * Comfortably above every schema that ships (the largest declares three) and low enough that
 * a body cannot be used to make this service build a large object before refusing it.
 */
export const MAX_CONFIG_FIELDS = 20;

/** The longest a string setting — or one entry of a list — may be. `base_url`'s own bound. */
export const MAX_CONFIG_VALUE_LENGTH = 2048;

/**
 * The most entries one list setting may carry — **one hundred**.
 *
 * Twice the fifty repositories the GitHub provider allows, and a bound rather than a policy:
 * the provider's own `maxItems` is what says how many a source may *enable*, and this is what
 * stops a body from being a way to make the schema check walk a million strings.
 */
export const MAX_CONFIG_LIST_LENGTH = 100;

/** The statuses a person may set. See this file's header on why `error` is not among them. */
export const SETTABLE_STATUSES = [
  "active",
  "paused",
] as const satisfies readonly TicketSourceStatus[];

/** One of {@link SETTABLE_STATUSES}. */
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

/**
 * An object of bounded strings and bounded lists of bounded strings.
 *
 * A constraint class rather than `@ValidateNested` against a DTO, for `IsProviderConfig`'s
 * reason: the keys are whichever fields the provider for the body's `kind` declares, and a
 * class with declared properties would have to declare the union of every provider's schema —
 * which is the `switch (kind)` decision **P5** exists to refuse.
 */
@ValidatorConstraint({ name: "isTicketSourceConfig" })
export class IsTicketSourceConfig implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @returns Whether it is an object of at most {@link MAX_CONFIG_FIELDS} settings, each a
   *   string of at most {@link MAX_CONFIG_VALUE_LENGTH} characters or a list of at most
   *   {@link MAX_CONFIG_LIST_LENGTH} such strings.
   */
  validate(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length > MAX_CONFIG_FIELDS) {
      return false;
    }

    return entries.every(([, setting]) => isBoundedString(setting) || isBoundedList(setting));
  }

  /**
   * @param args - The validation context.
   * @returns What the client is told.
   */
  defaultMessage(args: ValidationArguments): string {
    return (
      `${args.property} must be an object of at most ${String(MAX_CONFIG_FIELDS)} settings, ` +
      `each a string of at most ${String(MAX_CONFIG_VALUE_LENGTH)} characters or a list of at ` +
      `most ${String(MAX_CONFIG_LIST_LENGTH)} such strings`
    );
  }
}

/**
 * Whether a value is a string within the bound.
 *
 * @param value - One setting.
 * @returns `true` for a string of at most {@link MAX_CONFIG_VALUE_LENGTH} characters.
 */
function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CONFIG_VALUE_LENGTH;
}

/**
 * Whether a value is a list of bounded strings within the bound.
 *
 * @param value - One setting.
 * @returns `true` for an array of at most {@link MAX_CONFIG_LIST_LENGTH} bounded strings.
 */
function isBoundedList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length <= MAX_CONFIG_LIST_LENGTH && value.every(isBoundedString)
  );
}

/** The `{id}` every operation below the collection takes. */
export class SourceParams {
  /**
   * `ticket_sources.id`.
   *
   * A uuid check rather than a bare string, so a path that could not name a row is a `422`
   * before a statement is issued.
   */
  @IsUUID()
  id!: string;
}

/** The query string of `GET /api/v1/sources`: nothing but the window. */
export class ListSourcesQuery extends PageQuery {}

/**
 * The body of `POST /api/v1/sources`.
 *
 * `!`-asserted rather than initialised, as everywhere in this service: `class-transformer`
 * assigns to these objects, and a default written here would be a value the pipe kept for a
 * field the client never sent.
 */
export class CreateSourceDto {
  /**
   * Which tracker.
   *
   * Checked against V030's five rather than the registry's registered set: a kind this build
   * has no provider for is a `501` naming the kinds that *are* available, which
   * `TicketSourceRegistry.get` answers and which is a more useful answer than *not one of five*.
   */
  @IsIn(TICKET_SOURCE_KINDS)
  kind!: TicketSourceKind;

  /** What the settings list calls it. Unique per workspace. */
  @Validate(IsTrimmed)
  @Length(1, MAX_DISPLAY_NAME_LENGTH)
  @IsString()
  displayName!: string;

  /**
   * The provider's own settings, keyed by the field names its `configSchema()` declares — the
   * credential among them, which the service routes to the vault.
   */
  @Validate(IsTicketSourceConfig)
  config!: Record<string, TicketSourceConfigValue>;
}

/**
 * The body of `PATCH /api/v1/sources/{id}`.
 *
 * Every field is optional and an absent one is left alone — which is what distinguishes this
 * from a `PUT`. A body carrying nothing changes nothing and reads back the source as it is.
 */
export class UpdateSourceDto {
  /** A new display name. */
  @IsOptional()
  @Validate(IsTrimmed)
  @Length(1, MAX_DISPLAY_NAME_LENGTH)
  @IsString()
  displayName?: string;

  /**
   * The provider's settings, whole.
   *
   * Replaced rather than merged: the settings form submits every field it draws, and a merge
   * would have no way to say *clear this optional setting*. The credential is never among
   * these — `POST /api/v1/sources/{id}/credentials` is where it changes.
   */
  @IsOptional()
  @Validate(IsTicketSourceConfig)
  config?: Record<string, TicketSourceConfigValue>;

  /** `paused` to stop polling this source; `active` to resume it, or to clear an `error`. */
  @IsOptional()
  @IsIn(SETTABLE_STATUSES)
  status?: SettableStatus;
}

/** The body of `POST /api/v1/sources/{id}/credentials`. */
export class SetCredentialsDto {
  /**
   * The credential, exactly as typed.
   *
   * Trimmed by nobody: a token with a trailing space is a token that was pasted with one, and
   * the provider's **Test connection** is what says whether it works.
   */
  @Length(1, MAX_SECRET_LENGTH)
  @IsString()
  secret!: string;
}
