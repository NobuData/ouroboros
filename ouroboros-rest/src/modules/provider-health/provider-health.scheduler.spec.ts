import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import { JITTER_SPREAD } from "./cadence";
import { ProviderHealthScheduler, SWEEP_TIMEOUT } from "./provider-health.scheduler";
import type { ProviderHealthService, SweepReport } from "./provider-health.service";

/**
 * The loop — three properties, each of which is a way a background job goes wrong and is
 * never noticed.
 *
 *   * **It does not synchronise.** Every delay, the first one included, is jittered. A fleet
 *     of self-hosted instances restarted together must not agree on when to knock; see
 *     `cadence.ts` for why that matters to somebody who is not us.
 *   * **It does not overlap itself.** The next delay is booked after the previous sweep has
 *     settled, so a cycle that runs long delays the next rather than stacking on it.
 *   * **It does not stop quietly.** A sweep that threw costs a cycle; a sweep that threw and
 *     stopped rescheduling would leave a process that looks healthy and has silently given up
 *     until somebody restarts it — which is the failure nobody has an alert for.
 *
 * Timers are faked, because the real interval is a minute and a suite that waited for one
 * would be a suite nobody runs.
 */

const MINUTE = 60_000;

const CONFIG = { providerHealthIntervalSeconds: 60 } as unknown as AppConfigService;

const QUIET: SweepReport = { checked: 0, active: 0, failed: 0, skipped: 0, capped: false };

/** A sweep that answers, and records that it was asked. */
function sweeping(report: SweepReport = QUIET) {
  return { sweep: jest.fn<Promise<SweepReport>, unknown[]>().mockResolvedValue(report) };
}

describe("the health sweep loop", () => {
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

  /** Build a scheduler over a sweep a test drives. */
  function scheduler(health: { sweep: jest.Mock }): ProviderHealthScheduler {
    return new ProviderHealthScheduler(
      health as unknown as ProviderHealthService,
      CONFIG,
      registry,
    );
  }

  describe("starting", () => {
    it("books a first tick rather than sweeping at boot", async () => {
      // A fleet coming up together — a rolled deployment, a host reboot, a compose stack —
      // must not converge on one schedule for the rest of its life. The cost is one cycle of
      // honest `unknown` chips, which is what a page should show before anything was checked.
      const health = sweeping();
      scheduler(health).onApplicationBootstrap();

      expect(health.sweep).not.toHaveBeenCalled();
      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(true);

      await jest.advanceTimersByTimeAsync(MINUTE * (1 + JITTER_SPREAD));

      expect(health.sweep).toHaveBeenCalledTimes(1);
    });

    it("books it inside the jitter window and not on the boundary", () => {
      scheduler(sweeping()).onApplicationBootstrap();

      // `jest.getTimerCount()` proves a timer exists; the window is what matters, and the
      // clock is what can say when it fires.
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(MINUTE * (1 - JITTER_SPREAD) - 1);
      expect(jest.getTimerCount()).toBe(1);
    });

    it("registers exactly one timeout under one name", () => {
      scheduler(sweeping()).onApplicationBootstrap();

      expect(registry.getTimeouts()).toEqual([SWEEP_TIMEOUT]);
    });
  });

  describe("running", () => {
    it("books the next tick only after the previous sweep has settled", async () => {
      let settle = (): void => undefined;
      const health = {
        sweep: jest.fn().mockReturnValue(
          new Promise<SweepReport>((resolve) => {
            settle = () => {
              resolve(QUIET);
            };
          }),
        ),
      };
      const loop = scheduler(health);

      const running = loop.tick();

      // Mid-sweep: nothing booked, so two sweeps cannot be in flight against the same rows.
      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(false);

      settle();
      await running;

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(true);
    });

    it("keeps going, cycle after cycle", async () => {
      const health = sweeping();
      scheduler(health).onApplicationBootstrap();

      for (let cycle = 0; cycle < 3; cycle += 1) {
        await jest.advanceTimersByTimeAsync(MINUTE * (1 + JITTER_SPREAD));
      }

      // At least three, rather than exactly three: each window is longer than the shortest
      // delay the jitter can produce, so a run of short delays legitimately fits an extra
      // cycle in. The claim is that the loop keeps going, and pinning it to a count would be
      // pinning it to the jitter this file exists to introduce.
      expect(health.sweep.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(true);
    });

    it("loses a cycle to a failed sweep, and not the loop", async () => {
      // A database that is briefly down should cost a cycle. A caught error that stopped
      // rescheduling would leave a healthy-looking process that has quietly stopped checking.
      const health = { sweep: jest.fn().mockRejectedValue(new Error("the pool is draining")) };
      const loop = scheduler(health);

      await loop.tick();

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(true);
    });

    it("says so where an operator reads it", async () => {
      const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const health = { sweep: jest.fn().mockRejectedValue(new Error("the pool is draining")) };

      await scheduler(health).tick();

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("retrying next cycle") as string,
        expect.any(String) as string,
      );
    });

    it("reports a cycle that did something, and stays quiet about one that did not", async () => {
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const loop = scheduler(sweeping());

      await loop.tick();
      expect(logged).not.toHaveBeenCalled();

      const busy = scheduler(
        sweeping({ checked: 2, active: 1, failed: 1, skipped: 0, capped: false }),
      );
      await busy.tick();

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("checked 2 connections") as string,
      );
    });
  });

  describe("stopping", () => {
    it("clears a pending tick", () => {
      const loop = scheduler(sweeping());
      loop.onApplicationBootstrap();

      loop.onApplicationShutdown();

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("books nothing after a sweep that was already in flight", async () => {
      // The race `app.close()` opens. Without the guard, a live timer is left behind a
      // destroyed injector — in a test run a worker that never exits, in production a query
      // against a drained pool.
      let settle = (): void => undefined;
      const health = {
        sweep: jest.fn().mockReturnValue(
          new Promise<SweepReport>((resolve) => {
            settle = () => {
              resolve(QUIET);
            };
          }),
        ),
      };
      const loop = scheduler(health);

      const running = loop.tick();
      loop.onApplicationShutdown();
      settle();
      await running;

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("is safe to call when nothing was ever started", () => {
      expect(() => {
        scheduler(sweeping()).onApplicationShutdown();
      }).not.toThrow();
    });
  });
});
