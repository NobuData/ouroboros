/**
 * What `/api/v1/settings/notifications` sends (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488)):
 * the Settings notifications card, one row per route.
 */

import type { NotificationRouteChannel, NotificationRouteConfig } from "../db/schema";
import { ROUTE_CHANNELS, channelLock, type RouteReach } from "./routes.catalog";

/** The channel a chat route posts to — a `chat_channels` row of the workspace. */
export interface RouteChatChannelResource {
  readonly id: string;
  /** The channel's name, without the leading `#`. */
  readonly name: string;
  /** Whether the bot is a member — it cannot post where it is not. */
  readonly joined: boolean;
  readonly archived: boolean;
}

/**
 * A chat route's row on the Chat Ops page's *What gets published where* card (CA.3,
 * [#543](https://github.com/NobuData/ouroboros/issues/543)).
 */
export interface RouteChatResource {
  /** The row's name — *Loop finished (merged)*. */
  readonly label: string;
  /** The warning printed beside it — *noisy, off by default* — or null. */
  readonly note: string | null;
  /** The channel the route posts to, or null while none is chosen. */
  readonly channel: RouteChatChannelResource | null;
  /** Whether the route also DMs the on-call designee. */
  readonly dmOnCall: boolean;
}

/** One org-level route, with its lock derived. */
export interface NotificationRouteResource {
  /** `needs_you_dm | daily_digest | loop_failures | weekly_insights`, or `custom:<slug>`. */
  readonly kind: string;
  readonly channel: NotificationRouteChannel;
  /** `{ time?, weekday?, recipients? }` — empty for a route nobody configured. */
  readonly config: NotificationRouteConfig;
  /** Whether the workspace wants the route. */
  readonly enabled: boolean;
  /** The locked-row rule: the channel has no connection in this build. */
  readonly locked: boolean;
  /** Why it is locked — *connect PagerDuty first* — or null. */
  readonly lockedReason: string | null;
  /** `enabled ∧ ¬locked`: whether the route can actually fire. */
  readonly delivering: boolean;
  /**
   * False for a kind nobody has saved yet — a core kind's default binding, off, or a chat route's
   * default (`CHAT_ROUTES`), which posts nowhere until a channel is chosen.
   */
  readonly stored: boolean;
  /**
   * Where the route posts in chat — for the five chat routes while they are on Slack. Null for
   * every other route: email, PagerDuty, and `needs_you_dm`, whose target is a person.
   */
  readonly chat: RouteChatResource | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** One channel, and whether it can deliver. */
export interface RouteChannelResource {
  readonly channel: NotificationRouteChannel;
  readonly available: boolean;
  /** Why not, when not — the same sentence a route on it is locked with. */
  readonly reason: string | null;
}

/** The card. */
export interface NotificationRoutesResource {
  /**
   * The four core kinds in the card's order, then the five chat routes in theirs (each stored or
   * default), then any other custom kind.
   */
  readonly items: NotificationRouteResource[];
  /** Every channel a route may bind to, so a picker can grey the ones that cannot deliver. */
  readonly channels: RouteChannelResource[];
}

/**
 * Every channel with its availability.
 *
 * @param reach - What the workspace has connected.
 * @returns The channel list, in V094's order.
 */
export function channelsResource(reach: RouteReach): RouteChannelResource[] {
  return ROUTE_CHANNELS.map((channel) => {
    const reason = channelLock(channel, reach);

    return { channel, available: reason === null, reason };
  });
}
