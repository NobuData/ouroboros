/**
 * The port the PR sync tells about a merged PR — the estimator calibration fill (BI.4,
 * [#435](https://github.com/NobuData/ouroboros/issues/435)).
 *
 * A token and an interface in a file of their own, so `pull-requests/pr-sync.service.ts` can take
 * the port as `@Optional() @Inject(CALIBRATION_MERGE_OBSERVER)` without importing the insights
 * module's service — the `FACT_COMMIT_OBSERVER` pattern. `InsightsModule` binds it to
 * `CalibrationService`.
 */

/** The injection token. */
export const CALIBRATION_MERGE_OBSERVER = Symbol("CALIBRATION_MERGE_OBSERVER");

/** What a merged PR is reported to. */
export interface CalibrationMergeObserver {
  /**
   * A PR of this workspace was just observed `merged`. Grade it against the estimate in force
   * when its work was queued. Idempotent: reporting the same merge twice leaves one row.
   *
   * @param organizationId - The workspace.
   * @param prId - `pull_requests.id`.
   * @returns When the outcome is recorded. The caller logs a rejection and carries on.
   */
  mergeObserved(organizationId: string, prId: string): Promise<void>;
}
