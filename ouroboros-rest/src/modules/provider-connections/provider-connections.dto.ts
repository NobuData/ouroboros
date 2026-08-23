/**
 * What a credential-lifecycle request may contain, as `class-validator` classes
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)).
 *
 * **These decorators restate V015's and V017's CHECKs, deliberately** — the same argument
 * `pricing/pricing.dto.ts` makes. The database is still the authority:
 * `provider_connections_display_name_present` and its siblings are what actually stop a
 * blank name or a 3 000-character address being stored. Restating them here changes only
 * *who says no and how*: without it a trimmed-to-empty name is a constraint violation
 * surfacing as `500 internal_error`, and with it, it is a `422` naming the field.
 *
 * ---------------------------------------------------------------------------
 * **`config` is validated in two places and neither is redundant.**
 *
 * Here it is checked for *shape* — a flat object of strings, bounded — because that is what
 * `class-validator` can say about a value whose keys depend on which adapter the body names.
 * What each field *means* is the adapter's `configSchema()`, and `config.validation.ts` is
 * where the submission meets it: the pipe has no way to reach a registry, and a DTO that
 * tried would be resolving a provider kind inside a validation decorator.
 *
 * The bounds are the interesting part of what is here. `additionalProperties: false` in the
 * dialect means an undeclared key is refused — but by the *schema* check, after the body has
 * been parsed and after the pipe has run, so an object with fifty thousand keys would be
 * built before anything refused it. {@link MAX_CONFIG_FIELDS} and
 * {@link MAX_CONFIG_VALUE_LENGTH} are the cheap refusal in front of that.
 *
 * ---------------------------------------------------------------------------
 * **Why `null` is spelled out on three fields and absent on the rest.**
 *
 * `PATCH` distinguishes *do not change this* from *clear this*, and JSON has one word for
 * both unless a body says otherwise: an absent key is the first and an explicit `null` is
 * the second. So `monthlyCapCents`, `capabilityNote` — the two settings whose *absence* is
 * itself a value — admit `null`, and everything else does not. `enabled` has no null because
 * a switch has two positions and V017 refuses a third.
 */

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  Validate,
  ValidateIf,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

import { PROVIDER_CONNECTION_KINDS, type ProviderConnectionKind } from "../db/schema";
import { CAPABILITY_NOTE_MAX_LENGTH } from "../providers/provider.config";
import { PageQuery } from "../tenancy/pagination";

/** The longest `display_name` V015 will store. */
export const MAX_DISPLAY_NAME_LENGTH = 120;

/**
 * The largest `monthly_cap_cents` the column can hold — `integer`'s maximum.
 *
 * Bounded here rather than left to PostgreSQL because an out-of-range `integer` is a `22003`
 * from the driver, and the client that sent a cap of ten billion deserves to be told which
 * field was out of range rather than reading `internal_error`.
 */
export const MAX_MONTHLY_CAP_CENTS = 2_147_483_647;

/**
 * How many settings one provider configuration may carry — **twenty**.
 *
 * Comfortably above every schema that ships (the largest declares three) and low enough that
 * a body cannot be used to make this service build a large object before refusing it. A
 * submission over the limit is refused as a whole rather than truncated: silently dropping a
 * setting is the failure this module answers `501` for elsewhere, and it would be no better
 * here.
 */
export const MAX_CONFIG_FIELDS = 20;

/**
 * The longest a configuration value may be — **2 048**, `base_url`'s own bound in V015.
 *
 * The longest thing any declared field holds is an address, so the address's limit is the
 * right ceiling for all of them. A field with a tighter rule — a capability note's
 * {@link CAPABILITY_NOTE_MAX_LENGTH} — is refused by the adapter's schema, which is where a
 * per-field bound belongs.
 */
export const MAX_CONFIG_VALUE_LENGTH = 2048;

/** The longest credential this API will accept. */
export const MAX_SECRET_LENGTH = 4096;

/** The longest password this API will pass to BetterAuth — its own `PASSWORD_MAX_LENGTH`. */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * A flat object of strings, bounded.
 *
 * A constraint class rather than `@ValidateNested` against a DTO, because the keys are not
 * known here: they are whichever fields the adapter for the body's `kind` declares, and a
 * class with declared properties could not accept `baseUrl` for one provider and `token` for
 * another without declaring the union of every adapter's schema — which is exactly the
 * `switch (kind)` decision **P1** exists to refuse.
 *
 * Inherited and prototype keys are not reachable: `Object.entries` reads own enumerable
 * properties only, so a body carrying `__proto__` is one more own key that the adapter's
 * schema will refuse as undeclared.
 */
@ValidatorConstraint({ name: "isProviderConfig" })
export class IsProviderConfig implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @returns Whether it is a flat, bounded object of strings.
   */
  validate(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length > MAX_CONFIG_FIELDS) {
      return false;
    }

    return entries.every(
      ([, setting]) => typeof setting === "string" && setting.length <= MAX_CONFIG_VALUE_LENGTH,
    );
  }

  /**
   * @param args - The validation context.
   * @returns What the client is told.
   */
  defaultMessage(args: ValidationArguments): string {
    return (
      `${args.property} must be an object of at most ${MAX_CONFIG_FIELDS} string settings, ` +
      `each at most ${MAX_CONFIG_VALUE_LENGTH} characters`
    );
  }
}

/**
 * A string with no leading or trailing whitespace.
 *
 * V015 and V017 both spell their presence rules `btrim(x) = x and x <> ''`, and a value that
 * only differs from a stored one by a space is a value somebody will one day fail to find.
 * Trimming *for* the caller was the alternative and is worse: it stores something other than
 * what was sent, which is the whole complaint this module makes about dropping a field.
 */
@ValidatorConstraint({ name: "isTrimmed" })
export class IsTrimmed implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @returns Whether it is a string that is already trimmed and not blank.
   */
  validate(value: unknown): boolean {
    return typeof value === "string" && value.trim() === value && value.length > 0;
  }

  /**
   * @param args - The validation context.
   * @returns What the client is told.
   */
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must not be blank or carry leading or trailing whitespace`;
  }
}

/** The `{id}` every operation below the collection takes. */
export class ConnectionParams {
  /**
   * `provider_connections.id`.
   *
   * A uuid check rather than a bare string, so a path that could not name a row is a `422`
   * before a statement is issued — and so a caller cannot use this path to send arbitrary
   * text into a `where` clause's parameter, which costs a round trip to answer `404`.
   */
  @IsUUID()
  id!: string;
}

/**
 * The query string of `GET /api/v1/providers`.
 *
 * Nothing but the window. Extending {@link PageQuery} rather than answering a bare array is
 * the #31 convention's own instruction — every list endpoint in this API answers
 * `{items, total, limit, offset}` — and a workspace's provider list is short enough that the
 * `count(*)` it costs is free.
 */
export class ListConnectionsQuery extends PageQuery {}

/**
 * The body of `POST /api/v1/providers`.
 *
 * `kind` and `config` are required and `displayName` is required, because there is no
 * sensible default for any of them: a connection with no name is a card with no heading, and
 * an empty config is refused by the adapter's own `required` unless the adapter genuinely
 * takes nothing.
 *
 * `!`-asserted rather than initialised, as everywhere in this service: `class-transformer`
 * assigns to these objects, and a default written here would be a value the pipe kept for a
 * field the client never sent.
 */
export class CreateConnectionDto {
  /**
   * Which provider this connects to.
   *
   * Checked against V015's six rather than against the registry's registered set: a kind
   * this build has no adapter for is a `501` naming the kinds that *are* available, which is
   * a more useful answer than *not one of six*. `ModelProviderRegistry.get` is where that
   * happens — see `provider.registry.ts` on why it is `501` and not `404`.
   */
  @IsIn(PROVIDER_CONNECTION_KINDS)
  kind!: ProviderConnectionKind;

  /** The card's heading. */
  @Validate(IsTrimmed)
  @Length(1, MAX_DISPLAY_NAME_LENGTH)
  @IsString()
  displayName!: string;

  /** The adapter's own settings, keyed by the field names its `configSchema()` declares. */
  @Validate(IsProviderConfig)
  config!: Record<string, string>;

  /**
   * The monthly cap in whole cents, or absent for *no cap*.
   *
   * `null` is admitted and means the same as absent here — on a create there is nothing to
   * clear — so that one client can send the same field shape to `POST` and `PATCH`.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONTHLY_CAP_CENTS)
  monthlyCapCents?: number | null;
}

/**
 * The body of `PATCH /api/v1/providers/{id}`.
 *
 * Every field is optional and an absent one is left alone — which is what distinguishes this
 * from the `PUT` `pricing.dto.ts` argues for: a price is a statement replaced outright,
 * while a connection is a row with five independent settings and *turn this one off* should
 * not require resending an address.
 *
 * **The credential is not here.** Replacing one is `POST /{id}/rotate`, because it is the
 * operation that has to validate against the live provider before it destroys anything, and
 * an edit that could silently carry a new key would be that operation without the check.
 */
export class UpdateConnectionDto {
  /**
   * The card's heading.
   *
   * `@ValidateIf` rather than `@IsOptional()`, and the difference is the whole of what this
   * body's null rule is: `@IsOptional()` skips validation for `null` as well as for absence,
   * so it would quietly *admit* `null` on a field that has no meaning for one. Only the two
   * settings below whose absence is itself a value may be cleared.
   */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(IsTrimmed)
  @Length(1, MAX_DISPLAY_NAME_LENGTH)
  @IsString()
  displayName?: string;

  /** The card's switch. No `null` — a switch has two positions and V017 refuses a third. */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  /** The monthly cap in whole cents. `null` clears it, which is *no cap*. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONTHLY_CAP_CENTS)
  monthlyCapCents?: number | null;

  /**
   * The card's second line. `null` clears it.
   *
   * A field of its own rather than a `config` entry, and the asymmetry is deliberate: the
   * note is a *connection* fact — V017 gives it a column beside the cap and the switch — and
   * only three of the five adapters declare it in their form schema. AC.2's Anthropic card
   * does not, yet mockup 07 draws it with *api.anthropic.com · primary coding lane* under
   * the name. Routing it through `config` would therefore make the note editable for some
   * providers and not others, for a reason that is about an adapter's form rather than about
   * the connection. Sending it inside `config` is refused; see
   * `provider-connections.service.ts`.
   */
  @IsOptional()
  @Validate(IsTrimmed)
  @Length(1, CAPABILITY_NOTE_MAX_LENGTH)
  @IsString()
  capabilityNote?: string | null;

  /**
   * The adapter's settings to change — the base URL or host edits the issue names.
   *
   * Merged over what is stored and validated as a whole, because a schema's rules can span
   * fields and a half-request cannot be judged against them. A body carrying this is
   * re-validated against the live provider before anything is written, exactly as an add is.
   */
  @IsOptional()
  @Validate(IsProviderConfig)
  config?: Record<string, string>;
}

/**
 * The body of `POST /api/v1/providers/{id}/reveal`.
 *
 * Optional in its entirety: a client whose session is fresh sends `{}` and is answered, and
 * a client that has been challenged sends the password. See `step-up.ts` for why those are
 * the two methods and why a wrong password is answered exactly as an absent one is.
 */
export class RevealConnectionDto {
  /**
   * The caller's own password, when they are stepping up with one.
   *
   * Never stored, never logged, and never compared here: it is handed to
   * `auth.api.verifyPassword`, which is BetterAuth's own scrypt verifier against the
   * caller's `credential` account.
   */
  @IsOptional()
  @IsString()
  @Length(1, MAX_PASSWORD_LENGTH)
  password?: string;
}

/**
 * The body of `POST /api/v1/providers/{id}/rotate`.
 *
 * One field, required. A rotation with no new credential is not a rotation, and the
 * operation that removes one without replacing it is `DELETE` — deliberately, because a
 * connection left credential-less would be *configured* and unusable, which is the state
 * V015's nullable column exists to describe for providers that genuinely need none.
 */
export class RotateConnectionDto {
  /**
   * The new credential.
   *
   * Live-validated against the provider before the old one is replaced. Not trimmed and not
   * normalised: a credential is an opaque string, and a service that "helpfully" stripped a
   * character would break a key that legitimately carried it.
   */
  @IsString()
  @Length(1, MAX_SECRET_LENGTH)
  secret!: string;
}
