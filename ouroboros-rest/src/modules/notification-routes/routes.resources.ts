/**
 * What `/api/v1/settings/notifications` sends (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488)):
 * the Settings notifications card, one row per route.
 */

import type { NotificationRouteChannel, NotificationRouteConfig } from "../db/schema";
import { ROUTE_CHANNELS, channelLock } from "./routes.catalog";

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
  /** False for a core kind nobody has saved yet — the card's default binding, off. */
  readonly stored: boolean;
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
  /** The four core kinds in the card's order (stored or default), then any custom kinds. */
  readonly items: NotificationRouteResource[];
  /** Every channel a route may bind to, so a picker can grey the ones that cannot deliver. */
  readonly channels: RouteChannelResource[];
}

/**
 * Every channel with its availability.
 *
 * @returns The channel list, in V094's order.
 */
export function channelsResource(): RouteChannelResource[] {
  return ROUTE_CHANNELS.map((channel) => {
    const reason = channelLock(channel);

    return { channel, available: reason === null, reason };
  });
}
