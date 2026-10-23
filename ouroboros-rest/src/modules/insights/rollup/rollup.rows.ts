/**
 * Building `metric_daily` rows by aggregation (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * Three constructors for V078's three aggregations, so an extractor states which shape a metric
 * has instead of assembling one by hand — and so the median's value is computed exactly the way
 * `metric_daily_shape_guard` checks it.
 */

import type { DataOrigin } from "../../db/schema";
import type { RollupRow } from "./rollup.types";

/** Where a row belongs: the repository, metric, dimension and origin. */
export interface RowKey {
  readonly repoRef: string;
  readonly metricId: string;
  /** Defaults to `""`, the undimensioned row. */
  readonly dimension?: string;
  /** The origin of the source rows behind it (V154, DJ.2). */
  readonly origin: DataOrigin;
}

/**
 * A `sum` row — a count or a total.
 *
 * @param key - Where it belongs.
 * @param value - The day's total. Must be finite and non-negative.
 * @param population - How many source rows the total is over — for a count, usually the count
 *   itself; for cents or tokens, the rows that carried them.
 * @returns The row.
 * @throws {RangeError} On a negative or non-finite value or population — the grain refuses both.
 */
export function sumRow(key: RowKey, value: number, population: number): RollupRow {
  assertAmount(key.metricId, value);
  assertPopulation(key.metricId, population);

  return { ...place(key), value, population };
}

/**
 * A `ratio` row — V076's component rule: the components, and the day's own rate for its chart
 * point.
 *
 * @param key - Where it belongs.
 * @param numerator - The day's numerator, non-negative.
 * @param denominator - The day's denominator, positive.
 * @param scale - What the rate is multiplied by for `value`: 100 for a `pct` metric, 1 otherwise.
 * @param population - How many source rows the rate is over; the denominator when omitted, which
 *   is right whenever the denominator is a count of rows.
 * @returns The row.
 * @throws {RangeError} On a negative numerator or a denominator that is not positive.
 */
export function ratioRow(
  key: RowKey,
  numerator: number,
  denominator: number,
  scale: number,
  population: number = denominator,
): RollupRow {
  assertAmount(key.metricId, numerator);
  assertPopulation(key.metricId, population);

  if (!(denominator > 0) || !Number.isFinite(denominator)) {
    throw new RangeError(
      `${key.metricId}: a rate needs a positive denominator, got ${String(denominator)}`,
    );
  }

  return {
    ...place(key),
    value: (scale * numerator) / denominator,
    numerator,
    denominator,
    population,
  };
}

/**
 * A `median` row — the day's samples, ascending, and their median.
 *
 * @param key - Where it belongs.
 * @param samples - The day's observations, in any order. At least one, each non-negative. Their
 *   count is the row's population.
 * @returns The row, with its samples sorted.
 * @throws {RangeError} On no samples or a negative one.
 */
export function medianRow(key: RowKey, samples: readonly number[]): RollupRow {
  if (samples.length === 0) {
    throw new RangeError(`${key.metricId}: a median needs at least one sample`);
  }

  samples.forEach((sample) => {
    assertAmount(key.metricId, sample);
  });

  const sorted = [...samples].sort((a, b) => a - b);

  return { ...place(key), value: median(sorted), samples: sorted, population: sorted.length };
}

/**
 * The median of ascending numbers, as PostgreSQL's `percentile_cont(0.5)` computes it — the middle
 * value, or the mean of the middle two for an even count.
 *
 * @param sorted - Ascending, non-empty.
 * @returns The median.
 */
export function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The placement half of a row — where it goes in the grain key.
 *
 * @param key - The caller's key.
 * @returns The repository, metric, dimension (`""` when omitted) and origin.
 */
function place(key: RowKey): Pick<RollupRow, "repoRef" | "metricId" | "dimension" | "origin"> {
  return {
    repoRef: key.repoRef,
    metricId: key.metricId,
    dimension: key.dimension ?? "",
    origin: key.origin,
  };
}

/**
 * Refuse a population the grain cannot store.
 *
 * @param metricId - For the message.
 * @param population - The count of source rows.
 * @throws {RangeError} When it is not a non-negative integer.
 */
function assertPopulation(metricId: string, population: number): void {
  if (!Number.isInteger(population) || population < 0) {
    throw new RangeError(
      `${metricId}: a population is a non-negative whole count, got ${String(population)}`,
    );
  }
}

/**
 * Refuse an amount the grain cannot store.
 *
 * @param metricId - For the message.
 * @param value - The amount.
 * @throws {RangeError} When it is negative or not finite.
 */
function assertAmount(metricId: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${metricId}: a daily amount is finite and non-negative, got ${String(value)}`,
    );
  }
}
