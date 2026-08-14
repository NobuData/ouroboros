/**
 * Every statement the runs endpoints issue — three, all scoped to one workspace
 * ([#71](https://github.com/NobuData/ouroboros/issues/71)).
 *
 * ## The orderings are the aggregate's, and that is a contract
 *
 * The acceptance criterion says the aggregate's `activeRuns` and `recentRuns` are pages of
 * these listings — byte-identical rows. That only holds if the ordering here and the
 * ordering in `dashboard.repository.ts` are the *same sentence*: active runs in lifecycle
 * order then longest-running first, terminal runs newest-stopped first, `id` breaking every
 * tie. The two files state it independently — the dashboard module exports no provider, by
 * its own argument — and `runs.integration-spec.ts` is what holds them together: it reads
 * the aggregate and the listing over one population and requires the slices to be equal as
 * JSON. Reorder either file and that test names the divergence.
 *
 * ## Org scoping is not optional and is not the client's
 *
 * Every method takes `organizationId` first and every statement filters on it, exactly as
 * the dashboard repository does and for the same reason: the value comes from the tenant
 * context, never from the request, and `runs.repository.spec.ts` asserts the predicate is
 * present in every compiled statement. For {@link RunsRepository.find} the scope is also the
 * `404` criterion — a run belonging to another workspace is *absent* through this query, so
 * the existence leak the ticket names cannot be reintroduced without deleting a `where`.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { ACTIVE_RUN_STATUSES, type Run } from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";
import { asCount } from "../tenancy/queries";
import type { RunStatusFamily } from "./runs.dto";

/** The filters a listing applies — one family, optionally one repository. */
export interface RunsFilter {
  /** Which family of statuses — see `runs.dto.ts` for why this is not optional. */
  readonly status: RunStatusFamily;
  /** Narrow to one repository, or `undefined` for the whole workspace. */
  readonly repoId?: string;
}

@Injectable()
export class RunsRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One window of the workspace's runs, in the family's own order.
   *
   * **Active**: lifecycle order (`array_position` over {@link ACTIVE_RUN_STATUSES}), then
   * longest-running first, then `id` — the *Active loops* card's order, extended past its
   * limit. **Terminal**: newest-stopped first, then `id` — the *Recently closed* card's,
   * filtered on `finished_at` being present rather than on the three terminal statuses
   * because V008's `runs_terminal_finished_at` makes those the same set and the shorter
   * question is the one `runs_organization_finished_at_idx` answers.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param filter - The family, and the repository if one narrows it.
   * @param window - Which rows of the match to return.
   * @returns The rows for this window.
   */
  async list(organizationId: string, filter: RunsFilter, window: PageWindow): Promise<Run[]> {
    let query = this.database.db
      .selectFrom("runs")
      .selectAll()
      .where("organization_id", "=", organizationId);

    if (filter.repoId !== undefined) {
      query = query.where("github_repo_id", "=", filter.repoId);
    }

    query =
      filter.status === "active"
        ? query
            .where("status", "in", [...ACTIVE_RUN_STATUSES])
            .orderBy(sql<number>`array_position(${[...ACTIVE_RUN_STATUSES]}::text[], status)`)
            .orderBy("started_at", "asc")
        : query.where("finished_at", "is not", null).orderBy("finished_at", "desc");

    return query.orderBy("id", "asc").limit(window.limit).offset(window.offset).execute();
  }

  /**
   * How many runs match, ignoring the window — the `total` the #31 convention promises.
   *
   * The same predicates as {@link list}, restated rather than shared through a builder
   * helper: three `where` clauses are cheaper to read twice than a function that exists to
   * be called twice, and `runs.repository.spec.ts` asserts the two agree where it matters —
   * both carry the org scope, and both branch on the family the same way.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param filter - The family, and the repository if one narrows it.
   * @returns The count.
   */
  async count(organizationId: string, filter: RunsFilter): Promise<number> {
    let query = this.database.db.selectFrom("runs").where("organization_id", "=", organizationId);

    if (filter.repoId !== undefined) {
      query = query.where("github_repo_id", "=", filter.repoId);
    }

    query =
      filter.status === "active"
        ? query.where("status", "in", [...ACTIVE_RUN_STATUSES])
        : query.where("finished_at", "is not", null);

    const row = await query.select(sql<string>`count(*)`.as("total")).executeTakeFirstOrThrow();

    return asCount(row.total);
  }

  /**
   * One run, if it is this workspace's to see.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The run's id, already validated as a uuid.
   * @returns The row, or `undefined` — which covers "no such run" and "somebody else's run"
   *   in one answer, deliberately. The service turns it into the `404`; nothing between here
   *   and there can tell the two cases apart, which is the point.
   */
  async find(organizationId: string, id: string): Promise<Run | undefined> {
    return this.database.db
      .selectFrom("runs")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }
}
