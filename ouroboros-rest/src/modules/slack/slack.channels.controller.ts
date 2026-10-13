/**
 * The Slack channel routes (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)) —
 * what the Chat Ops page's *+ Add channel* picker reads and writes.
 *
 * ```
 * GET    /api/v1/slack/channels               any member    the channels, and what each is for
 * POST   /api/v1/slack/channels/refresh       owner/admin   ask Slack for the list again
 * PUT    /api/v1/slack/channels/:id/binding   owner/admin   bind a channel for a purpose
 * DELETE /api/v1/slack/channels/:id/binding   owner/admin   unbind it
 * ```
 *
 * **Every member reads; administrators write** — as the connection's status and its verify are
 * gated (`slack.controller.ts`). Where a workspace's loops and alerts are posted is decided for
 * everyone. Every write answers with the list as it now stands, so the picker redraws from one
 * response.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { SLACK_ROUTE } from "./slack.app";
import { PutSlackChannelBindingDto } from "./slack.channels.dto";
import { SlackChannelsService } from "./slack.channels.service";
import type { SlackChannelsResource } from "./slack.resources";

@Controller(`${SLACK_ROUTE}/channels`)
export class SlackChannelsController {
  /** @param channels - The operations. */
  constructor(private readonly channels: SlackChannelsService) {}

  /**
   * `GET /slack/channels` — the channels the connection knows, as last listed.
   *
   * @param tenant - The workspace.
   * @returns The channels; none, with `connected: false`, without an active connection.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<SlackChannelsResource> {
    return this.channels.list(tenant.id);
  }

  /**
   * `POST /slack/channels/refresh` — ask Slack for the workspace's channels again.
   *
   * @param tenant - The workspace.
   * @returns The channels after the listing.
   * @throws {ConflictError} `409 slack_not_connected`.
   * @throws {UpstreamError} `502 slack_channel_list_failed`.
   */
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  refresh(@CurrentTenant() tenant: Organization): Promise<SlackChannelsResource> {
    return this.channels.refresh(tenant.id);
  }

  /**
   * `PUT /slack/channels/:id/binding` — bind a channel for a purpose.
   *
   * @param tenant - The workspace.
   * @param principal - Who bound it — the audit actor.
   * @param id - The channel row.
   * @param body - What the channel is for.
   * @returns The channels after the binding.
   * @throws {NotFoundError} `404 slack_channel_not_found`.
   * @throws {ConflictError} `409 slack_not_connected`, `slack_channel_archived` or
   *   `slack_channel_not_joined`.
   */
  @Put(":id/binding")
  @Roles(...ADMINISTRATORS)
  bind(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id") id: string,
    @Body() body: PutSlackChannelBindingDto,
  ): Promise<SlackChannelsResource> {
    return this.channels.bind(tenant.id, principal.user.id, id, body.purpose);
  }

  /**
   * `DELETE /slack/channels/:id/binding` — unbind a channel. Idempotent.
   *
   * @param tenant - The workspace.
   * @param principal - Who unbound it — the audit actor.
   * @param id - The channel row.
   * @returns The channels after it.
   * @throws {NotFoundError} `404 slack_channel_not_found`.
   * @throws {ConflictError} `409 slack_not_connected`.
   */
  @Delete(":id/binding")
  @Roles(...ADMINISTRATORS)
  unbind(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id") id: string,
  ): Promise<SlackChannelsResource> {
    return this.channels.unbind(tenant.id, principal.user.id, id);
  }
}
