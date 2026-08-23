/**
 * What a model costs, and the five things that sentence can honestly say
 * ([#586](https://github.com/NobuData/ouroboros/issues/586)).
 *
 * Mockup 21's `$ per 1M in·out` column has four render shapes and one absence, and this file
 * is the single place all five are decided — the ticket's *render rules codified in one
 * place, so the UI never re-derives them*:
 *
 * ```
 * token → "$10 · $50"      seat → "seat-based"      usage → "usage-based"
 * free  → "$0"             no row → "—"
 * ```
 *
 * **`$0` and `—` are different facts, and this file is where they are kept apart.** `$0` is a
 * `free` row: a model that genuinely costs nothing per token, because it runs on hardware the
 * workspace already pays for. `—` is the *absence* of a row: we have no price for this model.
 * The type below makes that structural — {@link ResolvedPrice} has no member meaning
 * "unknown", so an uncovered model is `undefined` and cannot be handed to a formatter that
 * would render it as a number. On a page somebody sizes a budget from, "unknown" quietly
 * becoming "free" is the one failure this whole surface exists to prevent.
 *
 * **Four interfaces rather than one with four nullable fields**, mirroring V012's four amount
 * CHECKs for the reason that migration gives for splitting them: a `seat` row *cannot* carry
 * a per-token amount and a `token` row *cannot* be missing one, and a union says so at
 * compile time where a nullable pair would leave every reader to remember it. It is also what
 * lets {@link renderPrice} be a total `switch` with no fallback branch — and a fallback
 * branch on this data would be a branch that renders a guess.
 *
 * **Provenance is not optional.** {@link ResolvedPrice.provenance} is required on all four,
 * so a price without it does not type-check, let alone reach a screen. A number about money
 * that cannot say where it came from is the ticket's stated bug.
 */

import type { BillingMode, ModelPrice, PriceSource } from "../db/schema";

/**
 * The cell for a model the catalog does not cover — an em dash, and **never** `$0`.
 *
 * A constant rather than a literal at the two call sites, because the assertion that
 * distinguishes it from {@link FREE} has to be able to name it.
 */
export const UNPRICED = "—";

/** The cell for a `free` row: this really does cost nothing per call. */
export const FREE = "$0";

/** The cell for a `seat` row — Copilot. Billed per person, so there is no rate to show. */
export const SEAT_BASED = "seat-based";

/** The cell for a `usage` row — Cursor. Metered on terms this catalog cannot express. */
export const USAGE_BASED = "usage-based";

/**
 * What separates the two rates in a `token` cell — space, U+00B7 middle dot, space.
 *
 * Taken from the mockup rather than invented: `$15 · $75`. A hyphen would read as a range and
 * a slash as a division, and this is neither — it is two prices for two different things.
 */
export const RATE_SEPARATOR = " · ";

/**
 * A pair the registry asks about: which provider kind, and which model on it.
 *
 * `connectionKind` is nullable because mockup 21's `gpt5-experiments` alias names a model and
 * no provider. That is not an error and does not resolve to `$0` — nothing has told us who
 * would be billing, so it resolves to nothing and renders `—`.
 */
export interface ModelKey {
  /** The AC.1 provider kind — `anthropic`, `copilot`, `ollama`, … — or null for an unbound alias. */
  readonly connectionKind: string | null;
  /** The model identifier as the vendor spells it. Never folded; some of them carry capitals. */
  readonly modelId: string;
}

/**
 * Where a price came from — served on every answer, and what #592 shows on hover.
 *
 * Two sources and one version between them: a bundled row names the snapshot it was
 * transformed from (`2026-08-15+litellm.70d51a1`), and an override names none, because an
 * override is not a version of anything — it is a workspace's own statement about its own
 * invoice.
 */
export interface PriceProvenance {
  /** `bundled` — the vendored snapshot said so — or `override` — this workspace did. */
  readonly source: PriceSource;
  /**
   * Which snapshot a bundled price came from; null on an override.
   *
   * Null **exactly** when `source` is `override`, which V012's
   * `model_prices_catalog_version_for_bundled` CHECK enforces from the other side.
   */
  readonly catalogVersion: string | null;
  /**
   * When these prices took effect as far as the source knows — upstream's commit timestamp
   * for a bundled row, the moment of the write for an override.
   *
   * Carried because "where did this number come from" is not fully answered by *who said it*:
   * a rate that took effect last quarter and a rate saved this morning are different claims,
   * and DASH-J.4 ([#92](https://github.com/NobuData/ouroboros/issues/92)) needs the second
   * half when it prices a ledger. It is **not** a history axis — the table holds one row per
   * (workspace, kind, model), so this says when what is true now became true, and re-pricing
   * against last quarter's rates is #598's question.
   */
  readonly effectiveAt: Date;
}

/**
 * A per-token price: both rates, in cents per one million tokens.
 *
 * The amounts are **strings**, and deliberately: `numeric(14, 4)` does not fit a JavaScript
 * number without a rounding decision, and the one arithmetic error this surface must not make
 * is rounding a rate down to a zero that reads as free. The same trade `token_usage.cost_cents`
 * states in `db/schema.ts`; a consumer either does its arithmetic in SQL or converts
 * deliberately, and {@link resources} converts exactly once, at the contract's edge.
 */
export interface TokenPrice {
  readonly billingMode: "token";
  /** Input rate, cents per 1M tokens. Never null — V012's `model_prices_token_requires_amounts`. */
  readonly inputCentsPer1m: string;
  /** Output rate, cents per 1M tokens. Never null, for the same reason. */
  readonly outputCentsPer1m: string;
  readonly provenance: PriceProvenance;
}

/** A seat-billed model: there is a price, and it is not a function of tokens. */
export interface SeatPrice {
  readonly billingMode: "seat";
  /** Always null — V012's `model_prices_metered_amounts_absent`. A rate here would be charged to somebody. */
  readonly inputCentsPer1m: null;
  /** Always null, for the same reason. */
  readonly outputCentsPer1m: null;
  readonly provenance: PriceProvenance;
}

/** A vendor-metered model: there is a price, and this catalog cannot express it as two rates. */
export interface UsagePrice {
  readonly billingMode: "usage";
  /** Always null — V012's `model_prices_metered_amounts_absent`. */
  readonly inputCentsPer1m: null;
  /** Always null, for the same reason. */
  readonly outputCentsPer1m: null;
  readonly provenance: PriceProvenance;
}

/**
 * A model that costs nothing per call — one running locally.
 *
 * The amounts are `string | null` rather than `null`, because V012 accepts both spellings of
 * zero and both are true: a locally served model has no rate at all, and a vendor publishing
 * `0` is saying the same thing. Nothing is normalised away here, so a consumer summing a
 * ledger sees what the row actually holds.
 */
export interface FreePrice {
  readonly billingMode: "free";
  /** Zero or absent — V012's `model_prices_free_amounts_zero`. */
  readonly inputCentsPer1m: string | null;
  /** Zero or absent, for the same reason. */
  readonly outputCentsPer1m: string | null;
  readonly provenance: PriceProvenance;
}

/**
 * One resolved price, whatever shape it turned out to be.
 *
 * **There is no member for "unknown"**, which is the point: an uncovered model is
 * `undefined`, so the `—` cell is reached by absence rather than by a value that a formatter
 * could mistake for a rate. See this file's header.
 */
export type ResolvedPrice = TokenPrice | SeatPrice | UsagePrice | FreePrice;

/**
 * A row of `model_prices` as a price, with the row's own CHECKs re-read on the way through.
 *
 * The re-reading is not distrust of the database — V012's four amount CHECKs make each of
 * these states impossible — it is what turns "impossible" into "loud". A `token` row that
 * arrived with a null amount can only mean the mirror and the migrations have drifted, and
 * the two ways of handling that are a thrown error naming the row or a cell that quietly
 * reads `—` for a model somebody is being invoiced for. The second is the failure this
 * ticket exists to prevent, so this throws.
 *
 * @param row - The row `ouroboros.model_price()` returned.
 * @returns The price it states.
 * @throws {Error} When the row contradicts V012 — a `token` row missing an amount, a `seat`
 *   or `usage` row carrying one, or a `billing_mode` outside the four. Unreachable against a
 *   migrated database, and a programming or migration fault rather than a request's.
 */
export function priceFromRow(row: ModelPrice): ResolvedPrice {
  const provenance: PriceProvenance = {
    source: row.source,
    catalogVersion: row.catalog_version,
    effectiveAt: row.effective_at,
  };

  switch (row.billing_mode) {
    case "token":
      if (row.input_cents_per_1m === null || row.output_cents_per_1m === null) {
        throw new Error(malformed(row, "a token price is missing one of its two rates"));
      }

      return {
        billingMode: "token",
        inputCentsPer1m: row.input_cents_per_1m,
        outputCentsPer1m: row.output_cents_per_1m,
        provenance,
      };

    case "seat":
    case "usage":
      if (row.input_cents_per_1m !== null || row.output_cents_per_1m !== null) {
        throw new Error(malformed(row, `a ${row.billing_mode} price carries a per-token rate`));
      }

      return {
        billingMode: row.billing_mode,
        inputCentsPer1m: null,
        outputCentsPer1m: null,
        provenance,
      };

    case "free":
      return {
        billingMode: "free",
        inputCentsPer1m: row.input_cents_per_1m,
        outputCentsPer1m: row.output_cents_per_1m,
        provenance,
      };

    default:
      // `billing_mode` is a union in the mirror and a CHECK in the database, so reaching here
      // means one of the two has grown a word the other has not. Named rather than defaulted,
      // because a fifth mode silently rendering as a fourth is a wrong cell that nobody sees.
      throw new Error(malformed(row, `unknown billing mode ${String(row.billing_mode)}`));
  }
}

/**
 * How a contradictory row is described in the log.
 *
 * Names the lookup key and the rule, and nothing a caller sent. There is no secret here — the
 * bundled catalog ships in this repository — but the habit is the service's: a message a
 * developer reads should say which row and which rule, not repeat a driver's diagnosis.
 *
 * @param row - The offending row.
 * @param problem - Which of V012's rules it breaks.
 * @returns The message.
 */
function malformed(row: ModelPrice, problem: string): string {
  return (
    `ouroboros.model_prices holds a row that V012 forbids: ${problem} ` +
    `(${row.match_provider_kind}/${row.match_model}, source ${row.source}). ` +
    "The amount CHECKs in V012__model_prices.sql make this state unreachable, so the " +
    "migrations and src/modules/db/schema.ts have drifted apart."
  );
}

/**
 * The cell mockup 21 draws for one model — the whole render rule, in one place.
 *
 * @param price - The resolved price, or `undefined` for a model the catalog does not cover.
 * @returns `"$10 · $50"`, `"seat-based"`, `"usage-based"`, `"$0"`, or `"—"`. Never an empty
 *   string, and never `"$0"` for an uncovered model.
 */
export function renderPrice(price: ResolvedPrice | undefined): string {
  if (price === undefined) {
    return UNPRICED;
  }

  switch (price.billingMode) {
    case "token":
      return (
        `$${dollarsFromCents(price.inputCentsPer1m)}` +
        RATE_SEPARATOR +
        `$${dollarsFromCents(price.outputCentsPer1m)}`
      );
    case "seat":
      return SEAT_BASED;
    case "usage":
      return USAGE_BASED;
    case "free":
      // Whatever the row holds — a null, or a `0.0000` a vendor published — the claim is the
      // same one, and it is the mode that makes it rather than the amount.
      return FREE;
  }
}

/**
 * Cents per 1M as dollars per 1M, without going through a float.
 *
 * `1500.0000` → `15`. `25.0000` → `0.25`. `0.2500` → `0.0025`.
 *
 * **String arithmetic rather than `Number(cents) / 100`**, for the reason the column is
 * `numeric(14, 4)` in the first place: a binary float cannot hold `0.0001` exactly, and the
 * error it makes is invisible until it is a total on somebody's invoice. Dividing by a power
 * of ten is a decimal-point move, so moving it is all this does — no precision is created and
 * none is lost.
 *
 * Trailing zeros are trimmed because the mockup renders `$15`, not `$15.0000`, and no
 * thousands separator is inserted: a rate is a bare decimal here, and where the digits are
 * grouped is the stylesheet's business rather than this service's.
 *
 * @param cents - The amount as `pg` hands a `numeric` back: digits, optionally a `.`, digits.
 * @returns The same amount in dollars, as a plain decimal string with no currency sign.
 */
function dollarsFromCents(cents: string): string {
  const [whole, fraction = ""] = cents.trim().split(".");

  // Every significant digit, and how many of them are behind the point once ÷100 has moved it
  // two places further right.
  const digits = `${whole}${fraction}`;
  const decimals = fraction.length + 2;
  const padded = digits.padStart(decimals + 1, "0");
  const split = padded.length - decimals;

  const integer = padded.slice(0, split).replace(/^0+(?=\d)/, "");
  const decimal = padded.slice(split).replace(/0+$/, "");

  return decimal === "" ? integer : `${integer}.${decimal}`;
}

/**
 * The four modes, as a list — what a DTO validates against and a test iterates.
 *
 * Derived from nothing: it restates V012's `model_prices_billing_mode` CHECK, exactly as
 * `db/schema.ts`'s {@link BillingMode} restates it as a type, and `price.spec.ts` holds the
 * two to each other so a fifth mode cannot be added to one and not the other.
 */
export const BILLING_MODES: readonly BillingMode[] = ["token", "seat", "usage", "free"];
