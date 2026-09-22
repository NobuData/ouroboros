import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import { JITTER_SPREAD } from "../scheduling/cadence";
import { CONTROL_SWEEP_TIMEOUT, ControlsSweeper } from "./controls.sweeper";
import type { ControlsService } from "./controls.service";

/**
 * The TTL loop (#306), held to the properties every loop in this service keeps: it waits a
 * jittered interval, it does not stop when a sweep fails, it logs only when a sweep did
 * something, and it clears its timer on shutdown. Timers are faked.
 */

const FIFTEEN_SECONDS = 15_000;
const CONFIG = { runControlSweepSeconds: 15 } as AppConfigService;

describe("the control expiry loop", () => {
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
  function sweeper(sweep: jest.Mock) {
    return new ControlsSweeper({ sweep } as unknown as ControlsService, CONFIG, registry);
  }

  it("books its first sweep a jittered interval after bootstrap, not immediately", () => {
    const sweep = jest.fn().mockResolvedValue(0);
    const loop = sweeper(sweep);

    loop.onApplicationBootstrap();

    expect(sweep).not.toHaveBeenCalled();
    expect(registry.doesExist("timeout", CONTROL_SWEEP_TIMEOUT)).toBe(true);

    jest.advanceTimersByTime(FIFTEEN_SECONDS * (1 + JITTER_SPREAD));

    expect(sweep).toHaveBeenCalledTimes(1);
    loop.onApplicationShutdown();
  });

  it("says nothing when nothing expired, and says so when something did", async () => {
    const sweep = jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    const loop = sweeper(sweep);

    await loop.tick();
    expect(log).not.toHaveBeenCalled();

    await loop.tick();
    expect(log).toHaveBeenCalledWith("Control sweep: 2 control(s) expired unanswered.");

    loop.onApplicationShutdown();
  });

  it("loses a sweep, not the loop, when the database is unreachable", async () => {
    const loop = sweeper(jest.fn().mockRejectedValue(new Error("connection refused")));

    await loop.tick();

    expect(error).toHaveBeenCalled();
    expect(registry.doesExist("timeout", CONTROL_SWEEP_TIMEOUT)).toBe(true);

    loop.onApplicationShutdown();
  });

  it("clears its timer on shutdown and books nothing afterwards", async () => {
    const loop = sweeper(jest.fn().mockResolvedValue(0));

    loop.onApplicationBootstrap();
    loop.onApplicationShutdown();

    expect(registry.doesExist("timeout", CONTROL_SWEEP_TIMEOUT)).toBe(false);

    await loop.tick();

    expect(registry.doesExist("timeout", CONTROL_SWEEP_TIMEOUT)).toBe(false);
  });

  it("tolerates a shutdown with no timer booked", () => {
    expect(() => sweeper(jest.fn()).onApplicationShutdown()).not.toThrow();
  });
});
