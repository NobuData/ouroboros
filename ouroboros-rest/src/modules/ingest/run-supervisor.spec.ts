import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { AppConfigService } from "../config/config.service";
import type { EngineClient } from "../engine/engine.client";
import { JITTER_SPREAD } from "../scheduling/cadence";
import type { RunExecutionRepository } from "./run-execution.repository";
import { RUN_SUPERVISOR_TIMEOUT, RunSupervisor } from "./run-supervisor";

/**
 * The run supervisor (#160): which runs it resubmits, when it asks for claims, and that an
 * engine failure costs one call rather than the loop.
 */

const NOW = new Date("2026-10-15T14:25:00.000Z");

describe("the run supervisor (#160)", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    registry = new SchedulerRegistry();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * A supervisor over stand-ins.
   *
   * @param options - The two reads, the engine's answers and the switch.
   * @returns The supervisor and its stand-ins.
   */
  function rig(
    options: {
      stale?: string[] | jest.Mock;
      workspaces?: string[];
      live?: boolean;
      execute?: jest.Mock;
      claim?: jest.Mock;
      tick?: number;
    } = {},
  ) {
    const runs = {
      staleRuns:
        typeof options.stale === "function"
          ? options.stale
          : jest.fn().mockResolvedValue(options.stale ?? []),
      claimableWorkspaces: jest.fn().mockResolvedValue(options.workspaces ?? []),
    };
    const engine = {
      executeRun: options.execute ?? jest.fn().mockResolvedValue({ accepted: true, reason: null }),
      claimWork:
        options.claim ?? jest.fn().mockResolvedValue({ claimed: true, runId: "r", reason: null }),
    };
    const config = {
      runSupervisorTickSeconds: options.tick ?? 5,
      runHeartbeatStaleSeconds: 30,
      liveExecutionEnabled: options.live ?? false,
    } as AppConfigService;
    const supervisor = new RunSupervisor(
      runs as unknown as RunExecutionRepository,
      engine as unknown as EngineClient,
      config,
      registry,
    );

    return { supervisor, runs, engine };
  }

  it("asks for runs whose heartbeat is older than the staleness, and resubmits each once", async () => {
    const { supervisor, runs, engine } = rig({ stale: ["r1", "r2", "r1"] });

    await expect(supervisor.supervise(NOW)).resolves.toEqual({
      resubmitted: 2,
      declined: 0,
      claimed: 0,
    });
    expect(runs.staleRuns).toHaveBeenCalledWith(new Date("2026-10-15T14:24:30.000Z"));
    expect(engine.executeRun).toHaveBeenCalledTimes(2);
    expect(engine.executeRun).toHaveBeenNthCalledWith(1, "r1");
    expect(engine.executeRun).toHaveBeenNthCalledWith(2, "r2");
  });

  it("resubmits nothing when no run is stale", async () => {
    const { supervisor, engine } = rig();

    await supervisor.supervise(NOW);

    expect(engine.executeRun).not.toHaveBeenCalled();
  });

  it("counts a decline and swallows an engine failure, moving on to the next run", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ accepted: false, reason: "no_executor" })
      .mockRejectedValueOnce(new Error("engine down"))
      .mockResolvedValueOnce({ accepted: true, reason: null });
    const { supervisor, engine } = rig({ stale: ["r1", "r2", "r3"], execute });

    await expect(supervisor.supervise(NOW)).resolves.toEqual({
      resubmitted: 1,
      declined: 2,
      claimed: 0,
    });
    expect(engine.executeRun).toHaveBeenCalledTimes(3);
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
  });

  it("asks for no claims while live execution is off", async () => {
    const { supervisor, runs, engine } = rig({ live: false, workspaces: ["org-a"] });

    await supervisor.supervise(NOW);

    expect(runs.claimableWorkspaces).not.toHaveBeenCalled();
    expect(engine.claimWork).not.toHaveBeenCalled();
  });

  it("asks once per claimable workspace while live execution is on", async () => {
    const claim = jest
      .fn()
      .mockResolvedValueOnce({ claimed: true, runId: "r9", reason: null })
      .mockResolvedValueOnce({ claimed: false, runId: null, reason: "nothing_queued" })
      .mockRejectedValueOnce(new Error("engine down"));
    const { supervisor, runs, engine } = rig({
      live: true,
      workspaces: ["org-a", "org-b", "org-a", "org-c"],
      claim,
    });

    await expect(supervisor.supervise(NOW)).resolves.toEqual({
      resubmitted: 0,
      declined: 0,
      claimed: 1,
    });
    expect(runs.claimableWorkspaces).toHaveBeenCalledWith(NOW);
    expect(engine.claimWork.mock.calls).toEqual([["org-a"], ["org-b"], ["org-c"]]);
  });

  it("logs only a tick that did something", async () => {
    const quiet = rig();
    await quiet.supervisor.tick();
    expect(Logger.prototype.log).not.toHaveBeenCalled();

    const busy = rig({ stale: ["r1"] });
    await busy.supervisor.tick();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "Run supervisor: 1 stale run(s) resubmitted, 0 workspace claim(s) opened a run.",
    );

    quiet.supervisor.onApplicationShutdown();
    busy.supervisor.onApplicationShutdown();
  });

  it("loses a tick, not the loop, when the database is unreachable", async () => {
    const { supervisor } = rig({ stale: jest.fn().mockRejectedValue(new Error("refused")) });

    await supervisor.tick();

    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(registry.doesExist("timeout", RUN_SUPERVISOR_TIMEOUT)).toBe(true);
    supervisor.onApplicationShutdown();
  });

  it("books its first tick a jittered interval after bootstrap", () => {
    jest.useFakeTimers();
    const stale = jest.fn().mockResolvedValue([]);
    const { supervisor } = rig({ stale, tick: 7 });

    supervisor.onApplicationBootstrap();

    expect(stale).not.toHaveBeenCalled();
    jest.advanceTimersByTime(7 * 1000 * (1 + JITTER_SPREAD));
    expect(stale).toHaveBeenCalledTimes(1);
    supervisor.onApplicationShutdown();
  });

  it("clears its timer on shutdown and books nothing afterwards", async () => {
    const { supervisor } = rig();

    supervisor.onApplicationBootstrap();
    supervisor.onApplicationShutdown();
    expect(registry.doesExist("timeout", RUN_SUPERVISOR_TIMEOUT)).toBe(false);

    await supervisor.tick();
    expect(registry.doesExist("timeout", RUN_SUPERVISOR_TIMEOUT)).toBe(false);
  });
});
