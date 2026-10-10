import { ApiHarness } from "../../../testing/harness.fixture";
import { MetricsService } from "../../insights/metrics/metrics.service";
import {
  supportsFetch,
  supportsQuery,
  type ToolCallContext,
  type ToolResult,
} from "../tools/research-tool.adapter";
import { sourceRecordViolations } from "../tools/research-tool.citations";
import { ResearchToolRegistry } from "../tools/research-tool.registry";

/**
 * The build & test telemetry tool against a real PostgreSQL (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)): the registered adapter, the
 * repository's statements and the insights service together, over planes whose answers are known
 * by inspection.
 *
 * What only a database can show: that the tool's figure **is** the Insights service's figure,
 * that a cited locator is one the ledger's CHECK accepts and re-runs to the same digest, that a
 * workspace sees none of another's history — and that running every operation leaves every plane
 * byte-for-byte as it was.
 */

/**
 * The fixture's two case keys. A case key is derived by the database from the repository, suite,
 * class and name (V051), so each is read back from the insert rather than typed — and set anew by
 * every {@link workspace}.
 */
let CASE = "";
let HOVER = "";

/** The tables the tool reads — what "read-only across the planes" is asserted over. */
const PLANES = [
  "metric_daily",
  "hil_measurements",
  "test_case_history",
  "flake_scores",
  "runs",
  "token_usage",
  "regression_baselines",
  "test_runs",
  "test_cases",
] as const;

describe("the telemetry tool, on the database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * The registered tool, called as the invoker calls it.
   *
   * @returns `query` and `fetch` bound to a workspace.
   */
  function tool() {
    const adapter = api.nest.get(ResearchToolRegistry).get("telemetry");

    if (!supportsQuery(adapter) || !supportsFetch(adapter)) {
      throw new Error("the telemetry tool does not declare query and fetch");
    }

    const context = (organizationId: string): ToolCallContext => ({
      organizationId,
      investigationId: "00000000-0000-4000-8000-000000000000",
      config: {},
      secret: null,
      tokenCeiling: null,
    });

    return {
      query: (organizationId: string, input: Record<string, unknown>): Promise<ToolResult> =>
        adapter.query(context(organizationId), input),
      fetch: (organizationId: string, locator: string): Promise<ToolResult> =>
        adapter.fetch(context(organizationId), locator),
    };
  }

  /**
   * A workspace with every plane filled: twenty days of merge-rate rollups, four overshoot
   * measurements with their results, one hover-drift measurement against a stored baseline,
   * five runs and three model calls.
   *
   * @returns The workspace's id.
   */
  async function workspace(): Promise<string> {
    const owner = await api.signIn();
    const { id: org } = await api.workspace(owner);
    const one = async (sql: string, values: unknown[]): Promise<string> =>
      (await api.sql.query<{ id: string }>(sql, values)).rows[0].id;

    const caseKeyOf = async (testCase: string): Promise<string> =>
      (
        await api.sql.query<{ case_key: string }>(
          `select case_key from ouroboros.test_cases where id = $1`,
          [testCase],
        )
      ).rows[0].case_key;

    const githubOrg = await one(
      `insert into ouroboros.github_orgs (organization_id, login, enabled) values ($1, 'acme-robotics', true) returning id`,
      [org],
    );
    const repo = await one(
      `insert into ouroboros.github_repos (org_id, name, enabled, default_branch) values ($1, 'helios-firmware', true, 'main') returning id`,
      [githubOrg],
    );

    // The insights plane: yesterday back twenty days, 9 merged of 10 opened, then 8 of 10.
    await api.sql.query(
      `insert into ouroboros.metric_daily (organization_id, repo_ref, metric_id, is_rate, dimension, day, value, numerator, denominator, meta)
       select $1, 'acme-robotics/helios-firmware', 'merge_rate', true, '',
              (now() at time zone 'UTC')::date - n,
              case when n <= 10 then 90 else 80 end, case when n <= 10 then 9 else 8 end, 10, '{}'
         from generate_series(1, 20) n`,
      [org],
    );

    // The test plane: four builds of one run, three failing at 2.4 % overshoot, the fix at 1.7 %.
    const run = await one(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model, status,
                                   stage_label, stage_index, stage_total, started_at, finished_at, pr_number)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', 'standard-fix', 'claude-fable-5', 'merged', 'Done', 8, 8,
               now() - interval '2 days', now() - interval '1 day', 514) returning id`,
      [org, repo],
    );

    for (const [n, value] of [2.4, 2.4, 2.4, 1.7].entries()) {
      const testRun = await one(
        `insert into ouroboros.test_runs (organization_id, run_id, attempt_seq, status, wall_ms, sim_ms, physical_ms, started_at)
         values ($1, $2, $3, 'complete', 1000, 1000, 0, now() - make_interval(hours => 40 - $3)) returning id`,
        [org, run, n + 1],
      );
      const suite = await one(
        `insert into ouroboros.test_suites (organization_id, test_run_id, name, platform, kind, results_format)
         values ($1, $2, 'PHYSICAL · HIL rig', 'rig:helios-rig-02', 'physical', 'hil') returning id`,
        [org, testRun],
      );
      const status = value > 2 ? "failed" : "passed";
      const testCase = await one(
        `insert into ouroboros.test_cases (organization_id, test_suite_id, name, classname, status, retry_outcomes)
         values ($1, $2, 'overshoot_under_load', 'hil.motor', $3, jsonb_build_array($3::text)) returning id`,
        [org, suite, status],
      );

      CASE = await caseKeyOf(testCase);

      await api.sql.query(
        `insert into ouroboros.hil_measurements (organization_id, test_case_id, procedure, metric, value, unit, limit_value, limit_kind, verdict)
         values ($1, $2, 'E-stop release under 2 Nm load', 'overshoot_pct', $3, '%', 2.0, 'max', $4)`,
        [org, testCase, value, value > 2 ? "fail" : "pass"],
      );
      await api.sql.query(
        `insert into ouroboros.test_case_history (organization_id, test_case_id, github_repo_id, case_key, test_run_id, status, retries, pass_on_retry, observed_at)
         values ($1, $2, $3, $4, $5, $6, 0, false, now() - make_interval(hours => 40 - $7::int))`,
        [org, testCase, repo, CASE, testRun, status, n + 1],
      );

      // The last build also carries the nightly hover-drift case, measured at 35.34 cm.
      if (n === 3) {
        const hoverCase = await one(
          `insert into ouroboros.test_cases (organization_id, test_suite_id, name, classname, status, retry_outcomes)
           values ($1, $2, 'hover_drift_gusts', 'hil.hover', 'passed', '["passed"]') returning id`,
          [org, suite],
        );

        HOVER = await caseKeyOf(hoverCase);
        await api.sql.query(
          `insert into ouroboros.hil_measurements (organization_id, test_case_id, procedure, metric, value, unit, limit_value, limit_kind, verdict)
           values ($1, $2, 'Hover in 8 m/s gusts', 'hover_drift_cm', 35.34, 'cm', 50, 'max', 'pass')`,
          [org, hoverCase],
        );
      }
    }

    await api.sql.query(
      `insert into ouroboros.regression_baselines (organization_id, repo_ref, release_tag, metric_source, metric_key, metric_class, "window", captured_via)
       values ($1, 'acme-robotics/helios-firmware', 'v2.0.4', 'case_metric', $2, 'accuracy',
               '{"n": 48, "median": 31.0, "spread": 4.2, "spread_kind": "iqr", "unit": "cm",
                 "from": "2026-07-25T02:35:47Z", "to": "2026-08-01T02:35:47Z"}', 'release')`,
      [org, `${HOVER}:hover_drift_cm`],
    );
    await api.sql.query(
      `insert into ouroboros.token_usage (organization_id, run_id, provider, model, tokens_in, tokens_out, cost_cents, occurred_at)
       values ($1, $2, 'anthropic', 'claude-fable-5', 1000, 200, 12.5, now() - interval '30 hours'),
              ($1, $2, 'anthropic', 'claude-fable-5', 3000, 500, null, now() - interval '29 hours'),
              ($1, null, 'anthropic', 'claude-fable-5', 400, 100, 3, now() - interval '5 hours')`,
      [org, run],
    );

    return org;
  }

  /**
   * A digest of every plane the tool reads.
   *
   * @returns One md5 per table, over every row.
   */
  async function planes(): Promise<Record<string, string>> {
    const digests: Record<string, string> = {};

    for (const table of PLANES) {
      const { rows } = await api.sql.query<{ digest: string }>(
        `select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as digest
           from ouroboros.${table} t`,
      );

      digests[table] = rows[0].digest;
    }

    return digests;
  }

  /** One query per operation, over the fixture. */
  const everyOperation = (): Record<string, unknown>[] => [
    { op: "metric_window", metric: "merge_rate", window: "30d" },
    { op: "metric_window", metric: `${CASE}:overshoot_pct`, window: "7d" },
    { op: "metric_window", metric: `${HOVER}:hover_drift_cm`, window: "baseline:v2.0.4" },
    { op: "compare", metric: `${HOVER}:hover_drift_cm`, windowA: "baseline:v2.0.4", windowB: "7d" },
    { op: "compare", metric: "merge_rate", windowA: "30d", windowB: "7d" },
    { op: "case_history", case: CASE, window: "7d" },
    {
      op: "case_history",
      suite: "PHYSICAL · HIL rig",
      window: "7d",
      repo: "Acme-Robotics/Helios-Firmware",
    },
    { op: "run_series", kind: "runs", window: "7d" },
    { op: "run_series", kind: "tokens", window: "7d", repo: "acme-robotics/helios-firmware" },
    { op: "metric_window", metric: `${CASE}:overshoot_pct`, window: "2026-01-01..2026-01-08" },
  ];

  it("reproduces the insights plane's figure exactly — the Insights service's own window", async () => {
    const org = await workspace();
    const insights = await api.nest.get(MetricsService).window("merge_rate", {
      organizationId: org,
      range: "30d",
    });

    const result = await tool().query(org, {
      op: "metric_window",
      metric: "merge_rate",
      window: "30d",
    });

    expect(result.payload).toMatchObject({
      status: "ok",
      value: insights.value,
      unit: "%",
      n: insights.components?.denominator,
      basis: "denominator",
      from: insights.from,
      to: insights.to,
    });
    // 170 merged of 200 opened: nine a day for ten days, eight for ten more.
    expect(insights.value).toBe(85);
    expect(insights.components).toEqual({ numerator: 170, denominator: 200 });
  });

  it("reproduces the test plane's measurements: median 2.4 %, n = 4", async () => {
    const org = await workspace();

    const result = await tool().query(org, {
      op: "metric_window",
      metric: `${CASE}:overshoot_pct`,
      window: "7d",
    });

    expect(result.payload).toMatchObject({
      status: "ok",
      value: 2.4,
      median: 2.4,
      spread: 0.175,
      unit: "%",
      n: 4,
      basis: "samples",
    });
  });

  it("compares a stored baseline with a live window: +14%, both sample counts, one citation", async () => {
    const org = await workspace();

    const result = await tool().query(org, {
      op: "compare",
      metric: `${HOVER}:hover_drift_cm`,
      windowA: "baseline:v2.0.4",
      windowB: "7d",
    });

    expect(result.payload).toMatchObject({
      status: "ok",
      unit: "cm",
      delta: 4.34,
      deltaPct: 14,
      display: "+14% (+4.34 cm)",
      a: { n: 48, value: 31, basis: "baseline", from: "2026-07-25T02:35:47Z" },
      b: { n: 1, value: 35.34, basis: "samples" },
    });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].locator).toMatch(
      new RegExp(
        `^telemetry://case/${HOVER}/hover_drift_cm/baseline:v2\\.0\\.4-vs-\\d{4}-\\d\\d-\\d\\dT[\\d:]+Z\\.\\.\\d{4}-\\d\\d-\\d\\dT[\\d:]+Z$`,
      ),
    );
  });

  it("answers case history, runs and token usage from their own planes", async () => {
    const org = await workspace();
    const { query } = tool();

    expect(
      (await query(org, { op: "case_history", case: CASE, window: "7d" })).payload,
    ).toMatchObject({
      status: "ok",
      runs: 4,
      cases: 1,
      passed: 1,
      failed: 3,
      passRatePct: 25,
      flake: { scored: 0, maxScore: null },
    });
    expect(
      (await query(org, { op: "case_history", suite: "PHYSICAL · HIL rig", window: "7d" })).payload,
    ).toMatchObject({ status: "ok", runs: 4, cases: 1 });
    expect(
      (await query(org, { op: "run_series", kind: "runs", window: "7d" })).payload,
    ).toMatchObject({
      status: "ok",
      daysWithData: 1,
      totals: { started: 1, merged: 1, failed: 0, needsHuman: 0 },
    });
    expect(
      (await query(org, { op: "run_series", kind: "tokens", window: "7d" })).payload,
    ).toMatchObject({
      status: "ok",
      totals: { events: 3, tokensIn: 4400, tokensOut: 800, costCents: 15.5, unpricedEvents: 1 },
    });
    // A repository's usage is its runs': the call that belongs to no run is not counted.
    expect(
      (
        await query(org, {
          op: "run_series",
          kind: "tokens",
          window: "7d",
          repo: "ACME-Robotics/helios-firmware",
        })
      ).payload,
    ).toMatchObject({ totals: { events: 2 } });
  });

  it("returns the designed no-data record for an empty window — never 0", async () => {
    const org = await workspace();
    const { query } = tool();

    const measured = await query(org, {
      op: "metric_window",
      metric: `${CASE}:overshoot_pct`,
      window: "2026-01-01..2026-01-08",
    });
    const rolled = await query(org, {
      op: "metric_window",
      metric: "merged_prs",
      window: "2026-01-01..2026-01-08",
    });
    const compared = await query(org, {
      op: "compare",
      metric: "merge_rate",
      windowA: "30d",
      windowB: "2026-01-01..2026-01-08",
    });
    const series = await query(org, {
      op: "run_series",
      kind: "runs",
      window: "2026-01-01..2026-01-08",
    });

    for (const result of [measured, rolled, compared, series]) {
      expect(result.payload).toMatchObject({ status: "no_data" });
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].excerpt).toMatch(/^No data — /);
    }
    expect(measured.payload).toMatchObject({
      window: "2026-01-01..2026-01-08",
      reason: expect.stringContaining("2026-01-01..2026-01-08") as string,
    });
    // The insights composition answers 0 for a sum over nothing; the citation does not.
    expect(JSON.stringify(rolled.payload)).not.toMatch(/"value"/);
    expect(compared.payload).not.toHaveProperty("delta");
  });

  it("cites every result with a locator the ledger accepts, and re-runs it to the same numbers", async () => {
    const org = await workspace();
    const { query, fetch } = tool();

    for (const input of everyOperation()) {
      const first = await query(org, input);
      const source = first.sources[0];

      expect(sourceRecordViolations(source)).toEqual([]);
      // The database's own rule, not only its TypeScript mirror.
      const { rows } = await api.sql.query<{ valid: boolean }>(
        `select ouroboros.source_locator_valid('telemetry', $1) as valid`,
        [source.locator],
      );
      expect([source.locator, rows[0].valid]).toEqual([source.locator, true]);

      const again = await fetch(org, source.locator);

      expect(again.payload).toEqual(first.payload);
      expect(again.sources[0].locator).toBe(source.locator);
      expect(again.sources[0].contentHash).toBe(source.contentHash);
    }
  });

  it("returns nothing of one workspace's history to another", async () => {
    const mine = await workspace();
    const stranger = await api.workspace(await api.signIn());
    const { query, fetch } = tool();

    for (const input of everyOperation()) {
      const theirs = await query(stranger.id, input);

      expect([input.op, (theirs.payload as { status: string }).status]).toEqual([
        input.op,
        "no_data",
      ]);

      // Nor through a locator the owning workspace was given.
      const cited = (await query(mine, input)).sources[0].locator;
      expect((await fetch(stranger.id, cited)).payload).toMatchObject({ status: "no_data" });
    }
  });

  it("is read-only: every operation, and every re-run, leaves every plane exactly as it was", async () => {
    const org = await workspace();
    const { query, fetch } = tool();
    const before = await planes();

    for (const input of everyOperation()) {
      const result = await query(org, input);

      await fetch(org, result.sources[0].locator);
    }

    expect(await planes()).toEqual(before);
  });
});
