/**
 * Installing the Slack app into a workspace, and knowing whether it still works (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)).
 *
 * ```
 * install   authorize URL (state) ─▶ Slack consent ─▶ callback(code) ─▶ oauth.v2.access
 *           ─▶ token sealed (AD.1, bound to the connection's id) ─▶ connection{active}
 *           ─▶ channels listed ─▶ audit chat.connection_installed
 * verify    unseal ─▶ auth.test ─▶ last_verified_at   |   revoked error ─▶ connection{revoked}
 * revoked   app_uninstalled · tokens_revoked · invalid_auth ─▶ connection{revoked}, token dropped
 * ```
 *
 * **The bot token is plaintext for exactly as long as it takes to seal it.** It arrives from
 * `oauth.v2.access`, is sealed under the workspace's key with the connection's id as the
 * record, and is never logged, returned or stored any other way.
 *
 * **Revocation is a state.** When Slack says the install is over, the connection is flipped to
 * `revoked` with the platform's reason and its dead token dropped. Nothing retries a revoked
 * connection: a publisher (BZ.2, #536) checks the status before it posts, and the product
 * shows the state instead of a growing pile of failures.
 */

import { randomUUID } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  CHAT_CONNECTION_INSTALLED_EVENT,
  CHAT_CONNECTION_REVOKED_EVENT,
} from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { AppConfigService } from "../config/config.service";
import type { ChatConnectionPublic } from "../db/schema";
import { VaultService } from "../vault/vault.service";
import {
  SLACK_APP_MANIFEST_VERSION,
  SLACK_AUTHORIZE_URL,
  SLACK_BOT_SCOPES,
  SLACK_PATH_PREFIX,
} from "./slack.app";
import { REVOKED_ERRORS, SLACK_API, type SlackApi } from "./slack.client";
import { slackAlreadyConnected, slackInstallFailed, slackNotConfigured } from "./slack.errors";
import { SlackRepository, violates } from "./slack.repository";

/** The app's OAuth credentials, when the deployment has registered one. */
export interface SlackAppCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** What {@link SlackInstallService.verify} found. */
export type SlackVerification = "verified" | "revoked" | "unreachable" | "not_connected";

@Injectable()
export class SlackInstallService {
  private readonly logger = new Logger(SlackInstallService.name);

  /**
   * @param config - The deployment's Slack app, and the UI origin links are built on.
   * @param slack - The calls to Slack.
   * @param repository - Connections and channels.
   * @param vault - Seals and unseals the bot token.
   * @param audit - The audit plane.
   */
  constructor(
    private readonly config: AppConfigService,
    @Inject(SLACK_API) private readonly slack: SlackApi,
    private readonly repository: SlackRepository,
    private readonly vault: VaultService,
    private readonly audit: AuditService,
  ) {}

  /**
   * This deployment's Slack app credentials.
   *
   * @returns The client id and secret, or `undefined` when no Slack app is registered.
   */
  credentials(): SlackAppCredentials | undefined {
    const { slackClientId: clientId, slackClientSecret: clientSecret } = this.config;

    return clientId === undefined || clientSecret === undefined
      ? undefined
      : { clientId, clientSecret };
  }

  /**
   * Where Slack sends the browser back to — on the UI origin, whose proxy forwards the Slack
   * family here, so the session cookie travels with it.
   *
   * @returns The redirect URI registered in the app's manifest.
   */
  redirectUri(): string {
    return `${this.config.uiUrl.replace(/\/+$/, "")}${SLACK_PATH_PREFIX}oauth/callback`;
  }

  /**
   * The Slack consent screen for this app.
   *
   * @param state - The value the callback must present back — bound to the browser that began.
   * @returns The URL to send the browser to.
   * @throws {NotFoundError} `404 slack_not_configured` when the deployment has no Slack app.
   */
  authorizeUrl(state: string): string {
    const credentials = this.credentials();

    if (credentials === undefined) {
      throw slackNotConfigured();
    }

    const query = new URLSearchParams({
      client_id: credentials.clientId,
      scope: SLACK_BOT_SCOPES.join(","),
      state,
      redirect_uri: this.redirectUri(),
    });

    return `${SLACK_AUTHORIZE_URL}?${query.toString()}`;
  }

  /**
   * Complete an install: exchange the code, seal the token, store the connection, list channels.
   *
   * @param organizationId - The workspace installing.
   * @param userId - The owner or admin who began the install.
   * @param code - The code Slack sent to the callback.
   * @returns The connection, active.
   * @throws {NotFoundError} `404 slack_not_configured`.
   * @throws {UpstreamError} `502 slack_install_failed` when Slack does not complete the exchange.
   * @throws {ConflictError} `409 slack_already_connected` when the workspace already has a
   *   different Slack workspace active.
   */
  async complete(
    organizationId: string,
    userId: string,
    code: string,
  ): Promise<ChatConnectionPublic> {
    const credentials = this.credentials();

    if (credentials === undefined) {
      throw slackNotConfigured();
    }

    const exchange = await this.slack.exchangeCode({
      ...credentials,
      code,
      redirectUri: this.redirectUri(),
    });

    if (!exchange.ok) {
      throw slackInstallFailed(exchange.error);
    }

    const { grant } = exchange;
    const current = await this.repository.connectionOf(organizationId);

    // Refused before anything is written, with the name a person recognises; the unique index
    // below is what makes it true under a race.
    if (current?.status === "active" && current.workspace_id !== grant.teamId) {
      throw slackAlreadyConnected(current.workspace_name);
    }

    // The envelope is bound to the connection's id, so the id is settled first: the existing
    // row's on a re-install, a new one otherwise.
    const id = (await this.repository.installedId(organizationId, grant.teamId)) ?? randomUUID();
    const at = new Date();

    try {
      await this.repository.saveInstall({
        id,
        organizationId,
        workspaceId: grant.teamId,
        workspaceName: grant.teamName,
        botTokenSealed: await this.vault.encryptText(organizationId, id, grant.botToken),
        botUserId: grant.botUserId,
        installMeta: {
          scopes: [...grant.scopes],
          app_id: grant.appId,
          app_version: SLACK_APP_MANIFEST_VERSION,
        },
        installedBy: userId,
        at,
      });
    } catch (error) {
      if (violates(error, "chat_connections_one_active_slack")) {
        throw slackAlreadyConnected(current?.workspace_name ?? "another Slack workspace");
      }
      throw error;
    }

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: CHAT_CONNECTION_INSTALLED_EVENT,
      subjectType: "chat_connection",
      subjectId: id,
      at,
      detail: {
        workspaceId: grant.teamId,
        workspaceName: grant.teamName,
        appId: grant.appId,
        appVersion: SLACK_APP_MANIFEST_VERSION,
        scopes: grant.scopes.join(","),
      },
    });

    const connection = await this.repository.connection(id);

    if (connection === undefined) {
      throw slackInstallFailed("connection_not_stored");
    }

    // The install stands whether or not the listing does: channels can be refreshed later.
    await this.refreshChannels(connection, grant.botToken);

    return connection;
  }

  /**
   * Ask Slack whether a workspace's connection still works, and refresh its channels.
   *
   * @param organizationId - The workspace.
   * @returns `verified`; `revoked` when Slack said the install is over (the connection is
   *   flipped); `unreachable` when Slack could not be asked; `not_connected` when there is no
   *   active connection to ask about.
   */
  async verify(organizationId: string): Promise<SlackVerification> {
    const connection = await this.repository.connectionOf(organizationId);

    if (connection === undefined || connection.status !== "active") {
      return "not_connected";
    }

    const botToken = await this.botToken(connection.id);

    if (botToken === undefined) {
      return "unreachable";
    }

    const answer = await this.slack.authTest(botToken);

    if (!answer.ok) {
      return (await this.noteFailure(connection, answer.error, "auth.test"))
        ? "revoked"
        : "unreachable";
    }

    await this.repository.markVerified(connection.id, new Date());
    await this.refreshChannels(connection, botToken);

    return "verified";
  }

  /**
   * A connection's bot token, unsealed for one call.
   *
   * @param connectionId - The connection.
   * @returns The token, or `undefined` when the connection is not active, holds no token, or
   *   its envelope cannot be opened — which is logged, without the envelope.
   */
  async botToken(connectionId: string): Promise<string | undefined> {
    const sealed = await this.repository.sealedToken(connectionId);

    if (sealed === undefined) {
      return undefined;
    }

    try {
      return await this.vault.decryptText(sealed.organizationId, connectionId, sealed.envelope);
    } catch {
      this.logger.warn(`The bot token of Slack connection ${connectionId} could not be unsealed.`);

      return undefined;
    }
  }

  /**
   * React to a failed call: when Slack's error means the install is over, flip the connection.
   *
   * @param connection - The connection the call was made for.
   * @param error - Slack's error code.
   * @param source - The call or event that revealed it, for the audit entry.
   * @returns `true` when the error was a revocation and the connection is now `revoked`;
   *   `false` for a failure worth retrying.
   */
  async noteFailure(
    connection: Pick<ChatConnectionPublic, "id" | "organization_id">,
    error: string,
    source: string,
  ): Promise<boolean> {
    if (!REVOKED_ERRORS.has(error)) {
      return false;
    }

    await this.revoke(connection, error, source);

    return true;
  }

  /**
   * Flip a connection to `revoked`. Idempotent: a second call changes and records nothing.
   *
   * @param connection - The connection.
   * @param reason - The platform's reason.
   * @param source - The call or event that revealed it.
   */
  async revoke(
    connection: Pick<ChatConnectionPublic, "id" | "organization_id">,
    reason: string,
    source: string,
  ): Promise<void> {
    if (!(await this.repository.markRevoked(connection.id, reason))) {
      return;
    }

    this.logger.warn(`Slack connection ${connection.id} is revoked: ${reason} (${source}).`);

    await this.audit.record({
      organizationId: connection.organization_id,
      actorId: null,
      action: CHAT_CONNECTION_REVOKED_EVENT,
      subjectType: "chat_connection",
      subjectId: connection.id,
      at: new Date(),
      detail: { reason, source },
    });
  }

  /**
   * List the workspace's channels and store them. A failure is noted and never thrown: an
   * install and a verification stand whether or not the listing does, and the caller that does
   * care (`POST /slack/channels/refresh`, #541) reads the answer.
   *
   * @param connection - The connection.
   * @param botToken - Its token, unsealed.
   * @returns `undefined` when the listing was stored; otherwise Slack's error code, with nothing
   *   stored — and the connection flipped to `revoked` when the error means the install is over.
   */
  async refreshChannels(
    connection: Pick<ChatConnectionPublic, "id" | "organization_id">,
    botToken: string,
  ): Promise<string | undefined> {
    const listing = await this.slack.listChannels(botToken);

    if (!listing.ok) {
      await this.noteFailure(connection, listing.error, "conversations.list");

      return listing.error;
    }

    await this.repository.saveChannels(connection, listing.channels, new Date());

    return undefined;
  }
}
