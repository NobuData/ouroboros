/**
 * Every statement the queue endpoint issues — two, both scoped to one workspace
 * ([#73](https://github.com/NobuData/ouroboros/issues/73)).
 *
 * ## The totals are the stat row's own sentence, and that is the contract
 *
 * The acceptance criterion says `totalEstMinutes` equals the `stats.queued.estMinutes` the
 * aggregate ([#70](https://github.com/NobuData/ouroboros/issues/70)) reports for the same
 * workspace. That holds because {@link QueueRepository.totals} and the dashboard
 * repository's `queueTotals` are the *same sentence* — `count(*)::int` and
 * `coalesce(sum(est_minutes), 0)::int` over the org-scoped rows — stated independently,
 * because the dashboard module exports no provider by its own argument.
 * `queue.integration-spec.ts` is what holds the two together: it reads the aggregate and
 * this listing over one population and requires the numbers to be equal.
 *
 * `sum(est_minutes)` skips the nulls without being asked, which is the behaviour the
 * nullable column exists for: an item nobody has sized yet contributes to the count and not
 * to the total. `coalesce` covers the empty queue, where the sum itself is null.
 *
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` first and every statement filters on it, exactly as
 * the dashboard repository does and for the same reason: the value comes from the tenant
 * context, never from the request, and `queue.repository.spec.ts` asserts the predicate is
 * present in every compiled statement — because the failure it guards against is silent: a
 * query that forgot it would answer, and would answer with somebody else's queue mixed in.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import type { QueueTotals } from "../dashboard/dashboard.repository";
import { DatabaseService } from "../db/db.service";
import type { QueueItem } from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";

/** The one filter a listing applies — optionally one repository. */
export interface QueueFilter {
  /** Narrow to one repository, or `undefined` for the whole workspace. */
  readonly repoId?: string;
}

@Injectable()
export class QueueRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One window of the workspace's queue, in queue order.
   *
   * **`position` ascending, and nothing else.** V009 makes `position` unique within the
   * workspace, so the order is total without a tiebreak — two rows cannot swap places
   * between polls because two rows cannot share a place. This is the *Up next in queue*
   * card's own order extended past its five, which is what makes the aggregate's
   * `queueHead` a page of this listing rather than a second opinion about what is next.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param filter - The repository, if one narrows it.
   * @param window - Which rows of the match to return.
   * @returns The rows for this window, position `1`'s window first.
   */
  async list(
    organizationId: string,
    filter: QueueFilter,
    window: PageWindow,
  ): Promise<QueueItem[]> {
    let query = this.database.db
      .selectFrom("queue_items")
      .selectAll()
      .where("organization_id", "=", organizationId);

    if (filter.repoId !== undefined) {
      query = query.where("github_repo_id", "=", filter.repoId);
    }

    return query.orderBy("position", "asc").limit(window.limit).offset(window.offset).execute();
  }

  /**
   * How many issues match, and how long they are expected to take — ignoring the window.
   *
   * One aggregate pass answers both the `total` the #31 convention promises and the
   * `totalEstMinutes` the ticket adds, so the two describe the same snapshot of the same
   * rows and cannot disagree with each other. The same predicates as {@link list}, restated
   * rather than shared through a builder helper, per the runs repository's argument: two
   * `where` clauses are cheaper to read twice than a function that exists to be called
   * twice, and `queue.repository.spec.ts` asserts the two agree where it matters.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param filter - The repository, if one narrows it.
   * @returns The count and the summed estimate. Zeros for a match with nothing in it.
   */
  async totals(organizationId: string, filter: QueueFilter): Promise<QueueTotals> {
    let query = this.database.db
      .selectFrom("queue_items")
      .where("organization_id", "=", organizationId);

    if (filter.repoId !== undefined) {
      query = query.where("github_repo_id", "=", filter.repoId);
    }

    return query
      .select([
        sql<number>`count(*)::int`.as("count"),
        sql<number>`coalesce(sum(est_minutes), 0)::int`.as("estMinutes"),
      ])
      .executeTakeFirstOrThrow();
  }
}
