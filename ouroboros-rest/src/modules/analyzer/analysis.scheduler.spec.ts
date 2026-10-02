import { SchedulerRegistry } from "@nestjs/schedule";

import { engineUnavailable } from "../engine/engine.errors";
import { analysisAlreadyRunning } from "./analysis.errors";
import type { AnalysisOrchestrator } from "./analysis.orchestrator";
import type { AnalysisRepository, WeeklySchedule } from "./analysis.repository";
import {
  ANALYZER_TIMEOUT,
  AnalysisScheduler,
  dueSlot,
  REAP_GRACE_SECONDS,
  REAPED_REASON,
} from "./analysis.scheduler";

/** Wednesday, Aug 12 2026, 10:00 UTC. */
const NOW = new Date("2026-08-12T10:00:00Z");

/** The seeded schedule: Mondays at 06:00 UTC. */
function weekly(overrides: Partial<WeeklySchedule> = {}): WeeklySchedule {
  return {
    id: "5eed0064-0000-4000-8000-000000000001",
    organizationId: "5eed0001-0000-4000-8000-000000000001",
    repoRef: "acme-robotics/helios-firmware",
    weeklyDay: 1,
    weeklyTime: "06:00",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    lastStartedAt: new Date("2026-08-03T06:00:30Z"),
    ...overrides,
  };
}

describe("a weekly slot", () => {
  it("is due when it has passed with no analysis started since", () => {
    expect(dueSlot(weekly(), NOW)).toEqual(new Date("2026-08-10T06:00:00Z"));
  });

  it("is not due once any analysis — manual or every-N included — started after it", () => {
    expect(
      dueSlot(weekly({ lastStartedAt: new Date("2026-08-11T15:00:00Z") }), NOW),
    ).toBeUndefined();
  });

  it("is due for a repository that has never been analyzed", () => {
    expect(dueSlot(weekly({ lastStartedAt: null }), NOW)).toEqual(new Date("2026-08-10T06:00:00Z"));
  });

  it("never fires a slot from before the schedule existed", () => {
    expect(
      dueSlot(weekly({ createdAt: new Date("2026-08-11T00:00:00Z"), lastStartedAt: null }), NOW),
    ).toBeUndefined();
  });
});

describe("the analyzer tick", () => {
  function harness(schedules: WeeklySchedule[]) {
    const runs = {
      reapStale: jest.fn().mockResolvedValue([]),
      weeklySchedules: jest.fn().mockResolvedValue(schedules),
    };
    const orchestrator = { start: jest.fn().mockResolvedValue({ id: "run-1" }) };
    const registry = new SchedulerRegistry();
    const scheduler = new AnalysisScheduler(
      runs as unknown as AnalysisRepository,
      orchestrator as unknown as AnalysisOrchestrator,
      registry,
      () => NOW.getTime(),
    );

    return { runs, orchestrator, registry, scheduler };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reaps runs abandoned past their ceiling, then starts each due weekly run", async () => {
    const { runs, orchestrator, scheduler } = harness([
      weekly(),
      weekly({ id: "s2", repoRef: "acme-robotics/helios-console", lastStartedAt: NOW }),
    ]);

    await scheduler.tick();
    scheduler.onApplicationShutdown();

    expect(runs.reapStale).toHaveBeenCalledWith(REAP_GRACE_SECONDS, REAPED_REASON);
    expect(orchestrator.start).toHaveBeenCalledTimes(1);
    expect(orchestrator.start).toHaveBeenCalledWith({
      organizationId: "5eed0001-0000-4000-8000-000000000001",
      repoRef: "acme-robotics/helios-firmware",
      trigger: "weekly",
      scheduleId: "5eed0064-0000-4000-8000-000000000001",
    });
  });

  it("moves on past a repository already being analyzed, and past one that could not start", async () => {
    const { orchestrator, scheduler } = harness([
      weekly(),
      weekly({ id: "s2", repoRef: "acme-robotics/helios-console" }),
      weekly({ id: "s3", repoRef: "acme-robotics/atlas-scheduler" }),
    ]);
    orchestrator.start
      .mockRejectedValueOnce(analysisAlreadyRunning("acme-robotics/helios-firmware", undefined))
      .mockRejectedValueOnce(engineUnavailable());

    await scheduler.tick();
    scheduler.onApplicationShutdown();

    expect(orchestrator.start).toHaveBeenCalledTimes(3);
  });

  it("books its next tick, and survives a pass that could not read anything", async () => {
    const { runs, registry, scheduler } = harness([]);
    runs.reapStale.mockRejectedValue(new Error("connection refused"));

    await scheduler.tick();

    expect(registry.doesExist("timeout", ANALYZER_TIMEOUT)).toBe(true);
    scheduler.onApplicationShutdown();
    expect(registry.doesExist("timeout", ANALYZER_TIMEOUT)).toBe(false);
  });

  it("books nothing once the application is shutting down", async () => {
    const { registry, scheduler } = harness([]);
    scheduler.onApplicationShutdown();

    await scheduler.tick();

    expect(registry.doesExist("timeout", ANALYZER_TIMEOUT)).toBe(false);
  });
});
