/**
 * `InboxController` — the Needs-You routes under `/api/v1/inbox`.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)) ships the feed only; BN.4
 * (#464) adds the queue, the resolved list, the stats and snooze beside it. **Members read**: the
 * feed carries no `@Roles()`, so every member of the workspace — viewers included — sees how many
 * decisions are waiting.
 */

import { Controller, Get } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { InboxFeedService, type InboxFeedResource } from "./inbox.feed";

@Controller("inbox")
export class InboxController {
  /**
   * @param feed - The counts.
   */
  constructor(private readonly feed: InboxFeedService) {}

  /**
   * `GET /api/v1/inbox/feed` — the sidebar badge's counts, snooze-aware.
   *
   * @param tenant - The workspace.
   * @returns Open items by severity, the snoozed count and the next wake.
   */
  @Get("feed")
  read(@CurrentTenant() tenant: Organization): Promise<InboxFeedResource> {
    return this.feed.feed(tenant.id);
  }
}
