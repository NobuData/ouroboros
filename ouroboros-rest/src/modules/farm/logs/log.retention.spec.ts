import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { RetentionCutoffs } from "../../retention/retention.cutoffs";
import { retentionHarness, type RetentionHarness } from "../../retention/retention.fixture";
import { LOG_SWEEP_BATCH, LOG_SWEEP_INTERVAL_MS } from "./log.policy";
import type { LogRepository, SweepCandidate } from "./log.repository";
import { LOG_RETENTION_SWEEP, LogRetentionSweeper } from "./log.retention";

/**
 * The retention sweep (#253): age first, then each workspace's budget, oldest finished jobs
 * first, whole logs only, bounded — and the tombstone counts.
 */
describe("log retention", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  const NOW = new Date("2026-09-19T12:00:00.000Z");
  let repository: jest.Mocked<
    Pick<LogRepository, "expired" | "overBudget" | "oldestKept" | "sweep">
  >;
  let scheduler: SchedulerRegistry;
  let retention: RetentionHarness;
  let sweeper: LogRetentionSweeper;

  beforeEach(() => {
    repository = {
      expired: jest.fn().mockResolvedValue([]),
      overBudget: jest.fn().mockResolvedValue([]),
      oldestKept: jest.fn().mockResolvedValue([]),
      sweep: jest.fn().mockResolvedValue({ chunks: 2, bytes: 100 }),
    };
    scheduler = new SchedulerRegistry();
    // org-a keeps build logs a week and transcripts a quarter; every other workspace the default.
    retention = retentionHarness([
      { organizationId: "org-a", dataClass: "build_logs", days: 7 },
      { organizationId: "org-a", dataClass: "transcripts", days: 90 },
    ]);
    sweeper = new LogRetentionSweeper(
      repository as unknown as LogRepository,
      { budgetBytesPerOrg: 1_000 },
      retention.service,
      retention.schedule,
      scheduler,
      () => NOW,
    );
  });

  afterEach(() => sweeper.onApplicationShutdown());

  /** A candidate job. */
  const job = (id: string): SweepCandidate => ({ id, organization_id: "org-a" });

  /** The cutoffs the sweep handed its repository. */
  function cutoffsAsked(): RetentionCutoffs {
    return repository.expired.mock.calls[0][0];
  }

  it("asks for the build_logs cutoffs — the default thirty days, and each workspace's own tier", async () => {
    await sweeper.sweep();

    const cutoffs = cutoffsAsked();
    expect(cutoffs.dataClass).toBe("build_logs");
    expect(cutoffs.fallback).toEqual(new Date("2026-08-20T12:00:00.000Z"));
    // org-a's build_logs tier, and nothing of its transcripts tier.
    expect([...cutoffs.byOrganization]).toEqual([["org-a", new Date("2026-09-12T12:00:00.000Z")]]);
  });

  it("moves its next cutoff when the build_logs tier changes, and only then (#482)", async () => {
    const admin = { userId: "u-admin", roles: ["owner"] as const };
    await retention.service.update("org-b", admin, { classes: { transcripts: 14 } });
    await sweeper.sweep();
    expect(cutoffsAsked().byOrganization.has("org-b")).toBe(false);

    await retention.service.update("org-b", admin, { classes: { build_logs: 60 } });
    await sweeper.sweep();
    expect(repository.expired.mock.calls[1][0].byOrganization.get("org-b")).toEqual(
      new Date("2026-07-21T12:00:00.000Z"),
    );
  });

  it("removes the logs past their window, bounded by the batch, and counts the tombstones", async () => {
    repository.expired.mockResolvedValue([job("a"), job("b")]);

    const report = await sweeper.sweep();

    expect(repository.expired).toHaveBeenCalledWith(cutoffsAsked(), LOG_SWEEP_BATCH);
    expect(repository.sweep).toHaveBeenCalledWith(job("a"), NOW);
    expect(report).toEqual({ byAge: 2, byBudget: 0, chunks: 4, bytes: 200 });
  });

  it("does not count a job that stopped being sweepable between the read and the lock", async () => {
    repository.expired.mockResolvedValue([job("a")]);
    repository.sweep.mockResolvedValue(undefined);

    expect(await sweeper.sweep()).toEqual({ byAge: 0, byBudget: 0, chunks: 0, bytes: 0 });
  });

  it("brings a workspace under its budget oldest-first, removing no more than it must", async () => {
    repository.overBudget.mockResolvedValue([{ organizationId: "org-a", kept: 1_500 }]);
    repository.oldestKept.mockResolvedValue([
      { ...job("oldest"), bytes: 300 },
      { ...job("older"), bytes: 300 },
      { ...job("newer"), bytes: 300 },
    ]);

    const report = await sweeper.sweep();

    expect(repository.overBudget).toHaveBeenCalledWith(1_000);
    expect(repository.oldestKept).toHaveBeenCalledWith("org-a", LOG_SWEEP_BATCH);
    // 500 over: the oldest two (600) bring it under; the third is kept.
    expect(repository.sweep.mock.calls.map(([candidate]) => candidate.id)).toEqual([
      "oldest",
      "older",
    ]);
    expect(report.byBudget).toBe(2);
  });

  it("stops at the batch across workspaces, so one sweep is never the load problem", async () => {
    repository.overBudget.mockResolvedValue([
      { organizationId: "org-a", kept: 10_000_000 },
      { organizationId: "org-b", kept: 10_000_000 },
    ]);
    repository.oldestKept.mockImplementation((organizationId, limit) =>
      Promise.resolve(
        Array.from({ length: limit }, (_, i) => ({
          id: `${organizationId}-${String(i)}`,
          organization_id: organizationId,
          bytes: 1,
        })),
      ),
    );

    const report = await sweeper.sweep();

    expect(report.byBudget).toBe(LOG_SWEEP_BATCH);
    expect(repository.oldestKept).toHaveBeenCalledTimes(1);
  });

  it("schedules itself on bootstrap and clears the timer on shutdown", () => {
    sweeper.onApplicationBootstrap();
    expect(scheduler.doesExist("timeout", LOG_RETENTION_SWEEP)).toBe(true);

    sweeper.onApplicationShutdown();
    expect(scheduler.doesExist("timeout", LOG_RETENTION_SWEEP)).toBe(false);
  });

  it("tells the retention schedule when it next runs, so the card can say when a change applies", () => {
    const before = Date.now();
    sweeper.onApplicationBootstrap();

    const next = retention.schedule.status("build_logs").nextAt;
    expect(next?.getTime()).toBeGreaterThan(before);

    sweeper.onApplicationShutdown();
    expect(retention.schedule.status("build_logs").nextAt).toBeNull();
  });

  it("reports each tick's tombstone count to the schedule", async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      repository.expired.mockResolvedValue([job("a")]);
      sweeper.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(LOG_SWEEP_INTERVAL_MS * 2);

      expect(retention.schedule.status("build_logs").last).toEqual({ at: NOW, removed: 1 });
    } finally {
      sweeper.onApplicationShutdown();
      jest.useRealTimers();
    }
  });
});
