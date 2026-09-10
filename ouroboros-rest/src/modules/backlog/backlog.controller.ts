/**
 * `/api/v1/backlog/sync-status` and `/api/v1/backlog/sync` — the freshness tag's data, and the
 * click behind it (M.4, [#113](https://github.com/NobuData/ouroboros/issues/113)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the dashboard,
 * runs and queue controllers open with, because it is the same property: no `{orgId}` in the
 * path, the tenant guard resolves and membership-checks the active organization, and these
 * handlers read what it established. Sessions are required without anything here saying so —
 * the global guard — and a tenant is required *because* nothing here says otherwise: no
 * `@TenantOptional()`, so a session acting in no workspace is a `400 organization_required`
 * before either handler runs.
 *
 * **The read is every member's and the trigger is not.** Reading a status is looking, which is
 * what a `viewer` is for; starting a cycle spends the workspace's GitHub budget, so it carries
 * `@Roles(...CONTRIBUTORS)` — owner, admin or member. That is the ticket's *member+* criterion,
 * and it is the first use of a list that is deliberately not `ADMINISTRATORS`: a re-sync is
 * work, not administration.
 *
 * **Two routes and no listing.** `GET /api/v1/backlog` is M.1's
 * ([#110](https://github.com/NobuData/ouroboros/issues/110)), and it will publish its own
 * controller under the same prefix. This one is named for the module rather than for the
 * routes so that the second controller has a name to take; what it must not do is grow a
 * listing of its own.
 */

import { Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import type { SyncStatusResource } from "./sync.resources";
import { SyncStatusService } from "./sync-status.service";
import { SyncTriggerService } from "./sync-trigger.service";

@Controller("backlog")
export class BacklogController {
  /**
   * @param status - The composed answer.
   * @param trigger - The guarded start.
   */
  constructor(
    private readonly status: SyncStatusService,
    private readonly trigger: SyncTriggerService,
  ) {}

  /**
   * How fresh the backlog is, and why it is not fresher.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The status. Never a `404`: a workspace with no token and no repositories has a
   *   state, and saying which one is the whole point of the endpoint.
   */
  @Get("sync-status")
  syncStatus(@CurrentTenant() tenant: Organization): Promise<SyncStatusResource> {
    return this.status.status(tenant.id);
  }

  /**
   * Sync now.
   *
   * `202` rather than `200`: the cycle outlives the response, so what this answers is *the
   * request was accepted* plus the state as it stood at that moment — `running: true`, and a
   * `syncedAt` the cycle has not moved yet.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The status at acceptance.
   * @throws {ConflictError} `backlog_sync_running` when a cycle is in flight, or
   *   `backlog_sync_too_soon` with `details.retryAfterSeconds` when one ran a moment ago.
   */
  @Post("sync")
  @Roles(...CONTRIBUTORS)
  @HttpCode(HttpStatus.ACCEPTED)
  sync(@CurrentTenant() tenant: Organization): Promise<SyncStatusResource> {
    return this.trigger.trigger(tenant.id);
  }
}
