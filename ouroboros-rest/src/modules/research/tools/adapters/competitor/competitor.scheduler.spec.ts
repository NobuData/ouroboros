import type { ClaimedWatch } from "../../../competitors/competitors.repository";
import { CHANGELOG_URL, watch } from "./competitor.recordings.fixture";
import { CLAIM_LEASE_MS, CompetitorWatchScheduler } from "./competitor.scheduler";
import type { CheckResult } from "./competitor.snapshotter";

const NOW = new Date("2026-09-01T06:00:00Z");

/** A scheduler over a recorded queue of due watches. */
function build(
  due: ClaimedWatch[],
  options: { tickMs?: number; batch?: number; failCheck?: string } = {},
) {
  const claims: { now: Date; limit: number; leaseUntil: Date }[] = [];
  const checked: string[] = [];
  const scheduler = new CompetitorWatchScheduler({
    claim: (now, limit, leaseUntil) => {
      claims.push({ now, limit, leaseUntil });
      return Promise.resolve(due.splice(0, limit));
    },
    check: (claimed) => {
      if (claimed.id === options.failCheck) return Promise.reject(new Error("database went away"));
      checked.push(claimed.id);
      return Promise.resolve({ outcome: "unchanged" } as CheckResult);
    },
    tickMs: options.tickMs ?? 60_000,
    batch: options.batch ?? 2,
    now: () => NOW,
    random: () => 0.5,
  });
  return { scheduler, claims, checked };
}

const due = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    watch({
      id: `w-${String(index)}`,
      sourceKind: "changelog",
      url: `${CHANGELOG_URL}/${String(index)}`,
    }),
  );

describe("the competitor watch scheduler", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("claims at most a batch per tick, under a lease, so a restart cannot stampede", async () => {
    const queue = due(5);
    const { scheduler, claims, checked } = build(queue, { batch: 2 });

    expect(await scheduler.tick()).toBe(2);
    expect(claims[0]).toEqual({
      now: NOW,
      limit: 2,
      leaseUntil: new Date(NOW.getTime() + CLAIM_LEASE_MS),
    });
    expect(checked).toEqual(["w-0", "w-1"]);
    expect(queue).toHaveLength(3);
  });

  it("goes on after one watch's check fails; the failed claim lapses on its own", async () => {
    const { scheduler, checked } = build(due(3), { batch: 3, failCheck: "w-1" });

    expect(await scheduler.tick()).toBe(2);
    expect(checked).toEqual(["w-0", "w-2"]);
  });

  it("survives a claim that could not be made", async () => {
    const scheduler = new CompetitorWatchScheduler({
      claim: () => Promise.reject(new Error("no database")),
      check: () => Promise.reject(new Error("unreachable")),
      tickMs: 60_000,
      batch: 10,
    });

    expect(await scheduler.tick()).toBe(0);
  });

  it("does nothing at boot — the first tick is a jittered interval away", async () => {
    jest.useFakeTimers();
    const { scheduler, claims } = build(due(1), { tickMs: 60_000 });

    scheduler.onApplicationBootstrap();
    expect(claims).toHaveLength(0);

    // random() = 0.5 puts the jittered interval at exactly the tick.
    await jest.advanceTimersByTimeAsync(59_999);
    expect(claims).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(claims).toHaveLength(1);

    scheduler.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(600_000);
    expect(claims).toHaveLength(1);
  });

  it("stays off when the tick is 0", async () => {
    jest.useFakeTimers();
    const { scheduler, claims } = build(due(1), { tickMs: 0 });

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3_600_000);

    expect(claims).toHaveLength(0);
  });

  it("joins a tick already running instead of starting a second", async () => {
    const { scheduler, claims } = build(due(4), { batch: 2 });

    const [first, second] = await Promise.all([scheduler.tick(), scheduler.tick()]);

    expect(first).toBe(2);
    expect(second).toBe(2);
    expect(claims).toHaveLength(1);
  });
});
