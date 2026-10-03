import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import { JITTER_SPREAD } from "../scheduling/cadence";
import type { LifecyclePurge } from "./lifecycle.purge";
import { LIFECYCLE_PURGE_TIMEOUT, LifecyclePurgeScheduler } from "./lifecycle.scheduler";

const HOUR_MS = 3_600_000;
const CONFIG = { lifecyclePurgeSweepSeconds: 3600 } as AppConfigService;

describe("the purge loop (#489)", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SchedulerRegistry();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** A scheduler over a purge stand-in. */
  function loop(sweep: jest.Mock) {
    return new LifecyclePurgeScheduler({ sweep } as unknown as LifecyclePurge, CONFIG, registry);
  }

  it("books its first sweep a jittered interval after bootstrap", () => {
    const sweep = jest.fn().mockResolvedValue([]);
    const scheduler = loop(sweep);

    scheduler.onApplicationBootstrap();

    expect(sweep).not.toHaveBeenCalled();
    jest.advanceTimersByTime(HOUR_MS * (1 + JITTER_SPREAD));
    expect(sweep).toHaveBeenCalledTimes(1);
    scheduler.onApplicationShutdown();
  });

  it("hands the sweep the instant it is judged at", async () => {
    const sweep = jest.fn().mockResolvedValue([]);
    const at = new Date("2026-11-02T00:00:00Z");

    await loop(sweep).tick(at);

    expect(sweep).toHaveBeenCalledWith(at);
  });

  it("keeps the loop alive when a sweep fails", async () => {
    const sweep = jest.fn().mockRejectedValue(new Error("down"));
    const scheduler = loop(sweep);

    await scheduler.tick();

    expect(registry.doesExist("timeout", LIFECYCLE_PURGE_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
    expect(registry.doesExist("timeout", LIFECYCLE_PURGE_TIMEOUT)).toBe(false);
  });

  it("books nothing after shutdown", async () => {
    const scheduler = loop(jest.fn().mockResolvedValue([]));

    scheduler.onApplicationShutdown();
    await scheduler.tick();

    expect(registry.doesExist("timeout", LIFECYCLE_PURGE_TIMEOUT)).toBe(false);
  });
});
