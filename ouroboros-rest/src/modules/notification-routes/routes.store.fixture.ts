/**
 * An in-memory `NotificationRoutesRepository` for the routes' unit suites (#488) — the same
 * derived lock as `notification_routes_effective`, and the same unique claim key as V103's
 * `notification_route_sends`, so a suite exercises the rules rather than a stub that agrees with
 * everything.
 */

import type { Transaction } from "kysely";

import type { Database, NotificationRouteSendStatus } from "../db/schema";
import { MAILING_KINDS, channelLock, type MailingKind } from "./routes.catalog";
import type {
  ChatTargetRow,
  EffectiveRouteRow,
  MailingRouteRow,
  NotificationRoutesRepository,
  RouteSendAttempt,
  RouteSendClaim,
  RouteWrite,
  StoredRouteRow,
} from "./routes.repository";

/** One stored route. */
interface StoredRoute extends StoredRouteRow {
  readonly organizationId: string;
  readonly kind: string;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

/** A route as a suite seeds it — its chat target is none unless given. */
export type SeededRoute = Pick<StoredRouteRow, "channel" | "config" | "enabled"> &
  Partial<Pick<StoredRouteRow, "chatChannelId" | "dmOnCall">>;

/** One `chat_channels` row, as far as a route's chat target reads it. */
export interface FakeChatChannel {
  readonly organizationId: string;
  readonly name: string;
  readonly joined: boolean;
  readonly archived: boolean;
  /** `loops`, `alerts`, `leads`; `dm` for a DM conversation; null for an unbound channel. */
  readonly purpose: string | null;
}

/** One logged send. */
export interface FakeRouteSend extends RouteSendClaim {
  readonly id: string;
  status: NotificationRouteSendStatus;
  error: string | null;
  claimedAt: Date;
}

/** A transaction handle nothing reads. */
const TRX = {} as Transaction<Database>;

export class FakeRouteStore {
  /** Stored routes, keyed `org|kind`. */
  readonly routes = new Map<string, StoredRoute>();
  /** The send log, in claim order. */
  readonly sends: FakeRouteSend[] = [];
  /** Workspace names. */
  readonly names = new Map<string, string>();
  /** Owners' and admins' addresses per workspace. */
  readonly administrators = new Map<string, string[]>();
  /** The clock claims are stamped with. */
  now = new Date("2026-10-05T09:00:30.000Z");
  /** Workspaces with an active Slack connection. */
  readonly slackConnected = new Set<string>();
  /** `chat_channels`, by row id. */
  readonly channels = new Map<string, FakeChatChannel>();

  /**
   * Store a route directly, as a seed or another surface would.
   *
   * @param organizationId - The workspace.
   * @param kind - The route.
   * @param route - Its binding.
   * @returns This store.
   */
  route(organizationId: string, kind: string, route: SeededRoute): this {
    this.routes.set(`${organizationId}|${kind}`, {
      chatChannelId: null,
      dmOnCall: false,
      ...route,
      organizationId,
      kind,
      updatedBy: null,
      updatedAt: new Date("2026-09-15T00:00:00.000Z"),
    });
    return this;
  }

  /**
   * Store a chat channel row — bound for `loops` and joined unless said otherwise.
   *
   * @param id - The row's id.
   * @param organizationId - The workspace it belongs to.
   * @param name - Its name, without the `#`.
   * @param overrides - What differs from a bound, joined, live channel.
   * @returns This store.
   */
  chatChannel(
    id: string,
    organizationId: string,
    name: string,
    overrides: Partial<Pick<FakeChatChannel, "joined" | "archived" | "purpose">> = {},
  ): this {
    this.channels.set(id, {
      organizationId,
      name,
      joined: true,
      archived: false,
      purpose: "loops",
      ...overrides,
    });
    return this;
  }

  /**
   * Name a workspace and its administrators.
   *
   * @param organizationId - The workspace.
   * @param name - Its name.
   * @param administrators - Its owners' and admins' addresses.
   * @returns This store.
   */
  workspace(organizationId: string, name: string, administrators: string[] = []): this {
    this.names.set(organizationId, name);
    this.administrators.set(organizationId, administrators);
    return this;
  }

  /**
   * The repository over this store.
   *
   * @returns A stand-in with the real repository's methods.
   */
  repository(): NotificationRoutesRepository {
    const effective = (route: StoredRoute): EffectiveRouteRow => {
      const lockedReason = channelLock(route.channel, {
        slackConnected: this.slackConnected.has(route.organizationId),
      });

      return {
        kind: route.kind,
        channel: route.channel,
        config: route.config,
        enabled: route.enabled,
        locked: lockedReason !== null,
        lockedReason,
        delivering: route.enabled && lockedReason === null,
        updatedBy: route.updatedBy,
        updatedAt: route.updatedAt,
      };
    };

    return {
      list: (organizationId: string) =>
        Promise.resolve(
          [...this.routes.values()]
            .filter((route) => route.organizationId === organizationId)
            .sort((a, b) => a.kind.localeCompare(b.kind))
            .map(effective),
        ),
      stored: (_trx: Transaction<Database>, organizationId: string, kind: string) => {
        const route = this.routes.get(`${organizationId}|${kind}`);

        return Promise.resolve(
          route === undefined
            ? undefined
            : {
                channel: route.channel,
                config: route.config,
                enabled: route.enabled,
                chatChannelId: route.chatChannelId,
                dmOnCall: route.dmOnCall,
              },
        );
      },
      upsert: (
        _trx: Transaction<Database>,
        organizationId: string,
        kind: string,
        write: RouteWrite,
      ) => {
        // V130's two CHECKs on a route's chat target, as the database would refuse the row.
        if (write.channel !== "slack" && (write.chatChannelId !== null || write.dmOnCall)) {
          return Promise.reject(new Error("notification_routes_chat_target_slack_only"));
        }
        if (
          write.channel === "slack" &&
          write.enabled &&
          kind !== "needs_you_dm" &&
          write.chatChannelId === null &&
          !write.dmOnCall
        ) {
          return Promise.reject(new Error("notification_routes_slack_target"));
        }

        this.routes.set(`${organizationId}|${kind}`, {
          organizationId,
          kind,
          channel: write.channel,
          config: write.config,
          enabled: write.enabled,
          chatChannelId: write.chatChannelId,
          dmOnCall: write.dmOnCall,
          updatedBy: write.updatedBy,
          updatedAt: this.now,
        });
        return Promise.resolve();
      },
      transaction: <T>(work: (trx: Transaction<Database>) => Promise<T>) => work(TRX),
      reach: (organizationId: string) =>
        Promise.resolve({ slackConnected: this.slackConnected.has(organizationId) }),
      chatTargets: (organizationId: string) =>
        Promise.resolve(
          [...this.routes.values()]
            .filter((route) => route.organizationId === organizationId && route.channel === "slack")
            .map((route): ChatTargetRow => {
              const channel =
                route.chatChannelId === null ? undefined : this.channels.get(route.chatChannelId);

              return {
                kind: route.kind,
                dmOnCall: route.dmOnCall,
                channel:
                  route.chatChannelId === null || channel === undefined
                    ? null
                    : {
                        id: route.chatChannelId,
                        name: channel.name,
                        joined: channel.joined,
                        archived: channel.archived,
                      },
              };
            }),
        ),
      boundChannel: (_trx: Transaction<Database>, organizationId: string, id: string) => {
        const channel = this.channels.get(id);

        return Promise.resolve(
          channel?.organizationId === organizationId &&
            channel.purpose !== null &&
            channel.purpose !== "dm",
        );
      },
      mailingRoutes: () =>
        Promise.resolve(
          [...this.routes.values()]
            .filter(
              (route) =>
                (MAILING_KINDS as readonly string[]).includes(route.kind) &&
                route.channel === "email" &&
                effective(route).delivering,
            )
            .map((route): MailingRouteRow => ({
              organizationId: route.organizationId,
              workspaceName: this.names.get(route.organizationId) ?? route.organizationId,
              kind: route.kind as MailingKind,
              config: route.config,
            })),
        ),
      administratorAddresses: (organizationId: string) =>
        Promise.resolve([...(this.administrators.get(organizationId) ?? [])]),
      lastSentSlot: (organizationId: string, kind: MailingKind) => {
        const slots = this.sends
          .filter(
            (s) => s.organizationId === organizationId && s.kind === kind && s.status === "sent",
          )
          .map((s) => s.slotAt.getTime());

        return Promise.resolve(slots.length === 0 ? undefined : new Date(Math.max(...slots)));
      },
      attempts: (organizationId: string, kind: MailingKind, slotAt: Date) =>
        Promise.resolve(
          this.sends
            .filter(
              (s) =>
                s.organizationId === organizationId &&
                s.kind === kind &&
                s.slotAt.getTime() === slotAt.getTime(),
            )
            .map((s): RouteSendAttempt => ({
              recipient: s.recipient,
              attempt: s.attempt,
              status: s.status,
            })),
        ),
      expireClaims: (leaseMs: number) => {
        let expired = 0;

        for (const send of this.sends) {
          if (
            send.status === "claimed" &&
            this.now.getTime() - send.claimedAt.getTime() > leaseMs
          ) {
            send.status = "failed";
            send.error = "The sender's claim lapsed.";
            expired += 1;
          }
        }

        return Promise.resolve(expired);
      },
      claim: (claim: RouteSendClaim) => {
        const clash = this.sends.some(
          (s) =>
            s.organizationId === claim.organizationId &&
            s.kind === claim.kind &&
            s.slotAt.getTime() === claim.slotAt.getTime() &&
            s.recipient === claim.recipient &&
            s.attempt === claim.attempt,
        );

        if (clash) {
          return Promise.resolve(undefined);
        }

        const id = `send-${String(this.sends.length + 1)}`;
        this.sends.push({ ...claim, id, status: "claimed", error: null, claimedAt: this.now });

        return Promise.resolve(id);
      },
      settle: (id: string, error?: string) => {
        const send = this.sends.find((s) => s.id === id && s.status === "claimed");

        if (send !== undefined) {
          send.status = error === undefined ? "sent" : "failed";
          send.error = error ?? null;
        }

        return Promise.resolve();
      },
    } as unknown as NotificationRoutesRepository;
  }
}
