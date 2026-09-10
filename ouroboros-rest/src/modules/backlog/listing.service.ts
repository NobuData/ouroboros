/**
 * The rules of `GET /api/v1/backlog`
 * (M.1, [#110](https://github.com/NobuData/ouroboros/issues/110)), which are four:
 *
 *   * **The defaults are the mockup's.** A request that names no `state` is `open` and one that
 *     names no `sort` is `effort`, because that is what mockup 03's `Open ▾` and *Sort:
 *     estimated effort ▾* selects open on. They are applied here rather than in the DTO so the
 *     repository is never handed an `undefined` to decide about, and so the one place a default
 *     is written is the one place a screen's first draw is described.
 *
 *   * **The five reads are concurrent and they answer one question.** Rows, counts, facets, the
 *     queue and the freshness stamp go out together — the dashboard repository's argument that a
 *     round trip costs more than the statement it carries — and are assembled into a single
 *     body, so the head, the table and the chip set a client renders came from one request
 *     rather than from three that could interleave with a sync.
 *
 *   * **`queued` is matched on the queue's rows, not carried on the issue.** M.3
 *     ([#112](https://github.com/NobuData/ouroboros/issues/112)) writes `queue_items` and
 *     nothing on `github_issues`, because `queued` is a presentation over that table rather
 *     than a fifth `sizing_status` — so the pill is decided here, against the queue as it is
 *     this instant, and cannot go stale the way a copied column would.
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
import {
  BacklogListingRepository,
  type BacklogFilter,
  type QueuedIssueKey,
} from "./listing.repository";
import { SyncStatusService } from "./sync-status.service";

@Injectable()
export class BacklogListingService {
  /**
   * @param backlog - The four statements.
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

    const [rows, counts, labelFacets, queued, status] = await Promise.all([
      this.backlog.list(organizationId, filter, sort, window),
      this.backlog.counts(organizationId, filter),
      this.backlog.labelFacets(organizationId, filter.repoId),
      this.backlog.queuedIssues(organizationId, filter.repoId),
      this.sync.status(organizationId),
    ]);

    const inQueue = queuedKeys(queued);

    return {
      ...pageOf(
        rows.map((row) => backlogRow(row, inQueue.has(queueKey(row)))),
        counts.total,
        window,
      ),
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
 * The queue's rows, as a set the mapping can ask one question of.
 *
 * @param queued - Every queued issue of the workspace, or of the repository when one narrows
 *   the listing.
 * @returns The keys, so deciding one row's pill is a lookup rather than a scan of the queue.
 */
function queuedKeys(queued: readonly QueuedIssueKey[]): Set<string> {
  return new Set(queued.map(queueKey));
}

/**
 * What identifies an issue to the queue: its repository and its number.
 *
 * The repository is half the key for `listing.repository.ts`' reason — `queue_items` is unique
 * on `(organization_id, issue_number)` and would otherwise draw the pill on a second
 * repository's issue of the same number.
 *
 * @param issue - Anything carrying the two — a backlog row, or a queued issue.
 * @returns The key. A composed string rather than a nested map: one `Set` reads better than a
 *   map of sets, and neither part can contain the separator.
 */
function queueKey(issue: { readonly githubRepoId: string; readonly number: number }): string {
  return `${issue.githubRepoId}#${issue.number}`;
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
