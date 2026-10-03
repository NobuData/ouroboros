/**
 * The port the PR sync tells about a merged PR — the farm's job hooks (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514)).
 *
 * A token and an interface in a file of their own, so `pull-requests/pr-sync.service.ts` can take
 * the port as `@Optional() @Inject(FARM_MERGE_OBSERVER)` without importing the farm's services —
 * the `CALIBRATION_MERGE_OBSERVER` pattern. `FarmConfigModule` binds it to `JobHooksService`.
 */

/** The injection token. */
export const FARM_MERGE_OBSERVER = Symbol("FARM_MERGE_OBSERVER");

/** What a merged PR is reported to. */
export interface FarmMergeObserver {
  /**
   * A PR of this workspace was just observed `merged`: submit every job hook it fires.
   *
   * @param organizationId - The workspace.
   * @param prId - `pull_requests.id`.
   * @returns When the hooks' jobs are submitted. The caller logs a rejection and carries on.
   */
  mergeObserved(organizationId: string, prId: string): Promise<void>;
}
