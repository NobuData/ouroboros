/**
 * The Slack app's reads and writes (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)), over V130's connections and
 * channels and V132's identity links.
 *
 * **The sealed bot token is selected in exactly one method** — {@link SlackRepository.sealedToken}
 * — which the caller is about to unseal and hand to Slack. Every other read goes through
 * `chat_connections_public`, which does not carry the column.
 *
 * **Nothing here deletes.** The application role holds no `delete` on these tables: a
 * connection is revoked, a link is revoked, and both rows stay.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import {
  DM_PURPOSE_TAG,
  DM_ROUTE_KIND,
  readChatDeliveryHealth,
  type ChatDeliveryHealthRow,
} from "../chat/chat.outbox";
import { DatabaseService } from "../db/db.service";
import type {
  ChatChannel,
  ChatConnectionPublic,
  ChatIdentityLink,
  ChatIdentityVerification,
  ChatInstallMeta,
  Database,
  NotificationRouteConfig,
} from "../db/schema";
import type { SlackChannelSummary } from "./slack.client";

/** The platform this module installs. `teams` is reserved for CB.2 (#547). */
const SLACK = "slack" as const;

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Whether an error is a unique violation of a named index.
 *
 * @param error - What a statement threw.
 * @param constraint - The index or constraint name.
 * @returns True when the database refused the row for that rule.
 */
export function violates(error: unknown, constraint: string): boolean {
  const failure = error as { code?: unknown; constraint?: unknown } | null;

  return failure?.code === UNIQUE_VIOLATION && failure.constraint === constraint;
}

/** A member of a workspace, as far as this module needs. */
export interface WorkspaceMember {
  readonly id: string;
  /** BetterAuth's role string — may be a comma-separated list. */
  readonly role: string;
}

/** What an install writes. */
export interface InstallWrite {
  /** The connection's id — chosen before sealing, because the envelope is bound to it. */
  readonly id: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly botTokenSealed: string;
  readonly botUserId: string;
  readonly installMeta: ChatInstallMeta;
  readonly installedBy: string;
  readonly at: Date;
}

/** A Slack notification route that posts to a channel: which kind, and which channel row. */
export interface ChannelRouteRow {
  readonly kind: string;
  readonly chatChannelId: string;
}

/** A route a binding points at a channel — and what it is created as when the workspace has none. */
export interface ChannelRouteWrite {
  readonly kind: string;
  /** Used only when the route is created: an existing route keeps its own. */
  readonly enabled: boolean;
  readonly dmOnCall: boolean;
  readonly config: NotificationRouteConfig;
}

@Injectable()
export class SlackRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workspace's Slack connection, without its token.
   *
   * @param organizationId - The workspace.
   * @returns The active connection; failing that the most recently changed one (revoked or in
   *   error), so the page can say what happened; `undefined` when Slack was never installed.
   */
  async connectionOf(organizationId: string): Promise<ChatConnectionPublic | undefined> {
    return (
      this.database.db
        .selectFrom("chat_connections_public")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("platform", "=", SLACK)
        // `active` sorts before `error` and `revoked`, which is the order wanted.
        .orderBy("status")
        .orderBy("updated_at", "desc")
        .limit(1)
        .executeTakeFirst()
    );
  }

  /**
   * The active connection of a Slack workspace — how an inbound request finds its organisation.
   *
   * @param workspaceId - Slack's team id (`T024AB`).
   * @returns The connection, or `undefined` when no organisation has that workspace installed
   *   and active.
   */
  async activeByWorkspace(workspaceId: string): Promise<ChatConnectionPublic | undefined> {
    return this.database.db
      .selectFrom("chat_connections_public")
      .selectAll()
      .where("platform", "=", SLACK)
      .where("workspace_id", "=", workspaceId)
      .where("status", "=", "active")
      .orderBy("installed_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * One connection by id, without its token.
   *
   * @param id - The connection.
   * @returns The connection, or `undefined`.
   */
  async connection(id: string): Promise<ChatConnectionPublic | undefined> {
    return this.database.db
      .selectFrom("chat_connections_public")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * A connection's sealed bot token — the one read of that column.
   *
   * @param connectionId - The connection.
   * @returns The envelope and the workspace it is bound to, or `undefined` when the connection
   *   holds no token (it was revoked).
   */
  async sealedToken(
    connectionId: string,
  ): Promise<{ organizationId: string; envelope: string } | undefined> {
    const row = await this.database.db
      .selectFrom("chat_connections")
      .select(["organization_id", "bot_token_sealed"])
      .where("id", "=", connectionId)
      .where("status", "=", "active")
      .executeTakeFirst();

    return row?.bot_token_sealed == null
      ? undefined
      : { organizationId: row.organization_id, envelope: row.bot_token_sealed };
  }

  /**
   * The id an install of a Slack workspace should be stored under.
   *
   * @param organizationId - The workspace.
   * @param workspaceId - Slack's team id.
   * @returns The existing row's id — a re-install revives it — or `undefined` for a first install.
   */
  async installedId(organizationId: string, workspaceId: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("chat_connections_public")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("platform", "=", SLACK)
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * Store an install: a new connection, or the same Slack workspace's row made active again.
   *
   * @param install - The install.
   * @throws The database's `unique_violation` on `chat_connections_one_active_slack` when the
   *   workspace already has a different Slack workspace active — the caller turns it into a 409.
   */
  async saveInstall(install: InstallWrite): Promise<void> {
    const values = {
      workspace_name: install.workspaceName,
      bot_token_sealed: install.botTokenSealed,
      bot_user_id: install.botUserId,
      install_meta: JSON.stringify(install.installMeta),
      status: "active" as const,
      status_detail: null,
      installed_by: install.installedBy,
      installed_at: install.at,
      last_verified_at: install.at,
    };

    await this.database.db
      .insertInto("chat_connections")
      .values({
        id: install.id,
        organization_id: install.organizationId,
        platform: SLACK,
        workspace_id: install.workspaceId,
        ...values,
      })
      .onConflict((conflict) =>
        conflict.constraint("chat_connections_workspace_key").doUpdateSet(values),
      )
      .execute();
  }

  /**
   * Record that a connection's token was just seen to work.
   *
   * @param connectionId - The connection.
   * @param at - When.
   */
  async markVerified(connectionId: string, at: Date): Promise<void> {
    await this.database.db
      .updateTable("chat_connections")
      .set({ last_verified_at: at })
      .where("id", "=", connectionId)
      .where("status", "=", "active")
      .execute();
  }

  /**
   * Flip an active connection to `revoked`, dropping its dead token.
   *
   * @param connectionId - The connection.
   * @param detail - The platform's reason (`token_revoked`, `app_uninstalled`, …).
   * @returns Whether a connection was flipped — `false` when it was already not active, so a
   *   redelivered event changes nothing.
   */
  async markRevoked(connectionId: string, detail: string): Promise<boolean> {
    const result = await this.database.db
      .updateTable("chat_connections")
      .set({ status: "revoked", status_detail: detail, bot_token_sealed: null })
      .where("id", "=", connectionId)
      .where("status", "=", "active")
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Store what Slack listed for a connection: new channels added, known ones refreshed.
   *
   * @param connection - The connection and its workspace.
   * @param channels - What `conversations.list` reported.
   * @param at - When — a channel newly joined is stamped with it.
   */
  async saveChannels(
    connection: Pick<ChatConnectionPublic, "id" | "organization_id">,
    channels: readonly SlackChannelSummary[],
    at: Date,
  ): Promise<void> {
    if (channels.length === 0) {
      return;
    }

    await this.database.db
      .insertInto("chat_channels")
      .values(
        channels.map((channel) => ({
          organization_id: connection.organization_id,
          connection_id: connection.id,
          platform: SLACK,
          channel_id: channel.id,
          channel_name: channel.name,
          is_private: channel.isPrivate,
          joined: channel.isMember,
          joined_at: channel.isMember ? at : null,
          member_count: channel.memberCount,
          archived: channel.isArchived,
        })),
      )
      .onConflict((conflict) =>
        conflict.constraint("chat_channels_channel_key").doUpdateSet((expression) => ({
          // A rename is an update of the name; nothing is keyed on it.
          channel_name: expression.ref("excluded.channel_name"),
          is_private: expression.ref("excluded.is_private"),
          joined: expression.ref("excluded.joined"),
          // Kept when already joined, so `joined_at` is when the bot joined, not the last listing.
          joined_at: expression.fn.coalesce("chat_channels.joined_at", "excluded.joined_at"),
          member_count: expression.ref("excluded.member_count"),
          archived: expression.ref("excluded.archived"),
        })),
      )
      .execute();
  }

  /**
   * A connection's channels.
   *
   * @param connectionId - The connection.
   * @returns Every known channel, by name. DM conversations the publisher opened (#536) are
   *   stored in the same table and are not channels: they are left out.
   */
  async channels(connectionId: string): Promise<ChatChannel[]> {
    return this.database.db
      .selectFrom("chat_channels")
      .selectAll()
      .where("connection_id", "=", connectionId)
      .where((eb) =>
        eb.or([eb("purpose_tag", "is", null), eb("purpose_tag", "<>", DM_PURPOSE_TAG)]),
      )
      .orderBy("channel_name")
      .execute();
  }

  /**
   * One channel row of a workspace, whatever its connection and purpose.
   *
   * @param organizationId - The workspace.
   * @param id - The row's id — a UUID; the caller has checked its shape.
   * @returns The row, or `undefined` when the workspace has none by that id.
   */
  async channel(organizationId: string, id: string): Promise<ChatChannel | undefined> {
    return this.database.db
      .selectFrom("chat_channels")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * The workspace's Slack routes that post to a channel.
   *
   * @param organizationId - The workspace.
   * @returns One row per route with a channel, by kind.
   */
  async channelRoutes(organizationId: string): Promise<ChannelRouteRow[]> {
    const rows = await this.database.db
      .selectFrom("notification_routes")
      .select(["kind", "chat_channel_id"])
      .where("organization_id", "=", organizationId)
      .where("channel", "=", SLACK)
      .where("chat_channel_id", "is not", null)
      .orderBy("kind")
      .execute();

    return rows.flatMap((row) =>
      row.chat_channel_id === null ? [] : [{ kind: row.kind, chatChannelId: row.chat_channel_id }],
    );
  }

  /**
   * Run work in one transaction.
   *
   * @param work - The statements.
   * @returns What the work returned.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * A connection's channels, locked for the binding that read them — so two bindings of one
   * connection run one after the other, and "one channel per purpose" holds under a race.
   *
   * @param trx - The binding's transaction.
   * @param connectionId - The connection.
   * @returns Every row of the connection, DM conversations included, as they are now.
   */
  async lockChannels(
    trx: Transaction<Database>,
    connectionId: string,
  ): Promise<Pick<ChatChannel, "id" | "purpose_tag">[]> {
    return trx
      .selectFrom("chat_channels")
      .select(["id", "purpose_tag"])
      .where("connection_id", "=", connectionId)
      .orderBy("id")
      .forUpdate()
      .execute();
  }

  /**
   * Set, or clear, what a channel is for.
   *
   * @param trx - The binding's transaction.
   * @param id - The channel row.
   * @param purpose - The purpose tag, or `null` for none.
   */
  async setChannelPurpose(
    trx: Transaction<Database>,
    id: string,
    purpose: string | null,
  ): Promise<void> {
    await trx
      .updateTable("chat_channels")
      .set({ purpose_tag: purpose })
      .where("id", "=", id)
      .execute();
  }

  /**
   * Point a Slack route at a channel: created when the workspace has no route of the kind,
   * re-pointed when it has — leaving `enabled`, `dm_on_call` and `config` as the workspace set
   * them. The one exception: a route that had no channel and was off — which is exactly what an
   * unbind leaves behind — takes the purpose's default `enabled`, so binding again switches back
   * on what unbinding switched off.
   *
   * @param trx - The binding's transaction.
   * @param organizationId - The workspace.
   * @param chatChannelId - The channel row.
   * @param route - The kind, and what a new route starts as.
   * @param updatedBy - Who bound the channel.
   * @returns Whether the route now posts to the channel — `false` when the workspace's route of
   *   that kind is bound to email or PagerDuty, which carries no chat target
   *   (`notification_routes_chat_target_slack_only`) and is left exactly as it was.
   */
  async pointRoute(
    trx: Transaction<Database>,
    organizationId: string,
    chatChannelId: string,
    route: ChannelRouteWrite,
    updatedBy: string,
  ): Promise<boolean> {
    const row = await trx
      .insertInto("notification_routes")
      .values({
        organization_id: organizationId,
        kind: route.kind,
        channel: SLACK,
        config: JSON.stringify(route.config),
        enabled: route.enabled,
        dm_on_call: route.dmOnCall,
        chat_channel_id: chatChannelId,
        updated_by: updatedBy,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["organization_id", "kind"])
          .doUpdateSet({
            chat_channel_id: chatChannelId,
            updated_by: updatedBy,
            enabled: sql<boolean>`case
              when notification_routes.chat_channel_id is null and not notification_routes.enabled
                then excluded.enabled
              else notification_routes.enabled
            end`,
          })
          .where("notification_routes.channel", "=", SLACK),
      )
      .returning("kind")
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Detach the Slack routes posting to a channel. A route left with nowhere to post — no
   * channel, no on-call DM, and not the kind that is a DM by nature — is switched off in the
   * same statement, which is what `notification_routes_slack_target` (V130) requires of it.
   *
   * @param trx - The binding's transaction.
   * @param organizationId - The workspace.
   * @param chatChannelId - The channel row.
   * @param keep - Kinds to leave pointing at the channel.
   * @param updatedBy - Who unbound the channel.
   * @returns The kinds detached, sorted.
   */
  async detachRoutes(
    trx: Transaction<Database>,
    organizationId: string,
    chatChannelId: string,
    keep: readonly string[],
    updatedBy: string,
  ): Promise<string[]> {
    const detach = trx
      .updateTable("notification_routes")
      .set({
        chat_channel_id: null,
        enabled: sql<boolean>`enabled and (dm_on_call or kind = ${DM_ROUTE_KIND})`,
        updated_by: updatedBy,
      })
      .where("organization_id", "=", organizationId)
      .where("channel", "=", SLACK)
      .where("chat_channel_id", "=", chatChannelId);
    const rows = await (keep.length === 0 ? detach : detach.where("kind", "not in", [...keep]))
      .returning("kind")
      .execute();

    return rows.map((row) => row.kind).sort();
  }

  /**
   * How a connection's outgoing messages stand — the publisher's outbox, read for the status.
   *
   * @param connectionId - The connection.
   * @param now - The instant the dead-letter window is measured from.
   * @returns The counts.
   */
  deliveryHealth(connectionId: string, now: Date): Promise<ChatDeliveryHealthRow> {
    return readChatDeliveryHealth(this.database.db, connectionId, now);
  }

  /**
   * A person's membership of a workspace.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @returns Their member row, or `undefined` when they are not a member.
   */
  async member(organizationId: string, userId: string): Promise<WorkspaceMember | undefined> {
    return this.database.db
      .selectFrom("member")
      .select(["id", "role"])
      .where("organizationId", "=", organizationId)
      .where("userId", "=", userId)
      .executeTakeFirst();
  }

  /**
   * The live identity link of a Slack user — one indexed read.
   *
   * @param connectionId - The connection.
   * @param platformUserId - Slack's user id.
   * @returns Their pending or linked row, or `undefined` for someone unlinked (a revoked link
   *   reads as unlinked).
   */
  async liveLink(
    connectionId: string,
    platformUserId: string,
  ): Promise<ChatIdentityLink | undefined> {
    return this.database.db
      .selectFrom("chat_identity_links")
      .selectAll()
      .where("connection_id", "=", connectionId)
      .where("platform_user_id", "=", platformUserId)
      .where("state", "<>", "revoked")
      .executeTakeFirst();
  }

  /**
   * Open, or re-open, a linking handshake for a Slack user.
   *
   * @param handshake - The connection, the Slack user, their display name, and the new token's
   *   hash and expiry.
   * @returns `true` when a pending row now holds the hash; `false` when the user is already
   *   linked and nothing was changed.
   */
  async openHandshake(handshake: {
    organizationId: string;
    connectionId: string;
    platformUserId: string;
    displayName: string | null;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<boolean> {
    return this.database.db.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom("chat_identity_links")
        .select(["id", "state"])
        .where("connection_id", "=", handshake.connectionId)
        .where("platform_user_id", "=", handshake.platformUserId)
        .where("state", "<>", "revoked")
        .forUpdate()
        .executeTakeFirst();

      if (existing?.state === "linked") {
        return false;
      }

      if (existing !== undefined) {
        // A second request replaces the first one's token: only the newest link works.
        await transaction
          .updateTable("chat_identity_links")
          .set({
            link_token_hash: handshake.tokenHash,
            expires_at: handshake.expiresAt,
            display_name_cache: handshake.displayName,
          })
          .where("id", "=", existing.id)
          .execute();

        return true;
      }

      await transaction
        .insertInto("chat_identity_links")
        .values({
          organization_id: handshake.organizationId,
          connection_id: handshake.connectionId,
          platform_user_id: handshake.platformUserId,
          state: "pending",
          display_name_cache: handshake.displayName,
          link_token_hash: handshake.tokenHash,
          expires_at: handshake.expiresAt,
        })
        .execute();

      return true;
    });
  }

  /**
   * The pending handshake a token's hash names.
   *
   * @param tokenHash - SHA-256 of the presented token.
   * @returns The pending row, expired or not, or `undefined` when no handshake holds that hash
   *   (it was never issued, was replaced, or was already used).
   */
  async handshake(tokenHash: string): Promise<ChatIdentityLink | undefined> {
    return this.database.db
      .selectFrom("chat_identity_links")
      .selectAll()
      .where("link_token_hash", "=", tokenHash)
      .where("state", "=", "pending")
      .executeTakeFirst();
  }

  /**
   * Complete a handshake: bind the Slack user to a member, once.
   *
   * The update is conditional on the row still being pending under this hash and unexpired, and
   * clears the hash — so of two confirmations of one link, exactly one finds a row.
   *
   * @param tokenHash - SHA-256 of the presented token.
   * @param memberId - The member confirming.
   * @param verifiedVia - How the link was verified.
   * @param at - When.
   * @returns The linked row, or `undefined` when the token no longer names a live handshake.
   * @throws The database's `unique_violation` on `chat_identity_links_member_key` when the
   *   member already has a Slack identity on this connection.
   */
  async completeHandshake(
    tokenHash: string,
    memberId: string,
    verifiedVia: ChatIdentityVerification,
    at: Date,
  ): Promise<ChatIdentityLink | undefined> {
    return this.database.db
      .updateTable("chat_identity_links")
      .set({
        state: "linked",
        member_id: memberId,
        verified_via: verifiedVia,
        linked_at: at,
        link_token_hash: null,
        expires_at: null,
      })
      .where("link_token_hash", "=", tokenHash)
      .where("state", "=", "pending")
      .where("expires_at", ">", at)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Revoke a Slack user's link. The row is kept.
   *
   * @param connectionId - The connection.
   * @param platformUserId - Slack's user id.
   * @param revokedBy - The person behind the link, who asked — or `null`.
   * @param at - When.
   * @returns The revoked row, or `undefined` when they had no linked identity.
   */
  async revokeLink(
    connectionId: string,
    platformUserId: string,
    revokedBy: string | null,
    at: Date,
  ): Promise<ChatIdentityLink | undefined> {
    return this.database.db
      .updateTable("chat_identity_links")
      .set({ state: "revoked", revoked_at: at, revoked_by: revokedBy })
      .where("connection_id", "=", connectionId)
      .where("platform_user_id", "=", platformUserId)
      .where("state", "=", "linked")
      .returningAll()
      .executeTakeFirst();
  }
}
