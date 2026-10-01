/**
 * `CalibrationService` — estimator calibration (BI.4,
 * [#435](https://github.com/NobuData/ouroboros/issues/435), decision **I7**).
 *
 * ```
 * PR sync: newly merged ─▶ mergeObserved(org, pr) ─▶ record_estimate_outcome   (idempotent upsert)
 * GET /insights/calibration?window=30d ─▶ sums per effort ─▶ calibrationReport (headline + slices)
 * ```
 *
 * **The fill** is bound to `CALIBRATION_MERGE_OBSERVER`, the port `PrSyncService` tells about
 * every merge it is the first to see. A PR no loop opened gets no row, and that is not an error.
 *
 * **The report** is read by the Insights effort card (#446) and by the intake surfaces, so an
 * estimator issue can cite its own calibration.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import type { CalibrationMergeObserver } from "./calibration.observer";
import { CalibrationRepository, type CalibrationStore } from "./calibration.repository";
import {
  calibrationReport,
  windowRange,
  type CalibrationReport,
  type CalibrationWindow,
} from "./calibration.rules";

/** The clock's injection token — bound only by the suites; production reads `Date.now`. */
export const CALIBRATION_CLOCK = Symbol("CALIBRATION_CLOCK");

@Injectable()
export class CalibrationService implements CalibrationMergeObserver {
  /**
   * @param store - The calibration statements.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    @Inject(CalibrationRepository) private readonly store: CalibrationStore,
    @Optional() @Inject(CALIBRATION_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /** @inheritdoc */
  async mergeObserved(organizationId: string, prId: string): Promise<void> {
    await this.store.record(organizationId, prId);
  }

  /**
   * The calibration report for a window ending now.
   *
   * @param organizationId - The workspace.
   * @param window - The window.
   * @returns The headline, the unestimated count and all five effort slices.
   */
  async report(organizationId: string, window: CalibrationWindow): Promise<CalibrationReport> {
    const range = windowRange(window, new Date(this.clock()));
    const sums = await this.store.sums(organizationId, range);

    return calibrationReport(window, range, sums);
  }
}
