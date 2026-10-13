/**
 * Every statement the org notification routes issue (BR.4,
 * [#488](https://github.com/NobuData/ouroboros/issues/488)) — over V094's `notification_routes`
 * (read through `notification_routes_effective`, which derives the lock) and V103's
 * `notification_route_sends`. Statements only: the lock rule, the config check, the schedule and
 * the audit are the service's and the sender's.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  Database,
  NotificationRouteChannel,
  NotificationRouteConfig,
  NotificationRouteSendStatus,
} from "../db/schema";
import { rolesFrom } from "../tenancy/organization.repository";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { DM_PURPOSE_TAG } from "../chat/chat.outbox";
import { MAILING_KINDS, type MailingKind, type RouteReach } from "./routes.catalog";

/** One route as `notification_routes_effective` derives it. */
export interface EffectiveRouteRow {
  readonly kind: string;
  readonly channel: NotificationRouteChannel;
  readonly config: NotificationRouteConfig;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly lockedReason: string | null;
  readonly delivering: boolean;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

/** One stored route, as a write reads it under its lock. */
export interface StoredRouteRow {
  readonly channel: NotificationRouteChannel;
  readonly config: NotificationRouteConfig;
  readonly enabled: boolean;
  /** The chat channel row a Slack route posts to (V130), or null. */
  readonly chatChannelId: string | null;
  /** Whether a Slack route also DMs the on-call designee (V130). */
  readonly dmOnCall: boolean;
}

/** What a save writes. */
export interface RouteWrite extends StoredRouteRow {
  readonly updatedBy: string;
}

/** Where a stored Slack route posts — what the route's `chat` block is drawn from (#543). */
export interface ChatTargetRow {
  readonly kind: string;
  readonly dmOnCall: boolean;
  /** The channel row the route posts to, or null when it has none. */
  readonly channel: {
    readonly id: string;
    readonly name: string;
    readonly joined: boolean;
    readonly archived: boolean;
  } | null;
}

/** A route that can mail right now, in some workspace. */
export interface MailingRouteRow {
  readonly organizationId: string;
  readonly workspaceName: string;
  readonly kind: MailingKind;
  readonly config: NotificationRouteConfig;
}

/** One attempt at one address for one slot. */
export interface RouteSendAttempt {
  readonly recipient: string;
  readonly attempt: number;
  readonly status: NotificationRouteSendStatus;
}

/** What a sender claims before a mail leaves. */
export interface RouteSendClaim {
  readonly organizationId: string;
  readonly kind: MailingKind;
  readonly slotAt: Date;
  readonly recipient: string;
  readonly attempt: number;
  readonly messageId: string;
}

/** The longest error text a settled send keeps. */
const MAX_ERROR_LENGTH = 500;

@Injectable()
export class NotificationRoutesRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workspace's stored routes with their locks derived.
   *
   * @param organizationId - The workspace.
   * @returns Every stored route, by kind.
   */
  async list(organizationId: string): Promise<EffectiveRouteRow[]> {
    const rows = await this.database.db
      .selectFrom("notification_routes_effective")
      .select([
        "kind",
        "channel",
        "config",
        "enabled",
        "locked",
        "locked_reason",
        "delivering",
        "updated_by",
        "updated_at",
      ])
      .where("organization_id", "=", organizationId)
      .orderBy("kind")
      .execute();

    return rows.map((row) => ({
      kind: row.kind,
      channel: row.channel,
      config: row.config,
      enabled: row.enabled,
      locked: row.locked,
      lockedReason: row.locked_reason,
      delivering: row.delivering,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * One stored route, locked for the save that read it.
   *
   * @param trx - The save's transaction.
   * @param organizationId - The workspace.
   * @param kind - The route.
   * @returns The row, or undefined when the kind has never been saved.
   */
  async stored(
    trx: Transaction<Database>,
    organizationId: string,
    kind: string,
  ): Promise<StoredRouteRow | undefined> {
    const row = await trx
      .selectFrom("notification_routes")
      .select(["channel", "config", "enabled", "chat_channel_id", "dm_on_call"])
      .where("organization_id", "=", organizationId)
      .where("kind", "=", kind)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          channel: row.channel,
          config: row.config,
          enabled: row.enabled,
          chatChannelId: row.chat_channel_id,
          dmOnCall: row.dm_on_call,
        };
  }

  /**
   * Where the workspace's stored Slack routes post: each one's channel row, when it has one, and
   * whether it also DMs on-call (#543).
   *
   * @param organizationId - The workspace.
   * @returns One row per stored Slack route.
   */
  async chatTargets(organizationId: string): Promise<ChatTargetRow[]> {
    const rows = await this.database.db
      .selectFrom("notification_routes as r")
      .leftJoin("chat_channels as c", "c.id", "r.chat_channel_id")
      .select(["r.kind", "r.dm_on_call", "c.id", "c.channel_name", "c.joined", "c.archived"])
      .where("r.organization_id", "=", organizationId)
      .where("r.channel", "=", "slack")
      .execute();

    return rows.map((row) => ({
      kind: row.kind,
      dmOnCall: row.dm_on_call,
      channel:
        row.id === null
          ? null
          : {
              id: row.id,
              name: row.channel_name ?? "",
              joined: row.joined ?? false,
              archived: row.archived ?? false,
            },
    }));
  }

  /**
   * Whether an id names a channel of the workspace a route may post to: **bound** — it has a
   * purpose — and not one of the DM conversations the publisher opened, which share the table
   * (the rule of `SlackRepository.boundChannel`, read here under the save's transaction).
   *
   * @param trx - The save's transaction.
   * @param organizationId - The workspace.
   * @param id - The channel row's id — a UUID; the caller has checked its shape.
   * @returns True for a bound channel of this workspace.
   */
  async boundChannel(
    trx: Transaction<Database>,
    organizationId: string,
    id: string,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom("chat_channels")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("purpose_tag", "is not", null)
      .where("purpose_tag", "<>", DM_PURPOSE_TAG)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * What the workspace has connected — the fact `notification_routes_effective` derives the
   * Slack lock from (V134), asked directly for a route with no stored row.
   *
   * @param organizationId - The workspace.
   * @param trx - A save's transaction, when the read belongs to one.
   * @returns Whether an active Slack connection exists.
   */
  async reach(organizationId: string, trx?: Transaction<Database>): Promise<RouteReach> {
    const connection = await (trx ?? this.database.db)
      .selectFrom("chat_connections_public")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("platform", "=", "slack")
      .where("status", "=", "active")
      .executeTakeFirst();

    return { slackConnected: connection !== undefined };
  }

  /**
   * Store a route, replacing the workspace's previous one for the kind — its chat target
   * included, so the publisher (`chat/chat.outbox.ts`), which reads `chat_channel_id` and
   * `dm_on_call` from this row each time it enqueues, follows the save.
   *
   * @param trx - The save's transaction.
   * @param organizationId - The workspace.
   * @param kind - The route.
   * @param write - What it now is.
   */
  async upsert(
    trx: Transaction<Database>,
    organizationId: string,
    kind: string,
    write: RouteWrite,
  ): Promise<void> {
    const values = {
      channel: write.channel,
      config: JSON.stringify(write.config),
      enabled: write.enabled,
      chat_channel_id: write.chatChannelId,
      dm_on_call: write.dmOnCall,
      updated_by: write.updatedBy,
    };

    await trx
      .insertInto("notification_routes")
      .values({ organization_id: organizationId, kind, ...values })
      .onConflict((conflict) => conflict.columns(["organization_id", "kind"]).doUpdateSet(values))
      .execute();
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
   * Every route, in every workspace, that can mail now: a mailing kind, delivering (enabled and
   * not locked), on email.
   *
   * @returns The routes, with their workspace's name.
   */
  async mailingRoutes(): Promise<MailingRouteRow[]> {
    const rows = await this.database.db
      .selectFrom("notification_routes_effective as r")
      .innerJoin("organization as o", "o.id", "r.organization_id")
      .select(["r.organization_id", "o.name", "r.kind", "r.config"])
      .where("r.delivering", "=", true)
      .where("r.channel", "=", "email")
      .where("r.kind", "in", [...MAILING_KINDS])
      .orderBy("r.organization_id")
      .orderBy("r.kind")
      .execute();

    return rows.map((row) => ({
      organizationId: row.organization_id,
      workspaceName: row.name,
      kind: row.kind as MailingKind,
      config: row.config,
    }));
  }

  /**
   * The workspace's owners' and administrators' addresses — where a route with no recipients of
   * its own goes.
   *
   * @param organizationId - The workspace.
   * @returns The addresses, lower-cased, sorted, without duplicates.
   */
  async administratorAddresses(organizationId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("member as m")
      .innerJoin("user as u", "u.id", "m.userId")
      .select(["m.role", "u.email"])
      .where("m.organizationId", "=", organizationId)
      .execute();
    const administrators = new Set<string>(ADMINISTRATORS);
    const addresses = rows
      .filter((row) => rolesFrom(row.role).some((role) => administrators.has(role)))
      .map((row) => row.email.trim().toLowerCase())
      .filter((email) => email !== "");

    return [...new Set(addresses)].sort();
  }

  /**
   * The slot a route last delivered to anybody — what keeps a moved time from sending twice in a
   * day.
   *
   * @param organizationId - The workspace.
   * @param kind - The route.
   * @returns The latest slot with a sent mail, or undefined when it never sent.
   */
  async lastSentSlot(organizationId: string, kind: MailingKind): Promise<Date | undefined> {
    const row = await this.database.db
      .selectFrom("notification_route_sends")
      .select((eb) => eb.fn.max("slot_at").as("slot_at"))
      .where("organization_id", "=", organizationId)
      .where("kind", "=", kind)
      .where("status", "=", "sent")
      .executeTakeFirst();

    return row?.slot_at ?? undefined;
  }

  /**
   * Every attempt at one slot of one route.
   *
   * @param organizationId - The workspace.
   * @param kind - The route.
   * @param slotAt - The slot.
   * @returns The attempts, per address.
   */
  attempts(organizationId: string, kind: MailingKind, slotAt: Date): Promise<RouteSendAttempt[]> {
    return this.database.db
      .selectFrom("notification_route_sends")
      .select(["recipient", "attempt", "status"])
      .where("organization_id", "=", organizationId)
      .where("kind", "=", kind)
      .where("slot_at", "=", slotAt)
      .execute();
  }

  /**
   * Fail every claim held longer than the lease — a sender that died mid-send — so its address
   * gets another attempt.
   *
   * @param leaseMs - How long a claim may stay unsettled.
   * @returns How many claims were failed.
   */
  async expireClaims(leaseMs: number): Promise<number> {
    const result = await this.database.db
      .updateTable("notification_route_sends")
      .set({ status: "failed", settled_at: sql`now()`, error: "The sender's claim lapsed." })
      .where("status", "=", "claimed")
      .where("claimed_at", "<", sql<Date>`now() - ${`${String(leaseMs)} milliseconds`}::interval`)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  /**
   * Claim one attempt at one address.
   *
   * @param claim - The attempt.
   * @returns The claim's id, or undefined when another sender claimed it first.
   */
  async claim(claim: RouteSendClaim): Promise<string | undefined> {
    const row = await this.database.db
      .insertInto("notification_route_sends")
      .values({
        organization_id: claim.organizationId,
        kind: claim.kind,
        slot_at: claim.slotAt,
        recipient: claim.recipient,
        attempt: claim.attempt,
        message_id: claim.messageId,
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning("id")
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * Settle a claim once: sent, or failed with why.
   *
   * @param id - The claim.
   * @param error - Why it failed; absent when it was sent.
   */
  async settle(id: string, error?: string): Promise<void> {
    await this.database.db
      .updateTable("notification_route_sends")
      .set(
        error === undefined
          ? { status: "sent", settled_at: sql`now()` }
          : {
              status: "failed",
              settled_at: sql`now()`,
              error: error.slice(0, MAX_ERROR_LENGTH) || "The send failed.",
            },
      )
      .where("id", "=", id)
      .where("status", "=", "claimed")
      .execute();
  }
}
