/**
 * The rules of `GET /api/v1/backlog`
 * (M.1, [#110](https://github.com/NobuData/ouroboros/issues/110)), which are three:
 *
 *   * **The defaults are the mockup's.** A request that names no `state` is `open` and one that
 *     names no `sort` is `effort`, because that is what mockup 03's `Open ▾` and *Sort:
 *     estimated effort ▾* selects open on. They are applied here rather than in the DTO so the
 *     repository is never handed an `undefined` to decide about, and so the one place a default
 *     is written is the one place a screen's first draw is described.
 *
 *   * **The four reads are concurrent and they answer one question.** Rows, counts, facets and
 *     the freshness stamp go out together — the dashboard repository's argument that a round
 *     trip costs more than the statement it carries — and are assembled into a single body, so
 *     the head, the table and the chip set a client renders came from one request rather than
 *     from three that could interleave with a sync.
 *
 *   * **`syncedAt` is lifted, never re-derived.** It is `SyncStatusService`'s number, which is
 *     what M.4 ([#113](https://github.com/NobuData/ouroboros/issues/113)) left for this ticket
 *     in as many words: the tag beside this listing and the tag from `GET
 *     /api/v1/backlog/sync-status` then cannot disagree, because there is one function that
 *     computes it. A second `max(synced_at)` here would be a second opinion about the same
 *     fact — and, worse, a different one: that column moves when a row is written, and the tag
 *     is about when a poll *ran*.
 */

import { Injectable } from "@nestjs/common";

import { pageOf, windowOf, type PageWindow } from "../tenancy/pagination";
import { DEFAULT_BACKLOG_SORT, DEFAULT_BACKLOG_STATE, type ListBacklogQuery } from "./listing.dto";
import { backlogRow, type BacklogListing } from "./listing.resources";
import { BacklogListingRepository, type BacklogFilter } from "./listing.repository";
import { SyncStatusService } from "./sync-status.service";

@Injectable()
export class BacklogListingService {
  /**
   * @param backlog - The three statements.
   * @param sync - Where the freshness tag's instant comes from.
   */
  constructor(
    private readonly backlog: BacklogListingRepository,
    private readonly sync: SyncStatusService,
  ) {}

  /**
   * One page of the workspace's backlog, with the page head's counts and the chip set.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param query - The filter bar, as a query string. Every field optional.
   * @returns The listing. A workspace that mirrors nothing answers an empty page with zeros and
   *   no chips, which is N.6 ([#120](https://github.com/NobuData/ouroboros/issues/120))'s empty
   *   state and not a failure.
   */
  async list(organizationId: string, query: ListBacklogQuery): Promise<BacklogListing> {
    const window: PageWindow = windowOf(query);
    const filter = filterOf(query);
    const sort = query.sort ?? DEFAULT_BACKLOG_SORT;

    const [rows, counts, labelFacets, status] = await Promise.all([
      this.backlog.list(organizationId, filter, sort, window),
      this.backlog.counts(organizationId, filter),
      this.backlog.labelFacets(organizationId, filter.repoId),
      this.sync.status(organizationId),
    ]);

    return {
      ...pageOf(rows.map(backlogRow), counts.total, window),
      meta: {
        openCount: counts.openCount,
        sizedCount: counts.sizedCount,
        syncedAt: status.syncedAt,
      },
      labelFacets,
    };
  }
}

/**
 * The query string, as the repository's filter — defaults applied.
 *
 * Separate from the method for the reason `sync.resources.ts` gives about its own composition:
 * this is a rule about what a *missing* parameter means, and a rule like that is worth reading
 * and testing on its own.
 *
 * @param query - What the client asked for, already validated by the pipe.
 * @returns The filter, with `state` decided and every other field carried through untouched.
 */
export function filterOf(query: ListBacklogQuery): BacklogFilter {
  return {
    ...(query.repo === undefined ? {} : { repoId: query.repo }),
    state: query.state ?? DEFAULT_BACKLOG_STATE,
    ...(query.labels === undefined ? {} : { labels: query.labels }),
    ...(query.q === undefined ? {} : { search: query.q }),
  };
}
