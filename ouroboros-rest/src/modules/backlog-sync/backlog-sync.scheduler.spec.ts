import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import { JITTER_SPREAD } from "../scheduling/cadence";
import { BacklogSyncScheduler, SYNC_TIMEOUT } from "./backlog-sync.scheduler";
import type { BacklogSyncService } from "./backlog-sync.service";
import { CONTINUATION_DELAY_MS } from "./cadence";
import type { SyncCycleReport } from "./sync.report";

/**
 * The loop — the three properties `provider-health.scheduler.spec.ts` asserts for the health
 * sweep, plus the one that is this loop's own.
 *
 *   * **It does not synchronise.** Every delay, the first one included, is jittered, so a
 *     fleet of self-hosted instances restarted together does not arrive at github.com in the
 *     same second forever.
 *   * **It does not overlap itself.** Two cycles in flight would walk the same repositories
 *     twice, spend one token's budget twice for one answer, and race each other's upserts.
 *   * **It does not stop quietly.** A cycle that threw costs a cycle; a cycle that threw and
 *     stopped rescheduling would leave a process that looks healthy and has silently stopped
 *     watching anything.
 *   * **A cycle that left known work behind comes back in a second**, which is what makes a
 *     cold import of a large backlog several quick cycles rather than an afternoon.
 *
 * Timers are faked: the real interval is five minutes.
 */

const FIVE_MINUTES = 300_000;

const CONFIG = { backlogSyncIntervalSeconds: 300 } as unknown as AppConfigService;

/** A cycle that polled nothing — the quiet answer most of these assertions do not care about. */
const QUIET: SyncCycleReport = {
  startedAt: new Date("2026-09-08T10:00:00.000Z"),
  organizations: [],
  pending: false,
};

/** A cycle that stopped at the per-poll cap, with a page still waiting. */
const PENDING: SyncCycleReport = {
  ...QUIET,
  organizations: [
    {
      organizationId: "org-backlog",
      repositories: [
        {
          organizationId: "org-backlog",
          githubRepoId: "dfff0000-0000-0000-0000-00000000000a",
          repository: "acme-robotics/helios-firmware",
          imported: 500,
          updated: 0,
          unchanged: 0,
          pullRequests: 0,
          unusable: 0,
          enqueued: 500,
          capped: true,
        },
      ],
    },
  ],
  pending: true,
};

/** A sync that answers, and records that it was asked. */
function syncing(report: SyncCycleReport = QUIET) {
  return { cycle: jest.fn<Promise<SyncCycleReport>, unknown[]>().mockResolvedValue(report) };
}

describe("the backlog sync loop", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SchedulerRegistry();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Build a scheduler over a cycle a test drives.
   *
   * @param sync - The stand-in for the service.
   * @returns The scheduler.
   */
  function scheduler(sync: { cycle: jest.Mock }): BacklogSyncScheduler {
    return new BacklogSyncScheduler(sync as unknown as BacklogSyncService, CONFIG, registry);
  }

  describe("starting", () => {
    it("books a timer rather than polling on boot", async () => {
      // A fleet restarted together must not converge, and a first cycle during bootstrap would
      // open sockets while other modules are still initialising.
      const sync = syncing();
      scheduler(sync).onApplicationBootstrap();

      expect(sync.cycle).not.toHaveBeenCalled();
      expect(registry.doesExist("timeout", SYNC_TIMEOUT)).toBe(true);

      await Promise.resolve();
    });

    it("books it inside the jitter window and not on the boundary", async () => {
      const sync = syncing();
      scheduler(sync).onApplicationBootstrap();

      // The clock is what can say when a timer fires; nothing fires before the bottom of the
      // window, and everything has fired by the top of it.
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(FIVE_MINUTES * (1 - JITTER_SPREAD) - 1);
      expect(sync.cycle).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(FIVE_MINUTES * 2 * JITTER_SPREAD + 1);

      expect(sync.cycle).toHaveBeenCalledTimes(1);
    });

    it("registers exactly one timeout under one name", async () => {
      const loop = scheduler(syncing());
      loop.onApplicationBootstrap();

      await loop.tick();

      expect(registry.getTimeouts()).toEqual([SYNC_TIMEOUT]);
    });
  });

  describe("running", () => {
    it("books the next cycle only once the previous has settled", async () => {
      let settle: () => void = () => undefined;
      const sync = {
        cycle: jest.fn().mockReturnValue(
          new Promise<SyncCycleReport>((resolve) => {
            settle = () => {
              resolve(QUIET);
            };
          }),
        ),
      };
      const loop = scheduler(sync);

      const running = loop.tick();

      // Mid-cycle: nothing is booked, so a long cycle delays its successor rather than
      // stacking a second walk on top of it.
      expect(registry.doesExist("timeout", SYNC_TIMEOUT)).toBe(false);

      settle();
      await running;

      expect(registry.doesExist("timeout", SYNC_TIMEOUT)).toBe(true);
    });

    it("comes back in a second when the cycle left known work behind", async () => {
      // A cold import of a large backlog is several cycles; making each wait five minutes for
      // a page already known to exist would turn a first sync into an afternoon.
      const sync = syncing(PENDING);
      const loop = scheduler(sync);

      await loop.tick();

      await jest.advanceTimersByTimeAsync(CONTINUATION_DELAY_MS);

      expect(sync.cycle).toHaveBeenCalledTimes(2);
    });

    it("waits a full jittered interval when every poll finished", async () => {
      const sync = syncing();
      const loop = scheduler(sync);

      await loop.tick();

      await jest.advanceTimersByTimeAsync(CONTINUATION_DELAY_MS);

      // Still one: the second cycle is a jittered five minutes away, not a second.
      expect(sync.cycle).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(FIVE_MINUTES * (1 + JITTER_SPREAD));

      expect(sync.cycle.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("says what a cycle did when it polled something", async () => {
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const loop = scheduler(syncing(PENDING));

      await loop.tick();

      expect(logged).toHaveBeenCalledWith(expect.stringContaining("polled 1 repositories"));
    });

    it("is silent about a cycle that polled nothing", async () => {
      // A background loop that logged every quiet interval is a log nobody reads by day two.
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const loop = scheduler(syncing());

      await loop.tick();

      expect(logged).not.toHaveBeenCalled();
    });
  });

  describe("failing", () => {
    it("loses a cycle rather than the loop", async () => {
      const sync = { cycle: jest.fn().mockRejectedValue(new Error("the database is down")) };
      const loop = scheduler(sync);

      await expect(loop.tick()).resolves.toBeUndefined();
      expect(registry.doesExist("timeout", SYNC_TIMEOUT)).toBe(true);
    });

    it("says so, so a process that has stopped watching is visible", async () => {
      const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const sync = { cycle: jest.fn().mockRejectedValue(new Error("the database is down")) };

      await scheduler(sync).tick();

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("Backlog sync cycle failed"),
        expect.anything(),
      );
    });
  });

  describe("stopping", () => {
    it("clears a pending timer", () => {
      const loop = scheduler(syncing());
      loop.onApplicationBootstrap();

      loop.onApplicationShutdown();

      expect(registry.doesExist("timeout", SYNC_TIMEOUT)).toBe(false);
    });

    it("books nothing after a cycle that was in flight when shutdown began", async () => {
      // The race a background loop leaves behind: a live timer behind a destroyed injector is a
      // query against a drained pool in production, and a worker that never exits in a test.
      const loop = scheduler(syncing());

      const running = loop.tick();
      loop.onApplicationShutdown();
      await running;

      expect(registry.doesExist("timeout", SYNC_TIMEOUT)).toBe(false);
    });

    it("is safe to call when nothing was ever started", () => {
      expect(() => scheduler(syncing()).onApplicationShutdown()).not.toThrow();
    });
  });

  describe("keeping going", () => {
    it("runs cycle after cycle without being asked again", async () => {
      const sync = syncing();
      scheduler(sync).onApplicationBootstrap();

      for (let cycle = 0; cycle < 3; cycle += 1) {
        await jest.advanceTimersByTimeAsync(FIVE_MINUTES * (1 + JITTER_SPREAD));
      }

      // At least three rather than exactly three: each window is longer than the shortest
      // delay the jitter can produce, so a run of short delays legitimately fits an extra
      // cycle in. Pinning it to a count would be pinning it to the jitter itself.
      expect(sync.cycle.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(registry.doesExist("timeout", SYNC_TIMEOUT)).toBe(true);
    });
  });
  describe("being driven by hand", () => {
    /**
     * A cycle that settles only when the test says so.
     *
     * @returns The stand-in sync, and the release.
     */
    function held(): { sync: { cycle: jest.Mock }; settle: () => void } {
      let settle: () => void = () => undefined;
      const sync = {
        cycle: jest.fn().mockReturnValue(
          new Promise<SyncCycleReport>((resolve) => {
            settle = () => {
              resolve(QUIET);
            };
          }),
        ),
      };

      return { sync, settle };
    }

    it("starts a cycle at once rather than waiting for the timer", async () => {
      // M.4's whole point (#113): somebody who has just filed an issue on GitHub should not
      // have to wait out an interval they cannot see.
      const sync = syncing();
      const loop = scheduler(sync);
      loop.onApplicationBootstrap();

      await loop.runNow();

      expect(sync.cycle).toHaveBeenCalledTimes(1);
    });

    it("refuses to start a second cycle while one is running", async () => {
      // The `409` the trigger answers with, as a property of the loop rather than of the
      // endpoint: two cycles walk the same repositories twice and race each other's upserts.
      const { sync, settle } = held();
      const loop = scheduler(sync);

      const first = loop.runNow();

      expect(loop.running()).toBe(true);
      expect(loop.runNow()).toBeUndefined();

      settle();
      await first;

      expect(sync.cycle).toHaveBeenCalledTimes(1);
    });

    it("lets the next one start once the first has settled", async () => {
      const { sync, settle } = held();
      const loop = scheduler(sync);

      const first = loop.runNow();
      settle();
      await first;

      expect(loop.running()).toBe(false);
      expect(loop.runNow()).toBeDefined();
    });

    it("has the timer join a cycle already in flight rather than overlap it", async () => {
      // The other direction, and the one that only exists because there are two callers now:
      // a booked tick that fires mid-trigger must not become a second walk.
      const { sync, settle } = held();
      const loop = scheduler(sync);

      const triggered = loop.runNow();
      const ticked = loop.tick();

      settle();
      await Promise.all([triggered, ticked]);

      expect(sync.cycle).toHaveBeenCalledTimes(1);
    });

    it("reports nothing running before the first cycle and after a failed one", async () => {
      const sync = { cycle: jest.fn().mockRejectedValue(new Error("the database is down")) };
      const loop = scheduler(sync);

      expect(loop.running()).toBe(false);

      await loop.runNow();

      // A cycle that threw is a cycle that finished: leaving the flag set would refuse every
      // trigger from here to the next restart.
      expect(loop.running()).toBe(false);
    });

    it("books the next tick after a manual cycle, exactly as the timer's does", async () => {
      const sync = syncing();
      const loop = scheduler(sync);

      await loop.runNow();

      expect(registry.getTimeouts()).toEqual([SYNC_TIMEOUT]);
    });

    it("leaves no second timer behind when it pre-empts a booked one", async () => {
      // A trigger runs *between* ticks, so the booked timeout is still registered when it
      // starts. Two timers under one name is the invariant that would break.
      const loop = scheduler(syncing());
      loop.onApplicationBootstrap();

      await loop.runNow();

      expect(registry.getTimeouts()).toEqual([SYNC_TIMEOUT]);
      expect(jest.getTimerCount()).toBe(1);
    });
  });
});
