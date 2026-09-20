import { runner } from "../farm.fixture";
import {
  avgBuildTime,
  buildsToday,
  cacheHitRate,
  farmStats,
  runnersOnline,
  type BuildOutcomeCounts,
} from "./fleet.stats";

/**
 * The stat row's arithmetic, and the one rule that runs through all of it: **a count of
 * nothing is zero and an average of nothing is `null`**.
 *
 * The seeded figures are asserted here as arithmetic — `fleet.integration-spec.ts` asserts
 * them again against the real rows, which is the acceptance criterion. What these cases add
 * is the *near misses*: the fleet count that forgets to exclude a retired machine, the delta
 * that reads an empty prior week as zero, the cache rate that reads a missing summary as 0%.
 */

/** The instant every age below is measured back from. */
const NOW = new Date("2026-09-19T12:00:00.000Z");

/** An instant a given number of seconds before {@link NOW}. */
const ago = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);

/** No builds at all — the empty workspace's aggregate. */
const NOTHING = { builds: 0, totalSeconds: 0 };

/** The four outcome counts, with zeros where a case says nothing. */
const outcomes = (counts: Partial<BuildOutcomeCounts> = {}): BuildOutcomeCounts => ({
  succeeded: 0,
  retried: 0,
  failed: 0,
  canceled: 0,
  ...counts,
});

describe("runners online", () => {
  it("counts the mockup's four of five, and names the one that went", () => {
    // Mockup 08's fleet: building, idle, idle, draining, offline.
    const fleet = [
      runner({ id: "r1", name: "forge-01", status: "building", last_seen_at: ago(4) }),
      runner({ id: "r2", name: "forge-02", status: "online", last_seen_at: ago(7) }),
      runner({ id: "r3", name: "anvil-mac", status: "online", last_seen_at: ago(5) }),
      runner({
        id: "r4",
        name: "bigiron",
        status: "draining",
        desired_state: "draining",
        last_seen_at: ago(9),
      }),
      runner({ id: "r5", name: "forge-03", status: "offline", last_seen_at: ago(7200) }),
    ];

    expect(runnersOnline(fleet, NOW)).toEqual({
      online: 4,
      total: 5,
      note: "forge-03 offline · 2h",
      offline: { name: "forge-03", lastSeenAt: ago(7200).toISOString() },
    });
  });

  it("counts a draining runner as online, because it is still connected and still building", () => {
    // `bigiron` is one of the mockup's four. A drained machine is finishing a build and still
    // costing what a runner costs; it is not a machine the fleet has lost.
    const fleet = [
      runner({ id: "r1", status: "draining", desired_state: "draining", last_seen_at: ago(9) }),
    ];

    expect(runnersOnline(fleet, NOW).online).toBe(1);
  });

  it("names the offline runner seen most recently, not the one gone longest", () => {
    // The note answers *what just happened to the fleet*. A machine decommissioned in spirit
    // six months ago is not news.
    const fleet = [
      runner({ id: "r1", name: "ancient", status: "offline", last_seen_at: ago(6_000_000) }),
      runner({ id: "r2", name: "forge-03", status: "offline", last_seen_at: ago(7200) }),
    ];

    expect(runnersOnline(fleet, NOW).note).toBe("forge-03 offline · 2h");
  });

  it("says a machine that never connected has never been seen, rather than `0h`", () => {
    // Enrolment is not a sighting. `0h` would say it was here just now.
    const fleet = [runner({ name: "forge-04", status: "offline", last_seen_at: null })];

    expect(runnersOnline(fleet, NOW).note).toBe("forge-04 offline · never seen");
    expect(runnersOnline(fleet, NOW).offline).toEqual({ name: "forge-04", lastSeenAt: null });
  });

  it("prefers a runner it has actually seen over one it never has", () => {
    const fleet = [
      runner({ id: "r1", name: "never", status: "offline", last_seen_at: null }),
      runner({ id: "r2", name: "forge-03", status: "offline", last_seen_at: ago(7200) }),
    ];

    expect(runnersOnline(fleet, NOW).note).toBe("forge-03 offline · 2h");
  });

  it("floors the age to one unit, erring towards more time having passed", () => {
    // *last seen 2h ago* about a machine last seen 1h 50m ago is a claim the fleet cannot
    // support. Rounding up would flatter; flooring does not.
    const age = (seconds: number): string | null =>
      runnersOnline([runner({ name: "x", status: "offline", last_seen_at: ago(seconds) })], NOW)
        .note;

    expect(age(45)).toBe("x offline · 45s");
    expect(age(59)).toBe("x offline · 59s");
    expect(age(60)).toBe("x offline · 1m");
    expect(age(3599)).toBe("x offline · 59m");
    expect(age(3600)).toBe("x offline · 1h");
    expect(age(7199)).toBe("x offline · 1h");
    expect(age(86_400)).toBe("x offline · 1d");
  });

  it("is a genuine 0/0 with no note for a workspace that has enrolled nothing", () => {
    // Counts, not averages: zero runners online out of zero is a measurement.
    expect(runnersOnline([], NOW)).toEqual({ online: 0, total: 0, note: null, offline: null });
  });

  it("has no note when the whole fleet is up", () => {
    expect(
      runnersOnline([runner({ status: "online", last_seen_at: ago(3) })], NOW).note,
    ).toBeNull();
  });
});

describe("builds today", () => {
  it("partitions the mockup's twenty-three", () => {
    expect(buildsToday(outcomes({ succeeded: 19, retried: 3, failed: 1 }))).toEqual({
      total: 23,
      clean: 19,
      retried: 3,
      failed: 1,
      canceled: 0,
    });
  });

  it("makes the total the sum, so the numbers cannot fail to add up", () => {
    // One partition rather than a total and three counts that might disagree with it.
    const stat = buildsToday(outcomes({ succeeded: 19, retried: 3, failed: 1, canceled: 2 }));

    expect(stat.total).toBe(stat.clean + stat.retried + stat.failed + stat.canceled);
    expect(stat.total).toBe(25);
  });

  it("is zero across the board for a workspace that has built nothing", () => {
    expect(buildsToday(outcomes())).toEqual({
      total: 0,
      clean: 0,
      retried: 0,
      failed: 0,
      canceled: 0,
    });
  });
});

describe("average build time", () => {
  it("is the mockup's 4m 12s, down 38 seconds on the week before", () => {
    // The seed's twenty-three builds total 5 796 seconds and the prior week's twenty total
    // 5 800 — 252 and 290, and the difference is the thirty-eight the card prints.
    expect(
      avgBuildTime({ builds: 23, totalSeconds: 5796 }, { builds: 20, totalSeconds: 5800 }),
    ).toEqual({
      seconds: 252,
      builds: 23,
      priorSeconds: 290,
      priorBuilds: 20,
      deltaVsLastWeek: -38,
    });
  });

  it("is an em-dash rather than `0m 00s` when nothing finished today", () => {
    // The acceptance criterion. An average over no builds is not a farm that finished
    // instantly; it is a measurement nobody took.
    const stat = avgBuildTime(NOTHING, { builds: 20, totalSeconds: 5800 });

    expect(stat.seconds).toBeNull();
    expect(stat.builds).toBe(0);
  });

  it("leaves the delta absent when there is no prior window, rather than reading `▼ 0s`", () => {
    // The acceptance criterion, and the one most likely to be got wrong: a farm switched on
    // this morning has nothing to compare against, and zero claims a comparison.
    const stat = avgBuildTime({ builds: 23, totalSeconds: 5796 }, NOTHING);

    expect(stat.seconds).toBe(252);
    expect(stat.priorSeconds).toBeNull();
    expect(stat.deltaVsLastWeek).toBeNull();
  });

  it("leaves the delta absent when today is empty too", () => {
    expect(avgBuildTime(NOTHING, NOTHING)).toEqual({
      seconds: null,
      builds: 0,
      priorSeconds: null,
      priorBuilds: 0,
      deltaVsLastWeek: null,
    });
  });

  it("reports a genuine zero delta when the two weeks really did average the same", () => {
    // The case that makes `null` meaningful: zero is a fact here, and absent is a fact there.
    const stat = avgBuildTime({ builds: 2, totalSeconds: 500 }, { builds: 4, totalSeconds: 1000 });

    expect(stat.deltaVsLastWeek).toBe(0);
    expect(stat.deltaVsLastWeek).not.toBeNull();
  });

  it("reports a positive delta when builds got slower", () => {
    expect(
      avgBuildTime({ builds: 1, totalSeconds: 300 }, { builds: 1, totalSeconds: 250 })
        .deltaVsLastWeek,
    ).toBe(50);
  });
});

describe("cache hit rate", () => {
  it("is the mockup's 78%, weighted over the day's objects", () => {
    // 6 864 hits in 8 800 objects — the sixteen of today's builds that reported a cache.
    expect(cacheHitRate({ hits: 6864, objects: 8800 })).toEqual({
      pct: 78,
      hits: 6864,
      objects: 8800,
      label: "ccache · per-runner",
    });
  });

  it("is an em-dash rather than `0%` when no build reported a cache", () => {
    // The acceptance criterion, and decision B5's whole point: null is *not measured*, and
    // `0%` would be the product claiming a cache miss it never had.
    const stat = cacheHitRate({ hits: 0, objects: 0 });

    expect(stat.pct).toBeNull();
    expect(stat.hits).toBe(0);
    expect(stat.objects).toBe(0);
  });

  it("reports a genuine 0% when a cache really did miss everything", () => {
    // Which is the reason `null` had to be a separate answer: this one is a real measurement.
    expect(cacheHitRate({ hits: 0, objects: 400 }).pct).toBe(0);
  });

  it("carries the label whether or not there is a number", () => {
    // The card's sub-label describes what the meter *would* be a rate of. An empty farm still
    // has per-runner caches.
    expect(cacheHitRate({ hits: 0, objects: 0 }).label).toBe("ccache · per-runner");
  });
});

describe("the whole row", () => {
  it("reproduces every number on mockup 08", () => {
    const fleet = [
      runner({ id: "r1", name: "forge-01", status: "building", last_seen_at: ago(4) }),
      runner({ id: "r2", name: "forge-02", status: "online", last_seen_at: ago(7) }),
      runner({ id: "r3", name: "anvil-mac", status: "online", last_seen_at: ago(5) }),
      runner({
        id: "r4",
        name: "bigiron",
        status: "draining",
        desired_state: "draining",
        last_seen_at: ago(9),
      }),
      runner({ id: "r5", name: "forge-03", status: "offline", last_seen_at: ago(7200) }),
    ];

    const stats = farmStats({
      runners: fleet,
      outcomes: outcomes({ succeeded: 19, retried: 3, failed: 1 }),
      today: { builds: 23, totalSeconds: 5796 },
      prior: { builds: 20, totalSeconds: 5800 },
      cache: { hits: 6864, objects: 8800 },
      since: "2026-09-19T00:00:00.000Z",
      timeZone: "UTC",
      now: NOW,
    });

    expect(stats.runnersOnline.online).toBe(4);
    expect(stats.runnersOnline.total).toBe(5);
    expect(stats.runnersOnline.note).toBe("forge-03 offline · 2h");
    expect(stats.buildsToday.total).toBe(23);
    expect(stats.buildsToday.clean).toBe(19);
    expect(stats.buildsToday.retried).toBe(3);
    expect(stats.buildsToday.failed).toBe(1);
    expect(stats.avgBuildTime.seconds).toBe(252);
    expect(stats.avgBuildTime.deltaVsLastWeek).toBe(-38);
    expect(stats.cacheHitRate.pct).toBe(78);
    expect(stats.cacheHitRate.label).toBe("ccache · per-runner");
  });

  it("publishes the window the day's count was taken over", () => {
    const stats = farmStats({
      runners: [],
      outcomes: outcomes(),
      today: NOTHING,
      prior: NOTHING,
      cache: { hits: 0, objects: 0 },
      since: "2026-09-19T00:00:00.000Z",
      timeZone: "UTC",
      now: NOW,
    });

    expect(stats.buildsToday.since).toBe("2026-09-19T00:00:00.000Z");
    expect(stats.buildsToday.timeZone).toBe("UTC");
  });

  it("gives an empty organization zeros where a count is zero and nulls where nothing was measured", () => {
    // The acceptance criterion, in one payload: **never** `0m 00s` and **never** `0%`.
    const stats = farmStats({
      runners: [],
      outcomes: outcomes(),
      today: NOTHING,
      prior: NOTHING,
      cache: { hits: 0, objects: 0 },
      since: "2026-09-19T00:00:00.000Z",
      timeZone: "UTC",
      now: NOW,
    });

    expect(stats.runnersOnline).toEqual({ online: 0, total: 0, note: null, offline: null });
    expect(stats.buildsToday.total).toBe(0);
    expect(stats.avgBuildTime.seconds).toBeNull();
    expect(stats.avgBuildTime.deltaVsLastWeek).toBeNull();
    expect(stats.cacheHitRate.pct).toBeNull();
  });
});
