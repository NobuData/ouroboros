import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { JITTER_SPREAD } from "../scheduling/cadence";
import type { ControlsService } from "./controls.service";
import {
  LIVE_LIMITS_SWEEP_SECONDS,
  LIVE_LIMITS_SWEEP_TIMEOUT,
  LiveLimitsSweeper,
} from "./live-limits.sweeper";

describe("the live-run limits loop (#1312)", () => {
  let registry: SchedulerRegistry;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SchedulerRegistry();
    log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** A sweeper over a service stand-in. */
  function sweeper(enforceLiveLimits: jest.Mock) {
    return new LiveLimitsSweeper({ enforceLiveLimits } as unknown as ControlsService, registry);
  }

  it("books its first cycle a jittered minute after bootstrap, not immediately", () => {
    const enforce = jest.fn().mockResolvedValue(0);
    const loop = sweeper(enforce);

    loop.onApplicationBootstrap();

    expect(enforce).not.toHaveBeenCalled();
    expect(registry.doesExist("timeout", LIVE_LIMITS_SWEEP_TIMEOUT)).toBe(true);

    jest.advanceTimersByTime(LIVE_LIMITS_SWEEP_SECONDS * 1000 * (1 + JITTER_SPREAD));

    expect(enforce).toHaveBeenCalledTimes(1);
    loop.onApplicationShutdown();
  });

  it("says nothing when no run passed a limit, and says so when one did", async () => {
    const enforce = jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const loop = sweeper(enforce);

    await loop.tick();
    expect(log).not.toHaveBeenCalled();

    await loop.tick();
    expect(log).toHaveBeenCalledWith("Live-run limits: 1 run(s) aborted past a limit.");

    loop.onApplicationShutdown();
  });

  it("loses a cycle, not the loop, when the database is unreachable", async () => {
    const loop = sweeper(jest.fn().mockRejectedValue(new Error("connection refused")));

    await loop.tick();

    expect(error).toHaveBeenCalled();
    expect(registry.doesExist("timeout", LIVE_LIMITS_SWEEP_TIMEOUT)).toBe(true);

    loop.onApplicationShutdown();
  });

  it("clears its timer on shutdown and books nothing afterwards", async () => {
    const loop = sweeper(jest.fn().mockResolvedValue(0));

    loop.onApplicationBootstrap();
    loop.onApplicationShutdown();

    expect(registry.doesExist("timeout", LIVE_LIMITS_SWEEP_TIMEOUT)).toBe(false);

    await loop.tick();

    expect(registry.doesExist("timeout", LIVE_LIMITS_SWEEP_TIMEOUT)).toBe(false);
  });
});
