import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../../config/config.service";
import { JITTER_SPREAD } from "../../scheduling/cadence";
import { ROLLUP_TIMEOUT, RollupScheduler } from "./rollup.scheduler";
import type { RollupReport, RollupService } from "./rollup.service";

/**
 * The rollup loop (BI.2, #433) — the shape every loop here has: it waits a jittered interval, it
 * does not overlap itself, a failed tick costs a tick rather than the loop, it stops on shutdown,
 * and it speaks only when something failed or a backfill moved.
 */

const HOUR = 3_600_000;
const CONFIG = { insightsRollupIntervalSeconds: 3600 } as unknown as AppConfigService;

const QUIET: RollupReport = {
  today: "2026-09-01",
  outcomes: [
    { organizationId: "org", family: "throughput", status: "succeeded", backfilledDays: 0 },
  ],
};

/**
 * A service whose pass answers a report.
 *
 * @param report - What the pass answers.
 * @returns The stand-in.
 */
function rolling(report: RollupReport = QUIET) {
  return { tick: jest.fn<Promise<RollupReport>, unknown[]>().mockResolvedValue(report) };
}

describe("the rollup loop", () => {
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
  });

  /**
   * A scheduler over a stand-in service.
   *
   * @param service - The stand-in.
   * @returns The scheduler.
   */
  function scheduler(service: ReturnType<typeof rolling>): RollupScheduler {
    return new RollupScheduler(service as unknown as RollupService, CONFIG, registry);
  }

  it("runs nothing at boot and the first pass within a jittered hour", async () => {
    const service = rolling();
    const loop = scheduler(service);

    loop.onApplicationBootstrap();
    expect(registry.doesExist("timeout", ROLLUP_TIMEOUT)).toBe(true);

    await jest.advanceTimersByTimeAsync(HOUR * (1 - JITTER_SPREAD) - 1);
    expect(service.tick).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(HOUR * 2 * JITTER_SPREAD + 2);
    expect(service.tick).toHaveBeenCalledTimes(1);

    loop.onApplicationShutdown();
  });

  it("joins a pass in flight rather than starting a second", async () => {
    let release: (report: RollupReport) => void = () => undefined;
    const service = {
      tick: jest.fn(() => new Promise<RollupReport>((resolve) => (release = resolve))),
    };
    const loop = scheduler(service);

    const first = loop.tick();
    const second = loop.tick();

    release(QUIET);
    await Promise.all([first, second]);

    expect(service.tick).toHaveBeenCalledTimes(1);
    loop.onApplicationShutdown();
  });

  it("keeps going after a pass that could not start, and says so", async () => {
    const service = rolling();

    service.tick.mockRejectedValueOnce(new Error("database unreachable"));

    const loop = scheduler(service);

    await loop.tick();

    expect(error).toHaveBeenCalledWith(
      "Insights rollup could not start; retrying next tick.",
      expect.stringContaining("database unreachable"),
    );
    expect(registry.doesExist("timeout", ROLLUP_TIMEOUT)).toBe(true);
    loop.onApplicationShutdown();
  });

  it("is silent on a quiet pass, and speaks for failures and backfill progress", async () => {
    const quiet = scheduler(rolling());

    await quiet.tick();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    quiet.onApplicationShutdown();

    const busy = scheduler(
      rolling({
        today: "2026-09-01",
        outcomes: [
          { organizationId: "org", family: "throughput", status: "succeeded", backfilledDays: 31 },
          {
            organizationId: "org",
            family: "dora",
            status: "failed",
            backfilledDays: 0,
            error: "boom",
          },
        ],
      }),
    );

    await busy.tick();
    expect(error).toHaveBeenCalledWith("Insights rollup dora failed for workspace org: boom");
    expect(log).toHaveBeenCalledWith(
      "Insights rollup (2026-09-01): backfilled 31 family-day(s) across 1 workspace(s).",
    );
    busy.onApplicationShutdown();
  });

  it("books nothing after shutdown, and clears the pending timer", async () => {
    const loop = scheduler(rolling());

    loop.onApplicationBootstrap();
    loop.onApplicationShutdown();
    expect(registry.doesExist("timeout", ROLLUP_TIMEOUT)).toBe(false);

    await loop.tick();
    expect(registry.doesExist("timeout", ROLLUP_TIMEOUT)).toBe(false);
  });
});
