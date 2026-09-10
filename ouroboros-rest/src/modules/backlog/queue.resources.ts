/**
 * What a bulk queue write answers with, and the two reconciliations it makes on the way
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * ## The items are the queue's own shape, not a second one
 *
 * `QueueItemSummary` is `dashboard/resources.ts`', which is what `GET /api/v1/queue` publishes
 * and what the *Up next in queue* card draws. Mapping through the same function is the ticket's
 * cross-roadmap criterion made structural: *"the items appear on the dashboard queue card"* is
 * true by construction rather than by two mappers agreeing today. Importing the mapper across a
 * module boundary is deliberately not importing the module — it is a pure function over a row,
 * exactly as `queue/queue.service.ts` imports it.
 *
 * ## The two reconciliations
 *
 * A queue row is written from an estimate, and the two were declared by different migrations
 * with different bounds. Reconciling them is this ticket's, in as many words — the intake
 * roadmap says so: *"reconciling the two is M.3's (#112), at the statement that copies one into
 * the other"*. Both rules live here, as pure functions, because a rule about what a column may
 * hold is worth reading and testing without a database.
 *
 *   * **The effort scale** — {@link queueEffort}. `issue_estimates.effort` and
 *     `queue_items.effort` are the same five sizes and deliberately *separate* types
 *     (`schema.ts` says why: a shared declaration would make widening one silently widen the
 *     other). The map below is where they meet, and it is exhaustive on both sides, so widening
 *     either is a compile error here rather than a check violation at run time.
 *   * **The estimate** — {@link queueEstMinutes}. V026 lets a breakdown's `est_minutes` run to
 *     100 000 and V009 holds the queue column to `1 … 20160` or null.
 */

import { queueItemSummary, type QueueItemSummary } from "../dashboard/resources";
import type { EstimateEffort, QueueEffort, QueueItem } from "../db/schema";

/**
 * The smallest and largest number `queue_items.est_minutes` will hold —
 * `queue_items_est_minutes_sane`, mirrored.
 *
 * Zero is refused by V009 because it is the value somebody would type for *no estimate* and
 * would then silently claim the loop needs no time; the upper bound is a fortnight of
 * continuous work, near enough to stop a units mistake from adding a century to the *Queued
 * issues* stat.
 */
export const MIN_QUEUE_EST_MINUTES = 1;
export const MAX_QUEUE_EST_MINUTES = 20160;

/**
 * `issue_estimates.effort` → `queue_items.effort`.
 *
 * Exhaustive by type on both sides. A `Record<EstimateEffort, QueueEffort>` is a compile error
 * the moment either scale gains a size, which is precisely the coupling `schema.ts` refused to
 * express as a shared type — the check is here, at the one statement that copies one into the
 * other, rather than in a declaration that would hide it.
 */
const QUEUE_EFFORTS: Readonly<Record<EstimateEffort, QueueEffort>> = Object.freeze({
  xs: "xs",
  s: "s",
  m: "m",
  l: "l",
  xl: "xl",
});

/**
 * The chip a queue row carries, from the chip its estimate carried.
 *
 * @param effort - What the estimate in force said.
 * @returns The same size, as the queue's own type.
 */
export function queueEffort(effort: EstimateEffort): QueueEffort {
  return QUEUE_EFFORTS[effort];
}

/**
 * The estimate a queue row carries, from the breakdown's own number.
 *
 * **Copied, never recomputed** — the ticket's criterion. What this function decides is only the
 * one thing the copy cannot: what to write when the number is outside what V009's column will
 * hold.
 *
 * **Out of range becomes `null`, which is the column's word for *not estimated*.** The
 * alternative is clamping, and clamping would publish a number no estimator produced —
 * `listing.resources.ts` refuses a `confidence ?? 0` on exactly that reasoning. A ten-week
 * estimate reported as a fortnight would make the *Queued issues* stat quietly wrong in the
 * direction that looks fine; `null` makes it visibly incomplete, which is honest and is what
 * `sum(est_minutes)` already skips without being asked. Zero is the same argument from the
 * other end: V026 permits it, V009 refuses it, and *the loop will finish this instantly* is not
 * a claim this service should make on an estimator's behalf.
 *
 * Neither bound is reachable from the bundled estimator, and that is the point of checking:
 * the day a different one is fitted, the queue write answers `201` with a null estimate instead
 * of a `500` carrying a constraint's name.
 *
 * @param estMinutes - `breakdown.est_minutes` from the estimate in force.
 * @returns The minutes to store, or `null` when the queue's column cannot hold them.
 */
export function queueEstMinutes(estMinutes: number): number | null {
  return estMinutes >= MIN_QUEUE_EST_MINUTES && estMinutes <= MAX_QUEUE_EST_MINUTES
    ? estMinutes
    : null;
}

/**
 * What one press of *Queue → standard-fix* answers with.
 *
 * The created rows, and the one number the selection action bar renders beside them.
 */
export interface QueuedSelection {
  /**
   * The rows that were created, in queue order — the first appended first.
   *
   * Byte-identical to the same rows read back from `GET /api/v1/queue`, because they are mapped
   * through that endpoint's own function. A client may therefore render them into the queue
   * card it already has without a re-fetch.
   */
  readonly items: readonly QueueItemSummary[];
  /**
   * The combined estimate, in minutes — *"est. 1h 10m combined autonomous work"*.
   *
   * The **sum of what was written**, skipping the items carrying no estimate rather than
   * counting them as zero — the same sentence `stats.queued.estMinutes` and
   * `QueuePage.totalEstMinutes` are, so this number and the queue card's own total cannot
   * disagree about the rows this request created. `items.length` may therefore speak for more
   * issues than this number does, which is the honest shape of a queue holding something
   * nobody could size.
   */
  readonly estMinutes: number;
}

/**
 * The created rows, as the API publishes them.
 *
 * A pure function over what the transaction returned, for `dashboard/resources.ts`' reason: the
 * mapping is the contract, and a contract worth testing is worth testing without a database.
 *
 * @param rows - The inserted `queue_items`, in the order they were appended.
 * @returns The items and their combined estimate.
 */
export function queuedSelection(rows: readonly QueueItem[]): QueuedSelection {
  return {
    items: rows.map(queueItemSummary),
    // Summed here rather than read back with a second statement: these are the rows that were
    // just written, so a `sum` over them is the same arithmetic the database would do and one
    // round trip fewer. `?? 0` skips a null rather than counting it — see `estMinutes`.
    estMinutes: rows.reduce((total, row) => total + (row.est_minutes ?? 0), 0),
  };
}
