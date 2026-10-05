import type { RunnerStatus } from "../db/schema";
import type { IntegrationFacts, SourceFact } from "./integrations.repository";
import {
  INTEGRATION_KINDS,
  SLACK_REASON,
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

  it("renders Slack as honestly absent — unbuilt, not merely off", () => {
    expect(tile(SEEDED, "slack")).toEqual({
      kind: "slack",
      label: "Slack",
      availability: "unavailable_unbuilt",
      state: "off",
      contextLine: null,
      deepLink: null,
      reason: SLACK_REASON,
    });
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
