/**
 * What the connection status API answers (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)) — the one source the Settings
 * integrations tile, the inbox's channel rows and the Chat Ops health strip (#541) read.
 */

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
}

/**
 * Compose the status resource.
 *
 * @param input - Whether the deployment has an app, the workspace's connection if any, its
 *   channel counts, and whether Socket Mode is on.
 * @returns The resource.
 */
export function connectionResource(input: {
  configured: boolean;
  connection: ChatConnectionPublic | undefined;
  channels: { total: number; joined: number };
  socketMode: boolean;
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
  };
}
