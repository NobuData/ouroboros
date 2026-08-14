/**
 * The rules of the queue surface ([#73](https://github.com/NobuData/ouroboros/issues/73)),
 * which are two:
 *
 *   * **A queued issue has exactly one shape everywhere.** The rows are mapped through
 *     `dashboard/resources.ts`'s `queueItemSummary` — the same function the aggregate's
 *     `queueHead` slice goes through — so a row here and the same row on the card are
 *     byte-identical by construction: there is no second mapper whose fields could drift.
 *     Importing the mapper across the module boundary is deliberately not importing the
 *     module: it is a pure function over a row, the dashboard's *providers* stay
 *     unexported, and its card-sized limits stay its own.
 *   * **The totals speak for the whole match, not the page.** `total` and `totalEstMinutes`
 *     are one aggregate statement over every row the filter admits, window ignored — so a
 *     client on page 3 still renders the queue's whole size and the stat row's own
 *     estimate. Unfiltered, `totalEstMinutes` is therefore the number
 *     `stats.queued.estMinutes` reports, which is the ticket's cannot-disagree criterion.
 */

import { Injectable } from "@nestjs/common";

import { queueItemSummary, type QueueItemSummary } from "../dashboard/resources";
import { pageOf, windowOf, type Page } from "../tenancy/pagination";
import type { ListQueueQuery } from "./queue.dto";
import { QueueRepository } from "./queue.repository";

/**
 * One page of the queue — the #31 convention's page, carrying one number more.
 *
 * `totalEstMinutes` rides beside `total` rather than inside any row because it answers the
 * same kind of question `total` does: a fact about the whole match that no client can
 * compute from the page it was sent — the rows it would need are the ones the window cut.
 */
export interface QueuePage extends Page<QueueItemSummary> {
  /**
   * The sum of the matched rows' estimates, in minutes — the whole queue's when nothing
   * narrows it, in which case it equals `stats.queued.estMinutes` for the same workspace.
   *
   * A **sum, not a count**, and it skips items with no estimate rather than counting them
   * as zero — so `total` may speak for more issues than this number does, which is the
   * honest shape of a queue where something has not been sized yet.
   */
  readonly totalEstMinutes: number;
}

@Injectable()
export class QueueService {
  constructor(private readonly queue: QueueRepository) {}

  /**
   * One page of the workspace's queue, in queue order.
   *
   * The rows and the totals are read concurrently — two statements over the same indexed
   * predicates, per the dashboard repository's argument that the round trip costs more than
   * the statement it carries.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param query - The optional repository, and the window.
   * @returns The page, position ascending, with the whole match's count and summed estimate.
   */
  async list(organizationId: string, query: ListQueueQuery): Promise<QueuePage> {
    const window = windowOf(query);
    const filter = { repoId: query.repo };

    const [rows, totals] = await Promise.all([
      this.queue.list(organizationId, filter, window),
      this.queue.totals(organizationId, filter),
    ]);

    return {
      ...pageOf(rows.map(queueItemSummary), totals.count, window),
      totalEstMinutes: totals.estMinutes,
    };
  }
}
