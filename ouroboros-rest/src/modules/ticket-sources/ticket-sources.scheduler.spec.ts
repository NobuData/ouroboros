import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import { JITTER_SPREAD } from "../scheduling/cadence";
import { CONTINUATION_DELAY_MS } from "./cadence";
import type { SourceSyncOutcome, SyncCycleReport } from "./sync.report";
import { TICKET_SYNC_TIMEOUT, TicketSourcesScheduler } from "./ticket-sources.scheduler";
import type { TicketSourcesService } from "./ticket-sources.service";

/**
 * The loop ([#139](https://github.com/NobuData/ouroboros/issues/139)) — the four properties
 * `backlog-sync.scheduler.spec.ts` and `provider-health.scheduler.spec.ts` each assert for
 * their own, because the shape is deliberately theirs:
 *
 *   * **It does not synchronise.** Every delay, the first one included, is jittered.
 *   * **It does not overlap itself.** Two cycles in flight would sync the same sources twice,
 *     spend each credential's budget twice for one answer, and race each other's upserts.
 *   * **It does not stop quietly.** A cycle that threw costs a cycle; a cycle that threw and
 *     stopped rescheduling would leave a process that looks healthy and has silently stopped
 *     watching anything.
 *   * **A cycle that left known work behind comes back in a second.**
 *
 * One is this loop's own, and it is about the log: **a cycle that only skipped is silent.**
 * This build registers no provider, so every cycle skips every source — and a scheduler that
 * announced that would fill an operator's log with a release schedule.
 *
 * Timers are faked: the real interval is five minutes.
 */

const FIVE_MINUTES = 300_000;

/** The interval is the backlog sync's; see `ticket-sources.scheduler.ts` on why. */
const CONFIG = { backlogSyncIntervalSeconds: 300 } as unknown as AppConfigService;

/** One outcome, with the zeroes spelled once. */
function outcome(overrides: Partial<SourceSyncOutcome> = {}): SourceSyncOutcome {
  return {
    organizationId: "org-sources",
    sourceId: "b0390000-0000-0000-0000-00000000000a",
    kind: "github",
    displayName: "GitHub · acme-robotics",
    imported: 0,
    updated: 0,
    unchanged: 0,
    skippedClosed: 0,
    enqueued: 0,
    hasMore: false,
    ...overrides,
  };
}

/** A cycle that found no source at all. */
const QUIET: SyncCycleReport = {
  startedAt: new Date("2026-09-12T10:00:00.000Z"),
  sources: [],
  pending: false,
};

/** A cycle in which every source was skipped — this build, with no provider registered. */
const SKIPPED: SyncCycleReport = {
  ...QUIET,
  sources: [outcome({ skipped: "unsupported_kind" })],
};

/** A cycle that polled something and left a page waiting. */
const PENDING: SyncCycleReport = {
  ...QUIET,
  sources: [outcome({ imported: 40, enqueued: 40, hasMore: true })],
  pending: true,
};

/** A cycle in which a source failed. */
const FAILED: SyncCycleReport = {
  ...QUIET,
  sources: [outcome({ failure: { errorClass: "auth", reason: "credentials rejected" } })],
};

/** A sync that answers, and records that it was asked. */
function syncing(report: SyncCycleReport = QUIET) {
  return { cycle: jest.fn<Promise<SyncCycleReport>, unknown[]>().mockResolvedValue(report) };
}

describe("the ticket source sync loop", () => {
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
  function scheduler(sync: { cycle: jest.Mock }): TicketSourcesScheduler {
    return new TicketSourcesScheduler(sync as unknown as TicketSourcesService, CONFIG, registry);
  }

  describe("starting", () => {
    it("books a timer rather than syncing on boot", async () => {
      const sync = syncing();
      scheduler(sync).onApplicationBootstrap();

      expect(sync.cycle).not.toHaveBeenCalled();
      expect(registry.doesExist("timeout", TICKET_SYNC_TIMEOUT)).toBe(true);

      await Promise.resolve();
    });

    it("books it inside the jitter window and not on the boundary", async () => {
      const sync = syncing();
      scheduler(sync).onApplicationBootstrap();

      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(FIVE_MINUTES * (1 - JITTER_SPREAD) - 1);
      expect(sync.cycle).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(FIVE_MINUTES * 2 * JITTER_SPREAD + 1);

      expect(sync.cycle).toHaveBeenCalledTimes(1);
    });

    it("registers exactly one timeout, under a name of its own", async () => {
      // Its own name rather than the backlog sync's: three loops share one registry, and an
      // operator listing it should see three entries rather than two and a collision.
      const loop = scheduler(syncing());
      loop.onApplicationBootstrap();

      await loop.tick();

      expect(registry.getTimeouts()).toEqual([TICKET_SYNC_TIMEOUT]);
      expect(TICKET_SYNC_TIMEOUT).not.toBe("backlog-sync-cycle");
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

      expect(registry.doesExist("timeout", TICKET_SYNC_TIMEOUT)).toBe(false);

      settle();
      await running;

      expect(registry.doesExist("timeout", TICKET_SYNC_TIMEOUT)).toBe(true);
    });

    it("joins a cycle already running rather than starting a second", async () => {
      // Enforced by a held promise rather than implied by there being one loop, because Q.4's
      // manual trigger will be a second caller.
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

      const first = loop.tick();
      const second = loop.tick();

      expect(loop.running()).toBe(true);
      expect(loop.runNow()).toBeUndefined();

      settle();
      await Promise.all([first, second]);

      expect(sync.cycle).toHaveBeenCalledTimes(1);
      expect(loop.running()).toBe(false);
    });

    it("comes back in a second when a provider said there is more", async () => {
      const sync = syncing(PENDING);
      const loop = scheduler(sync);

      await loop.tick();
      await jest.advanceTimersByTimeAsync(CONTINUATION_DELAY_MS);

      expect(sync.cycle).toHaveBeenCalledTimes(2);
    });

    it("waits a full jittered interval when every provider finished", async () => {
      const sync = syncing();
      const loop = scheduler(sync);

      await loop.tick();
      await jest.advanceTimersByTimeAsync(CONTINUATION_DELAY_MS);

      expect(sync.cycle).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(FIVE_MINUTES * (1 + JITTER_SPREAD));

      expect(sync.cycle.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("says what a cycle did when it polled something", async () => {
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

      await scheduler(syncing(PENDING)).tick();

      expect(logged).toHaveBeenCalledWith(expect.stringContaining("polled 1 source(s)"));
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("40 imported"));
    });

    it("says so when a source failed, even though none was polled", async () => {
      // A cycle in which everything failed polled nothing, and *that* is the cycle an operator
      // most needs to see. The threshold is polled-or-failed rather than polled.
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

      await scheduler(syncing(FAILED)).tick();

      expect(logged).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
    });

    it("is silent about a cycle that only skipped, which is every cycle in this build", async () => {
      // `TICKET_SOURCE_PROVIDERS` is empty until Q.3 (#140), so an announcement here would be
      // a log line per interval per deployment saying that a release has not happened.
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

      await scheduler(syncing(SKIPPED)).tick();

      expect(logged).not.toHaveBeenCalled();
    });

    it("is silent about a cycle that found no source", async () => {
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

      await scheduler(syncing()).tick();

      expect(logged).not.toHaveBeenCalled();
    });
  });

  describe("failing", () => {
    it("loses a cycle rather than the loop", async () => {
      const failed = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const sync = { cycle: jest.fn().mockRejectedValue(new Error("database is away")) };
      const loop = scheduler(sync);

      await expect(loop.tick()).resolves.toBeUndefined();

      expect(failed).toHaveBeenCalledWith(
        expect.stringContaining("retrying next cycle"),
        expect.anything(),
      );
      expect(registry.doesExist("timeout", TICKET_SYNC_TIMEOUT)).toBe(true);
    });
  });

  describe("stopping", () => {
    it("clears the timer and books no more", async () => {
      const loop = scheduler(syncing());
      loop.onApplicationBootstrap();

      loop.onApplicationShutdown();

      expect(registry.doesExist("timeout", TICKET_SYNC_TIMEOUT)).toBe(false);

      await loop.tick();

      // The guard that closes the race between a shutdown and a cycle in flight: the cycle
      // finishes, tries to schedule, and finds the loop closed.
      expect(registry.doesExist("timeout", TICKET_SYNC_TIMEOUT)).toBe(false);
    });

    it("is safe to call when nothing was ever booked", () => {
      expect(() => scheduler(syncing()).onApplicationShutdown()).not.toThrow();
    });
  });
});
