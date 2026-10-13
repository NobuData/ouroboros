/**
 * The workspace's Slack channels, and what each is for (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)) — the Chat Ops page's
 * *+ Add channel* picker.
 *
 * ```
 * list      connection{active} ─▶ channels (no DMs) + the Slack routes posting to each
 * refresh   unseal ─▶ conversations.list ─▶ channels stored   |   Slack's error ─▶ 502, nothing stored
 * bind      channel ∈ this connection · not archived · bot is a member
 *           ─▶ one transaction: purpose moved here ─▶ the purpose's default routes pointed here
 *           ─▶ audit chat.channel_bound
 * unbind    one transaction: purpose cleared ─▶ every route posting here detached
 *           ─▶ audit chat.channel_unbound (only when something changed)
 * ```
 *
 * **The bot is never joined to a channel from here.** The app asks for no `channels:join` scope
 * (a product decision on the ticket): a channel can be bound only where the bot already is a
 * member, and the refusal says what to type in Slack. A private channel is the same case.
 *
 * **A binding is a purpose, and a purpose is its default routes.** There is no bindings table
 * (V130): `chat_channels.purpose_tag` says what a channel is for, and `notification_routes`
 * says what is posted where. Binding a channel for a purpose points that purpose's default
 * routes ({@link PURPOSE_ROUTES}, mockup 19's rows) at it — creating the ones the workspace
 * does not have, and re-pointing the ones it does without touching whether they are on. Route by
 * route editing is #543.
 *
 * **One channel per purpose.** Binding a second channel for `loops` moves the purpose — and,
 * through the default routes, the posts — off the first.
 */

import { Injectable } from "@nestjs/common";

import { CHAT_CHANNEL_BOUND_EVENT, CHAT_CHANNEL_UNBOUND_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { DM_PURPOSE_TAG } from "../chat/chat.outbox";
import type { ChatChannel, ChatConnectionPublic } from "../db/schema";
import {
  slackChannelArchived,
  slackChannelListFailed,
  slackChannelNotFound,
  slackChannelNotJoined,
  slackNotConnected,
} from "./slack.errors";
import { SlackInstallService } from "./slack.install.service";
import { type ChannelRouteWrite, SlackRepository } from "./slack.repository";
import {
  type SlackChannelPurpose,
  type SlackChannelsResource,
  channelsResource,
  isChannelPurpose,
} from "./slack.resources";

/**
 * The routes each purpose switches on — mockup 19's five rows, as the development seed stores
 * them (`R__dev_seed_workspace_triage_slack.sql`). `enabled`, `dmOnCall` and `config` are what a
 * route is *created* as; a route the workspace already has keeps its own.
 *
 * *Every stage transition* is created switched off: it is noisy, and off by default.
 */
export const PURPOSE_ROUTES: Readonly<Record<SlackChannelPurpose, readonly ChannelRouteWrite[]>> = {
  loops: [
    { kind: "custom:blocking-questions", enabled: true, dmOnCall: true, config: {} },
    { kind: "custom:loop-finished", enabled: true, dmOnCall: false, config: {} },
    { kind: "custom:stage-transitions", enabled: false, dmOnCall: false, config: {} },
  ],
  alerts: [{ kind: "custom:build-failures", enabled: true, dmOnCall: false, config: {} }],
  leads: [{ kind: "custom:weekly-insights", enabled: true, dmOnCall: false, config: {} }],
};

/** A channel row's id, as the database stores one — anything else names no channel. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A channel a write may act on, and the connection it belongs to. */
interface Addressed {
  readonly connection: ChatConnectionPublic;
  readonly channel: ChatChannel;
}

@Injectable()
export class SlackChannelsService {
  /**
   * @param repository - Connections, channels and the routes posting to them.
   * @param installs - Unseals the bot token and lists channels.
   * @param audit - The audit plane.
   */
  constructor(
    private readonly repository: SlackRepository,
    private readonly installs: SlackInstallService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The workspace's channels, as last listed.
   *
   * @param organizationId - The workspace.
   * @returns The channels with what each is bound for; none without an active connection.
   */
  async list(organizationId: string): Promise<SlackChannelsResource> {
    const connection = await this.repository.connectionOf(organizationId);

    if (connection?.status !== "active") {
      return channelsResource({ connection: undefined, channels: [], routes: [] });
    }

    const [channels, routes] = await Promise.all([
      this.repository.channels(connection.id),
      this.repository.channelRoutes(organizationId),
    ]);

    return channelsResource({ connection, channels, routes });
  }

  /**
   * Ask Slack for the workspace's channels again — how a channel the bot was just invited to
   * becomes bindable.
   *
   * @param organizationId - The workspace.
   * @returns The channels after the listing.
   * @throws {ConflictError} `409 slack_not_connected`.
   * @throws {UpstreamError} `502 slack_channel_list_failed`, with Slack's error as
   *   `details.reason`; the stored channels are left as they were.
   */
  async refresh(organizationId: string): Promise<SlackChannelsResource> {
    const connection = await this.active(organizationId);
    const botToken = await this.installs.botToken(connection.id);

    if (botToken === undefined) {
      throw slackChannelListFailed("token_unavailable");
    }

    const failure = await this.installs.refreshChannels(connection, botToken);

    if (failure !== undefined) {
      throw slackChannelListFailed(failure);
    }

    return this.list(organizationId);
  }

  /**
   * Bind a channel for a purpose, and point the purpose's default routes at it.
   *
   * @param organizationId - The workspace.
   * @param actorId - The owner or admin binding it.
   * @param id - The channel row.
   * @param purpose - What the channel is for.
   * @returns The channels after the binding.
   * @throws {NotFoundError} `404 slack_channel_not_found`.
   * @throws {ConflictError} `409 slack_not_connected`, `409 slack_channel_archived`, or
   *   `409 slack_channel_not_joined` — which says how to add the bot in Slack.
   */
  async bind(
    organizationId: string,
    actorId: string,
    id: string,
    purpose: SlackChannelPurpose,
  ): Promise<SlackChannelsResource> {
    const { connection, channel } = await this.addressed(organizationId, id);

    if (channel.archived) {
      throw slackChannelArchived(channel.channel_name);
    }
    if (!channel.joined) {
      throw slackChannelNotJoined(channel.channel_name);
    }

    const defaults = PURPOSE_ROUTES[purpose];
    const routes = await this.repository.transaction(async (trx) => {
      const rows = await this.repository.lockChannels(trx, connection.id);
      const current = rows.find((row) => row.id === channel.id)?.purpose_tag ?? null;

      // One channel per purpose: whichever held it gives it up. Its default routes follow the
      // purpose below; anything else posting there is left where the workspace put it.
      for (const row of rows) {
        if (row.id !== channel.id && row.purpose_tag === purpose) {
          await this.repository.setChannelPurpose(trx, row.id, null);
        }
      }

      // A channel that was for something else stops being for it: the routes that purpose put
      // here are detached, exactly as an unbind would — all but the ones about to be pointed
      // here anyway, whose `enabled` a detach-and-repoint would otherwise switch off.
      if (current !== null && current !== purpose) {
        await this.repository.detachRoutes(
          trx,
          organizationId,
          channel.id,
          defaults.map((route) => route.kind),
          actorId,
        );
      }

      await this.repository.setChannelPurpose(trx, channel.id, purpose);

      const pointed: string[] = [];

      for (const route of defaults) {
        if (await this.repository.pointRoute(trx, organizationId, channel.id, route, actorId)) {
          pointed.push(route.kind);
        }
      }

      return pointed;
    });

    await this.audit.record({
      organizationId,
      actorId,
      action: CHAT_CHANNEL_BOUND_EVENT,
      subjectType: "chat_channel",
      subjectId: channel.id,
      at: new Date(),
      detail: {
        connectionId: connection.id,
        platformChannelId: channel.channel_id,
        channelName: channel.channel_name,
        purpose,
        routes: routes.join(","),
      },
    });

    return this.list(organizationId);
  }

  /**
   * Unbind a channel: clear what it is for and detach every route posting to it. Idempotent — a
   * channel that was not bound is answered the same way, and nothing is recorded.
   *
   * @param organizationId - The workspace.
   * @param actorId - The owner or admin unbinding it.
   * @param id - The channel row.
   * @returns The channels after it.
   * @throws {NotFoundError} `404 slack_channel_not_found`.
   * @throws {ConflictError} `409 slack_not_connected`.
   */
  async unbind(
    organizationId: string,
    actorId: string,
    id: string,
  ): Promise<SlackChannelsResource> {
    const { connection, channel } = await this.addressed(organizationId, id);

    const change = await this.repository.transaction(async (trx) => {
      const rows = await this.repository.lockChannels(trx, connection.id);
      const current = rows.find((row) => row.id === channel.id)?.purpose_tag ?? null;

      if (current !== null) {
        await this.repository.setChannelPurpose(trx, channel.id, null);
      }

      return {
        purpose: current,
        routes: await this.repository.detachRoutes(trx, organizationId, channel.id, [], actorId),
      };
    });

    if (change.purpose !== null || change.routes.length > 0) {
      await this.audit.record({
        organizationId,
        actorId,
        action: CHAT_CHANNEL_UNBOUND_EVENT,
        subjectType: "chat_channel",
        subjectId: channel.id,
        at: new Date(),
        detail: {
          connectionId: connection.id,
          platformChannelId: channel.channel_id,
          channelName: channel.channel_name,
          purpose: isChannelPurpose(change.purpose) ? change.purpose : null,
          routes: change.routes.join(","),
        },
      });
    }

    return this.list(organizationId);
  }

  /**
   * The workspace's active Slack connection.
   *
   * @param organizationId - The workspace.
   * @returns The connection.
   * @throws {ConflictError} `409 slack_not_connected` when Slack was never installed, or the
   *   install was revoked or is failing.
   */
  private async active(organizationId: string): Promise<ChatConnectionPublic> {
    const connection = await this.repository.connectionOf(organizationId);

    if (connection?.status !== "active") {
      throw slackNotConnected();
    }

    return connection;
  }

  /**
   * The channel a write names, when it is one of the active connection's.
   *
   * @param organizationId - The workspace.
   * @param id - The id from the path.
   * @returns The channel and its connection.
   * @throws {NotFoundError} `404 slack_channel_not_found` — not a channel row of this workspace,
   *   a DM conversation, or a row left behind by a connection that is no longer the active one.
   * @throws {ConflictError} `409 slack_not_connected`.
   */
  private async addressed(organizationId: string, id: string): Promise<Addressed> {
    const channel = UUID.test(id) ? await this.repository.channel(organizationId, id) : undefined;

    if (channel === undefined || channel.purpose_tag === DM_PURPOSE_TAG) {
      throw slackChannelNotFound(id);
    }

    const connection = await this.active(organizationId);

    if (channel.connection_id !== connection.id) {
      throw slackChannelNotFound(id);
    }

    return { connection, channel };
  }
}
