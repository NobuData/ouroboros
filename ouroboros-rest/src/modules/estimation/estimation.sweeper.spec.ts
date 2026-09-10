import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import { JITTER_SPREAD } from "../scheduling/cadence";
import type { EstimationOrchestrator, SweepReport } from "./estimation.orchestrator";
import { EstimationSweeper, SWEEP_TIMEOUT } from "./estimation.sweeper";

/**
 * The recovery loop ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * The same four properties `backlog-sync.scheduler.spec.ts` asserts for its own loop, because
 * it is deliberately the same shape — it does not synchronise, it does not overlap itself, it
 * does not stop quietly, and it does not hold the process open — plus the one this loop owns:
 * it says something only when a sweep found something, and it says something *different* when
 * everything it found was work already in flight.
 *
 * Timers are faked: the real interval is two minutes.
 */

const TWO_MINUTES = 120_000;

const CONFIG = {
  estimationSweepIntervalSeconds: 120,
  estimationStaleSeconds: 600,
} as unknown as AppConfigService;

/** A sweep that found nothing — the healthy answer, and most of these ticks. */
const QUIET: SweepReport = { stale: 0, requeued: 0, inFlight: 0 };

/** A sweep that recovered a row a restart stranded. */
const RECOVERED: SweepReport = { stale: 3, requeued: 2, inFlight: 1 };

/** A sweep whose every row was already being estimated here. */
const ALL_IN_FLIGHT: SweepReport = { stale: 4, requeued: 0, inFlight: 4 };

/** An orchestrator that answers, and records that it was asked. */
function sweeping(report: SweepReport = QUIET) {
  return { sweep: jest.fn<Promise<SweepReport>, unknown[]>().mockResolvedValue(report) };
}

describe("the estimation recovery loop", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SchedulerRegistry();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Build a sweeper over an orchestrator a test drives.
   *
   * @param orchestrator - The stand-in.
   * @returns The sweeper.
   */
  function sweeper(orchestrator: { sweep: jest.Mock }): EstimationSweeper {
    return new EstimationSweeper(
      orchestrator as unknown as EstimationOrchestrator,
      CONFIG,
      registry,
    );
  }

  describe("starting", () => {
    it("books a timer rather than sweeping on boot", async () => {
      const orchestrator = sweeping();
      sweeper(orchestrator).onApplicationBootstrap();

      expect(orchestrator.sweep).not.toHaveBeenCalled();
      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(true);

      await Promise.resolve();
    });

    it("books it inside the jitter window and not on the boundary", async () => {
      const orchestrator = sweeping();
      sweeper(orchestrator).onApplicationBootstrap();

      jest.advanceTimersByTime(TWO_MINUTES * (1 - JITTER_SPREAD) - 1);
      expect(orchestrator.sweep).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(TWO_MINUTES * 2 * JITTER_SPREAD + 1);

      expect(orchestrator.sweep).toHaveBeenCalledTimes(1);
    });

    it("registers exactly one timeout under one name", async () => {
      const loop = sweeper(sweeping());
      loop.onApplicationBootstrap();

      await loop.tick();

      expect(registry.getTimeouts()).toEqual([SWEEP_TIMEOUT]);
    });

    it("does not hold the process open", () => {
      // The HTTP server is what keeps this service alive; a referenced timer in a suite that
      // built an application and never listened is a worker that hangs after it has passed.
      const loop = sweeper(sweeping());
      loop.onApplicationBootstrap();

      const timer = registry.getTimeout(SWEEP_TIMEOUT) as { hasRef?: () => boolean };

      expect(timer.hasRef?.()).toBe(false);
    });
  });

  describe("running", () => {
    it("books the next sweep only once the previous has settled", async () => {
      let settle: () => void = () => undefined;
      const orchestrator = {
        sweep: jest.fn().mockReturnValue(
          new Promise<SweepReport>((resolve) => {
            settle = () => {
              resolve(QUIET);
            };
          }),
        ),
      };
      const loop = sweeper(orchestrator);

      const running = loop.tick();

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(false);

      settle();
      await running;

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(true);
    });

    it("keeps sweeping after one that failed", async () => {
      // A database that is briefly down should cost a sweep, not the loop: a caught error that
      // stopped rescheduling would leave a process that looks healthy and has silently stopped
      // recovering anything.
      const orchestrator = {
        sweep: jest
          .fn()
          .mockRejectedValueOnce(new Error("the pool is exhausted"))
          .mockResolvedValue(QUIET),
      };
      const loop = sweeper(orchestrator);

      await loop.tick();

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(true);

      await jest.advanceTimersByTimeAsync(TWO_MINUTES * (1 + JITTER_SPREAD));

      expect(orchestrator.sweep.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("what it says", () => {
    it("is silent about a sweep that found nothing", async () => {
      // A healthy service sweeps up nothing, over and over.
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const warned = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await sweeper(sweeping()).tick();

      expect(logged).not.toHaveBeenCalled();
      expect(warned).not.toHaveBeenCalled();
    });

    it("says what it recovered", async () => {
      const logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

      await sweeper(sweeping(RECOVERED)).tick();

      expect(logged).toHaveBeenCalledWith(expect.stringContaining("re-queued 2 stranded issue(s)"));
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("1 already in flight"));
    });

    it("warns when everything it found was already in flight", async () => {
      // Which means the threshold is set below how long an estimate legitimately takes — a
      // misconfiguration nothing else in the service would ever report.
      const warned = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      await sweeper(sweeping(ALL_IN_FLIGHT)).tick();

      expect(warned).toHaveBeenCalledWith(expect.stringContaining("OURO_ESTIMATION_STALE_SECONDS"));
      expect(warned).toHaveBeenCalledWith(expect.stringContaining("600s"));
    });
  });

  describe("shutting down", () => {
    it("clears a pending timer", () => {
      const loop = sweeper(sweeping());
      loop.onApplicationBootstrap();

      loop.onApplicationShutdown();

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(false);
    });

    it("books nothing after a sweep that was already running", async () => {
      // The race a shutdown mid-sweep would otherwise leave: a live timer behind a destroyed
      // injector.
      const loop = sweeper(sweeping());

      const running = loop.tick();
      loop.onApplicationShutdown();
      await running;

      expect(registry.doesExist("timeout", SWEEP_TIMEOUT)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("is safe when no timer was ever booked", () => {
      expect(() => sweeper(sweeping()).onApplicationShutdown()).not.toThrow();
    });
  });
});
