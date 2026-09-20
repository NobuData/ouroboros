import { describe, expect, it } from "vitest";

import {
  ALL_CONNECTED,
  FARM_ACTIONS,
  FARM_EYEBROW,
  FARM_HEADLINE_UNREAD,
  FARM_SUBLINE,
  FARM_UNREAD_HEADLINE,
  LEVEL_WITH_LAST_WEEK,
  NOT_MEASURED,
  NOT_READ,
  NO_BUILDS_TODAY,
  NO_CACHE_DATA,
  NO_POOLS,
  NO_RUNNERS,
  NO_RUNNERS_ENROLLED,
  buildTimeDelta,
  buildTimeStat,
  buildsStat,
  cacheStat,
  farmBannerHeadline,
  farmHeadline,
  farmStatRow,
  runnersStat,
} from "@/app/farm/view";

import { emptyFarm, farmStats, runnerPool, seededFarm } from "../helpers/farm";

/**
 * Every decision the farm's head and stat row make (#256), as unit tests on small values: how the
 * headline degrades, which way round good news is coloured, when a comparison is claimed at all,
 * and that `null` reaches the glass as an em dash and never as a zero.
 */

describe("the head's copy", () => {
  it("is the mockup's, verbatim", () => {
    expect(FARM_EYEBROW).toBe("Build Farm");
    expect(FARM_SUBLINE).toBe(
      "The Ouroboros server dispatches builds to your own machines over an outbound-only agent " +
        "connection — your hardware, your network, no inbound ports.",
    );
  });
});

describe("the headline", () => {
  it("reproduces the mockup from the seeded farm", () => {
    expect(farmHeadline(seededFarm())).toBe("5 runners. 2 pools. 78% cache hits.");
  });

  it("reads like a sentence a person wrote for a brand-new organization", () => {
    const headline = farmHeadline(emptyFarm());

    expect(headline).toBe(`${NO_RUNNERS} ${NO_POOLS} ${NO_CACHE_DATA}`);
    // Never a bare zero, and never a rate nobody measured.
    expect(headline).not.toMatch(/\b0\b/);
    expect(headline).not.toContain("%");
  });

  it("says one runner and one pool in the singular", () => {
    const one = seededFarm({
      stats: farmStats({ runnersOnline: { online: 1, total: 1, note: null, offline: null } }),
      pools: [runnerPool()],
    });

    expect(farmHeadline(one)).toBe("1 runner. 1 pool. 78% cache hits.");
  });

  it("degrades clause by clause, so a farm with no cache data still counts its machines", () => {
    const uncached = seededFarm({
      stats: farmStats({ cacheHitRate: { pct: null, hits: 0, objects: 0, label: "ccache · per-runner" } }),
    });

    expect(farmHeadline(uncached)).toBe(`5 runners. 2 pools. ${NO_CACHE_DATA}`);
    expect(farmHeadline(seededFarm({ pools: [] }))).toBe(`5 runners. ${NO_POOLS} 78% cache hits.`);
  });

  it("counts the fleet the first tile counts, so the heading and the 4/5 cannot disagree", () => {
    // `stats.runnersOnline.total` excludes retired machines; a payload whose `runners` array
    // somehow carried one more must not move the heading off the tile's denominator.
    const page = seededFarm();

    expect(farmHeadline({ ...page, runners: [...page.runners, page.runners[0]!] })).toMatch(/^5 runners\./);
  });

  it("prints a measured 0% as a rate, because a cache that missed is not a cache nobody measured", () => {
    const missed = seededFarm({
      stats: farmStats({ cacheHitRate: { pct: 0, hits: 0, objects: 40, label: "ccache · per-runner" } }),
    });

    expect(farmHeadline(missed)).toMatch(/0% cache hits\.$/);
  });

  it("claims nothing when nothing was read, and leaves the why to the banner", () => {
    expect(farmHeadline(null)).toBe(FARM_HEADLINE_UNREAD);
    expect(FARM_HEADLINE_UNREAD).not.toMatch(/\d|could not/);
  });
});

describe("the head's actions", () => {
  it("are the mockup's three, in its order and its tones", () => {
    expect(FARM_ACTIONS.map(({ label, tone }) => [label, tone])).toEqual([
      ["✦ Build Analyzer", "ghost"],
      ["Pool settings", "ghost"],
      ["+ Enroll runner", "primary"],
    ]);
  });

  it("name the issue that builds what the unbuilt one opens, so the tooltip answers when", () => {
    const notes = Object.fromEntries(FARM_ACTIONS.map(({ id, soonNote }) => [id, soonNote]));

    expect(notes.analyzer).toContain("#516");
    expect(notes.analyzer).toMatch(/arrives? with/);
  });

  it("stop calling Pool settings soon on the commit that builds the pools sheet (#259)", () => {
    expect(FARM_ACTIONS.find(({ id }) => id === "pools")?.soonNote).toBeNull();
  });

  it("stop calling + Enroll runner soon on the commit that builds the enroll card (#258)", () => {
    // `null` is what makes the head draw it as a control that acts (`app/farm/farm-head.tsx`).
    expect(FARM_ACTIONS.find(({ id }) => id === "enroll")?.soonNote).toBeNull();
  });

  it("carry no destination at all, so none of them can navigate to a dead route", () => {
    for (const action of FARM_ACTIONS) expect(Object.keys(action)).not.toContain("href");
  });
});

describe("runners online", () => {
  it("draws 4/5 with the quiet half apart, accented, over the service's offline note", () => {
    expect(runnersStat(farmStats().runnersOnline)).toEqual({
      id: "runners",
      label: "Runners online",
      value: "4",
      valueSuffix: "/5",
      accent: true,
      delta: "forge-03 offline · 2h",
      tone: "muted",
      meter: null,
    });
  });

  it("draws a genuine 0/0 for a workspace that has enrolled nothing", () => {
    const stat = runnersStat(emptyFarm().stats.runnersOnline);

    expect(`${stat.value}${stat.valueSuffix}`).toBe("0/0");
    expect(stat.delta).toBe(NO_RUNNERS_ENROLLED);
  });

  it("says so when nothing is offline, rather than leaving the tile uncaptioned", () => {
    expect(runnersStat({ online: 5, total: 5, note: null, offline: null }).delta).toBe(ALL_CONNECTED);
  });
});

describe("builds today", () => {
  it("draws 23 over the mockup's split line, exactly", () => {
    const stat = buildsStat(farmStats().buildsToday);

    expect(stat.value).toBe("23");
    expect(stat.delta).toBe("19 clean · 3 retried · 1 failed");
    expect(stat.accent).toBe(false);
  });

  it("keeps a zero part of the split, because a day with no failures is worth saying", () => {
    const stat = buildsStat({ ...farmStats().buildsToday, total: 5, clean: 5, retried: 0, failed: 0 });

    expect(stat.delta).toBe("5 clean · 0 retried · 0 failed");
  });

  it("names a cancelled build only when there is one, so the line still adds up", () => {
    const stat = buildsStat({ ...farmStats().buildsToday, total: 24, canceled: 1 });

    expect(stat.delta).toBe("19 clean · 3 retried · 1 failed · 1 canceled");
  });

  it("draws a genuine zero, with a sentence rather than a split of nothing", () => {
    const stat = buildsStat(emptyFarm().stats.buildsToday);

    expect(stat.value).toBe("0");
    expect(stat.delta).toBe(NO_BUILDS_TODAY);
  });
});

describe("the average build time's delta", () => {
  it("colours a falling time as good news — down is good here", () => {
    expect(buildTimeDelta(-38)).toEqual({ delta: "▼ 38s vs last week", tone: "up" });
  });

  it("colours a rising time as bad news", () => {
    expect(buildTimeDelta(38)).toEqual({ delta: "▲ 38s vs last week", tone: "down" });
  });

  it("is absent when no prior window exists — never ▼ 0s", () => {
    expect(buildTimeDelta(null)).toEqual({ delta: null, tone: "muted" });
  });

  it("says a real comparison that came out level in words, with no direction", () => {
    expect(buildTimeDelta(0)).toEqual({ delta: LEVEL_WITH_LAST_WEEK, tone: "muted" });
    expect(buildTimeDelta(-0.4).delta).toBe(LEVEL_WITH_LAST_WEEK);
  });

  it("never prints a zero-sized arrow, whatever it is handed", () => {
    for (const delta of [null, 0, -0.2, 0.49, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildTimeDelta(delta).delta ?? "").not.toMatch(/[▼▲] 0s/);
    }
  });

  it("spells a difference of a minute or more as minutes and seconds", () => {
    expect(buildTimeDelta(-65).delta).toBe("▼ 1m 05s vs last week");
    expect(buildTimeDelta(-59).delta).toBe("▼ 59s vs last week");
  });
});

describe("average build time", () => {
  it("draws 4m 12s over ▼ 38s vs last week", () => {
    const stat = buildTimeStat(farmStats().avgBuildTime);

    expect(stat.value).toBe("4m 12s");
    expect(stat.delta).toBe("▼ 38s vs last week");
    expect(stat.tone).toBe("up");
  });

  it("draws an em dash and no line over no builds — never 0m 00s", () => {
    const stat = buildTimeStat(emptyFarm().stats.avgBuildTime);

    expect(stat.value).toBe(NOT_MEASURED);
    expect(stat.delta).toBeNull();
  });

  it("draws today's mean with no line when there is no last week to compare it with", () => {
    const stat = buildTimeStat({ seconds: 200, builds: 1, priorSeconds: null, priorBuilds: 0, deltaVsLastWeek: null });

    expect(stat.value).toBe("3m 20s");
    expect(stat.delta).toBeNull();
  });

  it("draws no comparison under a mean it does not have, even if one is sent", () => {
    const stat = buildTimeStat({ seconds: null, builds: 0, priorSeconds: 290, priorBuilds: 140, deltaVsLastWeek: -38 });

    expect(stat.delta).toBeNull();
  });
});

describe("cache hit rate", () => {
  it("draws 78% with its meter, under the label the payload composed from B5", () => {
    expect(cacheStat(farmStats().cacheHitRate)).toMatchObject({
      value: "78%",
      meter: 0.78,
      delta: "ccache · per-runner",
      tone: "muted",
    });
  });

  it("renders whatever label the service sends, so #264 is no edit here", () => {
    const shared = cacheStat({ pct: 78, hits: 1, objects: 2, label: "ccache · shared per pool" });

    expect(shared.delta).toBe("ccache · shared per pool");
  });

  it("draws an em dash and no meter when nothing was measured — never 0% and an empty bar", () => {
    const stat = cacheStat(emptyFarm().stats.cacheHitRate);

    expect(stat.value).toBe(NOT_MEASURED);
    expect(stat.meter).toBeNull();
    expect(stat.delta).toBe("ccache · per-runner");
  });

  it("draws a measured 0% as 0%, with an empty meter", () => {
    expect(cacheStat({ pct: 0, hits: 0, objects: 40, label: "ccache · per-runner" })).toMatchObject({
      value: "0%",
      meter: 0,
    });
  });
});

describe("the stat row", () => {
  it("is the mockup's four tiles, in its order", () => {
    expect(farmStatRow(seededFarm()).map((stat) => stat.label)).toEqual([
      "Runners online",
      "Builds today",
      "Avg build time",
      "Cache hit rate",
    ]);
  });

  it("accents exactly one figure — the one in the present tense", () => {
    expect(farmStatRow(seededFarm()).filter((stat) => stat.accent).map((stat) => stat.id)).toEqual(["runners"]);
  });

  it("reads 0/0 · 0 · — · — for an empty organization", () => {
    const row = farmStatRow(emptyFarm());

    expect(row.map((stat) => `${stat.value}${stat.valueSuffix ?? ""}`)).toEqual(["0/0", "0", "—", "—"]);
  });

  it("keeps its shape and its captions when nothing was read, and says what — not why", () => {
    const row = farmStatRow(null);

    expect(row.map((stat) => stat.label)).toEqual(farmStatRow(seededFarm()).map((stat) => stat.label));
    for (const stat of row) {
      expect(stat).toMatchObject({ value: NOT_MEASURED, delta: NOT_READ, tone: "failed", accent: false, meter: null });
    }
  });
});

describe("the banner's headline", () => {
  const clock = (atMs: number) => `clock(${atMs})`;

  it("says how old the page on screen is", () => {
    expect(farmBannerHeadline(1234, clock)).toBe("Showing data from clock(1234) — the latest refresh failed.");
  });

  it("says the page could not be read when there is none to be stale", () => {
    expect(farmBannerHeadline(null, clock)).toBe(FARM_UNREAD_HEADLINE);
  });
});
