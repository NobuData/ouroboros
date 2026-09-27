import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import {
  FLAKE_RESCORE_JITTER_MINUTES,
  FLAKE_RESCORE_TIMEOUT,
  FlakeRescoreScheduler,
} from "./flake-rescore.scheduler";
import type { FlakeScorerService, RescoreReport } from "./flake-scorer.service";

/**
 * The nightly flake re-score loop (AT.3, #331): it books a jittered slot rather than running at
 * boot, runs the night and books the next, never overlaps itself, survives a night that could not
 * start, and clears its timer on shutdown. Timers and the clock are faked.
 */

const CONFIG = { flakeRescoreHourUtc: 3 } as unknown as AppConfigService;

const MINUTE = 60_000;

const QUIET: RescoreReport = { formulaVersion: 1, cap: 2000, workspaces: [] };

describe("the nightly flake re-score loop", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-09-27T01:00:00.000Z") });
    registry = new SchedulerRegistry();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * A scheduler over a scorer a test drives.
   *
   * @param rescoreAll - What a night does.
   * @returns The scheduler and the scorer's mock.
   */
  function build(rescoreAll: () => Promise<RescoreReport> = () => Promise.resolve(QUIET)) {
    const scorer = { rescoreAll: jest.fn(rescoreAll) };

    return {
      scheduler: new FlakeRescoreScheduler(
        scorer as unknown as FlakeScorerService,
        CONFIG,
        registry,
      ),
      scorer,
    };
  }

  it("books tonight's slot on boot rather than running", () => {
    const { scheduler, scorer } = build();

    scheduler.onApplicationBootstrap();

    expect(scorer.rescoreAll).not.toHaveBeenCalled();
    expect(registry.doesExist("timeout", FLAKE_RESCORE_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
  });

  it("does not fire before the hour, and fires inside the jitter window after it", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    const { scheduler, scorer } = build();

    scheduler.onApplicationBootstrap();

    // 01:00 → 03:00 is two hours; half the window after it is the jittered slot.
    await jest.advanceTimersByTimeAsync(120 * MINUTE - 1);
    expect(scorer.rescoreAll).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync((FLAKE_RESCORE_JITTER_MINUTES / 2) * MINUTE + 1);
    expect(scorer.rescoreAll).toHaveBeenCalledTimes(1);

    scheduler.onApplicationShutdown();
  });

  it("jitters the slot across the window — the ends of the window differ", async () => {
    const early = build();

    jest.spyOn(Math, "random").mockReturnValue(0);
    early.scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(120 * MINUTE);
    expect(early.scorer.rescoreAll).toHaveBeenCalledTimes(1);
    early.scheduler.onApplicationShutdown();

    jest.setSystemTime(new Date("2026-09-27T01:00:00.000Z"));
    registry = new SchedulerRegistry();
    const late = build();

    jest.spyOn(Math, "random").mockReturnValue(0.999);
    late.scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(120 * MINUTE);
    expect(late.scorer.rescoreAll).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(FLAKE_RESCORE_JITTER_MINUTES * MINUTE);
    expect(late.scorer.rescoreAll).toHaveBeenCalledTimes(1);
    late.scheduler.onApplicationShutdown();
  });

  it("books the next night after a run, and runs it a day later", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const { scheduler, scorer } = build();

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(120 * MINUTE);
    expect(scorer.rescoreAll).toHaveBeenCalledTimes(1);
    expect(registry.doesExist("timeout", FLAKE_RESCORE_TIMEOUT)).toBe(true);

    await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);
    expect(scorer.rescoreAll).toHaveBeenCalledTimes(2);

    scheduler.onApplicationShutdown();
  });

  it("joins a pass already running rather than starting a second", async () => {
    let finish: (report: RescoreReport) => void = () => undefined;
    const { scheduler, scorer } = build(
      () =>
        new Promise<RescoreReport>((resolve) => {
          finish = resolve;
        }),
    );

    const first = scheduler.tick();
    const second = scheduler.tick();

    finish(QUIET);
    await Promise.all([first, second]);

    expect(scorer.rescoreAll).toHaveBeenCalledTimes(1);

    scheduler.onApplicationShutdown();
  });

  it("logs a night's totals, and is silent when there was nothing to re-score", async () => {
    const { scheduler } = build(() =>
      Promise.resolve({
        formulaVersion: 1,
        cap: 2000,
        workspaces: [
          {
            organizationId: "org-a",
            runId: "run-a",
            status: "complete",
            casesScored: 12,
            stateChanges: 1,
            candidates: [],
          },
          {
            organizationId: "org-b",
            runId: "run-b",
            status: "error",
            casesScored: 0,
            stateChanges: 0,
            candidates: [],
            error: "Error: timeout",
          },
        ],
      }),
    );

    await scheduler.tick();

    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "Flake re-score (formula v1, cap 2000): 2 workspace(s), 12 case(s) scored, " +
        "1 state change(s), 0 candidate(s); 1 failed.",
    );

    jest.mocked(Logger.prototype.log).mockClear();
    await build().scheduler.tick();
    expect(Logger.prototype.log).not.toHaveBeenCalled();

    scheduler.onApplicationShutdown();
  });

  it("keeps the loop alive after a night that could not start", async () => {
    const { scheduler, scorer } = build(() => Promise.reject(new Error("unreachable")));

    await scheduler.tick();

    expect(scorer.rescoreAll).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(registry.doesExist("timeout", FLAKE_RESCORE_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
  });

  it("holds at most one timer under its name", async () => {
    const { scheduler } = build();

    scheduler.onApplicationBootstrap();
    await scheduler.tick();

    expect(registry.getTimeouts()).toEqual([FLAKE_RESCORE_TIMEOUT]);

    scheduler.onApplicationShutdown();
  });

  it("clears its timer on shutdown and books nothing more", async () => {
    const { scheduler } = build();

    scheduler.onApplicationBootstrap();
    scheduler.onApplicationShutdown();

    expect(registry.doesExist("timeout", FLAKE_RESCORE_TIMEOUT)).toBe(false);

    await scheduler.tick();

    expect(registry.doesExist("timeout", FLAKE_RESCORE_TIMEOUT)).toBe(false);
  });
});
