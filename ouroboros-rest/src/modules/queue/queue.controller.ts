/**
 * `/api/v1/queue` — the ordered queue behind mockup 02's `Manage queue →` link
 * ([#73](https://github.com/NobuData/ouroboros/issues/73)).
 *
 * **The workspace is the session's, never the request's** — the same sentence the dashboard
 * and runs controllers open with, because it is the same property: no `{orgId}` in the
 * path, the tenant guard resolves and membership-checks the active organization, and this
 * handler reads what it established.
 *
 * **One route, and it reads.** Reorder, remove and enqueue are deliberately not here: the
 * queue's writes belong to the issues screen (mockup 03), and this surface publishing them
 * early would put the dashboard in the business of mutating rows it exists to display. The
 * OpenAPI description states the omission so it reads as a decision rather than an
 * oversight, and `queue.controller.spec.ts` holds it as a property.
 *
 * Sessions are required without anything here saying so — the global guard — and a tenant
 * is required *because* nothing here says otherwise: no `@TenantOptional()`, so a session
 * acting in no workspace is a `400 organization_required` before the handler runs.
 */

import { Controller, Get, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { ListQueueQuery } from "./queue.dto";
import { QueueService, type QueuePage } from "./queue.service";

@Controller("queue")
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  /**
   * One page of the workspace's queue — `position` ascending, `1` next.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param query - Repository filter and window, all optional.
   * @returns The page per the #31 convention, plus the whole match's `totalEstMinutes`.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization, @Query() query: ListQueueQuery): Promise<QueuePage> {
    return this.queue.list(tenant.id, query);
  }
}
