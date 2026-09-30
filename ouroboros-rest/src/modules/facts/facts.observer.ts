/**
 * The port the source sync tells about a merged PR — the staleness sweep's commit awareness
 * (BF.2, [#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 * A token and an interface in a file of their own, so `pull-requests/pr-sync.service.ts` can take
 * the port as `@Optional() @Inject(FACT_COMMIT_OBSERVER)` without importing the facts module's
 * service — the `GATE_EVIDENCE` pattern. `FactsModule` binds it to `FactSweepService`.
 */

/** The injection token. */
export const FACT_COMMIT_OBSERVER = Symbol("FACT_COMMIT_OBSERVER");

/** What a merged PR is reported to. */
export interface FactCommitObserver {
  /**
   * A PR of this workspace was just observed `merged`. Match its changed paths and diff sample
   * against the workspace's confirmed facts' anchors, and flag the facts it touches `stale`.
   *
   * @param organizationId - The workspace.
   * @param prId - `pull_requests.id`.
   * @returns When the facts are flagged. The caller logs a rejection and carries on.
   */
  mergeObserved(organizationId: string, prId: string): Promise<void>;
}
