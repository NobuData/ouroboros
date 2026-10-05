import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { recordingAudit, type RecordingAudit } from "../audit/audit.fixture";
import { retentionHarness, type RetentionHarness } from "../retention/retention.fixture";
import type { RetentionPolicyService } from "../retention/retention.service";
import type { AuditPurgeRepository } from "./audit-purge.repository";
import {
  AUDIT_PURGE_BATCH,
  AUDIT_PURGE_INTERVAL_MS,
  AUDIT_PURGE_MAX_BATCHES,
  AUDIT_PURGE_SWEEP,
  AuditPurgeSweeper,
} from "./audit-purge.sweeper";

/**
 * The audit purge (#486): the `audit` tier's cutoffs, the 90-day floor refused, batches, held rows
 * counted, and a tombstone row per workspace — never silent.
 */
describe("the audit purge", () => {
  const NOW = new Date("2026-10-05T12:00:00.000Z");
  let repository: jest.Mocked<Pick<AuditPurgeRepository, "organizations" | "purge">>;
  let retention: RetentionHarness;
  let audit: RecordingAudit;
  let scheduler: SchedulerRegistry;
  let sweeper: AuditPurgeSweeper;

  /**
   * Build the sweeper over a retention service.
   *
   * @param service - The policy service it reads cutoffs from.
   * @returns The sweeper, clock pinned.
   */
  function build(service: RetentionPolicyService): AuditPurgeSweeper {
    const built = new AuditPurgeSweeper(
      repository as unknown as AuditPurgeRepository,
      service,
      retention.schedule,
      audit.service,
      scheduler,
    );
    built.now = () => NOW;
    return built;
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    repository = {
      organizations: jest.fn().mockResolvedValue(["org-a", "org-b"]),
      purge: jest.fn().mockResolvedValue({ removed: 0, held: 0 }),
    };
    // org-a keeps its audit log 120 days; org-b the default 400.
    retention = retentionHarness([{ organizationId: "org-a", dataClass: "audit", days: 120 }]);
    audit = recordingAudit();
    scheduler = new SchedulerRegistry();
    sweeper = build(retention.service);
  });

  afterEach(() => sweeper.onApplicationShutdown());

  it("purges each workspace to its own audit tier — 400 days by default", async () => {
    await sweeper.sweep();

    expect(repository.purge).toHaveBeenCalledWith(
      "org-a",
      new Date("2026-06-07T12:00:00.000Z"),
      AUDIT_PURGE_BATCH,
    );
    expect(repository.purge).toHaveBeenCalledWith(
      "org-b",
      new Date("2025-08-31T12:00:00.000Z"),
      AUDIT_PURGE_BATCH,
    );
  });

  it("works a backlog down in batches, and stops at a short one", async () => {
    repository.organizations.mockResolvedValue(["org-a"]);
    repository.purge
      .mockResolvedValueOnce({ removed: AUDIT_PURGE_BATCH, held: 2 })
      .mockResolvedValueOnce({ removed: 12, held: 2 });

    const report = await sweeper.sweep();

    expect(repository.purge).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ removed: AUDIT_PURGE_BATCH + 12, held: 2, refused: [] });
  });

  it("bounds one workspace's work per tick", async () => {
    repository.organizations.mockResolvedValue(["org-a"]);
    repository.purge.mockResolvedValue({ removed: AUDIT_PURGE_BATCH, held: 0 });

    await sweeper.sweep();

    expect(repository.purge).toHaveBeenCalledTimes(AUDIT_PURGE_MAX_BATCHES);
  });

  it("leaves an audit.purged row with the cutoff, tier and counts, as the system", async () => {
    repository.purge.mockImplementation((organizationId) =>
      Promise.resolve(
        organizationId === "org-a" ? { removed: 31, held: 4 } : { removed: 0, held: 0 },
      ),
    );

    const report = await sweeper.sweep();

    expect(audit.records).toEqual([
      {
        organizationId: "org-a",
        actorId: null,
        action: "audit.purged",
        subjectType: "workspace",
        subjectId: "org-a",
        at: NOW,
        detail: { cutoff: "2026-06-07T12:00:00.000Z", days: 120, removed: 31, held: 4 },
      },
    ]);
    expect(report.workspaces).toEqual([
      {
        organizationId: "org-a",
        days: 120,
        cutoff: new Date("2026-06-07T12:00:00.000Z"),
        removed: 31,
        held: 4,
      },
    ]);
  });

  it("reports held rows even when nothing could be removed, without a purge row", async () => {
    repository.organizations.mockResolvedValue(["org-a"]);
    repository.purge.mockResolvedValue({ removed: 0, held: 3 });

    const report = await sweeper.sweep();

    expect(report).toMatchObject({ removed: 0, held: 3 });
    expect(audit.records).toEqual([]);
  });

  it("refuses a workspace whose tier is below the 90-day floor, and touches nothing of it", async () => {
    const below = {
      cutoffs: jest.fn().mockResolvedValue({
        dataClass: "audit",
        fallback: new Date("2025-09-01T12:00:00.000Z"),
        byOrganization: new Map([["org-a", new Date("2026-09-05T12:00:00.000Z")]]),
      }),
    } as unknown as RetentionPolicyService;
    sweeper = build(below);

    const report = await sweeper.sweep();

    expect(report.refused).toEqual(["org-a"]);
    expect(repository.purge).not.toHaveBeenCalledWith(
      "org-a",
      expect.anything(),
      expect.anything(),
    );
    expect(repository.purge).toHaveBeenCalledWith("org-b", expect.any(Date), AUDIT_PURGE_BATCH);
  });

  it("logs a refusal loudly on the tick", async () => {
    const below = {
      cutoffs: jest.fn().mockResolvedValue({
        dataClass: "audit",
        fallback: new Date("2026-09-05T12:00:00.000Z"),
        byOrganization: new Map(),
      }),
    } as unknown as RetentionPolicyService;
    sweeper = build(below);
    const error = jest.spyOn(
      (sweeper as unknown as { logger: { error: (message: string) => void } }).logger,
      "error",
    );
    jest.useFakeTimers();
    try {
      sweeper.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(2 * AUDIT_PURGE_INTERVAL_MS);

      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/below the 90-day floor: org-a, org-b/),
      );
    } finally {
      sweeper.onApplicationShutdown();
      jest.useRealTimers();
    }
  });

  it("books itself on bootstrap, tells the schedule when, and clears both on shutdown", () => {
    sweeper.onApplicationBootstrap();
    expect(scheduler.doesExist("timeout", AUDIT_PURGE_SWEEP)).toBe(true);
    expect(retention.schedule.status("audit").nextAt).not.toBeNull();

    sweeper.onApplicationShutdown();
    expect(scheduler.doesExist("timeout", AUDIT_PURGE_SWEEP)).toBe(false);
    expect(retention.schedule.status("audit").nextAt).toBeNull();
  });

  it("logs and reports each tick's tombstone counts, and books the next", async () => {
    repository.organizations.mockResolvedValue(["org-a"]);
    repository.purge.mockResolvedValue({ removed: 5, held: 1 });
    const log = jest.spyOn(
      (sweeper as unknown as { logger: { log: (message: string) => void } }).logger,
      "log",
    );
    jest.useFakeTimers();
    try {
      sweeper.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(2 * AUDIT_PURGE_INTERVAL_MS);

      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          /removed 5 event\(s\) and held 1 still referenced, across 1 workspace/,
        ),
      );
      expect(retention.schedule.status("audit").last).toEqual({ at: NOW, removed: 5 });
      expect(scheduler.doesExist("timeout", AUDIT_PURGE_SWEEP)).toBe(true);
    } finally {
      sweeper.onApplicationShutdown();
      jest.useRealTimers();
    }
  });

  it("keeps purging after a failed tick", async () => {
    repository.organizations.mockRejectedValue(new Error("connection reset"));
    jest.useFakeTimers();
    try {
      sweeper.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(2 * AUDIT_PURGE_INTERVAL_MS);

      expect(scheduler.doesExist("timeout", AUDIT_PURGE_SWEEP)).toBe(true);
    } finally {
      sweeper.onApplicationShutdown();
      jest.useRealTimers();
    }
  });
});
