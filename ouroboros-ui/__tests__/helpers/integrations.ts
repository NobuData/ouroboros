import type {
  IntegrationTile,
  Integrations,
  NotificationRoute,
  NotificationRoutes,
} from "@/app/api/settings-integrations";

/**
 * The Integrations and Notifications cards' fixtures (BS.5, #495) — the seeded `acme-robotics`
 * grid and its org routes, as BR.4's status hub (#488) answers them: Slack honestly not built,
 * the v2 connectors honestly v2, and both routes on an unconnected channel locked.
 */

/**
 * One tile.
 *
 * @param kind The integration.
 * @param label Its name.
 * @param overrides The rest; defaults to a connected, healthy tile with no context.
 * @returns The tile.
 */
export function tile(
  kind: IntegrationTile["kind"],
  label: string,
  overrides: Partial<IntegrationTile> = {},
): IntegrationTile {
  return {
    kind,
    label,
    availability: "connected",
    state: "ok",
    contextLine: null,
    deepLink: null,
    reason: null,
    ...overrides,
  };
}

/** Why Slack is not a tile anybody can connect yet. */
export const SLACK_REASON = "Arrives with Chat Ops (mockup 19).";

/** Why a v2 connector is not available. */
export const V2_REASON = "A v2 connector.";

/** Why the build farm needs attention. */
export const FARM_REASON = "1 runner is offline.";

/**
 * The seeded grid.
 *
 * @param overrides Fields to replace.
 * @returns The payload.
 */
export function integrations(overrides: Partial<Integrations> = {}): Integrations {
  const unavailable = { state: "off", availability: "unavailable_v2", reason: V2_REASON } as const;

  return {
    tiles: [
      tile("github", "GitHub", {
        contextLine: "acme-robotics · GitHub App installed",
        deepLink: { label: "Manage", path: "/settings/sources" },
      }),
      tile("slack", "Slack", {
        availability: "unavailable_unbuilt",
        state: "off",
        reason: SLACK_REASON,
      }),
      tile("jira", "Jira", {
        contextLine: "acme.atlassian.net",
        deepLink: { label: "Manage", path: "/settings/sources" },
      }),
      tile("linear", "Linear", {
        availability: "disconnected",
        state: "off",
        deepLink: { label: "Connect", path: "/settings/sources" },
      }),
      tile("teams", "MS Teams", unavailable),
      tile("webhooks", "Webhooks", {
        contextLine: "2 active",
        deepLink: { label: "Manage", path: "/settings#integrations" },
      }),
      tile("datadog", "Datadog", unavailable),
      tile("pagerduty", "PagerDuty", unavailable),
      tile("build_farm", "Build farm", {
        state: "attention",
        contextLine: "3 of 4 runners online",
        deepLink: { label: "Manage", path: "/build-farm" },
        reason: FARM_REASON,
      }),
    ],
    connectedCount: 4,
    ...overrides,
  };
}

/**
 * One org route.
 *
 * @param kind The route.
 * @param overrides The rest; defaults to a stored, enabled, delivering email route.
 * @returns The route.
 */
export function route(kind: string, overrides: Partial<NotificationRoute> = {}): NotificationRoute {
  return {
    kind,
    channel: "email",
    config: {},
    enabled: true,
    locked: false,
    lockedReason: null,
    delivering: true,
    stored: true,
    updatedAt: "2026-10-01T09:00:00.000Z",
    updatedBy: "Ken",
    ...overrides,
  };
}

/** A route nobody saved, on a channel with no connection: its default binding, off and locked. */
const LOCKED = {
  enabled: false,
  locked: true,
  delivering: false,
  stored: false,
  updatedAt: null,
  updatedBy: null,
} as const;

/**
 * The seeded routes: the four core kinds in the card's order.
 *
 * @param overrides Fields to replace.
 * @returns The payload.
 */
export function notificationRoutes(overrides: Partial<NotificationRoutes> = {}): NotificationRoutes {
  return {
    items: [
      route("needs_you_dm", { ...LOCKED, channel: "slack", lockedReason: "connect Slack first" }),
      route("daily_digest", { config: { time: "09:00" } }),
      route("loop_failures", {
        ...LOCKED,
        channel: "pagerduty",
        lockedReason: "connect PagerDuty first",
      }),
      route("weekly_insights", {
        config: { weekday: "monday", recipients: ["eng-leads@acme.dev"] },
      }),
    ],
    channels: [
      { channel: "email", available: true, reason: null },
      { channel: "slack", available: false, reason: "connect Slack first" },
      { channel: "pagerduty", available: false, reason: "connect PagerDuty first" },
    ],
    ...overrides,
  };
}
