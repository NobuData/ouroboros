/**
 * The shapes every rollup extractor shares (BI.2, [#433](https://github.com/NobuData/ouroboros/issues/433)).
 *
 * An extractor is one metric family's fill: given a workspace and one UTC day, it reads the
 * family's source planes and answers the `metric_daily` rows that day should hold. It writes
 * nothing — `rollup.repository.ts` replaces the day's rows and moves the family's cursor in one
 * transaction, which is what makes a re-run idempotent and an interrupted backfill resumable.
 */

import type { Kysely } from "kysely";

import type { Database } from "../../db/schema";

/** A UTC calendar day, `YYYY-MM-DD` — the grain's `day` column. */
export type Day = string;

/**
 * One `metric_daily` row an extractor answers.
 *
 * The shape follows the registry's `aggregation` (V078): a `sum` row carries `value` only, a
 * `ratio` row also `numerator` and `denominator`, and a `median` row its day's `samples`,
 * ascending, with `value` their median — see {@link medianRow}.
 */
export interface RollupRow {
  /** `owner/name` — V067's `repo_ref`. Extractors fill per repository; org-level rows are #451's. */
  readonly repoRef: string;
  /** The registry id, `merged_prs`. */
  readonly metricId: string;
  /** The dimension label — a suite, stage or effort — or `""` for an undimensioned metric. */
  readonly dimension: string;
  /** The day's number. Never negative. */
  readonly value: number;
  /** A rate's numerator; present exactly on rate rows. */
  readonly numerator?: number;
  /** A rate's denominator, positive; present exactly on rate rows. */
  readonly denominator?: number;
  /** A median's day of observations, ascending; present exactly on median rows. */
  readonly samples?: readonly number[];
}

/**
 * One metric family's fill.
 *
 * `metrics` is the version of every registry entry the extractor fills — the half of "extractors
 * are versioned with their registry entries" that lives in code. The fill refuses to run when the
 * database's `metric_definitions.version` disagrees (`rollup.registry.ts`), so a formula change
 * that shipped without its extractor, or the reverse, fails loudly instead of writing numbers the
 * methodology popover no longer describes.
 */
export interface FamilyExtractor {
  /** `metric_definitions.family` — the key `metric_rollup_state` is kept under. */
  readonly family: string;
  /** Every metric the family fills, mapped to the registry version this code implements. */
  readonly metrics: Readonly<Record<string, number>>;
  /**
   * Compute one day of the family for one workspace.
   *
   * @param db - The connection — or the transaction the day is written in.
   * @param organizationId - The workspace.
   * @param day - The UTC day.
   * @returns Every row the day should hold. A repository with no activity in the family's
   *   population that day has no rows; a rate with no denominator and a median with no samples
   *   have none either, because the grain cannot store them. A count over a non-empty population
   *   may be zero (a day of builds with no failures).
   */
  extract(db: Kysely<Database>, organizationId: string, day: Day): Promise<RollupRow[]>;
}
