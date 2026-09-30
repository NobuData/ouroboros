import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import { REPO_MAP_JITTER_MINUTES, REPO_MAP_TIMEOUT, RepoMapScheduler } from "./repo-map.scheduler";
import type { RepoMapReport } from "./repo-map.resources";
import type { RepoMapService } from "./repo-map.service";

/**
 * The nightly repo-map generator loop (#415): it books a jittered slot at `OURO_REPO_MAP_HOUR_UTC`
 * rather than running at boot, runs the night and books the next, never overlaps itself, survives
 * a night that could not start, and clears its timer on shutdown.
 */

const CONFIG = { repoMapHourUtc: 4 } as unknown as AppConfigService;

const MINUTE = 60_000;

describe("the nightly repo-map generator loop", () => {
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
   * A scheduler over a generator a test drives.
   *
   * @param generateAll - What a night does.
   * @returns The scheduler and the generator's mock.
   */
  function build(generateAll: () => Promise<RepoMapReport[]> = () => Promise.resolve([])) {
    const generator = { generateAll: jest.fn(generateAll) };

    return {
      scheduler: new RepoMapScheduler(generator as unknown as RepoMapService, CONFIG, registry),
      generator,
    };
  }

  it("books tonight's slot on boot rather than running", () => {
    const { scheduler, generator } = build();

    scheduler.onApplicationBootstrap();

    expect(generator.generateAll).not.toHaveBeenCalled();
    expect(registry.doesExist("timeout", REPO_MAP_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
    expect(registry.doesExist("timeout", REPO_MAP_TIMEOUT)).toBe(false);
  });

  it("fires inside the jitter window after the hour, with the pass's instant", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    const { scheduler, generator } = build();

    scheduler.onApplicationBootstrap();

    // 01:00 → 04:00 is three hours; half the window after it is the jittered slot.
    await jest.advanceTimersByTimeAsync(180 * MINUTE - 1);
    expect(generator.generateAll).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync((REPO_MAP_JITTER_MINUTES / 2) * MINUTE + 1);
    expect(generator.generateAll).toHaveBeenCalledTimes(1);
    expect(generator.generateAll).toHaveBeenCalledWith(new Date("2026-09-27T04:30:00.000Z"));

    // …and the next night a day later.
    await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);
    expect(generator.generateAll).toHaveBeenCalledTimes(2);

    scheduler.onApplicationShutdown();
  });

  it("joins a pass already running rather than starting a second", async () => {
    let finish: (reports: RepoMapReport[]) => void = () => undefined;
    const { scheduler, generator } = build(
      () =>
        new Promise<RepoMapReport[]>((resolve) => {
          finish = resolve;
        }),
    );

    const first = scheduler.tick();
    const second = scheduler.tick();

    finish([]);
    await Promise.all([first, second]);

    expect(generator.generateAll).toHaveBeenCalledTimes(1);

    scheduler.onApplicationShutdown();
  });

  it("keeps the loop alive after a night that could not start", async () => {
    const { scheduler } = build(() => Promise.reject(new Error("unreachable")));

    await scheduler.tick();

    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(registry.doesExist("timeout", REPO_MAP_TIMEOUT)).toBe(true);

    scheduler.onApplicationShutdown();
  });

  it("books nothing once the application is shutting down", async () => {
    const { scheduler } = build();

    scheduler.onApplicationShutdown();
    await scheduler.tick();

    expect(registry.doesExist("timeout", REPO_MAP_TIMEOUT)).toBe(false);
  });
});
