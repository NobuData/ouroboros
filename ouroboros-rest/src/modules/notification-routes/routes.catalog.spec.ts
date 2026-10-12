import {
  CORE_ROUTE_KINDS,
  channelLock,
  configProblems,
  defaultChannel,
  isRouteKind,
  isoDayOf,
  normalisedConfig,
} from "./routes.catalog";

/**
 * The routes' vocabulary (#488) — the same rules V094 holds `notification_routes` to, stated for a
 * write before it is stored.
 */

describe("a route's kind", () => {
  it("is one of the four core kinds, or a well-formed custom kind", () => {
    for (const kind of CORE_ROUTE_KINDS) expect(isRouteKind(kind)).toBe(true);
    expect(isRouteKind("custom:release-notes")).toBe(true);
    expect(isRouteKind("custom:")).toBe(false);
    expect(isRouteKind("custom:Bad Slug")).toBe(false);
    expect(isRouteKind("loop_failure")).toBe(false);
  });

  it("defaults to the card's own binding", () => {
    expect(defaultChannel("needs_you_dm")).toBe("slack");
    expect(defaultChannel("daily_digest")).toBe("email");
    expect(defaultChannel("loop_failures")).toBe("pagerduty");
    expect(defaultChannel("weekly_insights")).toBe("email");
    expect(defaultChannel("custom:release-notes")).toBe("email");
  });
});

describe("the locked-row rule", () => {
  const none = { slackConnected: false };
  const slack = { slackConnected: true };

  it("lets email deliver and locks the channels with no connection, saying why", () => {
    expect(channelLock("email", none)).toBeNull();
    expect(channelLock("slack", none)).toBe("connect Slack first");
    expect(channelLock("pagerduty", none)).toBe("connect PagerDuty first");
  });

  it("lifts the Slack lock exactly when the workspace has an active Slack connection (#536)", () => {
    expect(channelLock("slack", slack)).toBeNull();
    // Connecting Slack connects nothing else.
    expect(channelLock("pagerduty", slack)).toBe("connect PagerDuty first");
    expect(channelLock("email", slack)).toBeNull();
  });
});

describe("a route's config", () => {
  it("accepts the three settings, each optional", () => {
    expect(configProblems({})).toEqual({});
    expect(
      configProblems({ time: "09:00", weekday: "monday", recipients: ["eng-leads@acme.dev"] }),
    ).toEqual({});
  });

  it("names the field of every malformed setting", () => {
    expect(Object.keys(configProblems({ time: "9am" }))).toEqual(["config.time"]);
    expect(Object.keys(configProblems({ time: "24:00" }))).toEqual(["config.time"]);
    expect(Object.keys(configProblems({ weekday: "funday" }))).toEqual(["config.weekday"]);
    expect(Object.keys(configProblems({ recipients: [] }))).toEqual(["config.recipients"]);
    expect(Object.keys(configProblems({ recipients: ["not-an-address"] }))).toEqual([
      "config.recipients",
    ]);
    expect(Object.keys(configProblems({ channel: "#eng-leads" }))).toEqual(["config.channel"]);
    expect(Object.keys(configProblems([]))).toEqual(["config"]);
  });

  it("caps how many addresses a route carries", () => {
    const many = Array.from({ length: 21 }, (_, i) => `p${String(i)}@acme.dev`);

    expect(configProblems({ recipients: many })["config.recipients"]).toEqual([
      "a route carries at most 20 recipients",
    ]);
  });

  it("is stored with duplicate addresses collapsed and keys in one order", () => {
    expect(
      normalisedConfig({
        recipients: ["A@acme.dev", "a@acme.dev"],
        weekday: "friday",
        time: "17:00",
      }),
    ).toEqual({ time: "17:00", weekday: "friday", recipients: ["a@acme.dev"] });
  });
});

describe("a weekday", () => {
  it("is its ISO day, Monday when unset", () => {
    expect(isoDayOf("monday")).toBe(1);
    expect(isoDayOf("sunday")).toBe(7);
    expect(isoDayOf(undefined)).toBe(1);
  });
});
