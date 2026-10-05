import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { SchedulerRegistry } from "@nestjs/schedule";

import {
  ArtifactNotFoundError,
  ArtifactStoreError,
  type ArtifactStore,
} from "../farm/artifacts/artifact.store";
import { LocalArtifactStore } from "../farm/artifacts/local.store";
import {
  ARTIFACT_RETENTION_SWEEP,
  ARTIFACT_SWEEP_BATCH,
  ArtifactRetentionSweeper,
} from "./artifact.retention";
import { retentionHarness, type RetentionHarness } from "../retention/retention.fixture";
import { attemptId, FakeResultsRepository, mockupUniverse, ORG } from "./results.fixture";
import type { ArtifactRow, ResultsRepository } from "./results.repository";
import { ResultsService, storedKey } from "./results.service";

/**
 * The artifact retention sweep (AT.5, #333): bytes removed through the store, a tombstone left on
 * the row, and the page rendering it `expired` rather than losing it.
 */

/** Thirty-one days after the seeded uploads — past every artifact's thirty. */
const LATER = new Date("2026-10-21T14:00:00.000Z");

let root: string;
let directory = 0;
let store: ArtifactStore;
let repository: FakeResultsRepository;
let scheduler: SchedulerRegistry;
let retention: RetentionHarness;
let sweeper: ArtifactRetentionSweeper;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ouro-retention-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  store = new LocalArtifactStore(join(root, String((directory += 1))));
  repository = new FakeResultsRepository(mockupUniverse());
  scheduler = new SchedulerRegistry();
  retention = retentionHarness();
  sweeper = build(store);
  sweeper.now = () => LATER;

  // Every seeded artifact gets real bytes, so there is something to remove.
  for (const row of repository.universe.artifacts) {
    const bytes = Buffer.from(row.name);
    await store.put(
      storedKey(row.storage_ref, "local") ?? "",
      Readable.from([bytes]),
      bytes.length,
    );
  }
});

afterEach(() => {
  sweeper.onApplicationShutdown();
});

/** A sweeper over the fake repository and the given store. */
function build(over: ArtifactStore): ArtifactRetentionSweeper {
  return new ArtifactRetentionSweeper(
    repository as unknown as ResultsRepository,
    over,
    retention.service,
    retention.schedule,
    scheduler,
  );
}

/** The key a row's bytes are under. */
function keyOf(row: ArtifactRow): string {
  return storedKey(row.storage_ref, "local") ?? "";
}

describe("the artifact retention sweep", () => {
  it("keeps everything inside its retention window", async () => {
    sweeper.now = () => new Date("2026-09-25T00:00:00Z");

    expect(await sweeper.sweep()).toEqual({ expired: 0, bytes: 0, failed: 0 });
    expect(repository.universe.artifacts.every((row) => row.expired_at === null)).toBe(true);
  });

  it("removes the bytes of every expired artifact and leaves a tombstone", async () => {
    const report = await sweeper.sweep();

    expect(report).toEqual({
      expired: 5,
      bytes: 90112 + 48213 + 2202010 + 184320 + 91822,
      failed: 0,
    });
    for (const row of repository.universe.artifacts) {
      expect(row.expired_at).toEqual(LATER);
      await expect(store.get(keyOf(row))).rejects.toBeInstanceOf(ArtifactNotFoundError);
    }
  });

  it("leaves the page rendering each one as `expired`, with its name, kind and size", async () => {
    await sweeper.sweep();
    const service = new ResultsService(repository as unknown as ResultsRepository, store);

    const page = await service.page(ORG, attemptId(3));

    expect(page.artifacts.map((each) => [each.name, each.kind, each.state, each.href])).toEqual([
      ["junit-build3.xml", "junit", "expired", null],
      ["rig-capture-estop.csv", "capture", "expired", null],
      ["serial-console.log", "log", "expired", null],
      ["coverage.info", "coverage", "expired", null],
    ]);
    expect(page.artifacts[1].sizeBytes).toBe(2_202_010);
  });

  it("cuts on the workspace's artifacts tier as it stands now — a shortened tier reaches stored rows (#482)", async () => {
    const newest = Math.max(
      ...repository.universe.artifacts.map((row) => row.created_at.getTime()),
    );
    // Eight days after the newest upload: inside the default thirty, past a seven-day tier.
    sweeper.now = () => new Date(newest + 8 * 86_400_000);
    expect((await sweeper.sweep()).expired).toBe(0);

    await retention.service.update(
      ORG,
      { userId: "u-admin", roles: ["owner"] },
      {
        classes: { artifacts: 7 },
      },
    );

    expect((await sweeper.sweep()).expired).toBe(repository.universe.artifacts.length);
  });

  it("keeps a row stored exactly at the old boundary — the default reproduces the old sweep", async () => {
    const oldest = repository.universe.artifacts.reduce((a, b) =>
      a.created_at <= b.created_at ? a : b,
    );
    // The old sweep expired `retained_until <= now` with retained_until = upload + 30 d.
    sweeper.now = () => new Date(oldest.created_at.getTime() + 30 * 86_400_000 - 1);
    expect((await sweeper.sweep()).expired).toBe(0);

    sweeper.now = () => new Date(oldest.created_at.getTime() + 30 * 86_400_000);
    expect((await sweeper.sweep()).expired).toBeGreaterThanOrEqual(1);
    expect(oldest.expired_at).not.toBeNull();
  });

  it("leaves another workspace's artifacts to that workspace's tier", async () => {
    sweeper.now = () => LATER;
    await retention.service.update(
      "org-elsewhere",
      { userId: "u-admin", roles: ["owner"] },
      {
        classes: { artifacts: 365 },
      },
    );

    // ORG still takes the default, so its rows expire on LATER as before.
    expect((await sweeper.sweep()).expired).toBe(5);
  });

  it("reports its next run to the retention schedule, and clears it on shutdown", () => {
    sweeper.onApplicationBootstrap();
    expect(retention.schedule.status("artifacts").nextAt).not.toBeNull();
    sweeper.onApplicationShutdown();
    expect(retention.schedule.status("artifacts").nextAt).toBeNull();
  });

  it("keeps an artifact live when its bytes could not be removed, and retries it", async () => {
    const failing: ArtifactStore = {
      driver: "local",
      put: (key, body, size) => store.put(key, body, size),
      get: (key) => store.get(key),
      open: (key) => store.open(key),
      delete: (key) =>
        key.endsWith("serial-console.log")
          ? Promise.reject(new ArtifactStoreError("the disk is read-only"))
          : store.delete(key),
    };
    sweeper = build(failing);
    sweeper.now = () => LATER;

    expect(await sweeper.sweep()).toMatchObject({ expired: 4, failed: 1 });
    const log = repository.universe.artifacts.find((row) => row.name === "serial-console.log");
    expect(log?.expired_at).toBeNull();

    sweeper = build(store);
    sweeper.now = () => LATER;
    expect(await sweeper.sweep()).toMatchObject({ expired: 1, failed: 0 });
  });

  it("never tombstones a row stored through another driver — its bytes wait for the migration", async () => {
    const elsewhere = repository.universe.artifacts[2];
    Object.assign(elsewhere, { storage_ref: { driver: "s3", key: "bucket/key" } });

    expect((await sweeper.sweep()).expired).toBe(4);
    expect(elsewhere.expired_at).toBeNull();
  });

  it("does not count a tombstone another sweep wrote first", async () => {
    const racing = repository.markExpired.bind(repository);
    repository.markExpired = async (artifact, at) => {
      await racing(artifact, at);
      return false;
    };

    expect((await sweeper.sweep()).expired).toBe(0);
  });

  it("works a batch at a time", async () => {
    const template = repository.universe.artifacts[0];
    repository.universe.artifacts = Array.from({ length: ARTIFACT_SWEEP_BATCH + 5 }, (_, n) => ({
      ...template,
      id: `a${String(n)}`,
      name: `file-${String(n)}.log`,
    }));

    expect((await sweeper.sweep()).expired).toBe(ARTIFACT_SWEEP_BATCH);
    expect((await sweeper.sweep()).expired).toBe(5);
    expect((await sweeper.sweep()).expired).toBe(0);
  });

  it("books itself at bootstrap and clears its timer at shutdown", () => {
    sweeper.onApplicationBootstrap();
    expect(scheduler.doesExist("timeout", ARTIFACT_RETENTION_SWEEP)).toBe(true);

    sweeper.onApplicationShutdown();
    expect(scheduler.doesExist("timeout", ARTIFACT_RETENTION_SWEEP)).toBe(false);
  });

  it("logs its tombstone counts and books the next sweep after a tick", async () => {
    // Disk I/O does not advance with fake timers, so this sweep removes from memory.
    sweeper = build({ ...store, driver: "local", delete: () => Promise.resolve() });
    sweeper.now = () => LATER;
    jest.useFakeTimers();
    try {
      const log = jest.spyOn(
        (sweeper as unknown as { logger: { log: (message: string) => void } }).logger,
        "log",
      );
      const swept = jest.spyOn(retention.schedule, "swept");
      sweeper.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(2 * 3_600_000);

      expect(log).toHaveBeenCalledWith(expect.stringMatching(/tombstoned 5 artifact\(s\)/));
      expect(scheduler.doesExist("timeout", ARTIFACT_RETENTION_SWEEP)).toBe(true);
      // Jitter may fit a second, empty tick into the window; the first reported the five.
      expect(swept).toHaveBeenCalledWith("artifacts", LATER, 5);
    } finally {
      sweeper.onApplicationShutdown();
      jest.useRealTimers();
    }
  });
});
