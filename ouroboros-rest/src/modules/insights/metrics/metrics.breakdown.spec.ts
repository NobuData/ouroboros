/**
 * `MetricsService.windows` and `.breakdown` (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)) — the batch read and the
 * per-label read the Insights page is assembled from.
 *
 * Both must be the **same answer** `window()` gives, reached with fewer reads: a page that
 * computed a number a second way would be the second implementation decision I1 forbids. So each
 * case here compares against `window()` on a fresh service, and counts the scans and tails.
 */

import { medianRow, sumRow } from "../rollup/rollup.rows";
import type { Day, FamilyExtractor, RollupRow } from "../rollup/rollup.types";
import { MetricsCache } from "./metrics.cache";
import type { MetricDefinition, MetricsRepository, RowFilter } from "./metrics.repository";
import { MetricsService, MetricWindowError } from "./metrics.service";
import type { DailyRow } from "./metrics.types";
import type { DaySpan } from "./metrics.window";

const ORG = "org-metrics";
const OTHER = "org-neighbour";
const REPO = "acme/helios";
const NOW = new Date("2026-09-10T14:00:00.000Z");
const TODAY: Day = "2026-09-10";

/** A registry entry with the fields a case varies. */
function definition(
  metricId: string,
  family: string,
  unit: MetricDefinition["unit"],
  aggregation: MetricDefinition["aggregation"],
  dimensionKind: MetricDefinition["dimensionKind"] = null,
): [string, MetricDefinition] {
  return [
    metricId,
    {
      metricId,
      family,
      title: `Title of ${metricId}`,
      formulaText: `Formula of ${metricId}`,
      sourcePlanes: ["runs"],
      caveats: `Caveats of ${metricId}`,
      unit,
      isRate: aggregation === "ratio",
      version: 1,
      proxy: false,
      aggregation,
      dimensionKind,
    },
  ];
}

const DEFINITIONS = new Map<string, MetricDefinition>([
  definition("merged_prs", "throughput", "count", "sum"),
  definition("cost_cents", "cost", "cents", "sum"),
  definition("tokens", "cost", "tokens", "sum"),
  definition("cost_per_merged_pr", "cost", "cents", "ratio"),
  definition("human_interventions", "interventions", "count", "sum", "cause"),
  definition("stage_duration", "cycle", "duration_ms", "median", "stage"),
  definition("estimate_within_band_rate", "calibration", "pct", "ratio"),
]);

/** A stored row. */
function stored(
  day: Day,
  metricId: string,
  value: number,
  extra: Partial<DailyRow> = {},
  organizationId = ORG,
): DailyRow & { organizationId: string } {
  return {
    organizationId,
    day,
    metricId,
    repoRef: REPO,
    dimension: "",
    value,
    numerator: null,
    denominator: null,
    samples: [],
    meta: {},
    ...extra,
  };
}

/** The rollup as it stands: both windows of a 7-day range ending 2026-09-10, and a neighbour. */
const ROLLUP = [
  // this window (Sep 4 – Sep 10; today comes from the tail)
  stored("2026-09-05", "merged_prs", 3, { meta: { cost_cents: 500, interventions: 1 } }),
  stored("2026-09-08", "merged_prs", 2),
  stored("2026-09-05", "cost_cents", 500),
  stored("2026-09-08", "cost_cents", 250),
  stored("2026-09-05", "tokens", 9000),
  stored("2026-09-05", "human_interventions", 2, { dimension: "infra_rig" }),
  stored("2026-09-08", "human_interventions", 1, { dimension: "ambiguous_ticket" }),
  stored("2026-09-06", "stage_duration", 300, { dimension: "implement", samples: [200, 300, 400] }),
  stored("2026-09-07", "stage_duration", 900, { dimension: "implement", samples: [900] }),
  stored("2026-09-06", "stage_duration", 60, { dimension: "plan", samples: [50, 70] }),
  // the prior window (Aug 28 – Sep 3)
  stored("2026-08-30", "merged_prs", 4),
  stored("2026-08-30", "cost_cents", 1200),
  stored("2026-08-30", "human_interventions", 3, { dimension: "infra_rig" }),
  stored("2026-08-31", "human_interventions", 5, { dimension: "policy_gate" }),
  // another workspace, same repository reference
  stored("2026-09-05", "human_interventions", 40, { dimension: "infra_rig" }, OTHER),
  stored("2026-09-05", "merged_prs", 99, {}, OTHER),
];

/** Today's rows, as each family's extractor answers them live. */
const LIVE: Readonly<Record<string, readonly RollupRow[]>> = {
  throughput: [sumRow({ repoRef: REPO, metricId: "merged_prs" }, 1)],
  cost: [
    sumRow({ repoRef: REPO, metricId: "cost_cents" }, 100),
    sumRow({ repoRef: REPO, metricId: "tokens" }, 1000),
  ],
  interventions: [
    sumRow({ repoRef: REPO, metricId: "human_interventions", dimension: "infra_rig" }, 1),
  ],
  cycle: [medianRow({ repoRef: REPO, metricId: "stage_duration", dimension: "implement" }, [500])],
};

/** The families, each counting its live runs. */
function extractors(): FamilyExtractor[] {
  const family = (name: string, metrics: Record<string, number>): FamilyExtractor => ({
    family: name,
    metrics,
    extract: jest.fn((_db, organizationId: string) =>
      Promise.resolve(organizationId === ORG ? [...LIVE[name]] : []),
    ),
  });

  return [
    family("throughput", { merged_prs: 1 }),
    family("cost", { cost_cents: 1, tokens: 1 }),
    family("interventions", { human_interventions: 2 }),
    family("cycle", { stage_duration: 1 }),
  ];
}

/** A service over the rollup above, and the reads it made. */
function build() {
  const families = extractors();
  const scan = jest.fn((organizationId: string, filter: RowFilter, span: DaySpan) =>
    Promise.resolve(
      ROLLUP.filter(
        (row) =>
          row.organizationId === organizationId &&
          filter.metricIds.includes(row.metricId) &&
          (filter.repo === undefined || row.repoRef === filter.repo) &&
          (filter.dimension === undefined || row.dimension === filter.dimension) &&
          row.day >= span.from &&
          row.day <= span.to,
      ),
    ),
  );
  const tail = jest.fn(
    async (organizationId: string, extractor: FamilyExtractor, day: Day, filter: RowFilter) =>
      (await extractor.extract(undefined as never, organizationId, day))
        .filter(
          (row) =>
            filter.metricIds.includes(row.metricId) &&
            (filter.dimension === undefined || row.dimension === filter.dimension),
        )
        .map((row): DailyRow => ({
          day,
          metricId: row.metricId,
          repoRef: row.repoRef,
          dimension: row.dimension,
          value: row.value,
          numerator: row.numerator ?? null,
          denominator: row.denominator ?? null,
          samples: row.samples ?? [],
          meta: {},
        })),
  );
  const repository = {
    scan,
    tail,
    stamp: jest.fn().mockResolvedValue("stamp-1"),
    definitions: jest.fn().mockResolvedValue(DEFINITIONS),
  } as unknown as MetricsRepository;

  return { service: new MetricsService(repository, new MetricsCache(), families), scan, tail };
}

const SCOPE = { organizationId: ORG, range: "7d", now: NOW } as const;

describe("MetricsService.windows — several metrics in one read", () => {
  const IDS = ["merged_prs", "cost_cents", "tokens", "cost_per_merged_pr", "human_interventions"];

  it("answers each metric exactly as window() answers it alone", async () => {
    const together = await build().service.windows(IDS, SCOPE);

    for (const metricId of IDS) {
      expect(together.get(metricId)).toEqual(await build().service.window(metricId, SCOPE));
    }
    expect([...together.keys()]).toEqual(IDS);
    expect(together.get("merged_prs")).toMatchObject({ value: 6, prior: 4, delta: 2 });
    expect(together.get("cost_per_merged_pr")).toMatchObject({
      components: { numerator: 850, denominator: 6 },
    });
    // The undimensioned read of a dimensioned sum is every cause together.
    expect(together.get("human_interventions")).toMatchObject({ value: 4, prior: 8 });
  });

  it("reads the grain once and each family's live tail once, however many metrics", async () => {
    const { service, scan, tail } = build();

    await service.windows(IDS, SCOPE);

    expect(scan).toHaveBeenCalledTimes(1);
    // throughput, cost and interventions: three families for five metrics.
    expect(tail).toHaveBeenCalledTimes(3);
    for (const [organizationId, , day] of tail.mock.calls) {
      expect(organizationId).toBe(ORG);
      expect(day).toBe(TODAY);
    }
  });

  it("keeps a day's tooltip figures to the metric's own rows", async () => {
    const together = await build().service.windows(["merged_prs", "cost_cents"], SCOPE);
    const metaOn = (metricId: string, day: Day) =>
      together.get(metricId)?.series.find((point) => point.day === day)?.meta;

    expect(metaOn("merged_prs", "2026-09-05")).toEqual({ cost_cents: 500, interventions: 1 });
    // Read in the same scan, and not handed its neighbour's meta.
    expect(metaOn("cost_cents", "2026-09-05")).toEqual({});
  });

  it("serves a single window() afterwards from the cache, and reads a repeated id once", async () => {
    const { service, scan } = build();

    const together = await service.windows(["merged_prs", "merged_prs", "tokens"], SCOPE);
    const alone = await service.window("tokens", SCOPE);

    expect([...together.keys()]).toEqual(["merged_prs", "tokens"]);
    expect(alone).toBe(together.get("tokens"));
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("reads only what the cache does not already hold", async () => {
    const { service, scan } = build();

    await service.window("merged_prs", SCOPE);
    await service.windows(["merged_prs", "cost_cents"], SCOPE);

    expect(scan.mock.calls[1][1].metricIds).toEqual(["cost_cents"]);
  });

  it("refuses the whole read for a metric window() would refuse", async () => {
    const { service } = build();

    await expect(service.windows(["merged_prs", "vanity_rate"], SCOPE)).rejects.toThrow(
      MetricWindowError,
    );
    await expect(service.windows(["merged_prs", "stage_duration"], SCOPE)).rejects.toThrow(
      /needs a dimension/,
    );
    await expect(
      service.windows(["merged_prs", "estimate_within_band_rate"], SCOPE),
    ).rejects.toThrow(/no rollup family fills it/);
  });
});

describe("MetricsService.breakdown — one window per label", () => {
  it("lists every label with a row in the window or its prior, ascending", async () => {
    const breakdown = await build().service.breakdown("human_interventions", SCOPE);

    expect(breakdown).toMatchObject({
      metricId: "human_interventions",
      dimensionKind: "cause",
      range: "7d",
      from: "2026-09-04",
      to: TODAY,
      methodology: { metricId: "human_interventions" },
    });
    expect(
      breakdown.entries.map(({ dimension, window }) => [dimension, window.value, window.prior]),
    ).toEqual([
      ["ambiguous_ticket", 1, 0],
      // Two stored and one from this morning's live tail.
      ["infra_rig", 3, 3],
      // Quiet this window: still listed, so its drop from 5 is visible.
      ["policy_gate", 0, 5],
    ]);
  });

  it("answers each label exactly as window() answers it with that dimension", async () => {
    const breakdown = await build().service.breakdown("human_interventions", SCOPE);

    for (const { dimension, window } of breakdown.entries) {
      expect(window).toEqual(
        await build().service.window("human_interventions", { ...SCOPE, dimension }),
      );
    }
    // And the labels add up to the undimensioned total.
    expect(breakdown.entries.reduce((total, entry) => total + (entry.window.value ?? 0), 0)).toBe(
      (await build().service.window("human_interventions", SCOPE)).value,
    );
  });

  it("pools a median's samples per label, never across labels", async () => {
    const breakdown = await build().service.breakdown("stage_duration", SCOPE);

    expect(breakdown.entries.map(({ dimension, window }) => [dimension, window.value])).toEqual([
      // 200, 300, 400, 900 stored and 500 live: the pooled median, not a median of medians.
      ["implement", 400],
      ["plan", 60],
    ]);
  });

  it("reads the grain once and the family's tail once, then answers from the cache", async () => {
    const { service, scan, tail } = build();

    const first = await service.breakdown("human_interventions", SCOPE);
    const second = await service.breakdown("human_interventions", SCOPE);

    expect(second).toBe(first);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(tail).toHaveBeenCalledTimes(1);
    // No dimension filter: a breakdown is all of them.
    expect(scan.mock.calls[0][1].dimension).toBeUndefined();
  });

  it("never answers a window with a cached breakdown, or the reverse", async () => {
    const { service } = build();

    const total = await service.window("human_interventions", SCOPE);
    const breakdown = await service.breakdown("human_interventions", SCOPE);

    expect(total.value).toBe(4);
    expect(breakdown.entries).toHaveLength(3);
    expect((await service.window("human_interventions", SCOPE)).value).toBe(4);
  });

  it("reads the requesting workspace only", async () => {
    const { service, scan } = build();

    const breakdown = await service.breakdown("human_interventions", SCOPE);
    const neighbours = await service.breakdown("human_interventions", {
      ...SCOPE,
      organizationId: OTHER,
    });

    expect(scan.mock.calls.map(([organizationId]) => organizationId)).toEqual([ORG, OTHER]);
    // The neighbour's forty infra_rig events are in neither of this workspace's figures.
    expect(breakdown.entries.find((entry) => entry.dimension === "infra_rig")?.window.value).toBe(
      3,
    );
    expect(neighbours.entries.map(({ dimension, window }) => [dimension, window.value])).toEqual([
      ["infra_rig", 40],
    ]);
  });

  it("refuses a metric with no dimension, or not in the registry", async () => {
    const { service } = build();

    await expect(service.breakdown("merged_prs", SCOPE)).rejects.toThrow(/has no dimension/);
    await expect(service.breakdown("vanity_rate", SCOPE)).rejects.toThrow(MetricWindowError);
  });
});
