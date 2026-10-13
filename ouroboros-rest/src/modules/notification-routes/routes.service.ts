/**
 * The Settings notifications card's operations (BR.4,
 * [#488](https://github.com/NobuData/ouroboros/issues/488)).
 *
 * ```
 * list     the four core kinds (stored, or their default binding — off) · the five chat routes
 *          (stored, or their default) · other custom kinds · channels
 * update   kind check ─▶ config check ─▶ lock (row) ─▶ chat channel check ─▶ locked-row rule
 *          ─▶ target rule ─▶ upsert ─▶ audit
 * ```
 *
 * **One store, two cards.** The Chat Ops page's *What gets published where* card (CA.3,
 * [#543](https://github.com/NobuData/ouroboros/issues/543)) edits these same rows: a chat route
 * carries a `chat` block — its label, its channel, whether it also DMs on-call — and the save
 * takes `chatChannelId`. The publisher reads the row's channel each time it enqueues
 * (`chat/chat.outbox.ts`), so a saved channel is where the next message goes.
 *
 * **Org routes are not preferences.** BN.3's `notification_preferences` say how *one person* is
 * told; a route says where the *workspace's* digest, report or pages go, which is why it is an
 * administrator's write and why nothing here reads or writes a person's preferences.
 *
 * **The locked-row rule is enforced here, not only drawn by the UI.** A route whose channel cannot
 * deliver in this build (Slack before mockup 19, PagerDuty before BT.3) may be stored *disabled* —
 * re-bound, configured, registered — but a save that would leave it **enabled** is refused with the
 * reason the card prints, so a direct API call cannot switch on a page that never fires.
 *
 * **Every change is audited**, after it commits, with its before and after values; a save that
 * changes nothing writes no event.
 */

import { Injectable } from "@nestjs/common";

import { NOTIFICATION_ROUTE_UPDATED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { DM_ROUTE_KIND } from "../chat/chat.outbox";
import { chatChannelNotFound } from "../chatops/chatops.errors";
import type { NotificationRouteChannel, NotificationRouteConfig } from "../db/schema";
import {
  CHAT_ROUTES,
  CORE_ROUTE_KINDS,
  SLACK_TARGET_REQUIRED,
  channelLock,
  chatRoute,
  type RouteReach,
  configProblems,
  defaultChannel,
  isRouteKind,
  normalisedConfig,
} from "./routes.catalog";
import type { PatchNotificationRouteDto } from "./routes.dto";
import { routeConfigInvalid, routeKindUnknown, routeLocked, routeNotChat } from "./routes.errors";
import {
  NotificationRoutesRepository,
  type ChatTargetRow,
  type EffectiveRouteRow,
  type StoredRouteRow,
} from "./routes.repository";
import {
  channelsResource,
  type NotificationRouteResource,
  type NotificationRoutesResource,
  type RouteChatResource,
} from "./routes.resources";

/** A channel row's id, as the database stores one — anything else names no channel. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The kinds the card always lists: the core four, then the chat routes, each in its order. */
const LISTED_KINDS: readonly string[] = [
  ...CORE_ROUTE_KINDS,
  ...CHAT_ROUTES.map((route) => route.kind),
];

/** A route as it was and as it is, for the audit. */
interface RouteChange {
  readonly before: StoredRouteRow;
  readonly after: StoredRouteRow;
  /** Whether a stored route existed before the save. */
  readonly existed: boolean;
}

@Injectable()
export class NotificationRoutesService {
  /**
   * @param routes - The statements.
   * @param audit - The trail every change is written to.
   */
  constructor(
    private readonly routes: NotificationRoutesRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * The card: every core kind in the card's order — stored, or its default binding switched off —
   * then the five chat routes in theirs — stored, or their default — then any other stored custom
   * kind, and every channel's availability.
   *
   * @param organizationId - The workspace.
   * @returns The card.
   */
  async list(organizationId: string): Promise<NotificationRoutesResource> {
    const [rows, reach, targets] = await Promise.all([
      this.routes.list(organizationId),
      this.routes.reach(organizationId),
      this.routes.chatTargets(organizationId),
    ]);
    const stored = new Map(rows.map((row) => [row.kind, row]));
    const target = (kind: string): ChatTargetRow | undefined =>
      targets.find((row) => row.kind === kind);
    const listed = LISTED_KINDS.map((kind) => {
      const row = stored.get(kind);

      return row === undefined ? defaultRoute(kind, reach) : routeResource(row, target(row.kind));
    });
    const custom = [...stored.values()]
      .filter((row) => !LISTED_KINDS.includes(row.kind))
      .map((row) => routeResource(row, target(row.kind)));

    return { items: [...listed, ...custom], channels: channelsResource(reach) };
  }

  /**
   * One route.
   *
   * @param organizationId - The workspace.
   * @param kind - The route.
   * @returns The route, stored or default.
   * @throws {NotFoundError} `404 notification_route_kind_unknown` for a kind V094 refuses.
   */
  async read(organizationId: string, kind: string): Promise<NotificationRouteResource> {
    if (!isRouteKind(kind)) {
      throw routeKindUnknown(kind);
    }

    const row = (await this.routes.list(organizationId)).find((route) => route.kind === kind);

    if (row === undefined) {
      return defaultRoute(kind, await this.routes.reach(organizationId));
    }

    const targets = await this.routes.chatTargets(organizationId);

    return routeResource(
      row,
      targets.find((target) => target.kind === kind),
    );
  }

  /**
   * Save a route — re-bind its channel, replace its config, switch it, point a chat route at a
   * bound chat channel — and audit the change.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who saved it.
   * @param kind - The route.
   * @param patch - The fields to change; none reads back the route.
   * @returns The route as stored, its lock derived.
   * @throws {NotFoundError} `404 notification_route_kind_unknown`; `404 chat_channel_not_found`
   *   when `chatChannelId` is not a bound channel of this workspace (unknown, another
   *   workspace's, unbound, or a DM conversation — one answer).
   * @throws {InvalidRequestError} `422 notification_route_config_invalid`, with `details.fields`;
   *   `422 notification_route_not_chat` when `chatChannelId` is sent for a route that posts to no
   *   chat channel.
   * @throws {ConflictError} `409 notification_route_locked` — the save would leave the route
   *   enabled on a channel that cannot deliver, or enabled on Slack with nowhere to post (no
   *   channel and no on-call DM); `details.reason` is what the card prints.
   */
  async update(
    organizationId: string,
    actorId: string,
    kind: string,
    patch: PatchNotificationRouteDto,
  ): Promise<NotificationRouteResource> {
    if (!isRouteKind(kind)) {
      throw routeKindUnknown(kind);
    }

    let config: NotificationRouteConfig | undefined;

    if (patch.config !== undefined) {
      const problems = configProblems(patch.config);

      if (Object.keys(problems).length > 0) {
        throw routeConfigInvalid(problems);
      }

      config = normalisedConfig(patch.config);
    }

    const change = await this.routes.transaction(async (trx): Promise<RouteChange | undefined> => {
      const stored = await this.routes.stored(trx, organizationId, kind);
      const before: StoredRouteRow = stored ?? defaultStored(kind);
      const channel = patch.channel ?? before.channel;

      // Only a chat route takes a channel, and the channel is a bound one of this workspace.
      if (patch.chatChannelId !== undefined) {
        if (!isChatRoute(kind, channel)) {
          throw routeNotChat(kind);
        }

        if (
          patch.chatChannelId !== null &&
          !(
            UUID.test(patch.chatChannelId) &&
            (await this.routes.boundChannel(trx, organizationId, patch.chatChannelId))
          )
        ) {
          throw chatChannelNotFound();
        }
      }

      // A chat target belongs to a Slack route (V130): a route re-bound to email or PagerDuty
      // drops its channel and its on-call DM, and one re-bound to Slack starts from the default.
      const onSlack = channel === "slack";
      const kept = before.channel === "slack" ? before : defaultStored(kind);
      const after: StoredRouteRow = {
        channel,
        config: config ?? before.config,
        enabled: patch.enabled ?? before.enabled,
        chatChannelId: !onSlack
          ? null
          : patch.chatChannelId === undefined
            ? kept.chatChannelId
            : patch.chatChannelId,
        dmOnCall: onSlack && kept.dmOnCall,
      };

      if (changedFields(before, after).length === 0) {
        return undefined;
      }

      const lock = channelLock(after.channel, await this.routes.reach(organizationId, trx));

      if (after.enabled && lock !== null) {
        throw routeLocked(kind, after.channel, lock);
      }

      // A Slack route delivers to its bound channel or to the on-call person (V130). One with
      // neither has nowhere to post, and the database would refuse it as a constraint violation;
      // it is refused here instead, in the lock's own words.
      if (after.enabled && !slackTargeted(kind, after)) {
        throw routeLocked(kind, after.channel, SLACK_TARGET_REQUIRED);
      }

      await this.routes.upsert(trx, organizationId, kind, { ...after, updatedBy: actorId });

      return { before, after, existed: stored !== undefined };
    });

    if (change !== undefined) {
      await this.record(organizationId, actorId, kind, change);
    }

    return this.read(organizationId, kind);
  }

  /**
   * Write the change's audit event — before and after, field by field.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who saved it.
   * @param kind - The route.
   * @param change - What it was and is.
   */
  private async record(
    organizationId: string,
    actorId: string,
    kind: string,
    change: RouteChange,
  ): Promise<void> {
    const { before, after } = change;

    await this.audit.record({
      organizationId,
      actorId,
      action: NOTIFICATION_ROUTE_UPDATED_EVENT,
      subjectType: "notification_route",
      subjectId: kind,
      at: new Date(),
      detail: {
        kind,
        fields: changedFields(before, after).join(","),
        previousSource: change.existed ? "stored" : "default",
        previousChannel: before.channel,
        channel: after.channel,
        previousEnabled: before.enabled,
        enabled: after.enabled,
        previousConfig: JSON.stringify(before.config),
        config: JSON.stringify(after.config),
        previousChatChannelId: before.chatChannelId,
        chatChannelId: after.chatChannelId,
      },
    });
  }
}

/**
 * Which fields a save changes.
 *
 * @param before - The route as it was (or its default).
 * @param after - The route as the save leaves it.
 * @returns `channel`, `config`, `enabled`, `chatChannel` — those whose value differs.
 */
export function changedFields(before: StoredRouteRow, after: StoredRouteRow): string[] {
  const changed: string[] = [];

  if (before.channel !== after.channel) changed.push("channel");
  if (
    JSON.stringify(normalisedConfig(before.config)) !==
    JSON.stringify(normalisedConfig(after.config))
  ) {
    changed.push("config");
  }
  if (before.enabled !== after.enabled) changed.push("enabled");
  if (before.chatChannelId !== after.chatChannelId || before.dmOnCall !== after.dmOnCall) {
    changed.push("chatChannel");
  }

  return changed;
}

/**
 * What a kind is before anybody saves it: its default channel; off — unless it is a chat route,
 * which starts as {@link CHAT_ROUTES} says — and with no chat channel.
 *
 * @param kind - A valid kind.
 * @returns The route a first save starts from.
 */
export function defaultStored(kind: string): StoredRouteRow {
  const chat = chatRoute(kind);

  return {
    channel: defaultChannel(kind),
    config: {},
    enabled: chat?.enabled ?? false,
    chatChannelId: null,
    dmOnCall: chat?.dmOnCall ?? false,
  };
}

/**
 * Whether a route is one of the card's chat routes right now: one of the five kinds, on Slack.
 *
 * @param kind - The route.
 * @param channel - The channel it is bound to.
 * @returns True when the route carries a `chat` block and may take a chat channel.
 */
export function isChatRoute(kind: string, channel: NotificationRouteChannel): boolean {
  return channel === "slack" && chatRoute(kind) !== undefined;
}

/**
 * `notification_routes_slack_target` (V130), asked before the database does: a Slack route has
 * somewhere to post when it has a channel, DMs on-call, or is the kind that is a DM by nature.
 *
 * @param kind - The route.
 * @param route - The route as a save would leave it.
 * @returns False only for a Slack route with no target; true for every other channel.
 */
export function slackTargeted(kind: string, route: StoredRouteRow): boolean {
  return (
    route.channel !== "slack" ||
    kind === DM_ROUTE_KIND ||
    route.chatChannelId !== null ||
    route.dmOnCall
  );
}

/**
 * A route's `chat` block.
 *
 * @param kind - The route.
 * @param channel - The channel it is bound to.
 * @param target - Where it posts: its stored chat target, or its default.
 * @returns The block, or null for a route that is not a chat route.
 */
function chatResource(
  kind: string,
  channel: NotificationRouteChannel,
  target: Pick<ChatTargetRow, "channel" | "dmOnCall">,
): RouteChatResource | null {
  const chat = chatRoute(kind);

  return chat === undefined || !isChatRoute(kind, channel)
    ? null
    : { label: chat.label, note: chat.note, channel: target.channel, dmOnCall: target.dmOnCall };
}

/**
 * A stored route as the card shows it.
 *
 * @param row - The view's row.
 * @param target - Where the route posts in chat, when it is a Slack route.
 * @returns The resource.
 */
export function routeResource(
  row: EffectiveRouteRow,
  target?: ChatTargetRow,
): NotificationRouteResource {
  return {
    kind: row.kind,
    channel: row.channel,
    config: row.config,
    enabled: row.enabled,
    locked: row.locked,
    lockedReason: row.lockedReason,
    delivering: row.delivering,
    stored: true,
    chat: chatResource(row.kind, row.channel, target ?? { channel: null, dmOnCall: false }),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/**
 * A kind nobody saved: its default binding ({@link defaultStored}), its lock derived by the same
 * rule. It never reads as delivering — nothing is stored, so nothing fires.
 *
 * @param kind - The route.
 * @param reach - What the workspace has connected.
 * @returns The resource.
 */
export function defaultRoute(kind: string, reach: RouteReach): NotificationRouteResource {
  const route = defaultStored(kind);
  const lockedReason = channelLock(route.channel, reach);

  return {
    kind,
    channel: route.channel,
    config: {},
    enabled: route.enabled,
    locked: lockedReason !== null,
    lockedReason,
    delivering: false,
    stored: false,
    chat: chatResource(kind, route.channel, { channel: null, dmOnCall: route.dmOnCall }),
    updatedAt: null,
    updatedBy: null,
  };
}
