import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import {
  FACT_SWEEP_JITTER_MINUTES,
  FACT_SWEEP_TIMEOUT,
  FactSweepScheduler,
} from "./facts.scheduler";
import type { FactSweepService, SweepReport } from "./facts.sweep";

/**
 * The nightly fact staleness sweep loop (#411): it books a jittered slot at
 * `OURO_FACT_SWEEP_HOUR_UTC` rather than running at boot, runs the night and books the next, never
 * overlaps itself, survives a night that could not start, and clears its timer on shutdown.
 */

const CONFIG = { factSweepHourUtc: 4 } as unknown as AppConfigService;

const MINUTE = 60_000;

describe("the nightly fact staleness sweep loop", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-09-27T01:00:00.000Z") });
    registry = new SchedulerRegistry();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * A scheduler over a sweep a test drives.
   *
   * @param sweepAll - What a night does.
   * @returns The scheduler and the sweep's mock.
   */
  function build(sweepAll: () => Promise<SweepReport[]> = () => Promise.resolve([])) {
    const sweep = { sweepAll: jest.fn(sweepAll) };

    return {
      scheduler: new FactSweepScheduler(sweep as unknown as FactSweepService, CONFIG, registry),
      sweep,
    };
  }

  it("books tonight's slot on boot rather than running", () => {
    const { scheduler, sweep } = build();

    scheduler.onApplicationBootstrap();

    expect(sweep.sweepAll).not.toHaveBeenCalled();
    expect(registry.doesExist("timeout", FACT_SWEEP_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
    expect(registry.doesExist("timeout", FACT_SWEEP_TIMEOUT)).toBe(false);
  });

  it("fires inside the jitter window after the hour, with the pass's instant", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    const { scheduler, sweep } = build();

    scheduler.onApplicationBootstrap();

    // 01:00 → 04:00 is three hours; half the window after it is the jittered slot.
    await jest.advanceTimersByTimeAsync(180 * MINUTE - 1);
    expect(sweep.sweepAll).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync((FACT_SWEEP_JITTER_MINUTES / 2) * MINUTE + 1);
    expect(sweep.sweepAll).toHaveBeenCalledTimes(1);
    expect(sweep.sweepAll).toHaveBeenCalledWith(new Date("2026-09-27T04:30:00.000Z"));

    // …and the next night a day later.
    await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);
    expect(sweep.sweepAll).toHaveBeenCalledTimes(2);

    scheduler.onApplicationShutdown();
  });

  it("joins a pass already running rather than starting a second", async () => {
    let finish: (reports: SweepReport[]) => void = () => undefined;
    const { scheduler, sweep } = build(
      () =>
        new Promise<SweepReport[]>((resolve) => {
          finish = resolve;
        }),
    );

    const first = scheduler.tick();
    const second = scheduler.tick();

    finish([]);
    await Promise.all([first, second]);

    expect(sweep.sweepAll).toHaveBeenCalledTimes(1);

    scheduler.onApplicationShutdown();
  });

  it("keeps the loop alive after a night that could not start", async () => {
    const { scheduler } = build(() => Promise.reject(new Error("unreachable")));

    await scheduler.tick();

    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(registry.doesExist("timeout", FACT_SWEEP_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
  });

  it("books nothing once the application is shutting down", async () => {
    const { scheduler } = build();

    scheduler.onApplicationShutdown();
    await scheduler.tick();

    expect(registry.doesExist("timeout", FACT_SWEEP_TIMEOUT)).toBe(false);
  });
});
