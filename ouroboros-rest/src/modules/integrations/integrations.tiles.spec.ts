import type { RunnerStatus } from "../db/schema";
import type { IntegrationFacts, SourceFact } from "./integrations.repository";
import {
  INTEGRATION_KINDS,
  SLACK_INSTALL_PATH,
  SLACK_NOT_CONFIGURED_REASON,
  V2_REASON,
  WEBHOOKS_PATH,
  composeIntegrations,
  type IntegrationTileResource,
} from "./integrations.tiles";

/**
 * The integrations grid (#488): every tile derived from its owning plane's facts, absent things
 * labelled honestly, and every action a deep link to the surface that owns the connection.
 */

/**
 * A workspace with nothing connected, with overrides.
 *
 * @param overrides - The facts a case sets.
 * @returns The facts.
 */
function facts(overrides: Partial<IntegrationFacts> = {}): IntegrationFacts {
  return {
    githubTokenStored: false,
    githubOrgs: [],
    sources: [],
    activeWebhooks: 0,
    runners: new Map(),
    slack: { configured: false, connection: null },
    ...overrides,
  };
}

/**
 * A ticket source.
 *
 * @param overrides - What a case sets.
 * @returns The source.
 */
function source(overrides: Partial<SourceFact>): SourceFact {
  return {
    kind: "jira",
    displayName: "Jira · PROJ",
    status: "active",
    statusReason: null,
    config: { base_url: "https://acme-robotics.atlassian.net", project_keys: ["PROJ"] },
    hasCredential: true,
    ...overrides,
  };
}

/**
 * One tile of a grid.
 *
 * @param input - The facts.
 * @param kind - The tile.
 * @returns It.
 */
function tile(
  input: IntegrationFacts,
  kind: IntegrationTileResource["kind"],
): IntegrationTileResource {
  const found = composeIntegrations(input).tiles.find((t) => t.kind === kind);

  if (found === undefined) throw new Error(`no ${kind} tile`);
  return found;
}

/** The seeded workspace: GitHub by token, Jira, two webhooks, a farm with one machine offline. */
const SEEDED = facts({
  githubTokenStored: true,
  githubOrgs: [{ login: "acme-robotics", appInstalled: false }],
  sources: [
    source({
      kind: "github",
      displayName: "GitHub · acme-robotics",
      config: { login: "acme-robotics", repos: [] },
    }),
    source({}),
  ],
  activeWebhooks: 2,
  runners: new Map<RunnerStatus, number>([
    ["online", 2],
    ["building", 1],
    ["offline", 1],
  ]),
});

describe("the integrations grid", () => {
  it("shows every tile in the mockup's order, the build farm last", () => {
    expect(composeIntegrations(facts()).tiles.map((t) => t.kind)).toEqual([...INTEGRATION_KINDS]);
  });

  it("counts connected tiles from the real connections", () => {
    expect(composeIntegrations(facts()).connectedCount).toBe(0);
    // GitHub, Jira, webhooks and the farm.
    expect(composeIntegrations(SEEDED).connectedCount).toBe(4);
  });

  it("labels Teams, Datadog and PagerDuty as v2 kinds, distinguishable from unconfigured", () => {
    for (const kind of ["teams", "datadog", "pagerduty"] as const) {
      expect(tile(SEEDED, kind)).toMatchObject({
        availability: "unavailable_v2",
        deepLink: null,
        reason: V2_REASON,
      });
    }
    expect(tile(facts(), "linear").availability).toBe("disconnected");
  });

  it("never offers a Connect action on this page — every link is the owning surface", () => {
    const links = composeIntegrations(SEEDED).tiles.flatMap((t) =>
      t.deepLink === null ? [] : [t.deepLink.path],
    );

    expect(new Set(links)).toEqual(new Set(["/settings/sources", WEBHOOKS_PATH, "/build-farm"]));
  });
});

describe("the Slack tile (#535)", () => {
  const active = { workspaceName: "acme-robotics", status: "active", statusDetail: null } as const;

  it("says why there is nothing to connect on a deployment with no Slack app", () => {
    expect(tile(facts(), "slack")).toEqual({
      kind: "slack",
      label: "Slack",
      availability: "disconnected",
      state: "off",
      contextLine: null,
      deepLink: null,
      reason: SLACK_NOT_CONFIGURED_REASON,
    });
  });

  it("offers the install route where there is an app and no install", () => {
    expect(tile(facts({ slack: { configured: true, connection: null } }), "slack")).toEqual({
      kind: "slack",
      label: "Slack",
      availability: "disconnected",
      state: "off",
      contextLine: null,
      deepLink: { label: "Connect", path: "/api/v1/slack/oauth/install" },
      reason: null,
    });
    expect(SLACK_INSTALL_PATH).toBe("/api/v1/slack/oauth/install");
  });

  it("is connected, with the Slack workspace's name, once installed — and counts", () => {
    const grid = composeIntegrations(facts({ slack: { configured: true, connection: active } }));

    expect(grid.tiles.find((t) => t.kind === "slack")).toEqual({
      kind: "slack",
      label: "Slack",
      availability: "connected",
      state: "ok",
      contextLine: "acme-robotics",
      deepLink: { label: "Reinstall", path: SLACK_INSTALL_PATH },
      reason: null,
    });
    expect(grid.connectedCount).toBe(1);
  });

  it("reads a revoked install as disconnected, with Slack's reason — never a ✓", () => {
    const revoked = { ...active, status: "revoked", statusDetail: "app_uninstalled" } as const;
    const grid = composeIntegrations(facts({ slack: { configured: true, connection: revoked } }));

    expect(grid.tiles.find((t) => t.kind === "slack")).toMatchObject({
      availability: "disconnected",
      state: "off",
      contextLine: null,
      deepLink: { label: "Connect", path: SLACK_INSTALL_PATH },
      reason: "Slack revoked the app (app_uninstalled).",
    });
    expect(grid.connectedCount).toBe(0);
  });

  it("reads a failing install as connected and needing a look", () => {
    const failing = { ...active, status: "error", statusDetail: "ratelimited" } as const;

    expect(
      tile(facts({ slack: { configured: true, connection: failing } }), "slack"),
    ).toMatchObject({
      availability: "connected",
      state: "attention",
      reason: "ratelimited",
    });
  });

  it("keeps an install's state but offers no action once the deployment's app is gone", () => {
    expect(
      tile(facts({ slack: { configured: false, connection: active } }), "slack"),
    ).toMatchObject({
      availability: "connected",
      deepLink: null,
    });
  });
});

describe("the GitHub tile", () => {
  it("reports token truth with the login", () => {
    expect(tile(SEEDED, "github")).toMatchObject({
      availability: "connected",
      state: "ok",
      contextLine: "acme-robotics · token",
      deepLink: { label: "Manage", path: "/settings/sources" },
    });
  });

  it("reports App truth once the installation exists", () => {
    const input = facts({ githubOrgs: [{ login: "acme-robotics", appInstalled: true }] });

    expect(tile(input, "github").contextLine).toBe("acme-robotics · GitHub App installed");
  });

  it("reads as disconnected after the Danger zone's disconnect: token cleared, sources paused", () => {
    const input = facts({
      githubOrgs: [{ login: "acme-robotics", appInstalled: false }],
      sources: [source({ kind: "github", status: "paused" })],
    });

    expect(tile(input, "github")).toMatchObject({
      availability: "disconnected",
      state: "off",
      deepLink: { label: "Connect", path: "/settings/sources" },
    });
  });

  it("asks for attention when a GitHub source is failing, and says why", () => {
    const input = facts({
      githubTokenStored: true,
      sources: [source({ kind: "github", status: "error", statusReason: "token expired" })],
    });

    expect(tile(input, "github")).toMatchObject({ state: "attention", reason: "token expired" });
  });
});

describe("the tracker tiles", () => {
  it("name the Jira site from its own source", () => {
    expect(tile(SEEDED, "jira")).toMatchObject({
      availability: "connected",
      contextLine: "acme-robotics.atlassian.net",
    });
  });

  it("change when the source is paused elsewhere — nothing here is stored", () => {
    const paused = facts({ sources: [source({ status: "paused" })] });

    expect(tile(paused, "jira").availability).toBe("disconnected");
  });

  it("do not count a source with no credential", () => {
    expect(tile(facts({ sources: [source({ hasCredential: false })] }), "jira").availability).toBe(
      "disconnected",
    );
  });

  it("count several sources of one kind", () => {
    const input = facts({
      sources: [
        source({ kind: "linear", displayName: "Linear · ENG" }),
        source({ kind: "linear", displayName: "Linear · OPS" }),
      ],
    });

    expect(tile(input, "linear").contextLine).toBe("2 sources");
  });
});

describe("the webhooks and build farm tiles", () => {
  it("count active endpoints live", () => {
    expect(tile(SEEDED, "webhooks")).toMatchObject({
      availability: "connected",
      contextLine: "2 active",
    });
    expect(tile(facts(), "webhooks")).toMatchObject({
      availability: "disconnected",
      deepLink: { label: "Add endpoint", path: WEBHOOKS_PATH },
    });
  });

  it("report runner connectivity by the farm's own online rule", () => {
    expect(tile(SEEDED, "build_farm")).toMatchObject({
      availability: "connected",
      state: "attention",
      contextLine: "3 of 4 runners online",
      reason: "1 runner is offline.",
    });
    expect(tile(facts(), "build_farm")).toMatchObject({
      availability: "disconnected",
      deepLink: { label: "Enrol a runner", path: "/build-farm" },
    });
  });
});
