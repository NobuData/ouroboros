import { recordingDatabase, type RecordingDatabase } from "../../../db/database.fixture";
import { buildDurationExtractor } from "./build_duration.extractor";
import { buildsExtractor } from "./builds.extractor";
import { costExtractor } from "./cost.extractor";
import { cycleExtractor } from "./cycle.extractor";
import { doraExtractor, isReverted, recoveries } from "./dora.extractor";
import { effortExtractor } from "./effort.extractor";
import { interventionsExtractor } from "./interventions.extractor";
import { queueWaitExtractor } from "./queue_wait.extractor";
import { testsExtractor } from "./tests.extractor";
import { throughputExtractor } from "./throughput.extractor";

/**
 * Each extractor's statements and mapping, without a server (BI.2, #433).
 *
 * What a statement *computes* is the oracle parity suite's to prove against a migrated database
 * (`rollup.integration-spec.ts`). These assert what only a spec without one can pin cheaply: every
 * statement is scoped to the workspace and bounded to the UTC day, and the rows that come back
 * become the right `metric_daily` shapes — including the rows that must *not* be written.
 */

const ORG = "org-extract";
const DAY = "2026-08-04";
const FROM = new Date("2026-08-04T00:00:00.000Z");
const TO = new Date("2026-08-05T00:00:00.000Z");
const HELIOS = "acme/helios";

describe("the extractors", () => {
  let database: RecordingDatabase;

  beforeEach(() => {
    database = recordingDatabase();
  });

  /** Every statement must name the workspace and the day's bounds as parameters. */
  function expectScoped(): void {
    for (const statement of database.statements) {
      expect(statement.parameters).toContain(ORG);
    }

    expect(database.statements[0].parameters).toEqual(expect.arrayContaining([FROM, TO]));
  }

  it("throughput: counts merges, re-sums both rates, and writes no untouched rate without a merge", async () => {
    database.answers({
      rows: [
        {
          repo_ref: HELIOS,
          origin: "live",
          closed: "3",
          merged: "2",
          autonomous: "1",
          untouched: "1",
        },
        {
          repo_ref: "acme/zephyr",
          origin: "live",
          closed: "1",
          merged: "0",
          autonomous: "0",
          untouched: "0",
        },
      ],
    });

    const rows = await throughputExtractor.extract(database.service.db, ORG, DAY);

    expectScoped();
    expect(database.statements[0].sql).toContain("pr.run_id");
    expect(database.statements[0].sql).toContain("c.sha = v.head_sha");
    expect(rows).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "merged_prs",
        dimension: "",
        value: 2,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 3,
        metricId: "merge_rate",
        dimension: "",
        value: 100 / 3,
        numerator: 1,
        denominator: 3,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "merged_untouched_rate",
        dimension: "",
        value: 50,
        numerator: 1,
        denominator: 2,
      },
      {
        repoRef: "acme/zephyr",
        origin: "live",
        population: 0,
        metricId: "merged_prs",
        dimension: "",
        value: 0,
      },
      {
        repoRef: "acme/zephyr",
        origin: "live",
        population: 1,
        metricId: "merge_rate",
        dimension: "",
        value: 0,
        numerator: 0,
        denominator: 1,
      },
    ]);
  });

  it("interventions: one sum row per repository, origin and cause, from V079's events", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, origin: "live", cause: "infra_rig", events: "2" },
        { repo_ref: HELIOS, origin: "live", cause: "other", events: "1" },
      ],
    });

    expect(await interventionsExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "human_interventions",
        dimension: "infra_rig",
        value: 2,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "human_interventions",
        dimension: "other",
        value: 1,
      },
    ]);
    // Scoped to the workspace and the UTC day, bucketed as V079's daily view buckets, and grouped
    // by the run's origin (DJ.2) — which the view does not carry.
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0].parameters).toEqual([ORG, DAY]);
    expect(database.statements[0].sql).toContain("from ouroboros.intervention_events e");
    expect(database.statements[0].sql).toContain(
      "(e.detected_at at time zone 'UTC')::date = $2::date",
    );
    expect(database.statements[0].sql).toContain("r.origin");
  });

  it("interventions: a day with no events writes no rows", async () => {
    database.answers({ rows: [] });

    expect(await interventionsExtractor.extract(database.service.db, ORG, DAY)).toEqual([]);
  });

  it("interventions: implements human_interventions version 3, the per-origin entry", () => {
    expect(interventionsExtractor.metrics).toEqual({ human_interventions: 3 });
  });

  it("cycle: median rows per repository and per stage, samples kept", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, origin: "live", stage_key: null, ms: "2400000" },
        { repo_ref: HELIOS, origin: "live", stage_key: null, ms: "860000" },
        { repo_ref: HELIOS, origin: "live", stage_key: "implement", ms: "360000" },
      ],
    });

    expect(await cycleExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "cycle_time",
        dimension: "",
        value: 1_630_000,
        samples: [860_000, 2_400_000],
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "stage_duration",
        dimension: "implement",
        value: 360_000,
        samples: [360_000],
      },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("r.status = 'merged'");
  });

  it("cost: tokens, unpriced and local tokens always, cost only when something was priced", async () => {
    database.answers({
      rows: [
        {
          repo_ref: HELIOS,
          origin: "live",
          task_kind: "implement",
          tokens: "1500",
          unpriced_tokens: "0",
          local_tokens: "0",
          events: "1",
          unpriced_events: "0",
          local_events: "0",
          priced_events: "1",
          cost_cents: "912.5000",
        },
        {
          repo_ref: HELIOS,
          origin: "live",
          task_kind: null,
          tokens: "400",
          unpriced_tokens: "400",
          local_tokens: "0",
          events: "2",
          unpriced_events: "2",
          local_events: "0",
          priced_events: "0",
          cost_cents: null,
        },
        {
          repo_ref: "acme/zephyr",
          origin: "live",
          task_kind: "docs",
          tokens: "3000",
          unpriced_tokens: "3000",
          local_tokens: "3000",
          events: "3",
          unpriced_events: "3",
          local_events: "3",
          priced_events: "0",
          cost_cents: null,
        },
      ],
    });

    expect(await costExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 3,
        metricId: "tokens",
        dimension: "",
        value: 1900,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "unpriced_tokens",
        dimension: "",
        value: 400,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 0,
        metricId: "local_tokens",
        dimension: "",
        value: 0,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "cost_cents",
        dimension: "",
        value: 912.5,
      },
      // The usage that named no task kind is in the total above and in no bar.
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "tokens_by_task_kind",
        dimension: "implement",
        value: 1500,
      },
      {
        repoRef: "acme/zephyr",
        origin: "live",
        population: 3,
        metricId: "tokens",
        dimension: "",
        value: 3000,
      },
      {
        repoRef: "acme/zephyr",
        origin: "live",
        population: 3,
        metricId: "unpriced_tokens",
        dimension: "",
        value: 3000,
      },
      {
        repoRef: "acme/zephyr",
        origin: "live",
        population: 3,
        metricId: "local_tokens",
        dimension: "",
        value: 3000,
      },
      {
        repoRef: "acme/zephyr",
        origin: "live",
        population: 3,
        metricId: "tokens_by_task_kind",
        dimension: "docs",
        value: 3000,
      },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("filter (where tu.cost_cents is null)");
    // Local is the control plane's own list of kinds, passed in — never spelled in the SQL.
    expect(database.statements[0].sql).toContain("tu.provider = any(");
    expect(database.statements[0].parameters).toContainEqual(["ollama", "openai_compatible"]);
  });

  it("builds: totals, failures and the success rate", async () => {
    database.answers({ rows: [{ repo_ref: HELIOS, origin: "live", builds: "4", succeeded: "2" }] });

    expect(await buildsExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 4,
        metricId: "builds",
        dimension: "",
        value: 4,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 4,
        metricId: "build_failures",
        dimension: "",
        value: 2,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 4,
        metricId: "build_success_rate",
        dimension: "",
        value: 50,
        numerator: 2,
        denominator: 4,
      },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("b.status in ('succeeded', 'failed', 'retried')");
  });

  it("build_duration: a median row per repository and job label, every succeeded build a sample", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, origin: "live", label: "zephyr build", ms: "252000" },
        { repo_ref: HELIOS, origin: "live", label: "native_sim", ms: "91000" },
        { repo_ref: HELIOS, origin: "live", label: "zephyr build", ms: "238000" },
        { repo_ref: HELIOS, origin: "live", label: "zephyr build", ms: "260500" },
      ],
    });

    expect(await buildDurationExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 3,
        metricId: "build_duration",
        dimension: "zephyr build",
        value: 252_000,
        samples: [238_000, 252_000, 260_500],
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "build_duration",
        dimension: "native_sim",
        value: 91_000,
        samples: [91_000],
      },
    ]);
    expectScoped();
    // Only a succeeded build is timed, and to the millisecond as the seed's rows are.
    expect(database.statements[0].sql).toContain("b.status = 'succeeded'");
    expect(database.statements[0].sql).toContain("round(extract(epoch from");
  });

  it("build_duration: writes nothing for a day with no succeeded build", async () => {
    database.answers({ rows: [] });

    expect(await buildDurationExtractor.extract(database.service.db, ORG, DAY)).toEqual([]);
  });

  it("queue_wait: a median row per repository and pool, every started job a sample", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, origin: "live", pool: "pool-a", ms: "540000" },
        { repo_ref: HELIOS, origin: "live", pool: "pool-b", ms: "12000" },
        { repo_ref: HELIOS, origin: "live", pool: "pool-a", ms: "300000" },
      ],
    });

    expect(await queueWaitExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "queue_wait",
        dimension: "pool-a",
        value: 420_000,
        samples: [300_000, 540_000],
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "queue_wait",
        dimension: "pool-b",
        value: 12_000,
        samples: [12_000],
      },
    ]);
    expectScoped();
    // The wait is queued → started, never negative, and only a job that started is timed.
    expect(database.statements[0].sql).toContain("b.started_at - b.queued_at");
    expect(database.statements[0].sql).toContain("b.started_at >=");
  });

  it("queue_wait: writes nothing for a day on which no job started", async () => {
    database.answers({ rows: [] });

    expect(await queueWaitExtractor.extract(database.service.db, ORG, DAY)).toEqual([]);
  });

  it("tests: suite rows only for failing suites; cases and pass rate per repository", async () => {
    database.answers({
      rows: [
        {
          repo_ref: HELIOS,
          origin: "live",
          suite: "telemetry integration",
          ran: "13",
          passed: "11",
          failed: "2",
        },
        {
          repo_ref: HELIOS,
          origin: "live",
          suite: "unit · drivers",
          ran: "20",
          passed: "20",
          failed: "0",
        },
        {
          repo_ref: "acme/zephyr",
          origin: "live",
          suite: "unit",
          ran: "0",
          passed: "0",
          failed: "0",
        },
      ],
    });

    expect(await testsExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 13,
        metricId: "test_failures_by_suite",
        dimension: "telemetry integration",
        value: 2,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 33,
        metricId: "test_cases_run",
        dimension: "",
        value: 33,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 33,
        metricId: "test_pass_rate",
        dimension: "",
        value: 100 * (31 / 33),
        numerator: 31,
        denominator: 33,
      },
      {
        repoRef: "acme/zephyr",
        origin: "live",
        population: 0,
        metricId: "test_cases_run",
        dimension: "",
        value: 0,
      },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("t.status <> 'running'");
  });

  it("effort: one median row per predicted effort, a negative lead time clamped", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, origin: "live", effort: "s", ms: "860000" },
        { repo_ref: HELIOS, origin: "live", effort: "s", ms: "-5" },
        { repo_ref: HELIOS, origin: "live", effort: "m", ms: "1800000" },
      ],
    });

    expect(await effortExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "completion_time_by_effort",
        dimension: "s",
        value: 430_000,
        samples: [0, 860_000],
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "completion_time_by_effort",
        dimension: "m",
        value: 1_800_000,
        samples: [1_800_000],
      },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("eo.predicted_effort is not null");
  });

  it("dora: deploys, lead time, revert-detected failures and recoveries", async () => {
    const mergedAt = new Date("2026-08-04T10:40:00.000Z");

    database.answers(
      { rows: [{ repo_ref: HELIOS, origin: "live", deploys: "1" }] },
      {
        rows: [
          {
            repo_ref: HELIOS,
            origin: "live",
            title: "Add telemetry",
            external_url: "https://github.com/acme/helios/pull/2",
            merged_at: mergedAt,
            lead_ms: "2400000",
          },
          {
            repo_ref: HELIOS,
            origin: "live",
            title: "Docs typo",
            external_url: "https://github.com/acme/helios/pull/6",
            merged_at: mergedAt,
            lead_ms: "1200000",
          },
        ],
      },
      {
        rows: [
          {
            title: "Reverted docs typo",
            external_url: "https://github.com/acme/helios/pull/9",
            merged_at: new Date("2026-08-05T10:00:00.000Z"),
          },
        ],
      },
      {
        rows: [
          {
            repo_ref: HELIOS,
            origin: "live",
            message: "revert: Add telemetry",
            committed_at: new Date("2026-08-05T09:00:00.000Z"),
          },
        ],
      },
      {
        rows: [
          {
            repo_ref: HELIOS,
            origin: "live",
            run_id: "r1",
            status: "failed",
            finished_at: new Date("2026-08-04T09:05:00.000Z"),
          },
          {
            repo_ref: HELIOS,
            origin: "live",
            run_id: "r1",
            status: "succeeded",
            finished_at: new Date("2026-08-04T09:10:00.000Z"),
          },
        ],
      },
    );

    expect(await doraExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "deploy_frequency",
        dimension: "",
        value: 1,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "lead_time",
        dimension: "",
        value: 1_800_000,
        numerator: 3_600_000,
        denominator: 2,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 2,
        metricId: "change_failure_rate",
        dimension: "",
        value: 50,
        numerator: 1,
        denominator: 2,
      },
      {
        repoRef: HELIOS,
        origin: "live",
        population: 1,
        metricId: "mttr",
        dimension: "",
        value: 300_000,
        numerator: 300_000,
        denominator: 1,
      },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("'refs/heads/' || gr.default_branch");
    expect(database.statements[1].sql).toContain(
      "ouroboros.lead_time_ms(r.started_at, pr.merged_at)",
    );
  });

  it("throughput: two origins on one day are two rows each, never one sum (DJ.2)", async () => {
    database.answers({
      rows: [
        {
          repo_ref: HELIOS,
          origin: "live",
          closed: "1",
          merged: "1",
          autonomous: "1",
          untouched: "1",
        },
        {
          repo_ref: HELIOS,
          origin: "simulated",
          closed: "40",
          merged: "30",
          autonomous: "30",
          untouched: "30",
        },
      ],
    });

    const rows = await throughputExtractor.extract(database.service.db, ORG, DAY);
    const merged = rows.filter((row) => row.metricId === "merged_prs");

    expect(database.statements[0].sql).toContain("group by repo_ref, origin");
    expect(merged).toEqual([
      expect.objectContaining({ origin: "live", value: 1, population: 1 }),
      expect.objectContaining({ origin: "simulated", value: 30, population: 30 }),
    ]);
  });

  it("cycle: medians are pooled per origin, never across two", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, origin: "live", stage_key: null, ms: "1000" },
        { repo_ref: HELIOS, origin: "seeded", stage_key: null, ms: "9000" },
        { repo_ref: HELIOS, origin: "seeded", stage_key: null, ms: "7000" },
      ],
    });

    expect(await cycleExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      expect.objectContaining({ origin: "live", value: 1000, samples: [1000], population: 1 }),
      expect.objectContaining({
        origin: "seeded",
        value: 8000,
        samples: [7000, 9000],
        population: 2,
      }),
    ]);
  });

  it("every extractor selects an origin, and no family is left at its pre-origin version", async () => {
    const extractors = [
      throughputExtractor,
      interventionsExtractor,
      cycleExtractor,
      costExtractor,
      buildsExtractor,
      buildDurationExtractor,
      queueWaitExtractor,
      testsExtractor,
      effortExtractor,
      doraExtractor,
    ];

    for (const extractor of extractors) {
      const recording = recordingDatabase();

      await extractor.extract(recording.service.db, ORG, DAY);
      expect(recording.statements[0].sql).toMatch(/\b(pr|b|r|t|tu)?\.?origin\b/);
      expect(Math.min(...Object.values(extractor.metrics))).toBeGreaterThanOrEqual(2);
    }
  });

  it("dora: skips the revert reads on a day with no merges", async () => {
    await doraExtractor.extract(database.service.db, ORG, DAY);

    // Deploys, merges, then MTTR's jobs — no revert candidates were read.
    expect(database.statements).toHaveLength(3);
  });
});

describe("revert matching", () => {
  const pr = {
    repo_ref: HELIOS,
    title: "Fix CAN-bus flake ",
    external_url: "https://github.com/acme/helios/pull/101",
    merged_at: new Date("2026-08-03T09:14:20.000Z"),
  };
  const later = new Date("2026-08-05T10:00:00.000Z");

  it("matches a revert PR in the same repository, after the merge", () => {
    expect(
      isReverted(
        pr,
        [
          {
            title: 'Revert "Fix CAN-bus flake" (#101)',
            external_url: "https://github.com/acme/helios/pull/120",
            merged_at: later,
          },
        ],
        [],
      ),
    ).toBe(true);
  });

  it("ignores a revert in another repository, or one merged before", () => {
    expect(
      isReverted(
        pr,
        [
          {
            title: 'Revert "Fix CAN-bus flake"',
            external_url: "https://github.com/acme/zephyr/pull/1",
            merged_at: later,
          },
          {
            title: 'Revert "Fix CAN-bus flake"',
            external_url: "https://github.com/acme/helios/pull/99",
            merged_at: new Date("2026-08-03T08:00:00.000Z"),
          },
        ],
        [{ repo_ref: "acme/zephyr", message: "revert: Fix CAN-bus flake", committed_at: later }],
      ),
    ).toBe(false);
  });

  it("matches a loop commit in the same repository", () => {
    expect(
      isReverted(
        pr,
        [],
        [{ repo_ref: HELIOS, message: "revert: Fix CAN-bus flake", committed_at: later }],
      ),
    ).toBe(true);
  });
});

describe("recoveries", () => {
  const t = (minute: number) => new Date(Date.UTC(2026, 7, 4, 9, minute));

  it("times each green that follows reds from the first red of the streak", () => {
    expect(
      recoveries([
        { status: "succeeded", finished_at: t(0) },
        { status: "failed", finished_at: t(5) },
        { status: "retried", finished_at: t(7) },
        { status: "succeeded", finished_at: t(10) },
        { status: "succeeded", finished_at: t(12) },
        { status: "failed", finished_at: t(20) },
        { status: "succeeded", finished_at: t(21) },
      ]),
    ).toEqual([
      { at: t(10), ms: 5 * 60_000 },
      { at: t(21), ms: 60_000 },
    ]);
  });

  it("finds none in an all-green or still-red history", () => {
    expect(recoveries([{ status: "succeeded", finished_at: t(0) }])).toEqual([]);
    expect(recoveries([{ status: "failed", finished_at: t(0) }])).toEqual([]);
  });
});
