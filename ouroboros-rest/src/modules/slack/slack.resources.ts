/**
 * What the connection status API answers (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)) — the one source the Settings
 * integrations tile, the inbox's channel rows and the Chat Ops health strip (#541) read.
 */

import { DM_PURPOSE_TAG, type ChatDeliveryHealthRow } from "../chat/chat.outbox";
import type { ChatChannel, ChatConnectionPublic } from "../db/schema";
import { SLACK_BOT_SCOPES, SLACK_PATH_PREFIX } from "./slack.app";
import type { ChannelRouteRow } from "./slack.repository";

/**
 * Where Slack stands for a workspace.
 *
 * - `not_configured` — this deployment has registered no Slack app; there is nothing to install.
 * - `not_connected` — the app exists and this workspace has not installed it.
 * - `connected` — installed, and the token worked when last checked.
 * - `revoked` — the app was removed from the Slack workspace, or its token revoked.
 * - `error` — installed, but the platform could not be reached or answered something else.
 */
export type SlackConnectionState =
  "not_configured" | "not_connected" | "connected" | "revoked" | "error";

/** `GET /api/v1/slack/connection`. */
export interface SlackConnectionResource {
  readonly state: SlackConnectionState;
  /** Whether this deployment has a Slack app registered at all. */
  readonly configured: boolean;
  /** Where an owner or admin starts the install, on the UI origin — `null` when not configured. */
  readonly installPath: string | null;
  /** The connection's id — `null` when Slack was never installed here. */
  readonly connectionId: string | null;
  /** The Slack workspace — `null` when never installed. */
  readonly workspace: { readonly id: string; readonly name: string } | null;
  /** The Slack app's id and the manifest version it was installed at. */
  readonly appId: string | null;
  readonly appVersion: string | null;
  /** The scopes Slack granted, and any of the app's scopes it did not. */
  readonly scopes: readonly string[];
  readonly missingScopes: readonly string[];
  /** The platform's reason the connection is not working — `null` when it is, or never was. */
  readonly statusDetail: string | null;
  readonly installedAt: string | null;
  /** When the token was last seen to work. */
  readonly lastVerifiedAt: string | null;
  /** How many channels are known, and how many the bot is a member of. */
  readonly channels: { readonly total: number; readonly joined: number };
  /** Whether this deployment reaches Slack over Socket Mode — development only. */
  readonly socketMode: boolean;
  /** How the messages Ouroboros publishes through this connection are faring (#536). */
  readonly delivery: SlackDeliveryResource;
  /**
   * Whether the reader has a linked Slack identity on the workspace's active connection (#545).
   * False without an active connection. It gates nothing in the app — commands typed there run
   * under the session — and says only whether Slack's buttons will act as this person.
   */
  readonly viewerLinked: boolean;
}

/**
 * How publishing stands.
 *
 * - `idle` — nothing has been published and nothing is waiting.
 * - `healthy` — messages are going out.
 * - `retrying` — at least one message failed and will be tried again.
 * - `dead_lettered` — at least one message ran out of attempts in the last seven days and was
 *   not delivered. This is the state a banner is drawn for.
 */
export type SlackDeliveryState = "idle" | "healthy" | "retrying" | "dead_lettered";

/** The publisher's outbox for a connection, as counts. */
export interface SlackDeliveryResource {
  readonly state: SlackDeliveryState;
  /** Messages waiting for their first attempt. */
  readonly pending: number;
  /** Messages that failed and will be retried. */
  readonly retrying: number;
  /** Messages given up on in the last seven days. */
  readonly deadLettered: number;
  /** Messages still failing after several attempts — retrying persistently. */
  readonly stuck: number;
  /** The kinds of the routes with a dead letter or a stuck message, sorted. */
  readonly affectedRoutes: readonly string[];
  /** The most recent dead letter's error and instant — `null` when there is none. */
  readonly lastError: string | null;
  readonly lastDeadLetteredAt: string | null;
  /** When a message was last delivered. */
  readonly lastSentAt: string | null;
}

/** The delivery of a connection that has published nothing — or of no connection at all. */
export const NO_DELIVERY: ChatDeliveryHealthRow = {
  pending: 0,
  retrying: 0,
  deadLettered: 0,
  stuck: 0,
  affectedRoutes: [],
  lastError: null,
  lastDeadLetteredAt: null,
  lastSentAt: null,
};

/**
 * Compose the delivery resource.
 *
 * @param health - The outbox's counts.
 * @returns The resource. The worst thing true of the outbox is its state.
 */
export function deliveryResource(health: ChatDeliveryHealthRow): SlackDeliveryResource {
  return {
    state:
      health.deadLettered > 0
        ? "dead_lettered"
        : health.retrying > 0
          ? "retrying"
          : health.pending > 0 || health.lastSentAt !== null
            ? "healthy"
            : "idle",
    pending: health.pending,
    retrying: health.retrying,
    deadLettered: health.deadLettered,
    stuck: health.stuck,
    affectedRoutes: health.affectedRoutes,
    lastError: health.lastError,
    lastDeadLetteredAt: health.lastDeadLetteredAt?.toISOString() ?? null,
    lastSentAt: health.lastSentAt?.toISOString() ?? null,
  };
}

/**
 * Compose the status resource.
 *
 * @param input - Whether the deployment has an app, the workspace's connection if any, its
 *   channel counts, whether Socket Mode is on, and how its published messages are faring.
 * @returns The resource.
 */
export function connectionResource(input: {
  configured: boolean;
  connection: ChatConnectionPublic | undefined;
  channels: { total: number; joined: number };
  socketMode: boolean;
  delivery?: ChatDeliveryHealthRow;
  viewerLinked?: boolean;
}): SlackConnectionResource {
  const { configured, connection } = input;
  const scopes = connection?.install_meta.scopes ?? [];

  return {
    state:
      connection === undefined
        ? configured
          ? "not_connected"
          : "not_configured"
        : connection.status === "active"
          ? "connected"
          : connection.status,
    configured,
    installPath: configured ? `${SLACK_PATH_PREFIX}oauth/install` : null,
    connectionId: connection?.id ?? null,
    workspace:
      connection === undefined
        ? null
        : { id: connection.workspace_id, name: connection.workspace_name },
    appId: connection?.install_meta.app_id ?? null,
    appVersion: connection?.install_meta.app_version ?? null,
    scopes,
    // Only meaningful for a live connection: a revoked one has no grant to be short of.
    missingScopes:
      connection?.status === "active"
        ? SLACK_BOT_SCOPES.filter((scope) => !scopes.includes(scope))
        : [],
    statusDetail: connection?.status_detail ?? null,
    installedAt: connection?.installed_at.toISOString() ?? null,
    lastVerifiedAt: connection?.last_verified_at?.toISOString() ?? null,
    channels: input.channels,
    socketMode: input.socketMode,
    delivery: deliveryResource(input.delivery ?? NO_DELIVERY),
    // A link is to an active connection: with none, nobody is linked.
    viewerLinked: connection?.status === "active" && input.viewerLinked === true,
  };
}

/**
 * What a channel can be bound for (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541))
 * — mockup 19's three: where loops report, where failures alert, where leads read the digest.
 * In the order the page lists them.
 */
export const CHANNEL_PURPOSES = ["loops", "alerts", "leads"] as const;

/** One of {@link CHANNEL_PURPOSES}. */
export type SlackChannelPurpose = (typeof CHANNEL_PURPOSES)[number];

/** One Slack channel the workspace's connection knows. */
export interface SlackChannelResource {
  /** The workspace's channel row — what a binding is addressed by. */
  readonly id: string;
  /** Slack's own id for the channel (`C071LOOPS`). */
  readonly platformChannelId: string;
  /** Without the leading `#`. */
  readonly name: string;
  readonly isPrivate: boolean;
  /** Whether the bot is a member — it can post, and be bound, only where it is. */
  readonly joined: boolean;
  /** How many members Slack last reported — `null` until it has. */
  readonly memberCount: number | null;
  /** What the channel is bound for — `null` when it is not bound. */
  readonly purpose: SlackChannelPurpose | null;
  readonly archived: boolean;
  /** The channel, opened in Slack. */
  readonly url: string;
  /** The kinds of the Slack notification routes that post here, sorted. */
  readonly routes: readonly string[];
}

/** `GET /api/v1/slack/channels`, and what every channel write answers with. */
export interface SlackChannelsResource {
  /** Whether the workspace has an active Slack connection. Without one there are no channels. */
  readonly connected: boolean;
  /** When a channel row last changed — in practice, when the list was last refreshed. */
  readonly refreshedAt: string | null;
  readonly channels: readonly SlackChannelResource[];
}

/**
 * Whether a purpose tag is one a channel can be bound for.
 *
 * @param tag - A `chat_channels.purpose_tag`, or null.
 * @returns True for `loops`, `alerts` and `leads`.
 */
export function isChannelPurpose(tag: string | null): tag is SlackChannelPurpose {
  return (CHANNEL_PURPOSES as readonly (string | null)[]).includes(tag);
}

/**
 * Where a channel opens in Slack.
 *
 * @param workspaceId - Slack's team id (`T024AB`).
 * @param platformChannelId - Slack's channel id (`C071LOOPS`).
 * @returns The web client's URL, which the desktop app takes over when it is installed.
 */
export function channelUrl(workspaceId: string, platformChannelId: string): string {
  return `https://app.slack.com/client/${encodeURIComponent(workspaceId)}/${encodeURIComponent(platformChannelId)}`;
}

/**
 * Compose one channel — the shape the list, and the channel mirror (#542), answer with.
 *
 * @param connection - The connection the channel belongs to; its Slack workspace is in the URL.
 * @param row - The channel row.
 * @param routes - The workspace's Slack routes that post to a channel.
 * @returns The resource.
 */
export function channelResource(
  connection: Pick<ChatConnectionPublic, "workspace_id">,
  row: ChatChannel,
  routes: readonly ChannelRouteRow[],
): SlackChannelResource {
  return {
    id: row.id,
    platformChannelId: row.channel_id,
    name: row.channel_name,
    isPrivate: row.is_private,
    joined: row.joined,
    memberCount: row.member_count,
    purpose: isChannelPurpose(row.purpose_tag) ? row.purpose_tag : null,
    archived: row.archived,
    url: channelUrl(connection.workspace_id, row.channel_id),
    routes: routes
      .filter((route) => route.chatChannelId === row.id)
      .map((route) => route.kind)
      .sort(),
  };
}

/**
 * Compose the channel list.
 *
 * @param input - The workspace's connection if any, its channel rows, and the Slack routes that
 *   post to a channel.
 * @returns The resource: nothing listed where Slack was never installed; otherwise every channel
 *   but the DM conversations the publisher opened (#536) — bound ones first, in the order of
 *   {@link CHANNEL_PURPOSES}, then by name. A revoked or failing connection's channels are
 *   still listed, with `connected: false` (#545): what was published to them stays readable,
 *   and every write refuses.
 */
export function channelsResource(input: {
  connection: ChatConnectionPublic | undefined;
  channels: readonly ChatChannel[];
  routes: readonly ChannelRouteRow[];
}): SlackChannelsResource {
  const { connection } = input;

  if (connection === undefined) {
    return { connected: false, refreshedAt: null, channels: [] };
  }

  const rows = input.channels.filter((row) => row.purpose_tag !== DM_PURPOSE_TAG);
  const newest = rows.reduce((latest, row) => Math.max(latest, row.updated_at.getTime()), 0);
  const channels = rows.map((row) => channelResource(connection, row, input.routes));

  /** A bound channel's place among the purposes; an unbound one sorts after them all. */
  const rank = (channel: SlackChannelResource): number =>
    channel.purpose === null ? CHANNEL_PURPOSES.length : CHANNEL_PURPOSES.indexOf(channel.purpose);

  return {
    connected: connection.status === "active",
    refreshedAt: rows.length === 0 ? null : new Date(newest).toISOString(),
    channels: channels.sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    ),
  };
}
