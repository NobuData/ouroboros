/**
 * Which data origins an aggregate reads (DJ.2, [#1315](https://github.com/NobuData/ouroboros/issues/1315)).
 *
 * V141 (DJ.1) marks every run, and every row derived from one, `live`, `simulated` or `seeded`;
 * V154 splits the daily grain the same way. Every aggregate a read API answers is computed over
 * the rows of **one** origin — `live` unless the caller asks otherwise — and says which origins the
 * workspace holds at all, so "no live data" and "zero" are never the same answer:
 *
 *   asked        reads              marked
 *   ──────────────────────────────────────────────────────────────────────────────────────────
 *   (nothing)    live rows          —
 *   live         live rows          —
 *   simulated    simulated rows     —
 *   seeded       seeded rows        —
 *   all          every row          `mixed: true` when the answer sums more than one origin
 *
 * A window whose filter keeps no rows answers **no data** — a null figure — never zero and never a
 * fall-back to another origin's rows.
 */

import { DATA_ORIGINS, type DataOrigin } from "../../db/schema";

/** What a read API's `origin` parameter takes: one origin, or every one summed. */
export type OriginFilter = DataOrigin | "all";

/** Every {@link OriginFilter}, as the OpenAPI enum lists them. */
export const ORIGIN_FILTERS = [...DATA_ORIGINS, "all"] as const satisfies readonly OriginFilter[];

/** What an aggregate reads when the caller names no origin. */
export const DEFAULT_ORIGIN: OriginFilter = "live";

/**
 * Narrow a query value to an {@link OriginFilter}.
 *
 * @param value - The raw value.
 * @returns Whether it is one.
 */
export function isOriginFilter(value: unknown): value is OriginFilter {
  return typeof value === "string" && (ORIGIN_FILTERS as readonly string[]).includes(value);
}

/**
 * The origins a filter keeps.
 *
 * @param filter - The filter.
 * @returns Every origin for `all`, otherwise the one named.
 */
export function originsOf(filter: OriginFilter): readonly DataOrigin[] {
  return filter === "all" ? DATA_ORIGINS : [filter];
}

/**
 * Whether a row's origin passes a filter.
 *
 * @param filter - The filter.
 * @param origin - The row's origin.
 * @returns True when the filter keeps it.
 */
export function keeps(filter: OriginFilter, origin: DataOrigin): boolean {
  return filter === "all" || filter === origin;
}

/**
 * The distinct origins among some rows, in {@link DATA_ORIGINS} order.
 *
 * @param rows - Anything carrying an origin.
 * @returns The origins present; empty when there are no rows.
 */
export function originsPresent(rows: Iterable<{ readonly origin: DataOrigin }>): DataOrigin[] {
  const seen = new Set<DataOrigin>();

  for (const row of rows) {
    seen.add(row.origin);
  }

  return DATA_ORIGINS.filter((origin) => seen.has(origin));
}

/**
 * Whether an answer sums more than one origin — only ever true for `all`.
 *
 * @param filter - What was asked.
 * @param used - The origins of the rows the answer was computed from.
 * @returns True when the answer is mixed.
 */
export function isMixed(filter: OriginFilter, used: readonly DataOrigin[]): boolean {
  return filter === "all" && used.length > 1;
}
