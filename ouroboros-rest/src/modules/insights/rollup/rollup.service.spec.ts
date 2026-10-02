import type { AppConfigService } from "../../config/config.service";
import type { FamilyState } from "./rollup.plan";
import type { RegisteredMetric } from "./rollup.registry";
import type { RollupRepository } from "./rollup.repository";
import { RollupService } from "./rollup.service";
import type { FamilyExtractor } from "./rollup.types";

/**
 * One rollup pass (BI.2, #433): a due backfill is started and stepped within the per-tick bound,
 * today's tail is filled, a family whose registry entry moved refuses and says why, and one
 * family's failure does not stop the next.
 */

const NOW = new Date("2026-09-01T10:00:00.000Z");
const ORG = "org-rollup";

const CONFIG = {
  insightsRollupBackfillDays: 90,
  insightsRollupConsolidateDays: 3,
  insightsRollupDaysPerTick: 2,
} as unknown as AppConfigService;

const THROUGHPUT: FamilyExtractor = {
  family: "throughput",
  metrics: { merged_prs: 1 },
  extract: () => Promise.resolve([]),
};

const DORA: FamilyExtractor = {
  family: "dora",
  metrics: { mttr: 1 },
  extract: () => Promise.resolve([]),
};

const REGISTRY = new Map<string, RegisteredMetric>([
  [
    "merged_prs",
    { metricId: "merged_prs", family: "throughput", version: 1, isRate: false, aggregation: "sum" },
  ],
  ["mttr", { metricId: "mttr", family: "dora", version: 1, isRate: true, aggregation: "ratio" }],
]);

/**
 * A repository whose bookkeeping lives in memory and moves as the real one's does.
 *
 * @param initial - Each family's starting state.
 * @param registry - The registry it answers.
 * @returns The stand-in, and the record of filled days.
 */
function memoryRepository(
  initial: Record<string, FamilyState | undefined> = {},
  registry: Map<string, RegisteredMetric> = REGISTRY,
) {
  const states = new Map(Object.entries(initial));
  const filled: [string, string, string][] = [];
  const runs: [string, string, string?][] = [];

  const repository = {
    organizations: jest.fn().mockResolvedValue([ORG]),
    registry: jest.fn().mockResolvedValue(registry),
    state: jest.fn((_org: string, family: string) => Promise.resolve(states.get(family))),
    markRun: jest.fn((_org: string, family: string, status: string, error?: string) => {
      runs.push([family, status, error]);
      return Promise.resolve();
    }),
    startBackfill: jest.fn((_org: string, family: string, from: string, until: string) => {
      const state = states.get(family);
      states.set(family, {
        lastFilledDay: state?.lastFilledDay ?? null,
        backfillCursor:
          state?.backfillCursor != null && state.backfillCursor < from
            ? state.backfillCursor
            : from,
        backfillUntil:
          state?.backfillUntil != null && state.backfillUntil > until ? state.backfillUntil : until,
      });
      return Promise.resolve();
    }),
    fillDay: jest.fn(
      (_org: string, extractor: FamilyExtractor, _registry: unknown, day: string, move: string) => {
        filled.push([extractor.family, day, move]);

        const state = states.get(extractor.family);

        if (move === "backfill" && state?.backfillCursor === day && state.backfillUntil !== null) {
          const done = day >= state.backfillUntil;
          const next = new Date(`${day}T00:00:00.000Z`);

          next.setUTCDate(next.getUTCDate() + 1);
          states.set(extractor.family, {
            lastFilledDay: done ? state.backfillUntil : state.lastFilledDay,
            backfillCursor: done ? null : next.toISOString().slice(0, 10),
            backfillUntil: done ? null : state.backfillUntil,
          });
        }

        return Promise.resolve([]);
      },
    ),
  };

  return { repository, states, filled, runs };
}

/**
 * A service over a stand-in repository.
 *
 * @param repository - The stand-in.
 * @param extractors - The families.
 * @returns The service.
 */
function serviceOver(
  repository: object,
  extractors: FamilyExtractor[] = [THROUGHPUT],
): RollupService {
  return new RollupService(repository as unknown as RollupRepository, CONFIG, extractors);
}

describe("a rollup pass", () => {
  it("fills only today when yesterday is already filled", async () => {
    const { repository, filled, runs } = memoryRepository({
      throughput: { lastFilledDay: "2026-08-31", backfillCursor: null, backfillUntil: null },
    });

    const report = await serviceOver(repository).tick(NOW);

    expect(report.today).toBe("2026-09-01");
    expect(filled).toEqual([["throughput", "2026-09-01", "tail"]]);
    expect(runs).toEqual([
      ["throughput", "running", undefined],
      ["throughput", "succeeded", undefined],
    ]);
    expect(report.outcomes).toEqual([
      { organizationId: ORG, family: "throughput", status: "succeeded", backfilledDays: 0 },
    ]);
  });

  it("consolidates on the first tick of a new day, bounded per tick, and resumes on the next", async () => {
    const { repository, states, filled } = memoryRepository({
      throughput: { lastFilledDay: "2026-08-30", backfillCursor: null, backfillUntil: null },
    });
    const service = serviceOver(repository);

    await service.tick(NOW);

    expect(filled).toEqual([
      ["throughput", "2026-08-29", "backfill"],
      ["throughput", "2026-08-30", "backfill"],
      ["throughput", "2026-09-01", "tail"],
    ]);
    expect(states.get("throughput")).toEqual({
      lastFilledDay: "2026-08-30",
      backfillCursor: "2026-08-31",
      backfillUntil: "2026-08-31",
    });

    filled.length = 0;
    await service.tick(NOW);

    expect(filled).toEqual([
      ["throughput", "2026-08-31", "backfill"],
      ["throughput", "2026-09-01", "tail"],
    ]);
    expect(states.get("throughput")).toEqual({
      lastFilledDay: "2026-08-31",
      backfillCursor: null,
      backfillUntil: null,
    });
  });

  it("starts a first fill at the horizon", async () => {
    const { repository } = memoryRepository();

    await serviceOver(repository).tick(NOW);

    expect(repository.startBackfill).toHaveBeenCalledWith(
      ORG,
      "throughput",
      "2026-06-03",
      "2026-08-31",
    );
  });

  it("refuses a family whose registry entry moved, and still fills the next", async () => {
    const moved = new Map(REGISTRY);

    moved.set("merged_prs", { ...(REGISTRY.get("merged_prs") as RegisteredMetric), version: 2 });

    const { repository, filled, runs } = memoryRepository(
      {
        throughput: { lastFilledDay: "2026-08-31", backfillCursor: null, backfillUntil: null },
        dora: { lastFilledDay: "2026-08-31", backfillCursor: null, backfillUntil: null },
      },
      moved,
    );

    const report = await serviceOver(repository, [THROUGHPUT, DORA]).tick(NOW);

    expect(report.outcomes).toEqual([
      {
        organizationId: ORG,
        family: "throughput",
        status: "failed",
        backfilledDays: 0,
        error:
          "extractor and registry disagree: merged_prs is at registry version 2 but the " +
          "throughput extractor implements version 1",
      },
      { organizationId: ORG, family: "dora", status: "succeeded", backfilledDays: 0 },
    ]);
    expect(filled).toEqual([["dora", "2026-09-01", "tail"]]);
    expect(runs[0]).toEqual([
      "throughput",
      "failed",
      expect.stringContaining("version 2") as string,
    ]);
  });

  it("reports a fill that failed mid-backfill, with the days it did commit", async () => {
    const { repository, runs } = memoryRepository({
      throughput: { lastFilledDay: "2026-08-28", backfillCursor: null, backfillUntil: null },
    });
    const fill = repository.fillDay.getMockImplementation();

    repository.fillDay.mockImplementation((org, extractor, registry, day, move) =>
      day === "2026-08-30"
        ? Promise.reject(new Error("deploy"))
        : (fill?.(org, extractor, registry, day, move) ?? Promise.resolve([])),
    );

    const report = await serviceOver(repository).tick(NOW);

    expect(report.outcomes[0]).toEqual(
      expect.objectContaining({ status: "failed", backfilledDays: 1, error: "deploy" }),
    );
    expect(runs.at(-1)).toEqual(["throughput", "failed", "deploy"]);
  });

  it("still reports a failure it could not record", async () => {
    const { repository } = memoryRepository();

    repository.registry.mockResolvedValue(new Map());
    repository.markRun.mockRejectedValue(new Error("database gone"));

    const report = await serviceOver(repository).tick(NOW);

    expect(report.outcomes[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("not in the metric registry") as string,
      }),
    );
  });
});

describe("an operator backfill", () => {
  it("records the range and fills it to the end, regardless of the per-tick bound", async () => {
    const { repository, filled } = memoryRepository({
      throughput: { lastFilledDay: "2026-08-31", backfillCursor: null, backfillUntil: null },
    });

    const outcome = await serviceOver(repository).backfill(
      ORG,
      "throughput",
      "2026-08-01",
      "2026-08-05",
      NOW,
    );

    expect(outcome).toEqual({
      organizationId: ORG,
      family: "throughput",
      status: "succeeded",
      backfilledDays: 5,
    });
    expect(filled.filter(([, , move]) => move === "backfill").map(([, day]) => day)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
  });

  it.each([
    ["nonsense", "2026-08-01", "2026-08-05", "no rollup family named nonsense"],
    ["throughput", "2026-08-05", "2026-08-01", "a backfill is a range of whole days"],
    ["throughput", "2026-08-01", "2026-09-01", "a backfill is a range of whole days"],
    ["throughput", "2026-02-30", "2026-08-01", "a backfill is a range of whole days"],
    ["throughput", "2026-01-01", "2026-08-01", "a backfill spans at most 90 days"],
  ])("refuses %s %s … %s", async (family, from, until, message) => {
    const { repository } = memoryRepository();

    await expect(serviceOver(repository).backfill(ORG, family, from, until, NOW)).rejects.toThrow(
      message,
    );
    expect(repository.startBackfill).not.toHaveBeenCalled();
  });
});

describe("a one-day re-fill (#445)", () => {
  it("fills the day without moving a cursor, and stamps the family so caches retire", async () => {
    const { repository, filled, runs, states } = memoryRepository({
      throughput: { lastFilledDay: "2026-08-31", backfillCursor: null, backfillUntil: null },
    });

    await expect(
      serviceOver(repository).refillDay(ORG, "throughput", "2026-08-03", NOW),
    ).resolves.toEqual({
      organizationId: ORG,
      family: "throughput",
      status: "succeeded",
      backfilledDays: 0,
    });
    expect(filled).toEqual([["throughput", "2026-08-03", "tail"]]);
    expect(runs).toEqual([["throughput", "succeeded", undefined]]);
    expect(states.get("throughput")).toEqual({
      lastFilledDay: "2026-08-31",
      backfillCursor: null,
      backfillUntil: null,
    });
  });

  it("fills today too — a correction to an event detected this morning", async () => {
    const { repository, filled } = memoryRepository();

    await serviceOver(repository).refillDay(ORG, "throughput", "2026-09-01", NOW);

    expect(filled).toEqual([["throughput", "2026-09-01", "tail"]]);
  });

  it("records and reports a failed fill rather than rejecting", async () => {
    const { repository, runs } = memoryRepository();

    repository.fillDay.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      serviceOver(repository).refillDay(ORG, "throughput", "2026-08-03", NOW),
    ).resolves.toMatchObject({ status: "failed", error: "connection reset" });
    expect(runs).toEqual([["throughput", "failed", "connection reset"]]);
  });

  it("refuses a family whose registry entry moved", async () => {
    const { repository, filled } = memoryRepository({}, new Map());

    await expect(
      serviceOver(repository).refillDay(ORG, "throughput", "2026-08-03", NOW),
    ).resolves.toMatchObject({ status: "failed" });
    expect(filled).toEqual([]);
  });

  it.each([
    ["nonsense", "2026-08-03", "no rollup family named nonsense"],
    ["throughput", "2026-09-02", "a re-fill is one whole day up to 2026-09-01"],
    ["throughput", "2026-02-30", "a re-fill is one whole day"],
  ])("refuses %s %s", async (family, day, message) => {
    const { repository } = memoryRepository();

    await expect(serviceOver(repository).refillDay(ORG, family, day, NOW)).rejects.toThrow(message);
    expect(repository.fillDay).not.toHaveBeenCalled();
  });
});
