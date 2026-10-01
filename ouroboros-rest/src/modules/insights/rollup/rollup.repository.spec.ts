import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import type { RegisteredMetric } from "./rollup.registry";
import { RollupRepository } from "./rollup.repository";
import type { FamilyExtractor } from "./rollup.types";

/**
 * The rollup statements (BI.2, #433). The property everything else rests on is the shape of a
 * day's fill: one transaction that locks the family, extracts, replaces the day's rows and moves
 * the cursor — so a re-run is idempotent and an interruption loses only the day in flight. That is
 * proved against a real database by `rollup.integration-spec.ts`; this pins the statements.
 */

const ORG = "org-rollup";
const DAY = "2026-08-04";

const REGISTRY = new Map<string, RegisteredMetric>([
  [
    "merged_prs",
    { metricId: "merged_prs", family: "throughput", version: 1, isRate: false, aggregation: "sum" },
  ],
  [
    "merge_rate",
    {
      metricId: "merge_rate",
      family: "throughput",
      version: 1,
      isRate: true,
      aggregation: "ratio",
    },
  ],
  [
    "cycle_time",
    { metricId: "cycle_time", family: "cycle", version: 1, isRate: false, aggregation: "median" },
  ],
]);

/**
 * An extractor that answers fixed rows.
 *
 * @param rows - What it answers.
 * @returns The extractor.
 */
function extractorOf(rows: Awaited<ReturnType<FamilyExtractor["extract"]>>): FamilyExtractor {
  return {
    family: "throughput",
    metrics: { merged_prs: 1, merge_rate: 1 },
    extract: jest.fn().mockResolvedValue(rows),
  };
}

describe("the rollup repository", () => {
  let database: RecordingDatabase;
  let repository: RollupRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new RollupRepository(database.service);
  });

  it("fills a backfill day in one transaction: lock, extract, replace, advance", async () => {
    const extractor = extractorOf([
      { repoRef: "acme/helios", metricId: "merged_prs", dimension: "", value: 6 },
      {
        repoRef: "acme/helios",
        metricId: "merge_rate",
        dimension: "",
        value: 50,
        numerator: 1,
        denominator: 2,
      },
    ]);

    await repository.fillDay(ORG, extractor, REGISTRY, DAY, "backfill");

    const sql = database.sql();

    expect(sql[0]).toBe("begin");
    expect(sql[1]).toContain("pg_advisory_xact_lock(hashtext('metric_rollup')");
    expect(sql[2]).toContain("delete from ouroboros.metric_daily");
    expect(sql[2]).toContain("metric_id = any($2::text[])");
    expect(sql[3]).toContain('insert into "ouroboros"."metric_daily"');
    expect(sql[4]).toContain("update ouroboros.metric_rollup_state");
    expect(sql[4]).toContain("backfill_cursor = $");
    expect(sql[5]).toBe("commit");

    expect(extractor.extract).toHaveBeenCalledWith(expect.anything(), ORG, DAY);
    expect(database.statements[1].parameters).toEqual([ORG, "throughput"]);
    expect(database.statements[2].parameters).toEqual([ORG, ["merged_prs", "merge_rate"], DAY]);
    // Each row states its definition's is_rate, and only a rate carries components.
    expect(database.statements[3].parameters).toEqual([
      ORG,
      "acme/helios",
      "merged_prs",
      false,
      "",
      DAY,
      6,
      null,
      null,
      "{}",
      ORG,
      "acme/helios",
      "merge_rate",
      true,
      "",
      DAY,
      50,
      1,
      2,
      "{}",
    ]);
  });

  it("fills today's tail without touching the cursor — today is not over", async () => {
    await repository.fillDay(ORG, extractorOf([]), REGISTRY, DAY, "tail");

    expect(database.sql()).toEqual([
      "begin",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("delete from ouroboros.metric_daily"),
      "commit",
    ]);
  });

  it("stores a median's samples in meta", async () => {
    const extractor: FamilyExtractor = {
      family: "cycle",
      metrics: { cycle_time: 1 },
      extract: () =>
        Promise.resolve([
          {
            repoRef: "acme/helios",
            metricId: "cycle_time",
            dimension: "",
            value: 15,
            samples: [10, 20],
          },
        ]),
    };

    await repository.fillDay(ORG, extractor, REGISTRY, DAY, "tail");

    expect(database.statements[3].parameters).toContain(JSON.stringify({ samples: [10, 20] }));
  });

  it("refuses a row for a metric the family does not declare, rolling the day back", async () => {
    const extractor = extractorOf([
      { repoRef: "acme/helios", metricId: "cycle_time", dimension: "", value: 1 },
    ]);

    await expect(repository.fillDay(ORG, extractor, REGISTRY, DAY, "tail")).rejects.toThrow(
      "throughput wrote cycle_time, which it does not declare",
    );
    expect(database.sql().at(-1)).toBe("rollback");
  });

  it("reads the registry, the state with dates as text, and the workspaces", async () => {
    database.answers(
      {
        rows: [
          {
            metric_id: "merge_rate",
            family: "throughput",
            version: 1,
            is_rate: true,
            aggregation: "ratio",
          },
        ],
      },
      { rows: [{ last_filled_day: "2026-08-31", backfill_cursor: null, backfill_until: null }] },
      { rows: [] },
      { rows: [{ id: "a" }, { id: "b" }] },
    );

    expect(await repository.registry()).toEqual(
      new Map([
        [
          "merge_rate",
          {
            metricId: "merge_rate",
            family: "throughput",
            version: 1,
            isRate: true,
            aggregation: "ratio",
          },
        ],
      ]),
    );
    expect(await repository.state(ORG, "throughput")).toEqual({
      lastFilledDay: "2026-08-31",
      backfillCursor: null,
      backfillUntil: null,
    });
    expect(await repository.state(ORG, "dora")).toBeUndefined();
    expect(await repository.organizations()).toEqual(["a", "b"]);
    expect(database.statements[1].sql).toContain("to_char(last_filled_day, 'YYYY-MM-DD')");
  });

  it("stamps a run, keeping an error only on failure, bounded", async () => {
    await repository.markRun(ORG, "dora", "succeeded", "ignored");
    await repository.markRun(ORG, "dora", "failed", "x".repeat(5000));

    expect(database.statements[0].parameters).toEqual([ORG, "dora", "succeeded", null]);
    expect(database.statements[1].parameters).toEqual([ORG, "dora", "failed", "x".repeat(2000)]);
    expect(database.statements[0].sql).toContain("on conflict (organization_id, family) do update");
  });

  it("starts a backfill, widening one already in progress rather than replacing it", async () => {
    await repository.startBackfill(ORG, "dora", "2026-08-01", "2026-08-31");

    expect(database.statements[0].sql).toContain(
      "least(coalesce(metric_rollup_state.backfill_cursor",
    );
    expect(database.statements[0].sql).toContain(
      "greatest(coalesce(metric_rollup_state.backfill_until",
    );
    expect(database.statements[0].parameters).toEqual([ORG, "dora", "2026-08-01", "2026-08-31"]);
  });
});
