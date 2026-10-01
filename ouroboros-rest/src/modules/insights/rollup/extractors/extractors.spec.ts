import { recordingDatabase, type RecordingDatabase } from "../../../db/database.fixture";
import { buildsExtractor } from "./builds.extractor";
import { costExtractor } from "./cost.extractor";
import { cycleExtractor } from "./cycle.extractor";
import { doraExtractor, isReverted, recoveries } from "./dora.extractor";
import { effortExtractor } from "./effort.extractor";
import { interventionsExtractor } from "./interventions.extractor";
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
        { repo_ref: HELIOS, closed: "3", merged: "2", autonomous: "1", untouched: "1" },
        { repo_ref: "acme/zephyr", closed: "1", merged: "0", autonomous: "0", untouched: "0" },
      ],
    });

    const rows = await throughputExtractor.extract(database.service.db, ORG, DAY);

    expectScoped();
    expect(database.statements[0].sql).toContain("pr.run_id");
    expect(database.statements[0].sql).toContain("c.sha = v.head_sha");
    expect(rows).toEqual([
      { repoRef: HELIOS, metricId: "merged_prs", dimension: "", value: 2 },
      {
        repoRef: HELIOS,
        metricId: "merge_rate",
        dimension: "",
        value: 100 / 3,
        numerator: 1,
        denominator: 3,
      },
      {
        repoRef: HELIOS,
        metricId: "merged_untouched_rate",
        dimension: "",
        value: 50,
        numerator: 1,
        denominator: 2,
      },
      { repoRef: "acme/zephyr", metricId: "merged_prs", dimension: "", value: 0 },
      {
        repoRef: "acme/zephyr",
        metricId: "merge_rate",
        dimension: "",
        value: 0,
        numerator: 0,
        denominator: 1,
      },
    ]);
  });

  it("interventions: one sum row per repository and cause, read from V079's daily shape", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, cause: "infra_rig", events: "2" },
        { repo_ref: HELIOS, cause: "other", events: "1" },
      ],
    });

    expect(await interventionsExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      { repoRef: HELIOS, metricId: "human_interventions", dimension: "infra_rig", value: 2 },
      { repoRef: HELIOS, metricId: "human_interventions", dimension: "other", value: 1 },
    ]);
    // Scoped to the workspace and the UTC day — the view buckets by day, so the day is the bound.
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0].parameters).toEqual([ORG, DAY]);
    expect(database.statements[0].sql).toContain("ouroboros.intervention_cause_daily");
    expect(database.statements[0].sql).toContain("r.day = $2::date");
  });

  it("interventions: a day with no events writes no rows", async () => {
    database.answers({ rows: [] });

    expect(await interventionsExtractor.extract(database.service.db, ORG, DAY)).toEqual([]);
  });

  it("interventions: implements human_interventions version 2, the cause-dimensioned entry", () => {
    expect(interventionsExtractor.metrics).toEqual({ human_interventions: 2 });
  });

  it("cycle: median rows per repository and per stage, samples kept", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, stage_key: null, ms: "2400000" },
        { repo_ref: HELIOS, stage_key: null, ms: "860000" },
        { repo_ref: HELIOS, stage_key: "implement", ms: "360000" },
      ],
    });

    expect(await cycleExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        metricId: "cycle_time",
        dimension: "",
        value: 1_630_000,
        samples: [860_000, 2_400_000],
      },
      {
        repoRef: HELIOS,
        metricId: "stage_duration",
        dimension: "implement",
        value: 360_000,
        samples: [360_000],
      },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("r.status = 'merged'");
  });

  it("cost: tokens and unpriced tokens always, cost only when something was priced", async () => {
    database.answers({
      rows: [
        {
          repo_ref: HELIOS,
          tokens: "1900",
          unpriced_tokens: "400",
          priced_events: "1",
          cost_cents: "912.5000",
        },
        {
          repo_ref: "acme/zephyr",
          tokens: "3000",
          unpriced_tokens: "3000",
          priced_events: "0",
          cost_cents: null,
        },
      ],
    });

    expect(await costExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      { repoRef: HELIOS, metricId: "tokens", dimension: "", value: 1900 },
      { repoRef: HELIOS, metricId: "unpriced_tokens", dimension: "", value: 400 },
      { repoRef: HELIOS, metricId: "cost_cents", dimension: "", value: 912.5 },
      { repoRef: "acme/zephyr", metricId: "tokens", dimension: "", value: 3000 },
      { repoRef: "acme/zephyr", metricId: "unpriced_tokens", dimension: "", value: 3000 },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("filter (where tu.cost_cents is null)");
  });

  it("builds: totals, failures and the success rate", async () => {
    database.answers({ rows: [{ repo_ref: HELIOS, builds: "4", succeeded: "2" }] });

    expect(await buildsExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      { repoRef: HELIOS, metricId: "builds", dimension: "", value: 4 },
      { repoRef: HELIOS, metricId: "build_failures", dimension: "", value: 2 },
      {
        repoRef: HELIOS,
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

  it("tests: suite rows only for failing suites; cases and pass rate per repository", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, suite: "telemetry integration", ran: "13", passed: "11", failed: "2" },
        { repo_ref: HELIOS, suite: "unit · drivers", ran: "20", passed: "20", failed: "0" },
        { repo_ref: "acme/zephyr", suite: "unit", ran: "0", passed: "0", failed: "0" },
      ],
    });

    expect(await testsExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        metricId: "test_failures_by_suite",
        dimension: "telemetry integration",
        value: 2,
      },
      { repoRef: HELIOS, metricId: "test_cases_run", dimension: "", value: 33 },
      {
        repoRef: HELIOS,
        metricId: "test_pass_rate",
        dimension: "",
        value: 100 * (31 / 33),
        numerator: 31,
        denominator: 33,
      },
      { repoRef: "acme/zephyr", metricId: "test_cases_run", dimension: "", value: 0 },
    ]);
    expectScoped();
    expect(database.statements[0].sql).toContain("t.status <> 'running'");
  });

  it("effort: one median row per predicted effort, a negative lead time clamped", async () => {
    database.answers({
      rows: [
        { repo_ref: HELIOS, effort: "s", ms: "860000" },
        { repo_ref: HELIOS, effort: "s", ms: "-5" },
        { repo_ref: HELIOS, effort: "m", ms: "1800000" },
      ],
    });

    expect(await effortExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      {
        repoRef: HELIOS,
        metricId: "completion_time_by_effort",
        dimension: "s",
        value: 430_000,
        samples: [0, 860_000],
      },
      {
        repoRef: HELIOS,
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
      { rows: [{ repo_ref: HELIOS, deploys: "1" }] },
      {
        rows: [
          {
            repo_ref: HELIOS,
            title: "Add telemetry",
            external_url: "https://github.com/acme/helios/pull/2",
            merged_at: mergedAt,
            lead_ms: "2400000",
          },
          {
            repo_ref: HELIOS,
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
            message: "revert: Add telemetry",
            committed_at: new Date("2026-08-05T09:00:00.000Z"),
          },
        ],
      },
      {
        rows: [
          {
            repo_ref: HELIOS,
            run_id: "r1",
            status: "failed",
            finished_at: new Date("2026-08-04T09:05:00.000Z"),
          },
          {
            repo_ref: HELIOS,
            run_id: "r1",
            status: "succeeded",
            finished_at: new Date("2026-08-04T09:10:00.000Z"),
          },
        ],
      },
    );

    expect(await doraExtractor.extract(database.service.db, ORG, DAY)).toEqual([
      { repoRef: HELIOS, metricId: "deploy_frequency", dimension: "", value: 1 },
      {
        repoRef: HELIOS,
        metricId: "lead_time",
        dimension: "",
        value: 1_800_000,
        numerator: 3_600_000,
        denominator: 2,
      },
      {
        repoRef: HELIOS,
        metricId: "change_failure_rate",
        dimension: "",
        value: 50,
        numerator: 1,
        denominator: 2,
      },
      {
        repoRef: HELIOS,
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
