/**
 * `GET /api/v1/backlog/{id}` — everything mockup 03's `ISSUE DETAIL` panel shows for one issue
 * (M.2, [#111](https://github.com/NobuData/ouroboros/issues/111)).
 *
 * **A third controller under the same prefix**, named for its route as
 * `BacklogListingController` is. `BacklogController` holds `sync-status` and `sync`, that one
 * holds the listing, and this one holds the panel.
 *
 * **This is the first route under `/backlog` whose path is a bare parameter, and that makes
 * registration order a rule rather than a preference.** Express matches in registration order,
 * so a `GET /backlog/{id}` registered ahead of `GET /backlog/sync-status` would turn every
 * freshness poll into a request for an issue whose id is the word *sync-status* — refused as a
 * `422` by {@link IssueDetailParams}, on a route that exists. `backlog.module.ts` therefore
 * lists `BacklogController` first, and `detail.integration-spec.ts` asserts the consequence
 * rather than the list, which is what keeps the guarantee when somebody sorts the controllers.
 * The three neighbours that are not `GET` — `POST sync`, `POST estimate-all`,
 * `POST {id}/estimate` — cannot collide with it at all.
 *
 * **The workspace is the session's, never the request's** — the same sentence the listing, sync,
 * queue and dashboard controllers open with. No `{orgId}` in the path, the tenant guard resolves
 * and membership-checks the active organization, and this handler reads what it established. The
 * ticket's *404 across orgs* criterion is met two levels below, in the statements: see
 * `detail.repository.ts`.
 *
 * **No `@Roles()`, deliberately**, for `listing.controller.ts`' reason: the guard's bare default
 * is every member including a `viewer`, and opening a panel is looking. The panel's *buttons*
 * are a different question — **Re-estimate** is `POST {id}/estimate` and names `CONTRIBUTORS`,
 * and **Queue for loop** will name its own — but reading what they would act on spends nothing.
 */

import { Controller, Get, Param } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { IssueDetailParams } from "./detail.dto";
import type { IssueDetail } from "./detail.resources";
import { BacklogDetailService } from "./detail.service";

@Controller("backlog")
export class BacklogDetailController {
  /** @param detail - The composed answer. */
  constructor(private readonly detail: BacklogDetailService) {}

  /**
   * One issue, in full.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The issue's row id, validated as a uuid before a statement is issued.
   * @returns The panel: the issue, the estimate in force or `null`, and the version list.
   * @throws {NotFoundError} `issue_not_found` — including for an issue in another workspace.
   */
  @Get(":id")
  detailOf(
    @CurrentTenant() tenant: Organization,
    @Param() params: IssueDetailParams,
  ): Promise<IssueDetail> {
    return this.detail.detailOf(tenant.id, params.id);
  }
}
