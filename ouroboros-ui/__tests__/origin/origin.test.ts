import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORIGIN,
  NO_LIVE_LOOP,
  ORIGIN_COOKIE,
  ORIGIN_OPTIONS,
  READINESS_LINK,
  isOriginFilter,
  originBadge,
  originCookie,
  originStrip,
  parseOrigin,
} from "@/app/origin/origin";

/**
 * The data-origin table every surface reads (DJ.3, #1316): which filter a request asked for, the
 * badge a row carries, and the strip a page draws when everything on it is non-live.
 */

describe("the origin filter", () => {
  it("offers live, demo data, simulated and every origin, live first", () => {
    expect(ORIGIN_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      ["live", "Live"],
      ["seeded", "Demo data"],
      ["simulated", "Simulated"],
      ["all", "All origins"],
    ]);
    expect(DEFAULT_ORIGIN).toBe("live");
  });

  it("accepts exactly the four values", () => {
    for (const value of ["live", "seeded", "simulated", "all"]) {
      expect(isOriginFilter(value)).toBe(true);
    }

    for (const value of ["", "LIVE", "demo", "imported", undefined, null, 1]) {
      expect(isOriginFilter(value)).toBe(false);
    }
  });

  it("reads the address first, then the remembered choice, then live", () => {
    expect(parseOrigin("seeded", "simulated")).toBe("seeded");
    expect(parseOrigin(["all", "seeded"], "simulated")).toBe("all");
    expect(parseOrigin(undefined, "simulated")).toBe("simulated");
    expect(parseOrigin(null, undefined)).toBe("live");
  });

  it("ignores what it does not recognize rather than failing", () => {
    expect(parseOrigin("demo", "simulated")).toBe("simulated");
    expect(parseOrigin("demo", "garbage")).toBe("live");
    expect(parseOrigin([], undefined)).toBe("live");
  });

  it("remembers a choice site-wide for a year", () => {
    expect(originCookie("seeded")).toBe(
      `${ORIGIN_COOKIE}=seeded; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  });
});

describe("the origin badge", () => {
  it("labels demo and simulated rows in words, and live rows not at all", () => {
    expect(originBadge("seeded")).toBe("Demo data");
    expect(originBadge("simulated")).toBe("Simulated");
    expect(originBadge("live")).toBeNull();
  });
});

describe("the origin strip", () => {
  it("is absent when any live data exists", () => {
    expect(originStrip(["live", "seeded"], "all")).toBeNull();
    expect(originStrip(["live"], "live")).toBeNull();
  });

  it("is absent for a workspace with nothing in it — its empty states speak instead", () => {
    expect(originStrip([], "live")).toBeNull();
    expect(originStrip([], "all")).toBeNull();
  });

  it("says the page is showing demo data when that is all it shows", () => {
    expect(originStrip(["seeded"], "seeded")?.text).toBe(
      `This page is showing demo data. ${NO_LIVE_LOOP}`,
    );
    expect(originStrip(["seeded"], "all")?.text).toBe(
      "This page is showing demo data. No real loop has run in this workspace yet.",
    );
  });

  it("names both kinds when demo and simulated data are present", () => {
    expect(originStrip(["simulated", "seeded"], "all")?.text).toBe(
      `This page is showing simulated and demo data. ${NO_LIVE_LOOP}`,
    );
  });

  it("says where the hidden rows are when live is asked for and none exist", () => {
    expect(originStrip(["seeded"], "live")?.text).toBe(
      "No real loop has run in this workspace yet. Demo data is hidden; choose Demo data under Data origin to see it.",
    );
    expect(originStrip(["simulated"], "live")?.text).toBe(
      "No real loop has run in this workspace yet. Simulated is hidden; choose Simulated under Data origin to see it.",
    );
  });

  it("links to the readiness check", () => {
    expect(READINESS_LINK).toEqual({ label: "Check readiness →", href: "/get-started" });
  });
});
