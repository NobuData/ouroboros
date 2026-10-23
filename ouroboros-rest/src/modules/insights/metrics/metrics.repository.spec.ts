import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import type { FamilyExtractor } from "../rollup/rollup.types";
import { MetricsRepository, storedRow } from "./metrics.repository";

/**
 * The windowed metrics statements (BJ.1, #437): tenant scoping, the scan's bounds, and the live
 * tail's one-day bound.
 */

const ORG = "org-metrics";
const SPAN = { from: "2026-07-03", to: "2026-08-31" };
const FILTER = { metricIds: ["merge_rate"] };

describe("the metrics repository", () => {
  let database: RecordingDatabase;
  let repository: MetricsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new MetricsRepository(database.service);
  });

  describe("cross-tenant isolation", () => {
    it.each([
      ["stamp", (r: MetricsRepository) => r.stamp(ORG), [{ stamp: "" }]],
      ["scan", (r: MetricsRepository) => r.scan(ORG, FILTER, SPAN), []],
    ])("scopes %s to one workspace, by parameter", async (_name, read, rows) => {
      database.answers({ rows });

      await read(repository);

      const [statement] = database.statements;
      expect(statement.sql).toContain('"organization_id" = $');
      expect(statement.parameters).toContain(ORG);
    });

    it("hands the tail's extractor the workspace it was asked about", async () => {
      const extract = jest.fn().mockResolvedValue([]);

      await repository.tail(
        ORG,
        { family: "throughput", metrics: {}, extract },
        "2026-09-01",
        FILTER,
      );

      expect(extract).toHaveBeenCalledWith(database.service.db, ORG, "2026-09-01");
    });
  });

  describe("the scan", () => {
    it("reads the span's days as text, and filters metric, repository and dimension", async () => {
      await repository.scan(
        ORG,
        { metricIds: ["cost_cents", "merged_prs"], repo: "acme/helios", dimension: "" },
        SPAN,
      );

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain("to_char(day, 'YYYY-MM-DD')");
      expect(sql).toContain("day between $");
      expect(sql).toContain('"repo_ref" = $');
      expect(sql).toContain('"dimension" = $');
      expect(parameters).toEqual(
        expect.arrayContaining([
          ORG,
          "cost_cents",
          "merged_prs",
          SPAN.from,
          SPAN.to,
          "acme/helios",
        ]),
      );
    });

    it("reads every origin's rows, so the service can say which are present (DJ.2)", async () => {
      await repository.scan(ORG, FILTER, SPAN);

      const { sql } = database.statements[0];

      expect(sql).toContain('"origin"');
      expect(sql).toContain('"population"');
      expect(sql).not.toContain('"origin" =');
    });

    it("issues nothing for an empty span or no metrics", async () => {
      expect(await repository.scan(ORG, FILTER, { from: "2026-09-02", to: "2026-09-01" })).toEqual(
        [],
      );
      expect(await repository.scan(ORG, { metricIds: [] }, SPAN)).toEqual([]);
      expect(database.statements).toHaveLength(0);
    });

    it("maps numerics, samples and tooltip figures", async () => {
      database.answers({
        rows: [
          {
            day: "2026-08-04",
            metric_id: "cycle_time",
            repo_ref: "acme/helios",
            dimension: "",
            value: "860000",
            numerator: null,
            denominator: null,
            meta: { samples: [800000, 860000, 900000], label: "x", cost_cents: 912 },
            origin: "seeded",
            population: "3",
          },
        ],
      });

      const [row] = await repository.scan(ORG, FILTER, SPAN);

      expect(row).toEqual({
        day: "2026-08-04",
        metricId: "cycle_time",
        repoRef: "acme/helios",
        dimension: "",
        origin: "seeded",
        population: 3,
        value: 860000,
        numerator: null,
        denominator: null,
        samples: [800000, 860000, 900000],
        meta: { cost_cents: 912 },
      });
    });
  });

  describe("the live tail", () => {
    /** An extractor answering two repositories' rows for whatever day it is asked. */
    const extractor: FamilyExtractor = {
      family: "throughput",
      metrics: { merged_prs: 1, merge_rate: 1 },
      extract: jest.fn().mockResolvedValue([
        {
          repoRef: "acme/helios",
          metricId: "merged_prs",
          dimension: "",
          origin: "live",
          population: 2,
          value: 2,
        },
        {
          repoRef: "acme/helios",
          metricId: "merge_rate",
          dimension: "",
          origin: "live",
          population: 2,
          value: 50,
          numerator: 1,
          denominator: 2,
        },
        {
          repoRef: "acme/zephyr",
          metricId: "merged_prs",
          dimension: "",
          origin: "simulated",
          population: 1,
          value: 1,
        },
      ]),
    };

    it("is bounded to the one day it is given, and writes nothing", async () => {
      await repository.tail(ORG, extractor, "2026-09-01", { metricIds: ["merged_prs"] });

      expect(extractor.extract).toHaveBeenCalledTimes(1);
      expect(extractor.extract).toHaveBeenCalledWith(expect.anything(), ORG, "2026-09-01");
      expect(database.statements).toHaveLength(0);
    });

    it("keeps only the asked metrics and repository, dated today", async () => {
      const rows = await repository.tail(ORG, extractor, "2026-09-01", {
        metricIds: ["merged_prs"],
        repo: "acme/zephyr",
      });

      expect(rows).toEqual([
        {
          day: "2026-09-01",
          metricId: "merged_prs",
          repoRef: "acme/zephyr",
          dimension: "",
          origin: "simulated",
          population: 1,
          value: 1,
          numerator: null,
          denominator: null,
          samples: [],
          meta: {},
        },
      ]);
    });
  });

  it("fingerprints the rollup bookkeeping cheaply", async () => {
    database.answers({ rows: [{ stamp: "8 2026-09-01 10:00:00+00 x" }] });

    expect(await repository.stamp(ORG)).toBe("8 2026-09-01 10:00:00+00 x");
    expect(database.statements[0].sql).toContain('"ouroboros"."metric_rollup_state"');
    expect(database.statements[0].sql).toContain("max(last_run_at)");
  });

  it("reads the registry", async () => {
    database.answers({
      rows: [
        {
          metric_id: "merge_rate",
          family: "throughput",
          title: "Autonomous merge rate",
          formula_text: "autonomous / closed",
          source_planes: ["pull_requests", "runs"],
          caveats: "c",
          unit: "pct",
          is_rate: true,
          version: 1,
          proxy: false,
          aggregation: "ratio",
          dimension_kind: null,
          origin_rule: "Split per origin.",
        },
      ],
    });

    const definitions = await repository.definitions();

    expect(definitions.get("merge_rate")).toEqual({
      metricId: "merge_rate",
      family: "throughput",
      title: "Autonomous merge rate",
      formulaText: "autonomous / closed",
      sourcePlanes: ["pull_requests", "runs"],
      caveats: "c",
      unit: "pct",
      isRate: true,
      version: 1,
      proxy: false,
      aggregation: "ratio",
      dimensionKind: null,
      originRule: "Split per origin.",
    });
  });

  it("maps a ratio row's components to numbers", () => {
    expect(
      storedRow({
        day: "2026-08-04",
        metric_id: "merge_rate",
        repo_ref: null,
        dimension: "",
        value: "75.0",
        numerator: "3",
        denominator: "4",
        meta: {},
        origin: "live",
        population: null,
      }),
    ).toMatchObject({ repoRef: null, value: 75, numerator: 3, denominator: 4, samples: [] });
  });
});
