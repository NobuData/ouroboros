/**
 * What `GET`/`PATCH /api/v1/settings/retention` answer — the workspace card's *Data retention*
 * select and the advanced per-class editor behind it (BQ.3,
 * [#482](https://github.com/NobuData/ouroboros/issues/482)).
 */

import type { Editability } from "../settings/workspace.resources";
import { LOOP_DATA_CLASSES, type DataClass } from "./retention.policy";
import type { SweepRecord } from "./retention.schedule";

/**
 * The card's effect note — saving changes the *next* sweep's cutoff and deletes nothing itself,
 * so data older than a new, shorter tier stays visible until that sweep has run.
 */
export const RETENTION_EFFECT_NOTE =
  "Saving deletes nothing. Each class's next sweep applies the new tier; data past it is removed then.";

/** Where a tier's value came from. */
export type TierSource = "policy" | "default";

/** One class's tier, as the advanced editor renders it. */
export interface RetentionTierResource {
  /** `transcripts`, `build_logs`, `artifacts`, `audit`, or `custom:<slug>`. */
  readonly dataClass: DataClass;
  /** Days kept. */
  readonly days: number;
  /** `policy` when the workspace stored this tier; `default` when it never has. */
  readonly source: TierSource;
  /** `true` for the three classes the simple select governs. */
  readonly loopData: boolean;
  /** The fewest days the class may be given. */
  readonly floor: number;
  /** The most days the class may be given. */
  readonly ceiling: number;
  /** When the stored tier was last changed — `null` for a default. */
  readonly updatedAt: string | null;
  /** Who last changed it (a user id) — `null` for a default, or once that user is gone. */
  readonly updatedBy: string | null;
  /**
   * When the class is next swept — the moment a change takes effect. `null` when nothing in this
   * deployment sweeps the class yet (audit, until BR.2's purge; a custom class, until its plane's).
   */
  readonly nextSweepAt: string | null;
  /** What the last sweep removed, or `null` before the first since the service started. */
  readonly lastSweep: { readonly at: string; readonly removed: number } | null;
}

/** The card. */
export interface RetentionSettingsResource extends Editability {
  /**
   * The simple select's value: the tier the three loop-data classes share, or `null` when the
   * advanced editor has set them apart ("mixed").
   */
  readonly loopDays: number | null;
  /** Every core class, then every stored `custom:*` class, in that order. */
  readonly classes: readonly RetentionTierResource[];
  /** {@link RETENTION_EFFECT_NOTE}. */
  readonly effect: string;
}

/**
 * The simple select's value from the classes.
 *
 * @param classes - The tiers.
 * @returns The loop classes' shared tier, or `null` when they differ.
 */
export function sharedLoopDays(classes: readonly RetentionTierResource[]): number | null {
  const loop = classes.filter((tier) => tier.loopData).map((tier) => tier.days);
  return loop.length === LOOP_DATA_CLASSES.length && loop.every((days) => days === loop[0])
    ? loop[0]
    : null;
}

/**
 * A sweep record as the card renders it.
 *
 * @param record - The record, or `null`.
 * @returns ISO time and count, or `null`.
 */
export function sweepRecordResource(
  record: SweepRecord | null,
): RetentionTierResource["lastSweep"] {
  return record === null ? null : { at: record.at.toISOString(), removed: record.removed };
}
