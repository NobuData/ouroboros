/**
 * What an accepted re-estimation answers with — and what the three numbers on the fan-out
 * actually mean.
 *
 * L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108)). Both shapes are small and
 * both are `202`s, because the work outlives the response: an estimate is an engine call and a
 * versioned write, and a request that held a connection open for a backlog of them would turn
 * *Re-estimate all* into a timeout.
 *
 * **The fan-out's counts are the ticket's *confirmation contract*.** The head's dialog says
 * *"this re-estimates N issues"* from the backlog listing's own count (M.1,
 * [#110](https://github.com/NobuData/ouroboros/issues/110)), and this answer says how many it
 * actually took — which can be fewer, because rows already in flight are left alone. A dialog
 * that promised N and an answer that reported N regardless would be the one shape that cannot
 * tell the truth about a second press.
 */

import type { SizingStatus } from "../db/schema";

/** One issue accepted for re-estimation. */
export interface EstimationAccepted {
  /** `github_issues.id` — the row the new version will hang off. */
  readonly issueId: string;
  /** GitHub's own number, which is what the panel's title bar reads. */
  readonly number: number;
  /** `owner/name`, as GitHub spells it. */
  readonly repository: string;
  /**
   * What the issue is now — always `estimating`.
   *
   * True at the moment it is answered rather than aspirational: the endpoint moves the row
   * into `estimating` before it queues the work, so a client that re-reads the issue sees the
   * same word this field carries. The alternative — queue first, claim when the work starts —
   * would make this a promise about a row that still said `sized`.
   */
  readonly status: SizingStatus;
}

/** What one *Re-estimate all* took. */
export interface EstimationFanout {
  /** Issues this request moved into `estimating` and queued. */
  readonly enqueued: number;
  /**
   * Issues it did not touch.
   *
   * Defined as *everything else* — {@link total} less {@link enqueued} — rather than counted
   * separately, so the three numbers cannot disagree with each other. In practice they are the
   * rows that were already `estimating` when the request arrived.
   */
  readonly skipped: number;
  /** How many issues the workspace mirrors, as the request read it. */
  readonly total: number;
}

/**
 * The fan-out's three numbers, from the two the endpoint actually knows.
 *
 * @param total - How many issues the workspace mirrors, read before the claim.
 * @param enqueued - How many this request claimed *and* the queue admitted.
 * @returns The resource. `skipped` is clamped at zero: an issue that arrived between the count
 *   and the claim is claimed and queued, which can push `enqueued` past a `total` read a
 *   moment earlier — and a negative count in a dialog would be a worse answer than a rounded
 *   one.
 */
export function fanout(total: number, enqueued: number): EstimationFanout {
  return { enqueued, skipped: Math.max(0, total - enqueued), total };
}
