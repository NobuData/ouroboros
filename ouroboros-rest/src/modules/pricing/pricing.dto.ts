/**
 * What a price-override request may contain — the `PUT` body, the `DELETE` query string and
 * the listing's window, as `class-validator` classes
 * ([#586](https://github.com/NobuData/ouroboros/issues/586)).
 *
 * **These decorators restate V012's CHECKs, deliberately.** The database is still the
 * authority — `model_prices_token_requires_amounts` and its three siblings are what actually
 * make a seat row incapable of carrying a rate — and restating them here changes only *who
 * says no and how*. Without it, a body with an output rate and no input rate is a constraint
 * violation surfacing as `500 internal_error` with a message the client may not be shown; with
 * it, it is a `422` whose `details` names `inputCentsPer1m` and says what was wrong. The rule
 * is unchanged either way; the difference is whether the person who typed it can act on the
 * answer.
 *
 * The four amount rules are four constraints rather than one, mirroring V012's own reason for
 * splitting them: a rejection should name which rule was broken rather than report that the
 * body is wrong somehow.
 *
 * `@Validate` with a constraint class rather than `@ValidateIf` plus `@IsNumber`, because the
 * rules here are *conditional on a sibling field* — what `inputCentsPer1m` may be depends
 * entirely on `billingMode` — and `@ValidateIf` returning false skips every decorator on the
 * property, including the one that would have caught a missing required rate. One constraint
 * that reads both fields is the only spelling that can refuse both *absent when required* and
 * *present when forbidden*.
 */

import {
  IsIn,
  Matches,
  MaxLength,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

import type { BillingMode } from "../db/schema";
import { PageQuery } from "../tenancy/pagination";
import { BILLING_MODES } from "./price";

/**
 * The family wildcard, and the only wildcard V012 has.
 *
 * `match_provider_kind = '*'` is every kind and `match_model = '*'` is every model of a kind —
 * which is how a workspace says *everything I reach through this provider is free*, the row
 * that makes mockup 21's `llama-4-maverick` render `$0`. No other glob exists: a `*` anywhere
 * inside a model identifier is rejected below, exactly as `model_prices_match_model_format`
 * rejects it.
 */
export const FAMILY_WILDCARD = "*";

/**
 * How a provider kind may be spelled — V012's `model_prices_match_provider_kind_format`, with
 * capitals admitted.
 *
 * The column stores the kind folded, and the service folds before it writes or looks up, so a
 * caller sending `Anthropic` is not making a mistake — it is spelling the same kind. Refusing
 * it here would refuse a request this service knows exactly what to do with. What is refused
 * is a shape no folding can rescue: an empty group, a leading or trailing separator, a
 * character outside the class.
 */
export const CONNECTION_KIND_PATTERN = /^(\*|[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*)$/;

/** The longest a provider kind may be — `model_prices_match_provider_kind_format`. */
export const MAX_CONNECTION_KIND_LENGTH = 64;

/** The longest a model identifier may be — `model_prices_match_model_format`. */
export const MAX_MODEL_ID_LENGTH = 200;

/**
 * How a model identifier may be spelled — non-blank, and carrying no `*` of its own.
 *
 * Unfolded, unlike the kind: a model identifier is a name the vendor chose, some of them carry
 * capitals, and `token_usage.model` and `runs.model` store them unfolded too.
 */
export const MODEL_ID_PATTERN = /^(\*|[^*\s](?:[^*\n\r]*[^*\s])?)$/;

/** What a client is told when {@link CONNECTION_KIND_PATTERN} refuses their provider kind. */
export const CONNECTION_KIND_MESSAGE =
  "connectionKind must be a provider kind — letters and digits in groups separated by a " +
  `single . _ or - — or "${FAMILY_WILDCARD}" for every kind`;

/** What a client is told when {@link MODEL_ID_PATTERN} refuses their model identifier. */
export const MODEL_ID_MESSAGE =
  "modelId must be a model identifier carrying no * of its own and no surrounding " +
  `whitespace, or "${FAMILY_WILDCARD}" for every model of the kind`;

/**
 * The most a rate may be: `numeric(14, 4)`'s largest value.
 *
 * Ten integer digits and four decimal places. Bounded here rather than left to the column
 * because a `numeric` overflow is a `22003` from the driver, and the client that sent
 * `1e30` deserves to be told which field was out of range.
 */
export const MAX_RATE_CENTS_PER_1M = 9_999_999_999.9999;

/** How many decimal places a rate may carry — the column's scale. See {@link isStorableRate}. */
export const RATE_DECIMAL_PLACES = 4;

/**
 * Whether a value is a rate this column can hold exactly.
 *
 * Finite, non-negative, within range, and no finer than four decimal places. The last is the
 * one worth arguing for: a fifth decimal place would be rounded by `numeric(14, 4)` on the way
 * in, so the workspace would be shown a rate it did not enter and would be billed against a
 * number it never agreed to. Refusing is the only answer that does not silently change what
 * somebody typed.
 *
 * The decimal test is done on the value's own decimal rendering rather than by multiplying by
 * `10^4` and comparing to an integer — the multiplication is a float operation and reports
 * `0.0001` as having more places than it does.
 *
 * @param value - Whatever arrived in the field.
 * @returns Whether it is a number the column can store as sent.
 */
export function isStorableRate(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }

  if (value < 0 || value > MAX_RATE_CENTS_PER_1M) {
    return false;
  }

  const [, decimals = ""] = String(value).split(".");

  // An exponent means a rendering this test cannot read digits out of — `1e-7`, and anything
  // small enough that JavaScript prefers that form. Every one of those is finer than four
  // places, which is the answer either way.
  return !String(value).includes("e") && decimals.length <= RATE_DECIMAL_PLACES;
}

/** The shape the amount constraint below reads its sibling fields out of. */
interface AmountBearingBody {
  billingMode?: unknown;
  inputCentsPer1m?: unknown;
  outputCentsPer1m?: unknown;
}

/**
 * One amount, checked against the billing mode beside it — V012's four amount CHECKs, as a
 * message a client can act on.
 *
 * | `billingMode` | This field | The rule it restates |
 * |---|---|---|
 * | `token` | required, a storable rate | `model_prices_token_requires_amounts` |
 * | `seat`, `usage` | must be absent | `model_prices_metered_amounts_absent` |
 * | `free` | absent, or exactly `0` | `model_prices_free_amounts_zero` |
 *
 * A body whose `billingMode` is itself not one of the four is passed here — `@IsIn` on that
 * field is already reporting it, and a second complaint about an amount that could not be
 * judged would be noise in `details`.
 */
@ValidatorConstraint({ name: "rateMatchesBillingMode" })
export class RateMatchesBillingMode implements ValidatorConstraintInterface {
  /**
   * @param value - What the field carries.
   * @param args - The validation context, whose `object` is the body being validated.
   * @returns Whether the amount is legal for the mode beside it.
   */
  validate(value: unknown, args: ValidationArguments): boolean {
    const { billingMode } = args.object as AmountBearingBody;

    switch (billingMode) {
      case "token":
        return isStorableRate(value);
      case "seat":
      case "usage":
        return value === undefined;
      case "free":
        return value === undefined || value === 0;
      default:
        // Not a mode this table has. `billingMode`'s own `@IsIn` is the complaint.
        return true;
    }
  }

  /**
   * @param args - The validation context.
   * @returns What the client is told, naming the mode that decided it.
   */
  defaultMessage(args: ValidationArguments): string {
    const { billingMode } = args.object as AmountBearingBody;

    switch (billingMode) {
      case "token":
        return (
          `${args.property} is required when billingMode is token, and must be a rate in ` +
          `cents per 1M tokens between 0 and ${MAX_RATE_CENTS_PER_1M} with at most ` +
          `${RATE_DECIMAL_PLACES} decimal places`
        );
      case "seat":
      case "usage":
        return (
          `${args.property} must be omitted when billingMode is ${billingMode} — that ` +
          "billing is not a function of tokens, so there is no rate to record"
        );
      default:
        return `${args.property} must be omitted or 0 when billingMode is free`;
    }
  }
}

/**
 * A `token` price has to be a price — V012's `model_prices_token_amounts_meaningful`.
 *
 * Both rates at zero is a `free` row wearing the wrong mode, and it would render `$0` for a
 * model somebody is being invoiced for. One direction free is a real vendor arrangement and
 * stays legal.
 *
 * Reported against `billingMode` rather than against either amount, because neither amount is
 * wrong on its own — the pair is, and the field the client should change is the mode.
 */
@ValidatorConstraint({ name: "tokenPriceIsMeaningful" })
export class TokenPriceIsMeaningful implements ValidatorConstraintInterface {
  /**
   * @param value - The billing mode.
   * @param args - The validation context.
   * @returns Whether the body avoids claiming a per-token price of nothing in both directions.
   */
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value !== "token") {
      return true;
    }

    const { inputCentsPer1m, outputCentsPer1m } = args.object as AmountBearingBody;

    return inputCentsPer1m !== 0 || outputCentsPer1m !== 0;
  }

  /** @returns What the client is told. */
  defaultMessage(): string {
    return (
      "a token price of 0 in both directions is a free model recorded under the wrong " +
      "billingMode — send billingMode free instead"
    );
  }
}

/**
 * The body of `PUT /api/v1/registry/prices`.
 *
 * A `PUT` rather than a `PATCH`, and every field that the mode requires is required: this
 * replaces a workspace's statement about one model's price outright. A partial correction —
 * "change the output rate and leave the input one" — is not a thing that can be checked
 * against V012's amount rules without reading the row first, and a price assembled from half a
 * request and half a stored row is a number nobody entered.
 *
 * `!`-asserted rather than initialised, as everywhere in this service: `class-transformer`
 * assigns to these objects, and a default written here would be a value the pipe kept for a
 * field the client never sent.
 */
export class PutPriceOverrideDto {
  /**
   * Which provider kind this price is for, or `'*'` for every kind.
   *
   * Folded to lower case by the service before it is written, so `Anthropic` and `anthropic`
   * are one kind rather than two rows that would shadow each other on lookup.
   */
  @Matches(CONNECTION_KIND_PATTERN, { message: CONNECTION_KIND_MESSAGE })
  @MaxLength(MAX_CONNECTION_KIND_LENGTH)
  connectionKind!: string;

  /**
   * Which model, or `'*'` for every model of the kind.
   *
   * `'*'` is the family row a seat- or usage-billed provider is priced by, and a workspace's
   * `('openai_compatible', '*') → free` is how it says its OpenAI-compatible endpoint is a
   * local one. A literal `*` *inside* an identifier is refused, which is what keeps "the glob
   * is `*` and nothing else" a rule rather than a convention.
   */
  @Matches(MODEL_ID_PATTERN, { message: MODEL_ID_MESSAGE })
  @MaxLength(MAX_MODEL_ID_LENGTH)
  modelId!: string;

  /** How the money works — which of mockup 21's four cells this override renders. */
  @IsIn(BILLING_MODES)
  @Validate(TokenPriceIsMeaningful)
  billingMode!: BillingMode;

  /** Input rate, cents per one million tokens. Required for `token`, forbidden for `seat`/`usage`. */
  @Validate(RateMatchesBillingMode)
  inputCentsPer1m?: number;

  /** Output rate, cents per one million tokens. Same rules, and priced separately by every vendor. */
  @Validate(RateMatchesBillingMode)
  outputCentsPer1m?: number;
}

/**
 * The query string of `DELETE /api/v1/registry/prices`.
 *
 * The pair is in the query rather than the path because a model identifier is a vendor's
 * string — `qwen3-coder:32b`, `openai/gpt-oss-120b`, `*` — and half of those need escaping to
 * survive a path segment. One path with three verbs is also what the ticket specifies.
 *
 * The two fields repeat {@link PutPriceOverrideDto}'s rather than extending it, because what
 * they mean here is different: they address a row rather than describe one, and a class that
 * inherited the amount fields would accept a rate on a `DELETE`.
 */
export class DeletePriceOverrideQuery {
  /** The provider kind whose override is being withdrawn. Folded before the lookup. */
  @Matches(CONNECTION_KIND_PATTERN, { message: CONNECTION_KIND_MESSAGE })
  @MaxLength(MAX_CONNECTION_KIND_LENGTH)
  connectionKind!: string;

  /** The model whose override is being withdrawn. */
  @Matches(MODEL_ID_PATTERN, { message: MODEL_ID_MESSAGE })
  @MaxLength(MAX_MODEL_ID_LENGTH)
  modelId!: string;
}

/**
 * The query string of `GET /api/v1/registry/prices`.
 *
 * Nothing but the window. Extending {@link PageQuery} rather than answering an unpaginated
 * array is the #31 convention's own instruction — every list endpoint in this API answers
 * `{items, total, limit, offset}` — and it costs one `count(*)` over a table whose override
 * population is a workspace's own corrections.
 */
export class ListPriceOverridesQuery extends PageQuery {}
