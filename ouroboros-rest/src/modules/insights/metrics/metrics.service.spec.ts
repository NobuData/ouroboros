import { dayBounds } from "../rollup/rollup.days";
import { median, medianRow, ratioRow, sumRow } from "../rollup/rollup.rows";
import type { Day, FamilyExtractor, RollupRow } from "../rollup/rollup.types";
import { MetricsCache } from "./metrics.cache";
import type { MetricDefinition, MetricsRepository, RowFilter } from "./metrics.repository";
import { MetricsService, MetricWindowError } from "./metrics.service";
import type { DailyRow } from "./metrics.types";
import { daysOf, METRIC_RANGES, resolveWindow, type DaySpan } from "./metrics.window";

/**
 * The windowed metrics service (BJ.1, #437), against an on-the-fly oracle.
 *
 * The sources here are an in-memory list of events. A stand-in extractor buckets them into UTC
 * days exactly as the real ones do, and a stand-in repository serves those days as the rollup
 * (every past day filled) and today as the live tail. The oracle computes each window straight
 * from the events, so the window matrix checks the service's boundaries, recomposition and prior
 * window against arithmetic that shares none of its code.
 */

const ORG = "org-metrics";
const OTHER = "org-neighbour";

/** One closed loop PR: when, where, whether it merged autonomously, and its cycle. */
interface LoopEvent {
  readonly org: string;
  readonly at: Date;
  readonly repo: string;
  readonly merged: boolean;
  readonly autonomous: boolean;
  readonly cycleMs: number;
  readonly costCents: number;
}

/** A deterministic generator, so the matrix is reproducible. */
function prng(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/**
 * Two hundred days of loops for two workspaces, ending at `until`.
 *
 * @param until - The last instant any event may have.
 * @returns The events.
 */
function history(until: Date): LoopEvent[] {
  const random = prng(437);
  const out: LoopEvent[] = [];
  const start = until.getTime() - 200 * 86_400_000;

  for (let at = start; at <= until.getTime(); at += Math.floor(random() * 7 * 3_600_000)) {
    const merged = random() < 0.85;

    out.push({
      org: random() < 0.8 ? ORG : OTHER,
      at: new Date(at),
      repo: random() < 0.6 ? "acme/helios" : "acme/zephyr",
      merged,
      autonomous: merged && random() < 0.9,
      cycleMs: Math.floor(random() * 3_600_000),
      costCents: Math.floor(random() * 500),
    });
  }

  return out;
}

const DEFINITIONS = new Map<string, MetricDefinition>(
  (
    [
      ["merged_prs", "throughput", "count", "sum", false],
      ["merge_rate", "throughput", "pct", "ratio", true],
      ["cycle_time", "cycle", "duration_ms", "median", false],
      ["cost_cents", "cost", "cents", "sum", false],
      ["cost_per_merged_pr", "cost", "cents", "ratio", true],
      ["stage_duration", "cycle", "duration_ms", "median", false],
      ["estimate_within_band_rate", "calibration", "pct", "ratio", true],
    ] as const
  ).map(([metricId, family, unit, aggregation, isRate]) => [
    metricId,
    {
      metricId,
      family,
      title: `Title of ${metricId}`,
      formulaText: `Formula of ${metricId}`,
      sourcePlanes: ["pull_requests", "runs"],
      caveats: `Caveats of ${metricId}`,
      unit,
      isRate,
      version: metricId === "merge_rate" ? 3 : 1,
      proxy: false,
      aggregation,
      dimensionKind: metricId === "stage_duration" ? "stage" : null,
    },
  ]),
);

/**
 * The stand-in extractors over a list of events, bucketing by UTC day like the real ones.
 *
 * @param events - The sources.
 * @returns The families.
 */
function extractorsOver(events: readonly LoopEvent[]): FamilyExtractor[] {
  const on = (org: string, day: Day): LoopEvent[] => {
    const { from, to } = dayBounds(day);

    return events.filter((e) => e.org === org && e.at >= from && e.at < to);
  };
  const byRepo = (list: LoopEvent[]): Map<string, LoopEvent[]> => {
    const out = new Map<string, LoopEvent[]>();
    for (const e of list) out.set(e.repo, [...(out.get(e.repo) ?? []), e]);
    return out;
  };

  return [
    {
      family: "throughput",
      metrics: { merged_prs: 1, merge_rate: 3 },
      extract: jest.fn((_db, org: string, day: Day) =>
        Promise.resolve(
          [...byRepo(on(org, day))].flatMap(([repoRef, list]): RollupRow[] => [
            sumRow({ repoRef, metricId: "merged_prs" }, list.filter((e) => e.merged).length),
            ratioRow(
              { repoRef, metricId: "merge_rate" },
              list.filter((e) => e.autonomous).length,
              list.length,
              100,
            ),
          ]),
        ),
      ),
    },
    {
      family: "cycle",
      metrics: { cycle_time: 1, stage_duration: 1 },
      extract: jest.fn((_db, org: string, day: Day) =>
        Promise.resolve(
          [...byRepo(on(org, day).filter((e) => e.merged))].map(([repoRef, list]) =>
            medianRow(
              { repoRef, metricId: "cycle_time" },
              list.map((e) => e.cycleMs),
            ),
          ),
        ),
      ),
    },
    {
      family: "cost",
      metrics: { cost_cents: 1 },
      extract: jest.fn((_db, org: string, day: Day) =>
        Promise.resolve(
          [...byRepo(on(org, day))].map(([repoRef, list]) =>
            sumRow(
              { repoRef, metricId: "cost_cents" },
              list.reduce((total, e) => total + e.costCents, 0),
            ),
          ),
        ),
      ),
    },
  ];
}

/** A repository stand-in, with its calls recorded. */
interface FakeRepository {
  readonly repository: MetricsRepository;
  readonly scan: jest.Mock;
  readonly tail: jest.Mock;
  readonly stamp: jest.Mock;
  readonly definitions: jest.Mock;
}

/**
 * A repository serving every past day from the extractors (the filled rollup) and today live.
 *
 * @param extractors - The families.
 * @returns The stand-in.
 */
function repositoryOver(extractors: readonly FamilyExtractor[]): FakeRepository {
  const keep = (filter: RowFilter) => (row: RollupRow) =>
    filter.metricIds.includes(row.metricId) &&
    (filter.repo === undefined || row.repoRef === filter.repo) &&
    (filter.dimension === undefined || row.dimension === filter.dimension);
  const daily = (day: Day, row: RollupRow): DailyRow => ({
    day,
    metricId: row.metricId,
    repoRef: row.repoRef,
    dimension: row.dimension,
    value: row.value,
    numerator: row.numerator ?? null,
    denominator: row.denominator ?? null,
    samples: row.samples ?? [],
    meta: {},
  });

  const scan = jest.fn(async (org: string, filter: RowFilter, span: DaySpan) => {
    const out: DailyRow[] = [];
    for (const day of daysOf(span)) {
      for (const extractor of extractors) {
        const rows = await extractor.extract(undefined as never, org, day);
        out.push(...rows.filter(keep(filter)).map((row) => daily(day, row)));
      }
    }
    return out;
  });
  const tail = jest.fn(
    async (org: string, extractor: FamilyExtractor, day: Day, filter: RowFilter) =>
      (await extractor.extract(undefined as never, org, day))
        .filter(keep(filter))
        .map((row) => daily(day, row)),
  );
  const stamp = jest.fn().mockResolvedValue("stamp-1");
  const definitions = jest.fn().mockResolvedValue(DEFINITIONS);

  return {
    repository: { scan, tail, stamp, definitions } as unknown as MetricsRepository,
    scan,
    tail,
    stamp,
    definitions,
  };
}

/**
 * The oracle: a metric over a span of UTC days, straight from the events.
 *
 * @param events - The sources.
 * @param metricId - `merge_rate`, `merged_prs`, `cycle_time` or `cost_per_merged_pr`.
 * @param span - The days.
 * @param repo - One repository, or all.
 * @returns The figure, or null.
 */
function oracle(
  events: readonly LoopEvent[],
  metricId: string,
  span: DaySpan,
  repo?: string,
): number | null {
  const from = dayBounds(span.from).from;
  const to = dayBounds(span.to).to;
  const inside = events.filter(
    (e) => e.org === ORG && e.at >= from && e.at < to && (repo === undefined || e.repo === repo),
  );
  const merged = inside.filter((e) => e.merged);

  switch (metricId) {
    case "merged_prs":
      return merged.length;
    case "merge_rate":
      return inside.length === 0
        ? null
        : (100 * inside.filter((e) => e.autonomous).length) / inside.length;
    case "cycle_time":
      return merged.length === 0
        ? null
        : median(merged.map((e) => e.cycleMs).sort((a, b) => a - b));
    case "cost_per_merged_pr":
      return merged.length === 0
        ? null
        : inside.reduce((total, e) => total + e.costCents, 0) / merged.length;
    default:
      throw new Error(metricId);
  }
}

/**
 * Assert a figure equals the oracle's, null for null.
 *
 * @param actual - The service's figure.
 * @param expected - The oracle's.
 */
function expectFigure(actual: number | null, expected: number | null): void {
  if (expected === null) {
    expect(actual).toBeNull();
  } else {
    expect(actual).toBeCloseTo(expected, 9);
  }
}

/** Instants across month and week boundaries, each written in several offsets. */
const MATRIX_INSTANTS = [
  "2026-09-01T00:00:00.000Z",
  "2026-08-31T23:59:59.000Z",
  "2026-03-01T06:00:00.000+05:30",
  "2026-08-10T09:00:00.000-07:00",
  "2026-08-16T23:30:00.000+14:00",
  "2027-01-01T01:00:00.000-12:00",
];

describe("the windowed metrics service", () => {
  describe("the window matrix against the oracle", () => {
    const cases = METRIC_RANGES.flatMap((range) =>
      MATRIX_INSTANTS.flatMap((instant) =>
        ["merge_rate", "merged_prs", "cycle_time", "cost_per_merged_pr"].map(
          (metricId) => [range, instant, metricId] as const,
        ),
      ),
    );

    it.each(cases)("%s at %s: %s", async (range, instant, metricId) => {
      const now = new Date(instant);
      const events = history(now);
      const fake = repositoryOver(extractorsOver(events));
      const service = new MetricsService(
        fake.repository,
        new MetricsCache(),
        extractorsOver(events),
      );
      const resolved = resolveWindow(range, now);

      const window = await service.window(metricId, { organizationId: ORG, range, now });

      const value = oracle(events, metricId, resolved.current);
      const prior = oracle(events, metricId, resolved.prior);

      expect(window.from).toBe(resolved.current.from);
      expect(window.to).toBe(resolved.current.to);
      expectFigure(window.value, value);
      expectFigure(window.prior, prior);
      expectFigure(window.delta, value === null || prior === null ? null : value - prior);
      expect(window.series).toHaveLength(resolved.days);
      // Every series point is its own day, by the same oracle.
      for (const point of window.series) {
        expectFigure(point.value, oracle(events, metricId, { from: point.day, to: point.day }));
      }
    });

    it("matches the oracle for one repository too", async () => {
      const now = new Date("2026-09-01T15:00:00.000Z");
      const events = history(now);
      const service = new MetricsService(
        repositoryOver(extractorsOver(events)).repository,
        new MetricsCache(),
        extractorsOver(events),
      );

      const window = await service.window("merge_rate", {
        organizationId: ORG,
        repo: "acme/zephyr",
        range: "30d",
        now,
      });

      expectFigure(
        window.value,
        oracle(events, "merge_rate", resolveWindow("30d", now).current, "acme/zephyr"),
      );
    });
  });

  describe("rate recomposition", () => {
    it("is exact where averaging daily rates gives a visibly different answer", async () => {
      // Yesterday one PR closed and merged autonomously (100%); today forty closed and ten
      // merged autonomously (25%). The mean of the daily rates is 62.5%; the truth is 11/41.
      const now = new Date("2026-09-01T18:00:00.000Z");
      const event = (at: string, autonomous: boolean): LoopEvent => ({
        org: ORG,
        at: new Date(at),
        repo: "acme/helios",
        merged: true,
        autonomous,
        cycleMs: 1000,
        costCents: 10,
      });
      const events = [
        event("2026-08-31T10:00:00.000Z", true),
        ...Array.from({ length: 40 }, (_, i) => event("2026-09-01T09:00:00.000Z", i < 10)),
      ];
      const service = new MetricsService(
        repositoryOver(extractorsOver(events)).repository,
        new MetricsCache(),
        extractorsOver(events),
      );

      const window = await service.window("merge_rate", { organizationId: ORG, range: "7d", now });

      expect(window.components).toEqual({ numerator: 11, denominator: 41 });
      expect(window.value).toBeCloseTo((100 * 11) / 41, 12);
      expect(window.value).not.toBeCloseTo(62.5, 0);
    });
  });

  describe("the live tail", () => {
    const now = new Date("2026-09-01T14:00:00.000Z");

    it("brings today's data in, bounded to today, once per family", async () => {
      const events = history(now);
      const extractors = extractorsOver(events);
      const fake = repositoryOver(extractors);
      const service = new MetricsService(fake.repository, new MetricsCache(), extractors);

      const window = await service.window("cost_per_merged_pr", {
        organizationId: ORG,
        range: "90d",
        now,
      });

      // Two families (cost and throughput), one tail each, for today and no other day.
      expect(fake.tail).toHaveBeenCalledTimes(2);
      for (const [org, , day] of fake.tail.mock.calls as [string, unknown, Day][]) {
        expect(org).toBe(ORG);
        expect(day).toBe("2026-09-01");
      }
      // The scan never reads today, so the tail is the only source of it.
      const [[, , span]] = fake.scan.mock.calls as [string, RowFilter, DaySpan][];
      expect(span).toEqual({ from: "2026-03-06", to: "2026-08-31" });
      expect(window.series.at(-1)?.day).toBe("2026-09-01");
    });

    it("shows a merge from this morning that no rollup has seen", async () => {
      const events: LoopEvent[] = [
        {
          org: ORG,
          at: new Date("2026-09-01T08:00:00.000Z"),
          repo: "acme/helios",
          merged: true,
          autonomous: true,
          cycleMs: 1000,
          costCents: 10,
        },
      ];
      const extractors = extractorsOver(events);
      const service = new MetricsService(
        repositoryOver(extractors).repository,
        new MetricsCache(),
        extractors,
      );

      const window = await service.window("merged_prs", { organizationId: ORG, range: "7d", now });

      expect(window.value).toBe(1);
      expect(window.series.at(-1)).toEqual({ day: "2026-09-01", value: 1, meta: {} });
    });
  });

  describe("methodology", () => {
    it("attaches the registry entry, formula version included, to every response", async () => {
      const now = new Date("2026-09-01T14:00:00.000Z");
      const extractors = extractorsOver([]);
      const service = new MetricsService(
        repositoryOver(extractors).repository,
        new MetricsCache(),
        extractors,
      );

      for (const metricId of ["merge_rate", "merged_prs", "cycle_time", "cost_per_merged_pr"]) {
        const window = await service.window(metricId, { organizationId: ORG, range: "30d", now });
        const definition = DEFINITIONS.get(metricId);

        expect(window.methodology).toEqual({
          metricId,
          title: definition?.title,
          formula: definition?.formulaText,
          sources: definition?.sourcePlanes,
          caveats: definition?.caveats,
          unit: definition?.unit,
          version: definition?.version,
          proxy: false,
          aggregation: definition?.aggregation,
        });
      }
    });

    it("answers an empty window with nulls for rates and medians and zero for sums", async () => {
      const extractors = extractorsOver([]);
      const service = new MetricsService(
        repositoryOver(extractors).repository,
        new MetricsCache(),
        extractors,
      );
      const scope = { organizationId: ORG, range: "7d" as const, now: new Date("2026-09-01") };

      expect(await service.window("merge_rate", scope)).toMatchObject({
        value: null,
        prior: null,
        delta: null,
        components: { numerator: 0, denominator: 0 },
      });
      expect(await service.window("cycle_time", scope)).toMatchObject({ value: null });
      expect(await service.window("merged_prs", scope)).toMatchObject({
        value: 0,
        prior: 0,
        delta: 0,
      });
    });
  });

  describe("caching", () => {
    const now = new Date("2026-09-01T14:00:00.000Z");
    const scope = { organizationId: ORG, range: "30d" as const, now };

    it("serves a repeat request from the cache", async () => {
      const extractors = extractorsOver(history(now));
      const fake = repositoryOver(extractors);
      const service = new MetricsService(fake.repository, new MetricsCache(), extractors);

      const first = await service.window("merge_rate", scope);
      const second = await service.window("merge_rate", scope);

      expect(second).toBe(first);
      expect(fake.scan).toHaveBeenCalledTimes(1);
      expect(fake.stamp).toHaveBeenCalledTimes(2);
    });

    it("does not serve a stale window across a rollup refresh", async () => {
      // The rollup refreshed between the two requests: its stamp moved and its rows changed.
      const extractors = extractorsOver(history(now));
      const fake = repositoryOver(extractors);
      const service = new MetricsService(fake.repository, new MetricsCache(), extractors);

      const before = await service.window("merged_prs", scope);
      fake.stamp.mockResolvedValue("stamp-2");
      fake.scan.mockResolvedValueOnce([]);
      const after = await service.window("merged_prs", scope);

      expect(fake.scan).toHaveBeenCalledTimes(2);
      expect(after.value).not.toBe(before.value);
    });

    it("never answers one workspace with another's cached window", async () => {
      const events = history(now);
      const extractors = extractorsOver(events);
      const service = new MetricsService(
        repositoryOver(extractors).repository,
        new MetricsCache(),
        extractors,
      );

      const mine = await service.window("merged_prs", scope);
      const theirs = await service.window("merged_prs", { ...scope, organizationId: OTHER });

      expect(theirs).not.toBe(mine);
      expect(theirs.value).not.toBe(mine.value);
    });
  });

  describe("cross-tenant isolation", () => {
    it("asks every statement and every tail about the requesting workspace only", async () => {
      const now = new Date("2026-09-01T14:00:00.000Z");
      const extractors = extractorsOver(history(now));
      const fake = repositoryOver(extractors);
      const service = new MetricsService(fake.repository, new MetricsCache(), extractors);

      await service.window("cost_per_merged_pr", { organizationId: ORG, range: "7d", now });

      expect(fake.stamp).toHaveBeenCalledWith(ORG);
      for (const [org] of fake.scan.mock.calls as [string][]) expect(org).toBe(ORG);
      for (const [org] of fake.tail.mock.calls as [string][]) expect(org).toBe(ORG);
    });
  });

  describe("refusals", () => {
    const now = new Date("2026-09-01T14:00:00.000Z");
    const extractors = extractorsOver([]);
    const service = (): MetricsService =>
      new MetricsService(repositoryOver(extractors).repository, new MetricsCache(), extractors);

    it("refuses a metric that is not in the registry", async () => {
      await expect(
        service().window("vanity_rate", { organizationId: ORG, range: "7d", now }),
      ).rejects.toThrow(MetricWindowError);
    });

    it("refuses a metric no rollup family fills", async () => {
      await expect(
        service().window("estimate_within_band_rate", { organizationId: ORG, range: "7d", now }),
      ).rejects.toThrow(/no rollup family fills it/);
    });

    it("refuses a dimensioned median without a dimension, and answers with one", async () => {
      await expect(
        service().window("stage_duration", { organizationId: ORG, range: "7d", now }),
      ).rejects.toThrow(/needs a dimension/);
      await expect(
        service().window("stage_duration", {
          organizationId: ORG,
          range: "7d",
          now,
          dimension: "verify",
        }),
      ).resolves.toMatchObject({ value: null });
    });
  });

  it("uses its clock when no instant is given", async () => {
    const extractors = extractorsOver([]);
    const service = new MetricsService(
      repositoryOver(extractors).repository,
      new MetricsCache(),
      extractors,
      () => Date.parse("2026-09-01T14:00:00.000Z"),
    );

    const window = await service.window("merged_prs", { organizationId: ORG, range: "7d" });

    expect(window.to).toBe("2026-09-01");
    expect(window.from).toBe("2026-08-26");
  });
});
