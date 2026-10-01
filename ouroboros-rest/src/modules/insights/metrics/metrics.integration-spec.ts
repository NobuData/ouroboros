import { workspaceWithRepo, type SeededWorkspace } from "../../../testing/dashboard.fixture";
import { ApiHarness } from "../../../testing/harness.fixture";
import { insertLoopPr, markRollupRefreshed } from "../../../testing/metrics.fixture";
import { addDays, utcDay } from "../rollup/rollup.days";
import { rewindow, windowKey, type WindowValue } from "../rollup/rollup.oracle.fixture";
import { MetricsService } from "./metrics.service";
import { resolveWindow, METRIC_RANGES } from "./metrics.window";

/**
 * The windowed metrics service against a migrated database (BJ.1,
 * [#437](https://github.com/NobuData/ouroboros/issues/437)).
 *
 * Two workspaces hold rollup history at seed volume — ninety days of a prior window and ninety of
 * the window, three repositories, the KPI row's metrics — and the suite checks:
 *
 *   * every range's value and prior against the reference re-windowing SQL
 *     (`rollup.oracle.fixture.ts`'s `rewindow`, decision I2's oracle over the grain);
 *   * today arriving through the real extractors' live tail;
 *   * cross-tenant isolation with identical-shaped neighbours;
 *   * no stale window across a rollup refresh;
 *   * the KPI row's warm response budget.
 *
 * ```bash
 * yarn test:integration src/modules/insights/metrics
 * ```
 */

/** The KPI row's metrics — mockup 15's first row. */
const KPI_ROW = [
  "merge_rate",
  "merged_untouched_rate",
  "cycle_time",
  "cost_per_merged_pr",
  "human_interventions",
];

/**
 * The KPI row's warm budget, in milliseconds (the ticket's ≤ 150ms on seed volume). Warm means
 * the windows were asked once already — what every poll after the first costs.
 */
const KPI_WARM_BUDGET_MS = 150;

/** The repositories the history is spread over. */
const REPOS = ["helios-firmware", "atlas-control", "zephyr-sim"];

describe("the windowed metrics service, against PostgreSQL", () => {
  let api: ApiHarness;
  let metrics: MetricsService;
  let mine: SeededWorkspace;
  let neighbour: SeededWorkspace;
  let today: string;

  /**
   * Fill a workspace's rollup history: 180 days before today, three repositories, the KPI row.
   *
   * Components are generated, values follow from them, exactly as the extractors store them. The
   * `scale` differs per workspace so the two can never agree by accident.
   *
   * @param workspace - Whose history.
   * @param scale - A multiplier on every count.
   */
  async function history(workspace: SeededWorkspace, scale: number): Promise<void> {
    await api.sql.query(
      `with days as (
         select d::date as day, row_number() over (order by d) as n
           from generate_series($2::date - 180, $2::date - 1, interval '1 day') d
       ), grid as (
         select day, n, r as repo, ri from days, unnest($3::text[]) with ordinality as x(r, ri)
       ), comps as (
         select day, n, $4 || '/' || repo as repo_ref,
                (2 + (n * ri) % 5) * $5 as closed,
                (1 + (n * ri) % 4) * $5 as autonomous,
                (2 + (n + ri) % 3) * $5 as merged,
                (1 + (n + ri) % 2) * $5 as untouched,
                (n * 37 + ri * 101) % 900 as cents,
                600000 + ((n * 7919 + ri * 104729) % 600000) as cycle
           from grid
       )
       insert into ouroboros.metric_daily
         (organization_id, repo_ref, metric_id, is_rate, dimension, day, value, numerator,
          denominator, meta)
       select $1, repo_ref, m.metric_id, m.is_rate, m.dimension, day, m.value, m.num, m.den,
              m.meta
         from comps,
              lateral (values
                ('merged_prs', false, '', merged::numeric, null::numeric, null::numeric,
                 '{}'::jsonb),
                ('merge_rate', true, '', 100.0 * least(autonomous, closed) / closed,
                 least(autonomous, closed)::numeric, closed::numeric, '{}'::jsonb),
                ('merged_untouched_rate', true, '', 100.0 * least(untouched, merged) / merged,
                 least(untouched, merged)::numeric, merged::numeric, '{}'::jsonb),
                ('cost_cents', false, '', cents::numeric, null, null, '{}'::jsonb),
                ('cycle_time', false, '', (cycle + 1000)::numeric, null, null,
                 jsonb_build_object('samples', jsonb_build_array(cycle, cycle + 1000, cycle + 5000))),
                ('human_interventions', false, 'infra_rig', ((n % 3) * $5)::numeric, null, null,
                 '{}'::jsonb),
                ('human_interventions', false, 'policy_gate', ((n % 2) * $5)::numeric, null, null,
                 '{}'::jsonb)
              ) as m(metric_id, is_rate, dimension, value, num, den, meta)`,
      [workspace.id, today, REPOS, workspace.slug, scale],
    );
  }

  /**
   * A whole-workspace figure from the reference re-windowing, summed across repositories.
   *
   * @param workspace - Whose.
   * @param metricId - The metric.
   * @param aggregation - Its aggregation (`sum` or `ratio`).
   * @param from - The first day.
   * @param to - The last day.
   * @param scale - A ratio's unit scale.
   * @returns The figure, or null for a rate with no denominator.
   */
  async function reference(
    workspace: SeededWorkspace,
    metricId: string,
    aggregation: "sum" | "ratio",
    from: string,
    to: string,
    scale = 100,
  ): Promise<number | null> {
    const values: WindowValue[] = [
      ...(await rewindow(api.sql, workspace.id, metricId, aggregation, from, to)).values(),
    ];

    if (aggregation === "sum") {
      return values.reduce((total, v) => total + ("value" in v ? v.value : 0), 0);
    }

    const numerator = values.reduce((t, v) => t + ("numerator" in v ? v.numerator : 0), 0);
    const denominator = values.reduce((t, v) => t + ("denominator" in v ? v.denominator : 0), 0);

    return denominator === 0 ? null : (scale * numerator) / denominator;
  }

  beforeAll(async () => {
    api = await ApiHarness.start();
    metrics = api.nest.get(MetricsService);
  });

  beforeEach(async () => {
    today = utcDay(new Date());
    const owner = await api.signIn();
    mine = await workspaceWithRepo(api, owner);
    neighbour = await workspaceWithRepo(api, owner);
    await history(mine, 1);
    await history(neighbour, 3);
  });

  afterEach(() => api.truncate());
  afterAll(() => api.close());

  it.each(METRIC_RANGES.map((range) => [range]))(
    "matches the reference re-windowing over %s, value and prior",
    async (range) => {
      const resolved = resolveWindow(range, new Date());

      for (const [metricId, aggregation] of [
        ["merge_rate", "ratio"],
        ["merged_untouched_rate", "ratio"],
        ["merged_prs", "sum"],
        ["human_interventions", "sum"],
      ] as const) {
        const window = await metrics.window(metricId, { organizationId: mine.id, range });
        const value = await reference(mine, metricId, aggregation, resolved.current.from, today);
        const prior = await reference(
          mine,
          metricId,
          aggregation,
          resolved.prior.from,
          resolved.prior.to,
        );

        expect({ metricId, value: window.value, prior: window.prior }).toEqual({
          metricId,
          value: expect.closeTo(value ?? NaN, 9) as number,
          prior: expect.closeTo(prior ?? NaN, 9) as number,
        });
        expect(window.methodology.version).toBeGreaterThanOrEqual(1);
        expect(window.methodology.metricId).toBe(metricId);
      }
    },
  );

  it("derives cost per merged PR as total cost over total merges, each window", async () => {
    const resolved = resolveWindow("30d", new Date());
    const window = await metrics.window("cost_per_merged_pr", {
      organizationId: mine.id,
      range: "30d",
    });
    const cost = await reference(mine, "cost_cents", "sum", resolved.current.from, today);
    const merged = await reference(mine, "merged_prs", "sum", resolved.current.from, today);

    expect(window.value).toBeCloseTo((cost ?? 0) / (merged ?? 1), 9);
    expect(window.components).toEqual({ numerator: cost, denominator: merged });
  });

  it("pools the cycle samples into one median", async () => {
    const window = await metrics.window("cycle_time", {
      organizationId: mine.id,
      repo: `${mine.slug}/helios-firmware`,
      range: "7d",
    });
    const reference = await rewindow(
      api.sql,
      mine.id,
      "cycle_time",
      "median",
      window.from,
      window.to,
    );
    const helios = reference.get(windowKey(`${mine.slug}/helios-firmware`, ""));

    expect(helios).toBeDefined();
    expect(window.value).toBeCloseTo(helios && "value" in helios ? helios.value : NaN, 6);
  });

  it("brings today in through the real extractors' live tail", async () => {
    // A loop that merged a minute ago: no rollup has seen it, and the window still counts it.
    const before = await metrics.window("merged_prs", { organizationId: mine.id, range: "7d" });
    const { rows } = await api.sql.query<{ id: string; finished_at: Date }>(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total, started_at, finished_at, pr_number,
                                   checks_passed, checks_total)
       values ($1, $2, 1, 'Merged today', 'standard-fix', 'claude-fable-5', 'merged', 'Merged',
               6, 6, greatest(now() - interval '10 minutes',
                              date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
               now(), 1, 3, 3)
       returning id, finished_at`,
      [mine.id, mine.repoId],
    );
    await insertLoopPr(api, mine.id, rows[0].id, {
      number: 1,
      state: "merged",
      mergedAt: rows[0].finished_at.toISOString(),
    });
    // Retire the cached window the way a refresh would, so the tail is read again.
    await markRollupRefreshed(api, mine.id);

    const after = await metrics.window("merged_prs", { organizationId: mine.id, range: "7d" });

    expect(after.value).toBe((before.value ?? 0) + 1);
    expect(after.series.at(-1)).toEqual({ day: today, value: 1, meta: {} });
  });

  it("never reads another workspace's rollups", async () => {
    const one = await metrics.window("merged_prs", { organizationId: mine.id, range: "90d" });
    const other = await metrics.window("merged_prs", {
      organizationId: neighbour.id,
      range: "90d",
    });
    const resolved = resolveWindow("90d", new Date());

    // The neighbour's history is the same shape at three times the scale.
    expect(one.value).toBe(
      await reference(mine, "merged_prs", "sum", resolved.current.from, today),
    );
    expect(other.value).toBe((one.value ?? 0) * 3);
  });

  it("does not serve a stale window across a rollup refresh", async () => {
    const scope = { organizationId: mine.id, range: "7d" as const };
    const before = await metrics.window("merged_prs", scope);

    // A refresh rewrites yesterday with ten more merges and marks the family's run.
    await api.sql.query(
      `update ouroboros.metric_daily set value = value + 10
        where organization_id = $1 and metric_id = 'merged_prs' and day = $2::date
          and repo_ref = $3`,
      [mine.id, addDays(today, -1), `${mine.slug}/helios-firmware`],
    );
    await markRollupRefreshed(api, mine.id);

    const after = await metrics.window("merged_prs", scope);

    expect(after.value).toBe((before.value ?? 0) + 10);
  });

  it("answers the KPI row warm within its budget on seed volume", async () => {
    const scope = { organizationId: mine.id, range: "30d" as const };
    const row = () => Promise.all(KPI_ROW.map((metricId) => metrics.window(metricId, scope)));

    await row();

    const samples: number[] = [];
    for (let poll = 0; poll < 20; poll += 1) {
      const started = process.hrtime.bigint();
      await row();
      samples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    }

    const p95 = samples.toSorted((a, b) => a - b)[Math.floor(samples.length * 0.95) - 1];
    expect(p95).toBeLessThan(KPI_WARM_BUDGET_MS);
  });
});
