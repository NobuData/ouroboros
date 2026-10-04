/**
 * `InboxController` — the Needs-You routes under `/api/v1/inbox`.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)) shipped the feed; BN.4
 * ([#464](https://github.com/NobuData/ouroboros/issues/464)) adds the queue, the resolved day, the
 * stats and snooze beside it (the policy card is `inbox-policies/`, the action executor
 * `inbox-actions/`). **Members read**: the reads carry no `@Roles()`, so every member — viewers
 * included — sees what is waiting; a viewer's actions come back disabled with their reason.
 * **Contributors snooze**: a snooze hides an item from the whole workspace.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { currentUser } from "../tenancy/tenant.context";
import { CurrentMember, CurrentTenant } from "../tenancy/tenant.decorators";
import { InboxItemParams, InboxResolvedQuery, InboxSnoozeDto } from "./inbox.dto";
import { InboxFeedService, type InboxFeedResource } from "./inbox.feed";
import {
  InboxQueueService,
  type InboxQueueResource,
  type InboxResolvedResource,
  type InboxSnoozeResource,
  type InboxStatsResource,
  type InboxUnsnoozeResource,
} from "./inbox.queue";

/** *Snooze all 1h*: the default snooze, in minutes. */
export const DEFAULT_SNOOZE_MINUTES = 60;

/**
 * The signed-in person's id, or null for a caller with no person (a service account).
 *
 * @returns The id.
 */
function actorId(): string | null {
  return currentUser()?.id ?? null;
}

@Controller("inbox")
export class InboxController {
  /**
   * @param feed - The counts.
   */
  constructor(
    private readonly feed: InboxFeedService,
    private readonly queue: InboxQueueService,
  ) {}

  /**
   * `GET /api/v1/inbox` — the queue, the snoozed items and the head.
   *
   * @param member - The workspace and the caller's roles.
   * @returns The page's main read.
   */
  @Get()
  list(@CurrentMember() member: ActiveMembership): Promise<InboxQueueResource> {
    return this.queue.queue(member.tenant.id, { userId: actorId(), roles: member.roles });
  }

  /**
   * `GET /api/v1/inbox/resolved` — one UTC day's answers.
   *
   * @param tenant - The workspace.
   * @param query - The day.
   * @returns The rows and the paging.
   */
  @Get("resolved")
  resolved(
    @CurrentTenant() tenant: Organization,
    @Query() query: InboxResolvedQuery,
  ): Promise<InboxResolvedResource> {
    return this.queue.resolved(tenant.id, query.day);
  }

  /**
   * `GET /api/v1/inbox/stats` — this week's stat card.
   *
   * @param tenant - The workspace.
   * @returns The figures.
   */
  @Get("stats")
  stats(@CurrentTenant() tenant: Organization): Promise<InboxStatsResource> {
    return this.queue.stats(tenant.id);
  }

  /**
   * `POST /api/v1/inbox/items/{id}/snooze` — hide one item until the time asked.
   *
   * @param tenant - The workspace.
   * @param params - The item.
   * @param body - How long, and why.
   * @returns The item and when it wakes.
   */
  @Post("items/:id/snooze")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  snooze(
    @CurrentTenant() tenant: Organization,
    @Param() params: InboxItemParams,
    @Body() body: InboxSnoozeDto,
  ): Promise<InboxSnoozeResource> {
    return this.queue.snooze(
      tenant.id,
      params.id,
      actorId(),
      body.minutes ?? DEFAULT_SNOOZE_MINUTES,
      body.reason ?? null,
    );
  }

  /**
   * `POST /api/v1/inbox/snooze-all` — *Snooze all*: every open item, one event.
   *
   * @param tenant - The workspace.
   * @param body - How long, and why.
   * @returns The items caught.
   */
  @Post("snooze-all")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  snoozeAll(
    @CurrentTenant() tenant: Organization,
    @Body() body: InboxSnoozeDto,
  ): Promise<InboxSnoozeResource> {
    return this.queue.snoozeAll(
      tenant.id,
      actorId(),
      body.minutes ?? DEFAULT_SNOOZE_MINUTES,
      body.reason ?? null,
    );
  }

  /**
   * `POST /api/v1/inbox/items/{id}/unsnooze` — bring one item back now.
   *
   * @param tenant - The workspace.
   * @param params - The item.
   * @returns The item, if it was snoozed.
   */
  @Post("items/:id/unsnooze")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  unsnooze(
    @CurrentTenant() tenant: Organization,
    @Param() params: InboxItemParams,
  ): Promise<InboxUnsnoozeResource> {
    return this.queue.unsnooze(tenant.id, params.id, actorId());
  }

  /**
   * `POST /api/v1/inbox/unsnooze-all` — bring every snoozed item back now.
   *
   * @param tenant - The workspace.
   * @returns The items re-opened.
   */
  @Post("unsnooze-all")
  @HttpCode(HttpStatus.OK)
  @Roles(...CONTRIBUTORS)
  unsnoozeAll(@CurrentTenant() tenant: Organization): Promise<InboxUnsnoozeResource> {
    return this.queue.unsnooze(tenant.id, null, actorId());
  }

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
