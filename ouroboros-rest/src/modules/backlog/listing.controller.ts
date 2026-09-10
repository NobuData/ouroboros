/**
 * `GET /api/v1/backlog` — the org-scoped, filtered, sorted, searchable listing behind mockup
 * 03's backlog table (M.1, [#110](https://github.com/NobuData/ouroboros/issues/110)).
 *
 * **A second controller under the same prefix, which is what `backlog.module.ts` said it was
 * leaving room for.** `BacklogController` is named for the module and holds `sync-status` and
 * `sync`; this one is named for its route and holds the listing. Nothing can be shadowed:
 * `sync-status`, `sync` and `estimate-all` are literal segments and this path has none at all,
 * so `GET /backlog` is reached only by a request that named nothing after the prefix.
 *
 * **The workspace is the session's, never the request's** — the same sentence the sync, queue
 * and dashboard controllers open with. No `{orgId}` in the path, the tenant guard resolves and
 * membership-checks the active organization, and this handler reads what it established. The
 * ticket's cross-org criterion is met a level below, in the statement: see
 * `listing.repository.ts`.
 *
 * **No `@Roles()`, deliberately.** The guard's bare default is every member including a
 * `viewer`, and reading the backlog is looking — which is what a viewer is for. The contrast is
 * the two routes beside it: `POST /backlog/sync` spends the workspace's GitHub budget and
 * `POST /backlog/estimate-all` spends its engine quota, so both name a list. A listing spends
 * nothing.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ListBacklogQuery } from "./listing.dto";
import type { BacklogListing } from "./listing.resources";
import { BacklogListingService } from "./listing.service";

@Controller("backlog")
export class BacklogListingController {
  /** @param listing - The composed answer. */
  constructor(private readonly listing: BacklogListingService) {}

  /**
   * One page of the workspace's backlog.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - The filter bar. Every parameter is optional; the defaults are the mockup's.
   * @returns The page, the page head's counts, the freshness stamp and the chip set. Never a
   *   `404`: a workspace that mirrors nothing has an empty backlog, which is a state to render.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Query() query: ListBacklogQuery,
  ): Promise<BacklogListing> {
    return this.listing.list(tenant.id, query);
  }
}
