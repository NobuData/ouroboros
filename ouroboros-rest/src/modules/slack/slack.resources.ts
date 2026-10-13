/**
 * What the connection status API answers (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)) — the one source the Settings
 * integrations tile, the inbox's channel rows and the Chat Ops health strip (#541) read.
 */

import type { ChatDeliveryHealthRow } from "../chat/chat.outbox";
import type { ChatConnectionPublic } from "../db/schema";
import { SLACK_BOT_SCOPES, SLACK_PATH_PREFIX } from "./slack.app";

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
  };
}
