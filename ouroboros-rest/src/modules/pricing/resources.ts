/**
 * Row → resource, for the pricing surface — the same seam `settings/resources.ts` keeps.
 *
 * The rows are the database's (snake_case, `Date`s, `numeric` as text); the resources are the
 * contract's (camelCase, ISO 8601, and exactly what `openapi.yaml` promises). Two things are
 * decided here rather than at every future call site:
 *
 * **1. `—` is absence, not a value.** {@link ModelPriceResource.price} is `null` exactly when
 * the catalog covers nothing for the pair, and there is no `billingMode` outside that object
 * for it to be confused with. A client cannot read a rate off an unpriced model, because on an
 * unpriced model there is nowhere for a rate to be. That is the ticket's *asserted explicitly
 * to be distinguishable from `free`*, made structural rather than tested for.
 *
 * **2. Provenance is required on every price.** {@link ResolvedPriceResource.provenance} is
 * not optional, so a priced answer that could not say where its number came from does not
 * type-check. *A price with no provenance is a bug*, enforced by the shape.
 *
 * **The amounts become numbers here, and only here.** `numeric(14, 4)` crosses this service as
 * a string — see `db/schema.ts` — and the contract publishes a number, exactly as the
 * dashboard's `costCents` does. One conversion, at the edge, where the precision trade is
 * visible: every rate the catalog holds is far inside the range a double represents exactly at
 * four decimal places, and the DTO refuses a finer one on the way in.
 */

import type { BillingMode, ModelPrice, PriceSource } from "../db/schema";
import { renderPrice, type ModelKey, type ResolvedPrice } from "./price";

/** Where a price came from, as the contract publishes it. */
export interface PriceProvenanceResource {
  /** `bundled` — the vendored snapshot — or `override` — this workspace's own correction. */
  readonly source: PriceSource;
  /**
   * The snapshot a bundled price came from — `2026-08-15+litellm.70d51a1`.
   *
   * Null **exactly** on an override, which is not a version of anything. A client rendering
   * #592's hover shows the version for a bundled price and the word *override* for the other,
   * which is why the two fields are separate rather than one pre-formatted string.
   */
  readonly catalogVersion: string | null;
  /** When this price took effect, ISO 8601 — upstream's commit for a bundled row. */
  readonly effectiveAt: string;
}

/** A price that exists, in whichever of the four shapes it takes. */
export interface ResolvedPriceResource {
  /** `token`, `seat`, `usage` or `free` — which shape {@link ModelPriceResource.display} took. */
  readonly billingMode: BillingMode;
  /** Input rate in cents per 1M tokens; null for every mode but `token`, and possibly for `free`. */
  readonly inputCentsPer1m: number | null;
  /** Output rate in cents per 1M tokens; same rule. */
  readonly outputCentsPer1m: number | null;
  /** Where this number came from. Never absent — see this file's header. */
  readonly provenance: PriceProvenanceResource;
}

/**
 * What one model costs this workspace — the `$ per 1M in·out` cell, resolved.
 *
 * Carries the pair it answers for as well as the answer, so a batch response can be read
 * without counting positions against the request.
 */
export interface ModelPriceResource {
  /** The provider kind asked about, folded, or null for an unbound alias. */
  readonly connectionKind: string | null;
  /** The model identifier asked about. */
  readonly modelId: string;
  /** The price, or **null** when the catalog covers nothing for the pair. */
  readonly price: ResolvedPriceResource | null;
  /**
   * The cell, already rendered: `"$10 · $50"`, `"seat-based"`, `"usage-based"`, `"$0"`, `"—"`.
   *
   * Served rather than left to the client, which is the ticket's *render rules codified in one
   * place, so the UI never re-derives them*. A client is free to render from `price` instead —
   * a currency-aware formatter would want to — but the fallback for *no price* is the one thing
   * it must not invent, and this field is what makes inventing it unnecessary.
   */
  readonly display: string;
}

/**
 * One correction this workspace has recorded — what the override CRUD reads and writes.
 *
 * Distinct from {@link ModelPriceResource} on purpose. That one answers *what does this cost*,
 * and its answer may come from the bundled catalog; this one is a row the workspace owns, so
 * it has no `source` (it is always `override`), it always has a `connectionKind` (V012 requires
 * one on every row), and it carries the stamps a settings table shows.
 */
export interface PriceOverrideResource {
  /** The provider kind this correction applies to, or `"*"` for every kind. */
  readonly connectionKind: string;
  /** The model it applies to, or `"*"` for every model of the kind. */
  readonly modelId: string;
  /** How the money works under this correction. */
  readonly billingMode: BillingMode;
  /** Input rate in cents per 1M tokens, or null for a mode that carries none. */
  readonly inputCentsPer1m: number | null;
  /** Output rate in cents per 1M tokens, or null for a mode that carries none. */
  readonly outputCentsPer1m: number | null;
  /** The cell this correction renders — the same five shapes, so a table can preview it. */
  readonly display: string;
  /** When this correction took effect, ISO 8601. Moves on every save. */
  readonly effectiveAt: string;
  /** When the row last changed, ISO 8601 — the `touch_updated_at()` trigger's stamp. */
  readonly updatedAt: string;
}

/**
 * A resolved price as the contract publishes it.
 *
 * @param price - The price.
 * @returns The resource, amounts converted and provenance carried.
 */
export function resolvedPriceResource(price: ResolvedPrice): ResolvedPriceResource {
  return {
    billingMode: price.billingMode,
    inputCentsPer1m: centsAsNumber(price.inputCentsPer1m),
    outputCentsPer1m: centsAsNumber(price.outputCentsPer1m),
    provenance: {
      source: price.provenance.source,
      catalogVersion: price.provenance.catalogVersion,
      effectiveAt: price.provenance.effectiveAt.toISOString(),
    },
  };
}

/**
 * One answer to *what does this model cost*, pair and rendering included.
 *
 * @param key - The pair that was asked about, as the service normalised it — so a caller who
 *   sent `Anthropic` sees `anthropic` and knows which spelling was looked up.
 * @param price - What resolved, or `undefined` when nothing did.
 * @returns The resource. `price` is null and `display` is `"—"` for an uncovered model, and
 *   those two are the same fact said twice rather than two states that could disagree.
 */
export function modelPriceResource(
  key: ModelKey,
  price: ResolvedPrice | undefined,
): ModelPriceResource {
  return {
    connectionKind: key.connectionKind,
    modelId: key.modelId,
    price: price === undefined ? null : resolvedPriceResource(price),
    display: renderPrice(price),
  };
}

/**
 * One stored override, as the contract publishes it.
 *
 * The row is read back from what the write returned rather than re-read, for the reason
 * `settings/resources.ts` gives: what the upsert returned *is* the new state, trigger stamps
 * included, and reading again after writing would be a race with the next administrator
 * dressed up as confirmation.
 *
 * @param row - The override row. Its `billing_mode` and amounts are re-read through the same
 *   mapper the read path uses, so a stored row that contradicted V012 would fail here too
 *   rather than only where it is resolved.
 * @param price - The same row as a price — passed in rather than re-derived so the rendering
 *   and the amounts cannot come from two different readings of one row.
 * @returns The resource.
 */
export function priceOverrideResource(
  row: ModelPrice,
  price: ResolvedPrice,
): PriceOverrideResource {
  return {
    connectionKind: row.match_provider_kind,
    modelId: row.match_model,
    billingMode: price.billingMode,
    inputCentsPer1m: centsAsNumber(price.inputCentsPer1m),
    outputCentsPer1m: centsAsNumber(price.outputCentsPer1m),
    display: renderPrice(price),
    effectiveAt: row.effective_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * A `numeric(14, 4)` as the contract's number.
 *
 * The one conversion in this module, and the one place the precision trade is made — see this
 * file's header. Null stays null: an absent rate is not a zero rate, which is the same
 * distinction the whole surface is built on, one field down.
 *
 * @param cents - The amount as `pg` handed it back, or null.
 * @returns The number, or null.
 */
function centsAsNumber(cents: string | null): number | null {
  return cents === null ? null : Number(cents);
}
