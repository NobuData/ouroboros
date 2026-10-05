/**
 * The integrations grid, composed (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488))
 * — pure.
 *
 * **A status hub, not a second store.** Every tile is derived from the facts its owning plane
 * holds (`integrations.repository.ts`); nothing here is stored, so disconnecting Jira on the
 * sources page changes the Jira tile with no write to any settings table. Every Connect action
 * **deep-links** to the surface that owns the flow, and the grid has no connection form of its own.
 *
 * **A tile never shows a ✓ it did not earn.** `availability` separates *you have not connected
 * this* (`disconnected`) from *this does not exist yet* — Slack waits on mockup 19
 * (`unavailable_unbuilt`); Teams, Datadog and PagerDuty are v2 connector kinds (`unavailable_v2`)
 * — so the UI never has to guess from a null, and a greyed tile says why it is grey.
 *
 * ```
 * tile        owner                                     connected when
 * github      sources page · K.4 token · App state      App installed, a token stored, or an
 *                                                       unpaused GitHub source with a credential
 * slack       mockup 19 (Chat Ops)                      never, in this build
 * jira        sources page                              an unpaused Jira source with a credential
 * linear      sources page                              an unpaused Linear source with a credential
 * teams       BT.3 (v2)                                 never, in this build
 * webhooks    BR.3 endpoints                            at least one endpoint active
 * datadog     BT.3 (v2)                                 never, in this build
 * pagerduty   BT.3 (v2)                                 never, in this build
 * build_farm  farm control plane                        at least one runner enrolled
 * ```
 */

import { ONLINE_STATUSES } from "../farm/fleet/fleet.stats";
import { BUILD_FARM_PATH, SOURCES_PATH } from "../onboarding/defaults.resources";
import { SETTINGS_PATH } from "../onboarding/resources";
import type { IntegrationFacts, SourceFact } from "./integrations.repository";

/** Every tile the grid shows, in the mockup's order (the build farm after it). */
export const INTEGRATION_KINDS = [
  "github",
  "slack",
  "jira",
  "linear",
  "teams",
  "webhooks",
  "datadog",
  "pagerduty",
  "build_farm",
] as const;

/** One of {@link INTEGRATION_KINDS}. */
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/**
 * Whether the integration is connected, merely not connected, or does not exist in this build —
 * as a v2 connector kind, or as an unbuilt surface.
 */
export type IntegrationAvailability =
  "connected" | "disconnected" | "unavailable_v2" | "unavailable_unbuilt";

/** How the tile reads at a glance: healthy, connected but needing a look, or off. */
export type IntegrationState = "ok" | "attention" | "off";

/** Where a tile's action leads — always the surface that owns the connection. */
export interface IntegrationLinkResource {
  readonly label: string;
  /** An origin-relative UI path. */
  readonly path: string;
}

/** One tile. */
export interface IntegrationTileResource {
  readonly kind: IntegrationKind;
  /** `GitHub`, `MS Teams`, `Build farm`. */
  readonly label: string;
  readonly availability: IntegrationAvailability;
  readonly state: IntegrationState;
  /** `acme-robotics · GitHub App installed`, `2 active`, `3 of 4 runners online` — or null. */
  readonly contextLine: string | null;
  /** Connect or Manage, on the owning surface; null for a kind that cannot be connected yet. */
  readonly deepLink: IntegrationLinkResource | null;
  /** Why the tile is unavailable or needs attention, in a sentence — or null. */
  readonly reason: string | null;
}

/** The grid. */
export interface IntegrationsResource {
  readonly tiles: IntegrationTileResource[];
  /** *4 connected* — counted from the tiles, which are derived from real connections. */
  readonly connectedCount: number;
}

/** Where the webhook endpoints are managed: the integrations section, whose sheet BS.5 opens. */
export const WEBHOOKS_PATH = `${SETTINGS_PATH}#integrations`;

/** Why a v2 connector kind cannot be connected yet. */
export const V2_REASON = "Arrives with the v2 connectors (BT.3).";

/** Why Slack cannot be connected yet. */
export const SLACK_REASON = "Slack arrives with Chat Ops (mockup 19), which is not built yet.";

/**
 * The GitHub login a source names in its config, when it names one.
 *
 * @param config - A GitHub source's config (`{ login, repos }`).
 * @returns The login, or undefined.
 */
function loginOf(config: unknown): string | undefined {
  if (typeof config === "object" && config !== null && "login" in config) {
    const login = config.login;
    return typeof login === "string" && login !== "" ? login : undefined;
  }

  return undefined;
}

/**
 * The host a Jira source's `base_url` names — `acme-robotics.atlassian.net`.
 *
 * @param config - A source's config.
 * @returns The host, or undefined.
 */
function hostOf(config: unknown): string | undefined {
  if (typeof config === "object" && config !== null && "base_url" in config) {
    const url = config.base_url;

    if (typeof url === "string") {
      try {
        return new URL(url).host;
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

/**
 * A source that holds a live connection: not paused by anybody, with a credential stored.
 *
 * @param source - The source.
 * @returns True when it counts as connected.
 */
function live(source: SourceFact): boolean {
  return source.status !== "paused" && source.hasCredential;
}

/**
 * A tile for a kind that cannot be connected in this build.
 *
 * @param kind - The kind.
 * @param label - Its name.
 * @param availability - v2, or unbuilt.
 * @param reason - Why.
 * @returns The tile.
 */
function unavailable(
  kind: IntegrationKind,
  label: string,
  availability: "unavailable_v2" | "unavailable_unbuilt",
  reason: string,
): IntegrationTileResource {
  return { kind, label, availability, state: "off", contextLine: null, deepLink: null, reason };
}

/**
 * The GitHub tile: app-or-token truth.
 *
 * @param facts - The workspace's facts.
 * @returns The tile.
 */
export function githubTile(facts: IntegrationFacts): IntegrationTileResource {
  const sources = facts.sources.filter((source) => source.kind === "github");
  const installed = facts.githubOrgs.find((org) => org.appInstalled);
  const connected =
    installed !== undefined || facts.githubTokenStored || sources.some((source) => live(source));
  const login =
    installed?.login ??
    sources.map((source) => loginOf(source.config)).find((value) => value !== undefined) ??
    facts.githubOrgs[0]?.login;
  const failing = sources.find((source) => source.status === "error");

  if (!connected) {
    return {
      kind: "github",
      label: "GitHub",
      availability: "disconnected",
      state: "off",
      contextLine: null,
      deepLink: { label: "Connect", path: SOURCES_PATH },
      reason: null,
    };
  }

  const via = installed !== undefined ? "GitHub App installed" : "token";

  return {
    kind: "github",
    label: "GitHub",
    availability: "connected",
    state: failing === undefined ? "ok" : "attention",
    contextLine: login === undefined ? via : `${login} · ${via}`,
    deepLink: { label: "Manage", path: SOURCES_PATH },
    reason: failing === undefined ? null : (failing.statusReason ?? "A GitHub source is failing."),
  };
}

/**
 * A tracker tile — Jira or Linear — from that kind's ticket sources.
 *
 * @param facts - The workspace's facts.
 * @param kind - `jira` or `linear`.
 * @param label - Its name.
 * @returns The tile.
 */
export function trackerTile(
  facts: IntegrationFacts,
  kind: "jira" | "linear",
  label: string,
): IntegrationTileResource {
  const sources = facts.sources.filter((source) => source.kind === kind);
  const connected = sources.filter(live);

  if (connected.length === 0) {
    return {
      kind,
      label,
      availability: "disconnected",
      state: "off",
      contextLine: null,
      deepLink: { label: "Connect", path: SOURCES_PATH },
      reason: null,
    };
  }

  const failing = connected.find((source) => source.status === "error");
  const first = connected[0];
  const contextLine =
    connected.length > 1
      ? `${String(connected.length)} sources`
      : (hostOf(first.config) ?? first.displayName);

  return {
    kind,
    label,
    availability: "connected",
    state: failing === undefined ? "ok" : "attention",
    contextLine,
    deepLink: { label: "Manage", path: SOURCES_PATH },
    reason:
      failing === undefined ? null : (failing.statusReason ?? `A ${label} source is failing.`),
  };
}

/**
 * The webhooks tile: *N active*, counted live from BR.3's endpoints.
 *
 * @param facts - The workspace's facts.
 * @returns The tile.
 */
export function webhooksTile(facts: IntegrationFacts): IntegrationTileResource {
  const active = facts.activeWebhooks;

  return {
    kind: "webhooks",
    label: "Webhooks",
    availability: active > 0 ? "connected" : "disconnected",
    state: active > 0 ? "ok" : "off",
    contextLine: active > 0 ? `${String(active)} active` : null,
    deepLink: { label: active > 0 ? "Manage" : "Add endpoint", path: WEBHOOKS_PATH },
    reason: null,
  };
}

/**
 * The build-farm tile: runner connectivity, from the farm's own rows and its own online rule.
 *
 * @param facts - The workspace's facts.
 * @returns The tile.
 */
export function buildFarmTile(facts: IntegrationFacts): IntegrationTileResource {
  let total = 0;
  let online = 0;

  for (const [status, count] of facts.runners) {
    total += count;
    online += ONLINE_STATUSES.has(status) ? count : 0;
  }

  if (total === 0) {
    return {
      kind: "build_farm",
      label: "Build farm",
      availability: "disconnected",
      state: "off",
      contextLine: null,
      deepLink: { label: "Enrol a runner", path: BUILD_FARM_PATH },
      reason: null,
    };
  }

  const offline = total - online;

  return {
    kind: "build_farm",
    label: "Build farm",
    availability: "connected",
    state: offline === 0 ? "ok" : "attention",
    contextLine: `${String(online)} of ${String(total)} runner${total === 1 ? "" : "s"} online`,
    deepLink: { label: "Manage", path: BUILD_FARM_PATH },
    reason:
      offline === 0 ? null : `${String(offline)} runner${offline === 1 ? " is" : "s are"} offline.`,
  };
}

/**
 * The whole grid.
 *
 * @param facts - The workspace's facts, read from the owning planes.
 * @returns Every tile, in {@link INTEGRATION_KINDS} order, and the connected count.
 */
export function composeIntegrations(facts: IntegrationFacts): IntegrationsResource {
  const tiles: IntegrationTileResource[] = [
    githubTile(facts),
    unavailable("slack", "Slack", "unavailable_unbuilt", SLACK_REASON),
    trackerTile(facts, "jira", "Jira"),
    trackerTile(facts, "linear", "Linear"),
    unavailable("teams", "MS Teams", "unavailable_v2", V2_REASON),
    webhooksTile(facts),
    unavailable("datadog", "Datadog", "unavailable_v2", V2_REASON),
    unavailable("pagerduty", "PagerDuty", "unavailable_v2", V2_REASON),
    buildFarmTile(facts),
  ];

  return {
    tiles,
    connectedCount: tiles.filter((tile) => tile.availability === "connected").length,
  };
}
