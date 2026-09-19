import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { LOG_SWEEP_BATCH } from "./log.policy";
import type { LogRepository, SweepCandidate } from "./log.repository";
import { LOG_RETENTION_SWEEP, LogRetentionSweeper, retainUntil } from "./log.retention";

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
  let sweeper: LogRetentionSweeper;

  beforeEach(() => {
    repository = {
      expired: jest.fn().mockResolvedValue([]),
      overBudget: jest.fn().mockResolvedValue([]),
      oldestKept: jest.fn().mockResolvedValue([]),
      sweep: jest.fn().mockResolvedValue({ chunks: 2, bytes: 100 }),
    };
    scheduler = new SchedulerRegistry();
    sweeper = new LogRetentionSweeper(
      repository as unknown as LogRepository,
      { days: 30, budgetBytesPerOrg: 1_000 },
      scheduler,
      () => NOW,
    );
  });

  afterEach(() => sweeper.onApplicationShutdown());

  /** A candidate job. */
  const job = (id: string): SweepCandidate => ({ id, organization_id: "org-a" });

  it("writes a chunk's retain_until thirty days out, so a later policy never reaches back", () => {
    expect(retainUntil({ days: 30, budgetBytesPerOrg: 1 }, NOW)).toEqual(
      new Date("2026-10-19T12:00:00.000Z"),
    );
  });

  it("removes the logs past their window, bounded by the batch, and counts the tombstones", async () => {
    repository.expired.mockResolvedValue([job("a"), job("b")]);

    const report = await sweeper.sweep();

    expect(repository.expired).toHaveBeenCalledWith(NOW, LOG_SWEEP_BATCH);
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
});
