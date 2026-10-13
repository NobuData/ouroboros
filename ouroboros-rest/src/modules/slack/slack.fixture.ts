/* eslint-disable @typescript-eslint/require-await -- in-memory fakes of async ports: each method keeps the port's `async` signature and answers at once. */
/**
 * Fakes for the Slack app's specs (BZ.1, #535): a scriptable Slack, an in-memory store with the
 * database's own rules where a spec depends on them, and a vault that seals reversibly.
 */

import { randomUUID } from "node:crypto";

import type {
  ChatChannel,
  ChatConnectionPublic,
  ChatIdentityLink,
  ChatIdentityVerification,
  NotificationRouteChannel,
  NotificationRouteConfig,
} from "../db/schema";
import type { ChatDeliveryHealthRow } from "../chat/chat.outbox";
import type {
  SlackApi,
  SlackChannelSummary,
  SlackInstallGrant,
  SlackReply,
  SlackResult,
  SlackUserProfile,
  SlackDelivery,
  SlackMessage,
} from "./slack.client";
import type {
  ChannelRouteRow,
  ChannelRouteWrite,
  InstallWrite,
  WorkspaceMember,
} from "./slack.repository";

/** The workspace, Slack workspace and people the specs share. */
export const ORG = "org-acme";
export const TEAM = "T024AB";
export const KEN = { userId: "user-ken", name: "Ken S", email: "ken@acme-robotics.dev" } as const;
export const MAYA = {
  userId: "user-maya",
  name: "Maya Chen",
  email: "maya@acme-robotics.dev",
} as const;
export const SLACK_KEN = "U07KEN";
export const SLACK_MAYA = "U07MAYA";

/** A bot token that is recognisable if it ever leaks into an assertion. */
export const BOT_TOKEN = "xoxb-test-bot-token-that-must-not-leak";

/** What `oauth.v2.access` grants in these specs. */
export function grant(overrides: Partial<SlackInstallGrant> = {}): SlackInstallGrant {
  return {
    botToken: BOT_TOKEN,
    botUserId: "U07OUROBOT",
    appId: "A07OUROBOROS",
    scopes: [
      "chat:write",
      "commands",
      "channels:read",
      "groups:read",
      "im:write",
      "users:read",
      "users:read.email",
    ],
    teamId: TEAM,
    teamName: "acme-robotics",
    installerUserId: SLACK_KEN,
    ...overrides,
  };
}

/** One channel, as Slack lists it. */
export function channel(overrides: Partial<SlackChannelSummary> = {}): SlackChannelSummary {
  return {
    id: "C071LOOPS",
    name: "ouroboros-loops",
    isPrivate: false,
    isMember: true,
    isArchived: false,
    memberCount: 24,
    ...overrides,
  };
}

/** A Slack that answers what a spec scripted, and remembers what it was asked. */
export class FakeSlackApi implements SlackApi {
  exchange: SlackResult<{ grant: SlackInstallGrant }> = { ok: true, grant: grant() };
  auth: SlackResult<{ teamId: string; botUserId: string }> = {
    ok: true,
    teamId: TEAM,
    botUserId: "U07OUROBOT",
  };
  channelList: SlackResult<{ channels: readonly SlackChannelSummary[] }> = {
    ok: true,
    channels: [channel(), channel({ id: "C072ALERT", name: "helios-alerts", isMember: false })],
  };
  profiles = new Map<string, SlackUserProfile>([
    [SLACK_KEN, { id: SLACK_KEN, displayName: "Ken S", email: KEN.email }],
    [
      SLACK_MAYA,
      { id: SLACK_MAYA, displayName: "Maya Chen", email: "maya.chen@elsewhere.example" },
    ],
  ]);
  profileError: string | undefined;
  socket: SlackResult<{ url: string }> = { ok: true, url: "wss://wss.slack.example/link" };
  respondResult: SlackResult<object> = { ok: true };

  /** Every reply sent, with where it went. */
  readonly replies: { responseUrl: string; reply: SlackReply }[] = [];
  /** Every token a call was made with — to assert none is the sealed form. */
  readonly tokensSeen: string[] = [];
  /** The codes exchanged. */
  readonly exchanged: { code: string; redirectUri: string; clientSecret: string }[] = [];

  async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<SlackResult<{ grant: SlackInstallGrant }>> {
    this.exchanged.push(input);

    return this.exchange;
  }

  async authTest(botToken: string): Promise<SlackResult<{ teamId: string; botUserId: string }>> {
    this.tokensSeen.push(botToken);

    return this.auth;
  }

  async listChannels(
    botToken: string,
  ): Promise<SlackResult<{ channels: readonly SlackChannelSummary[] }>> {
    this.tokensSeen.push(botToken);

    return this.channelList;
  }

  async userProfile(
    botToken: string,
    userId: string,
  ): Promise<SlackResult<{ user: SlackUserProfile }>> {
    this.tokensSeen.push(botToken);

    if (this.profileError !== undefined) {
      return { ok: false, error: this.profileError };
    }

    const user = this.profiles.get(userId);

    return user === undefined ? { ok: false, error: "user_not_found" } : { ok: true, user };
  }

  async openSocket(): Promise<SlackResult<{ url: string }>> {
    return this.socket;
  }

  async respond(responseUrl: string, reply: SlackReply): Promise<SlackResult<object>> {
    this.replies.push({ responseUrl, reply });

    return this.respondResult;
  }

  /** Every message posted, in order. */
  readonly posted: { channel: string; message: SlackMessage; ts: string }[] = [];
  /** Every edit made, in order. */
  readonly updated: { channel: string; ts: string; message: SlackMessage }[] = [];
  /** Scripted answers for the next message calls; a call with none scripted succeeds. */
  readonly deliveries: SlackDelivery<{ ts: string }>[] = [];
  /** The DM conversation each user id opens; an unknown user is `user_not_found`. */
  readonly dms = new Map<string, string>([
    [SLACK_KEN, "D07KEN"],
    [SLACK_MAYA, "D07MAYA"],
  ]);

  async postMessage(
    botToken: string,
    channel: string,
    message: SlackMessage,
  ): Promise<SlackDelivery<{ ts: string }>> {
    this.tokensSeen.push(botToken);
    const scripted = this.deliveries.shift();

    if (scripted !== undefined && !scripted.ok) {
      return scripted;
    }

    const ts = scripted?.ts ?? `1760000000.${String(this.posted.length + 1).padStart(6, "0")}`;
    this.posted.push({ channel, message, ts });

    return { ok: true, ts };
  }

  async updateMessage(
    botToken: string,
    channel: string,
    ts: string,
    message: SlackMessage,
  ): Promise<SlackDelivery<{ ts: string }>> {
    this.tokensSeen.push(botToken);
    const scripted = this.deliveries.shift();

    if (scripted !== undefined && !scripted.ok) {
      return scripted;
    }

    this.updated.push({ channel, ts, message });

    return { ok: true, ts };
  }

  async openDm(botToken: string, userId: string): Promise<SlackDelivery<{ channelId: string }>> {
    this.tokensSeen.push(botToken);
    const channelId = this.dms.get(userId);

    return channelId === undefined
      ? { ok: false, error: "user_not_found" }
      : { ok: true, channelId };
  }
}

/** A vault that seals into the envelope's shape, reversibly, bound to the record id. */
export class FakeVault {
  async encryptText(organizationId: string, recordId: string, plaintext: string): Promise<string> {
    const body = Buffer.from(`${organizationId}|${recordId}|${plaintext}`).toString("base64url");

    return `ouro.v1.1.bm9uY2U.${body}`;
  }

  async decryptText(organizationId: string, recordId: string, envelope: string): Promise<string> {
    const [org, record, ...rest] = Buffer.from(envelope.split(".")[4] ?? "", "base64url")
      .toString()
      .split("|");

    if (org !== organizationId || record !== recordId) {
      throw new Error("the envelope is bound to another record");
    }

    return rest.join("|");
  }
}

/** An audit plane that keeps what it was told. */
export class RecordingAudit {
  readonly events: Record<string, unknown>[] = [];

  async record(event: Record<string, unknown>): Promise<string> {
    this.events.push(event);

    return randomUUID();
  }
}

/** A stored connection, with the column the public view leaves out. */
interface StoredConnection extends ChatConnectionPublic {
  bot_token_sealed: string | null;
}

/** A stored notification route — the columns a channel binding reads and writes. */
export interface StoredRoute {
  organization_id: string;
  kind: string;
  channel: NotificationRouteChannel;
  config: NotificationRouteConfig;
  enabled: boolean;
  chat_channel_id: string | null;
  dm_on_call: boolean;
  updated_by: string | null;
}

/** One stored route, as a spec seeds it. */
export function route(overrides: Partial<StoredRoute> & Pick<StoredRoute, "kind">): StoredRoute {
  return {
    organization_id: ORG,
    channel: "slack",
    config: {},
    enabled: true,
    chat_channel_id: null,
    dm_on_call: false,
    updated_by: null,
    ...overrides,
  };
}

/**
 * The repository, in memory — with the rules of the database the services lean on: one active
 * Slack connection per workspace, a handshake that completes once, a transaction that keeps
 * nothing when it throws, and V130's two CHECKs on a route's chat target.
 */
export class FakeSlackStore {
  readonly connections: StoredConnection[] = [];
  readonly channelRows: ChatChannel[] = [];
  readonly routeRows: StoredRoute[] = [];
  readonly links: ChatIdentityLink[] = [];
  readonly members = new Map<string, WorkspaceMember>([
    [`${ORG}:${KEN.userId}`, { id: "mem-ken", role: "owner" }],
    [`${ORG}:${MAYA.userId}`, { id: "mem-maya", role: "admin" }],
  ]);

  async connectionOf(organizationId: string): Promise<ChatConnectionPublic | undefined> {
    const own = this.connections.filter((row) => row.organization_id === organizationId);

    return own.find((row) => row.status === "active") ?? own.at(-1);
  }

  async activeByWorkspace(workspaceId: string): Promise<ChatConnectionPublic | undefined> {
    return this.connections.find(
      (row) => row.workspace_id === workspaceId && row.status === "active",
    );
  }

  async connection(id: string): Promise<ChatConnectionPublic | undefined> {
    return this.connections.find((row) => row.id === id);
  }

  async sealedToken(id: string): Promise<{ organizationId: string; envelope: string } | undefined> {
    const row = this.connections.find((found) => found.id === id && found.status === "active");

    return row?.bot_token_sealed == null
      ? undefined
      : { organizationId: row.organization_id, envelope: row.bot_token_sealed };
  }

  async installedId(organizationId: string, workspaceId: string): Promise<string | undefined> {
    return this.connections.find(
      (row) => row.organization_id === organizationId && row.workspace_id === workspaceId,
    )?.id;
  }

  async saveInstall(install: InstallWrite): Promise<void> {
    const other = this.connections.find(
      (row) =>
        row.organization_id === install.organizationId &&
        row.status === "active" &&
        row.workspace_id !== install.workspaceId,
    );

    if (other !== undefined) {
      throw Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "chat_connections_one_active_slack",
      });
    }

    const values = {
      workspace_name: install.workspaceName,
      bot_token_sealed: install.botTokenSealed,
      bot_user_id: install.botUserId,
      install_meta: install.installMeta,
      status: "active" as const,
      status_detail: null,
      installed_by: install.installedBy,
      installed_at: install.at,
      last_verified_at: install.at,
      updated_at: install.at,
    };
    const existing = this.connections.find((row) => row.id === install.id);

    if (existing !== undefined) {
      Object.assign(existing, values);

      return;
    }

    this.connections.push({
      id: install.id,
      organization_id: install.organizationId,
      platform: "slack",
      workspace_id: install.workspaceId,
      created_at: install.at,
      ...values,
    });
  }

  async markVerified(id: string, at: Date): Promise<void> {
    const row = this.connections.find((found) => found.id === id && found.status === "active");

    if (row !== undefined) {
      row.last_verified_at = at;
    }
  }

  async markRevoked(id: string, detail: string): Promise<boolean> {
    const row = this.connections.find((found) => found.id === id && found.status === "active");

    if (row === undefined) {
      return false;
    }

    Object.assign(row, { status: "revoked", status_detail: detail, bot_token_sealed: null });

    return true;
  }

  async saveChannels(
    connection: Pick<ChatConnectionPublic, "id" | "organization_id">,
    channels: readonly SlackChannelSummary[],
    at: Date,
  ): Promise<void> {
    for (const listed of channels) {
      const known = this.channelRows.find(
        (row) => row.connection_id === connection.id && row.channel_id === listed.id,
      );
      const values = {
        channel_name: listed.name,
        is_private: listed.isPrivate,
        joined: listed.isMember,
        member_count: listed.memberCount,
        archived: listed.isArchived,
      };

      if (known !== undefined) {
        Object.assign(known, values, {
          joined_at: known.joined_at ?? (listed.isMember ? at : null),
        });
        continue;
      }

      this.channelRows.push({
        id: randomUUID(),
        organization_id: connection.organization_id,
        connection_id: connection.id,
        platform: "slack",
        channel_id: listed.id,
        joined_at: listed.isMember ? at : null,
        purpose_tag: null,
        created_at: at,
        updated_at: at,
        ...values,
      });
    }
  }

  async channels(connectionId: string): Promise<ChatChannel[]> {
    return this.channelRows.filter(
      (row) => row.connection_id === connectionId && row.purpose_tag !== "dm",
    );
  }

  async channel(organizationId: string, id: string): Promise<ChatChannel | undefined> {
    return this.channelRows.find((row) => row.organization_id === organizationId && row.id === id);
  }

  async channelRoutes(organizationId: string): Promise<ChannelRouteRow[]> {
    return this.routeRows
      .filter((row) => row.organization_id === organizationId && row.channel === "slack")
      .flatMap((row) =>
        row.chat_channel_id === null
          ? []
          : [{ kind: row.kind, chatChannelId: row.chat_channel_id }],
      )
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }

  /** How many transactions were opened — a refused call opens none. */
  transactions = 0;

  /** Runs the work at once; when it throws, channels and routes are put back as they were. */
  async transaction<T>(work: (trx: never) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const channels = this.channelRows.map((row) => ({ ...row }));
    const routes = this.routeRows.map((row) => ({ ...row }));

    try {
      return await work(undefined as never);
    } catch (error) {
      this.channelRows.splice(0, this.channelRows.length, ...channels);
      this.routeRows.splice(0, this.routeRows.length, ...routes);
      throw error;
    }
  }

  async lockChannels(
    _trx: unknown,
    connectionId: string,
  ): Promise<Pick<ChatChannel, "id" | "purpose_tag">[]> {
    return this.channelRows
      .filter((row) => row.connection_id === connectionId)
      .map((row) => ({ id: row.id, purpose_tag: row.purpose_tag }));
  }

  async setChannelPurpose(_trx: unknown, id: string, purpose: string | null): Promise<void> {
    const row = this.channelRows.find((found) => found.id === id);

    if (row !== undefined) {
      Object.assign(row, { purpose_tag: purpose, updated_at: new Date() });
    }
  }

  async pointRoute(
    _trx: unknown,
    organizationId: string,
    chatChannelId: string,
    write: ChannelRouteWrite,
    updatedBy: string,
  ): Promise<boolean> {
    const stored = this.routeRows.find(
      (row) => row.organization_id === organizationId && row.kind === write.kind,
    );

    if (stored === undefined) {
      this.routeRows.push(
        this.checked({
          organization_id: organizationId,
          kind: write.kind,
          channel: "slack",
          config: { ...write.config },
          enabled: write.enabled,
          chat_channel_id: chatChannelId,
          dm_on_call: write.dmOnCall,
          updated_by: updatedBy,
        }),
      );

      return true;
    }

    if (stored.channel !== "slack") {
      return false;
    }

    // A route left off with no channel — what an unbind leaves — takes the default again.
    const enabled =
      stored.chat_channel_id === null && !stored.enabled ? write.enabled : stored.enabled;

    Object.assign(stored, this.checked({ ...stored, chat_channel_id: chatChannelId, enabled }), {
      updated_by: updatedBy,
    });

    return true;
  }

  async detachRoutes(
    _trx: unknown,
    organizationId: string,
    chatChannelId: string,
    keep: readonly string[],
    updatedBy: string,
  ): Promise<string[]> {
    const detached = this.routeRows.filter(
      (row) =>
        row.organization_id === organizationId &&
        row.channel === "slack" &&
        row.chat_channel_id === chatChannelId &&
        !keep.includes(row.kind),
    );

    for (const row of detached) {
      Object.assign(
        row,
        this.checked({
          ...row,
          chat_channel_id: null,
          enabled: row.enabled && (row.dm_on_call || row.kind === "needs_you_dm"),
          updated_by: updatedBy,
        }),
      );
    }

    return detached.map((row) => row.kind).sort();
  }

  /**
   * V130's rules for a route's chat target, as the database would refuse a row that broke them.
   *
   * @param row - The row about to be stored.
   * @returns The row.
   */
  private checked(row: StoredRoute): StoredRoute {
    const violated =
      row.channel !== "slack" && (row.chat_channel_id !== null || row.dm_on_call)
        ? "notification_routes_chat_target_slack_only"
        : row.channel === "slack" &&
            row.enabled &&
            row.kind !== "needs_you_dm" &&
            row.chat_channel_id === null &&
            !row.dm_on_call
          ? "notification_routes_slack_target"
          : undefined;

    if (violated !== undefined) {
      throw Object.assign(new Error(`violates check constraint "${violated}"`), {
        code: "23514",
        constraint: violated,
      });
    }

    return row;
  }

  /** What the publisher's outbox reports for each connection; absent means nothing published. */
  readonly deliveries = new Map<string, ChatDeliveryHealthRow>();

  async deliveryHealth(connectionId: string): Promise<ChatDeliveryHealthRow> {
    return (
      this.deliveries.get(connectionId) ?? {
        pending: 0,
        retrying: 0,
        deadLettered: 0,
        lastError: null,
        lastDeadLetteredAt: null,
        lastSentAt: null,
      }
    );
  }

  async member(organizationId: string, userId: string): Promise<WorkspaceMember | undefined> {
    return this.members.get(`${organizationId}:${userId}`);
  }

  async liveLink(
    connectionId: string,
    platformUserId: string,
  ): Promise<ChatIdentityLink | undefined> {
    return this.links.find(
      (row) =>
        row.connection_id === connectionId &&
        row.platform_user_id === platformUserId &&
        row.state !== "revoked",
    );
  }

  async openHandshake(handshake: {
    organizationId: string;
    connectionId: string;
    platformUserId: string;
    displayName: string | null;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const existing = await this.liveLink(handshake.connectionId, handshake.platformUserId);

    if (existing?.state === "linked") {
      return false;
    }

    if (existing !== undefined) {
      Object.assign(existing, {
        link_token_hash: handshake.tokenHash,
        expires_at: handshake.expiresAt,
        display_name_cache: handshake.displayName,
      });

      return true;
    }

    this.links.push({
      id: randomUUID(),
      organization_id: handshake.organizationId,
      connection_id: handshake.connectionId,
      platform_user_id: handshake.platformUserId,
      member_id: null,
      user_id: null,
      state: "pending",
      verified_via: null,
      display_name_cache: handshake.displayName,
      link_token_hash: handshake.tokenHash,
      expires_at: handshake.expiresAt,
      linked_at: null,
      revoked_at: null,
      revoked_by: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return true;
  }

  async handshake(tokenHash: string): Promise<ChatIdentityLink | undefined> {
    return this.links.find((row) => row.link_token_hash === tokenHash && row.state === "pending");
  }

  async completeHandshake(
    tokenHash: string,
    memberId: string,
    verifiedVia: ChatIdentityVerification,
    at: Date,
  ): Promise<ChatIdentityLink | undefined> {
    const row = this.links.find(
      (found) =>
        found.link_token_hash === tokenHash &&
        found.state === "pending" &&
        found.expires_at !== null &&
        found.expires_at > at,
    );

    if (row === undefined) {
      return undefined;
    }

    if (
      this.links.some(
        (other) =>
          other.connection_id === row.connection_id &&
          other.member_id === memberId &&
          other.state !== "revoked",
      )
    ) {
      throw Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "chat_identity_links_member_key",
      });
    }

    const userId =
      [...this.members.entries()].find(([, member]) => member.id === memberId)?.[0].split(":")[1] ??
      null;

    Object.assign(row, {
      state: "linked",
      member_id: memberId,
      user_id: userId,
      verified_via: verifiedVia,
      linked_at: at,
      link_token_hash: null,
      expires_at: null,
    });

    return row;
  }

  async revokeLink(
    connectionId: string,
    platformUserId: string,
    revokedBy: string | null,
    at: Date,
  ): Promise<ChatIdentityLink | undefined> {
    const row = this.links.find(
      (found) =>
        found.connection_id === connectionId &&
        found.platform_user_id === platformUserId &&
        found.state === "linked",
    );

    if (row === undefined) {
      return undefined;
    }

    Object.assign(row, { state: "revoked", revoked_at: at, revoked_by: revokedBy });

    return row;
  }
}

/** The configuration the specs run under: a registered Slack app, HTTPS endpoints. */
export function slackConfig(overrides: Record<string, unknown> = {}): {
  slackClientId: string | undefined;
  slackClientSecret: string | undefined;
  slackSigningSecret: string | undefined;
  slackSocketMode: boolean;
  slackAppToken: string | undefined;
  uiUrl: string;
} {
  return {
    slackClientId: "1234567890.1234567890123",
    slackClientSecret: "client-secret-that-must-not-leak",
    slackSigningSecret: "8f742231b10e8888abcd99yyyzzz85a5",
    slackSocketMode: false,
    slackAppToken: undefined,
    uiUrl: "https://app.example.test",
    ...overrides,
  };
}
