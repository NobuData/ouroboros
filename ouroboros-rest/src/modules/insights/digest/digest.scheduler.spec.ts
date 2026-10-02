import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../../config/config.service";
import { RecordingMailer } from "../../mail/mail.fixture";
import { JITTER_SPREAD } from "../../scheduling/cadence";
import type { DigestReport, DigestRunner } from "./digest.runner";
import { DIGEST_TIMEOUT, DigestScheduler } from "./digest.scheduler";

/**
 * The digest loop (BJ.4, #440) — the shape every loop here has, plus one rule of its own: a
 * deployment with no mail server books no timer.
 */

const INTERVAL = 300_000;
const CONFIG = { insightsDigestIntervalSeconds: 300 } as unknown as AppConfigService;
const SLOT = new Date("2026-08-10T09:00:00.000Z");
const QUIET: DigestReport = { outcomes: [], errors: [] };

/**
 * A runner whose pass answers a report.
 *
 * @param report - What the pass answers.
 * @returns The stand-in.
 */
function running(report: DigestReport = QUIET) {
  return {
    tick: jest.fn<Promise<DigestReport>, unknown[]>().mockResolvedValue(report),
    stop: jest.fn(),
  };
}

describe("the digest loop", () => {
  let registry: SchedulerRegistry;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SchedulerRegistry();
    log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * A scheduler over a stand-in runner.
   *
   * @param runner - The stand-in.
   * @param transport - Whether this deployment can send mail.
   * @returns The scheduler.
   */
  function scheduler(
    runner: ReturnType<typeof running>,
    transport: "smtp" | "none" = "smtp",
  ): DigestScheduler {
    return new DigestScheduler(
      runner as unknown as DigestRunner,
      new RecordingMailer(transport),
      CONFIG,
      registry,
    );
  }

  it("books no timer on a deployment with no mail server, and says so once", () => {
    const runner = running();

    scheduler(runner, "none").onApplicationBootstrap();
    jest.advanceTimersByTime(INTERVAL * 10);

    expect(registry.doesExist("timeout", DIGEST_TIMEOUT)).toBe(false);
    expect(runner.tick).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("OURO_SMTP_URL"));
  });

  it("waits a jittered interval before the first tick, then keeps ticking", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    const runner = running();

    scheduler(runner).onApplicationBootstrap();

    // The earliest the jitter allows, and not a millisecond before.
    const earliest = INTERVAL * (1 - JITTER_SPREAD);
    await jest.advanceTimersByTimeAsync(earliest - 1);
    expect(runner.tick).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(runner.tick).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(earliest);
    expect(runner.tick).toHaveBeenCalledTimes(2);
  });

  it("joins a pass already running rather than starting a second", async () => {
    let finish: (report: DigestReport) => void = () => undefined;
    const runner = running();
    runner.tick.mockReturnValue(new Promise<DigestReport>((resolve) => (finish = resolve)));
    const loop = scheduler(runner);

    const first = loop.tick();
    const second = loop.tick();
    finish(QUIET);
    await Promise.all([first, second]);

    expect(runner.tick).toHaveBeenCalledTimes(1);
  });

  it("loses a tick, not the loop, when a pass cannot start", async () => {
    const runner = running();
    runner.tick.mockRejectedValueOnce(new Error("database unreachable"));
    const loop = scheduler(runner);

    await loop.tick();

    expect(error).toHaveBeenCalledWith(
      "The weekly digest could not start; retrying next tick.",
      expect.stringContaining("database unreachable"),
    );
    expect(registry.doesExist("timeout", DIGEST_TIMEOUT)).toBe(true);
  });

  it("says nothing on a tick with nothing due", async () => {
    await scheduler(running()).tick();

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("reports what a pass sent, warns about failures, and logs no address", async () => {
    const runner = running({
      outcomes: [
        { organizationId: "org-acme", slotAt: SLOT, sent: 2, failed: 0, completed: true },
        { organizationId: "org-globex", slotAt: SLOT, sent: 1, failed: 1, completed: false },
      ],
      errors: [{ organizationId: "org-initech", error: "registry unreadable" }],
    });

    await scheduler(runner).tick();

    expect(log).toHaveBeenCalledWith(
      "Weekly digest for workspace org-acme (slot 2026-08-10T09:00:00.000Z): 2 sent, 0 failed.",
    );
    expect(warn).toHaveBeenCalledWith(
      "Weekly digest for workspace org-globex (slot 2026-08-10T09:00:00.000Z): 1 sent, 1 failed; will retry.",
    );
    expect(error).toHaveBeenCalledWith(
      "Weekly digest for workspace org-initech could not run; retrying next tick.",
      "registry unreadable",
    );
    for (const spy of [log, warn, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("@");
    }
  });

  it("stops on shutdown: no further tick, and a run in flight is told to stop", async () => {
    const runner = running();
    const loop = scheduler(runner);

    loop.onApplicationBootstrap();
    loop.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(runner.stop).toHaveBeenCalledTimes(1);
    expect(runner.tick).not.toHaveBeenCalled();
    expect(registry.doesExist("timeout", DIGEST_TIMEOUT)).toBe(false);

    // A pass that was already running books nothing once the application is going away.
    await loop.tick();
    expect(registry.doesExist("timeout", DIGEST_TIMEOUT)).toBe(false);
  });
});
