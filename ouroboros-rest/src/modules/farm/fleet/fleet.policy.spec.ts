import {
  CACHE_SHARING,
  CACHE_TOOL,
  cacheLabel,
  farmWindows,
  FARM_POLL_SECONDS,
  FARM_TIME_ZONE,
  PRIOR_WINDOW_DAYS,
} from "./fleet.policy";

/**
 * The windows, and the label decision **B5** decides.
 *
 * Two claims are worth asserting rather than reading: that *today* and *last week* are
 * **adjacent and disjoint** — the property that keeps today's builds out of both sides of
 * their own comparison — and that the cache label is composed rather than written out, which
 * is the acceptance criterion *derived, not hard-coded*.
 */

/** Milliseconds in a day, for the arithmetic the assertions below check. */
const DAY_MS = 24 * 60 * 60 * 1000;

describe("the windows", () => {
  it("starts today at midnight UTC on the day the request fell in", () => {
    const windows = farmWindows(new Date("2026-09-19T14:37:11.482Z"));

    expect(windows.dayStart.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(windows.timeZone).toBe("UTC");
    expect(windows.now.toISOString()).toBe("2026-09-19T14:37:11.482Z");
  });

  it("keeps a build at 23:58 in the day it actually finished in", () => {
    // The issue's own case. A request at two minutes to midnight measures a day that began
    // this morning, not one that begins in two minutes — so the build at 23:58 is inside it.
    const windows = farmWindows(new Date("2026-09-19T23:58:00.000Z"));

    expect(windows.dayStart.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(new Date("2026-09-19T23:58:00.000Z") >= windows.dayStart).toBe(true);
  });

  it("puts a build two minutes later in the next day, and the one before it in this one", () => {
    // Either side of the boundary, from the boundary's own side. `dayStart` for a request at
    // 00:00:30 is that midnight — so 23:58 yesterday is *outside* today, which is the half of
    // the rule a window open at the bottom would get wrong.
    const windows = farmWindows(new Date("2026-09-20T00:00:30.000Z"));

    expect(windows.dayStart.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(new Date("2026-09-19T23:58:00.000Z") >= windows.dayStart).toBe(false);
  });

  it("makes last week the seven whole days that end where today begins", () => {
    const windows = farmWindows(new Date("2026-09-19T14:37:11.482Z"));

    expect(windows.priorStart.toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(windows.dayStart.getTime() - windows.priorStart.getTime()).toBe(
      PRIOR_WINDOW_DAYS * DAY_MS,
    );
  });

  it("leaves no instant in both windows and no instant between them", () => {
    // Adjacent and disjoint, which is the whole reason the prior window is stepped back from
    // the day boundary rather than from `now`. A prior window of `now − 7d` would overlap
    // today by however far into it the request landed, and the delta would shrink towards
    // zero as the day went on.
    const windows = farmWindows(new Date("2026-09-19T18:00:00.000Z"));
    const inPrior = (at: Date): boolean => at >= windows.priorStart && at < windows.dayStart;
    const inToday = (at: Date): boolean => at >= windows.dayStart && at <= windows.now;

    const boundary = windows.dayStart;
    const justBefore = new Date(boundary.getTime() - 1);

    expect(inPrior(justBefore)).toBe(true);
    expect(inToday(justBefore)).toBe(false);
    expect(inPrior(boundary)).toBe(false);
    expect(inToday(boundary)).toBe(true);
  });

  it("measures every boundary from one instant", () => {
    // One `now` in, and everything else derived from it — so two statements of one read
    // cannot be answered about two nearly-equal presents.
    const now = new Date("2026-09-19T09:15:00.000Z");
    const windows = farmWindows(now);

    expect(windows.now).toBe(now);
    expect(windows.dayStart.getTime()).toBeLessThan(now.getTime());
  });

  it("names the zone it took the calendar boundaries in", () => {
    // Published because the payload carries it: a client rendering *today* beside a person's
    // own clock has to know which day is meant.
    expect(FARM_TIME_ZONE).toBe("UTC");
    expect(farmWindows(new Date("2026-09-19T00:00:00.000Z")).timeZone).toBe(FARM_TIME_ZONE);
  });

  it("refuses a zone the runtime does not know rather than guessing UTC", () => {
    // A boundary nobody can compute must not silently become a different one: a workspace's
    // whole day would be mis-dated and nothing would say so.
    expect(() => farmWindows(new Date(), "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("the cache label", () => {
  it("reads `ccache · per-runner` — decision B5, not the mockup's wording", () => {
    // The mockup says *shared per pool*. The MVP's caches are one per runner, so that would
    // be the label lying while the number beside it told the truth.
    expect(cacheLabel()).toBe("ccache · per-runner");
    expect(cacheLabel()).not.toContain("shared per pool");
  });

  it("is composed from the sharing mode rather than written out", () => {
    // The acceptance criterion. The proof is that changing the mode changes the label without
    // touching the label: this is what AJ.2 (#264) will do, in one line.
    expect(cacheLabel("shared-per-pool")).toBe("ccache · shared-per-pool");
    expect(cacheLabel(CACHE_SHARING, "sccache")).toBe("sccache · per-runner");
  });

  it("ships `per-runner`, because nothing in this release could make the other true", () => {
    expect(CACHE_SHARING).toBe("per-runner");
    expect(CACHE_TOOL).toBe("ccache");
  });
});

describe("the poll cadence", () => {
  it("matches the fleet's heartbeat, so a poll cannot outrun the data", () => {
    // Ten seconds is `HEARTBEAT_INTERVAL_MS`. A page polling faster would redraw telemetry
    // that has not moved.
    expect(FARM_POLL_SECONDS).toBe(10);
  });
});
