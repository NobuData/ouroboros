import type { AppConfigService } from "../config/config.service";
import type { BacklogHealthRepository, BacklogMetricsRow, LastRunRow } from "./health.repository";
import { BacklogHealthService } from "./health.service";

/**
 * The Backlog Health card's payload (AL.5, #281) — the meters, their drill-through filters, the
 * configurable threshold and the nightly job's footnote.
 */

const NOW = new Date("2026-09-17T12:00:00.000Z");

const CONFIG = {
  backlogStaleDays: 30,
  reestimationHourUtc: 2,
  reestimationJitterMinutes: 30,
  reestimationBatch: 100,
} as unknown as AppConfigService;

/**
 * A service over a repository that answers what a test says.
 *
 * @param metrics - The counts.
 * @param lastRun - The last run, or undefined.
 * @param config - The configuration.
 * @returns The service and the repository's mocks.
 */
function build(
  metrics: BacklogMetricsRow,
  lastRun: LastRunRow | undefined,
  config: AppConfigService = CONFIG,
) {
  const repository = {
    metrics: jest.fn(async () => Promise.resolve(metrics)),
    lastRun: jest.fn(async () => Promise.resolve(lastRun)),
  };

  return {
    service: new BacklogHealthService(repository as unknown as BacklogHealthRepository, config),
    repository,
  };
}

describe("the Backlog Health card", () => {
  it("reproduces the mockup's 38/42 · 4 · 6 with drill-through filters", async () => {
    const { service } = build({ open: 42, sized: 38, blocked: 4, stale: 6 }, undefined);

    await expect(service.health("org-acme", NOW)).resolves.toEqual({
      open: 42,
      sized: { count: 38, total: 42, filter: { state: "open", sizing: "unsized" } },
      blocked: { count: 4, filter: { state: "open", blocked: true } },
      stale: { count: 6, thresholdDays: 30, filter: { state: "open", staleDays: 30 } },
      reestimation: {
        schedule: { hourUtc: 2, jitterMinutes: 30, batchLimit: 100 },
        lastRun: null,
      },
    });
  });

  it("measures staleness from the configured threshold, not a constant", async () => {
    const { service, repository } = build({ open: 0, sized: 0, blocked: 0, stale: 0 }, undefined, {
      ...CONFIG,
      backlogStaleDays: 14,
    } as unknown as AppConfigService);

    const health = await service.health("org-acme", NOW);

    expect(repository.metrics).toHaveBeenCalledWith(
      "org-acme",
      new Date("2026-09-03T12:00:00.000Z"),
    );
    expect(health.stale.thresholdDays).toBe(14);
    expect(health.stale.filter.staleDays).toBe(14);
  });

  it("answers zeros for an empty workspace — genuine counts, never absent", async () => {
    const { service } = build({ open: 0, sized: 0, blocked: 0, stale: 0 }, undefined);

    const health = await service.health("org-empty", NOW);

    expect(health.open).toBe(0);
    expect(health.sized).toMatchObject({ count: 0, total: 0 });
    expect(health.blocked.count).toBe(0);
    expect(health.stale.count).toBe(0);
  });

  it("surfaces the last run's time and this workspace's counts for the tooltip", async () => {
    const { service, repository } = build(
      { open: 42, sized: 38, blocked: 4, stale: 6 },
      {
        startedAt: new Date("2026-09-17T02:14:00.000Z"),
        finishedAt: new Date("2026-09-17T02:14:01.000Z"),
        status: "succeeded",
        found: 4,
        queued: 3,
        inFlight: 1,
      },
    );

    const health = await service.health("org-acme", NOW);

    expect(repository.lastRun).toHaveBeenCalledWith("org-acme");
    expect(health.reestimation.lastRun).toEqual({
      startedAt: "2026-09-17T02:14:00.000Z",
      finishedAt: "2026-09-17T02:14:01.000Z",
      status: "succeeded",
      found: 4,
      queued: 3,
      inFlight: 1,
    });
  });

  it("reports a run still in progress with no finish time", async () => {
    const { service } = build(
      { open: 1, sized: 0, blocked: 0, stale: 0 },
      {
        startedAt: new Date("2026-09-17T02:14:00.000Z"),
        finishedAt: null,
        status: "running",
        found: 0,
        queued: 0,
        inFlight: 0,
      },
    );

    const health = await service.health("org-acme", NOW);

    expect(health.reestimation.lastRun).toMatchObject({ status: "running", finishedAt: null });
  });
});
