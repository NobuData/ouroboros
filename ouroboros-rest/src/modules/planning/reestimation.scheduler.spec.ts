import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import type { NightlySlot } from "../scheduling/cadence";
import type { ReestimationJob, ReestimationOutcome } from "./reestimation.job";
import { REESTIMATION_TIMEOUT, ReestimationScheduler } from "./reestimation.scheduler";

/**
 * The nightly loop (AL.5, #281): it books a jittered slot rather than running at boot, it runs the
 * night it booked and then books the next, a failed night costs a night rather than the loop, and a
 * shutdown clears the timer. Timers and the clock are faked.
 */

const CONFIG = {
  reestimationHourUtc: 2,
  reestimationJitterMinutes: 30,
} as unknown as AppConfigService;

const MINUTE = 60_000;

describe("the nightly re-estimation loop", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-09-17T01:00:00.000Z") });
    registry = new SchedulerRegistry();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * A scheduler over a job a test drives.
   *
   * @param run - What the job does.
   * @returns The scheduler and the job's mock.
   */
  function build(
    run: (slot: NightlySlot) => Promise<ReestimationOutcome> = async (slot) =>
      Promise.resolve({ kind: "skipped", night: slot.night }),
  ) {
    const job = { run: jest.fn(run) };

    return {
      scheduler: new ReestimationScheduler(job as unknown as ReestimationJob, CONFIG, registry),
      job,
    };
  }

  it("books tonight's slot on boot rather than running", () => {
    const { scheduler, job } = build();

    scheduler.onApplicationBootstrap();

    expect(job.run).not.toHaveBeenCalled();
    expect(registry.doesExist("timeout", REESTIMATION_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
  });

  it("does not fire before the hour, and fires inside the jitter window after it", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    const { scheduler, job } = build();

    scheduler.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(60 * MINUTE - 1);
    expect(job.run).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(15 * MINUTE + 1);
    expect(job.run).toHaveBeenCalledTimes(1);
    expect(job.run).toHaveBeenCalledWith({
      night: "2026-09-17",
      at: new Date("2026-09-17T02:00:00.000Z"),
    });

    scheduler.onApplicationShutdown();
  });

  it("books the next night after a run, and runs it a day later", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const { scheduler, job } = build();

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(60 * MINUTE);
    expect(job.run).toHaveBeenCalledTimes(1);
    expect(registry.doesExist("timeout", REESTIMATION_TIMEOUT)).toBe(true);

    await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);
    expect(job.run).toHaveBeenCalledTimes(2);
    expect(job.run.mock.calls[1]?.[0].night).toBe("2026-09-18");

    scheduler.onApplicationShutdown();
  });

  it("keeps the loop alive after a night that could not start", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const { scheduler, job } = build(async () => Promise.reject(new Error("unreachable")));

    await scheduler.tick({ night: "2026-09-17", at: new Date("2026-09-17T02:00:00.000Z") });

    expect(job.run).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(registry.doesExist("timeout", REESTIMATION_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
  });

  it("holds at most one timer under its name", async () => {
    const { scheduler } = build();

    scheduler.onApplicationBootstrap();
    await scheduler.tick({ night: "2026-09-17", at: new Date("2026-09-17T02:00:00.000Z") });

    expect(registry.getTimeouts()).toEqual([REESTIMATION_TIMEOUT]);

    scheduler.onApplicationShutdown();
  });

  it("clears its timer on shutdown and books nothing more", async () => {
    const { scheduler } = build();

    scheduler.onApplicationBootstrap();
    scheduler.onApplicationShutdown();

    expect(registry.doesExist("timeout", REESTIMATION_TIMEOUT)).toBe(false);

    await scheduler.tick({ night: "2026-09-17", at: new Date("2026-09-17T02:00:00.000Z") });

    expect(registry.doesExist("timeout", REESTIMATION_TIMEOUT)).toBe(false);
  });
});
