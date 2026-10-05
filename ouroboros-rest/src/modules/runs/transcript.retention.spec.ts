import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import type { RetentionCutoffs } from "../retention/retention.cutoffs";
import { retentionHarness, type RetentionHarness } from "../retention/retention.fixture";
import type { TranscriptCandidate, TranscriptRetentionRepository } from "./transcript.repository";
import {
  TRANSCRIPT_RETENTION_SWEEP,
  TRANSCRIPT_SWEEP_BATCH,
  TRANSCRIPT_SWEEP_INTERVAL_MS,
  TranscriptRetentionSweeper,
} from "./transcript.retention";

/**
 * The transcript retention sweep (#482, amending #299): the `transcripts` tier's cutoffs, whole
 * transcripts of finished runs, bounded, and the tombstone counts reported.
 */
describe("transcript retention", () => {
  const NOW = new Date("2026-10-04T12:00:00.000Z");
  let repository: jest.Mocked<Pick<TranscriptRetentionRepository, "expired" | "sweep">>;
  let retention: RetentionHarness;
  let scheduler: SchedulerRegistry;
  let sweeper: TranscriptRetentionSweeper;

  /** A finished run. */
  const run = (id: string): TranscriptCandidate => ({ id, organization_id: "org-a" });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    repository = {
      expired: jest.fn().mockResolvedValue([]),
      sweep: jest.fn().mockResolvedValue({ events: 10, bytes: 400 }),
    };
    // org-a keeps transcripts two weeks and build logs a year; every other workspace the default.
    retention = retentionHarness([
      { organizationId: "org-a", dataClass: "transcripts", days: 14 },
      { organizationId: "org-a", dataClass: "build_logs", days: 365 },
    ]);
    scheduler = new SchedulerRegistry();
    sweeper = new TranscriptRetentionSweeper(
      repository as unknown as TranscriptRetentionRepository,
      retention.service,
      retention.schedule,
      scheduler,
    );
    sweeper.now = () => NOW;
  });

  afterEach(() => sweeper.onApplicationShutdown());

  /** The cutoffs the sweep asked its repository with. */
  function cutoffsAsked(): RetentionCutoffs {
    return repository.expired.mock.calls[0][0];
  }

  it("works to the transcripts tier — thirty days by default, a workspace's own when stored", async () => {
    await sweeper.sweep();

    expect(cutoffsAsked().dataClass).toBe("transcripts");
    expect(cutoffsAsked().fallback).toEqual(new Date("2026-09-04T12:00:00.000Z"));
    expect([...cutoffsAsked().byOrganization]).toEqual([
      ["org-a", new Date("2026-09-20T12:00:00.000Z")],
    ]);
    expect(repository.expired).toHaveBeenCalledWith(cutoffsAsked(), TRANSCRIPT_SWEEP_BATCH);
  });

  it("moves its cutoff when the transcripts tier changes, and not when another class's does", async () => {
    const admin = { userId: "u-admin", roles: ["owner"] as const };
    await retention.service.update("org-b", admin, { classes: { artifacts: 7 } });
    await sweeper.sweep();
    expect(cutoffsAsked().byOrganization.has("org-b")).toBe(false);

    await retention.service.update("org-b", admin, { loopDays: 7 });
    await sweeper.sweep();
    expect(repository.expired.mock.calls[1][0].byOrganization.get("org-b")).toEqual(
      new Date("2026-09-27T12:00:00.000Z"),
    );
  });

  it("sweeps each run with its cutoffs and counts the tombstones", async () => {
    repository.expired.mockResolvedValue([run("r1"), run("r2")]);

    expect(await sweeper.sweep()).toEqual({ runs: 2, events: 20, bytes: 800 });
    expect(repository.sweep).toHaveBeenCalledWith(run("r1"), cutoffsAsked(), NOW);
  });

  it("does not count a run that stopped being sweepable between the read and the lock", async () => {
    repository.expired.mockResolvedValue([run("r1")]);
    repository.sweep.mockResolvedValue(undefined);

    expect(await sweeper.sweep()).toEqual({ runs: 0, events: 0, bytes: 0 });
  });

  it("books itself on bootstrap, tells the schedule when, and clears both on shutdown", () => {
    sweeper.onApplicationBootstrap();
    expect(scheduler.doesExist("timeout", TRANSCRIPT_RETENTION_SWEEP)).toBe(true);
    expect(retention.schedule.status("transcripts").nextAt).not.toBeNull();

    sweeper.onApplicationShutdown();
    expect(scheduler.doesExist("timeout", TRANSCRIPT_RETENTION_SWEEP)).toBe(false);
    expect(retention.schedule.status("transcripts").nextAt).toBeNull();
  });

  it("logs and reports each tick's tombstone counts, and books the next — never deleting silently", async () => {
    repository.expired.mockResolvedValue([run("r1")]);
    const log = jest.spyOn(
      (sweeper as unknown as { logger: { log: (message: string) => void } }).logger,
      "log",
    );
    jest.useFakeTimers();
    try {
      sweeper.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(2 * TRANSCRIPT_SWEEP_INTERVAL_MS);

      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/removed the transcripts of 1 finished run\(s\) — 10 entr\(ies\)/),
      );
      expect(retention.schedule.status("transcripts").last).toEqual({ at: NOW, removed: 1 });
      expect(scheduler.doesExist("timeout", TRANSCRIPT_RETENTION_SWEEP)).toBe(true);
    } finally {
      sweeper.onApplicationShutdown();
      jest.useRealTimers();
    }
  });

  it("keeps sweeping after a failed tick", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    repository.expired.mockRejectedValue(new Error("connection reset"));
    jest.useFakeTimers();
    try {
      sweeper.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(2 * TRANSCRIPT_SWEEP_INTERVAL_MS);

      expect(scheduler.doesExist("timeout", TRANSCRIPT_RETENTION_SWEEP)).toBe(true);
    } finally {
      sweeper.onApplicationShutdown();
      jest.useRealTimers();
    }
  });
});
