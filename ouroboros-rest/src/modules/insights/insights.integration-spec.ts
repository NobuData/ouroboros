/**
 * The Insights harness's cross-cutting suites against a migrated database (BJ.5,
 * [#441](https://github.com/NobuData/ouroboros/issues/441)).
 *
 * The page's failure mode is a **wrong number**, which renders as beautifully as a right one. The
 * per-module suites each hold their own piece (`rollup/` parity with the oracle twins, `metrics/`,
 * `page/`, `scoreboard/`, `digest/`, calibration, interventions). This one holds what sits between
 * them, where a refactor of one side can quietly disagree with the other:
 *
 *   * **Windows & deltas at the calendar's edges** — 7 / 30 / 90 days at a month start, a week
 *     start, a year end, and instants whose local calendar day is not their UTC day; value, prior
 *     and `delta` against arithmetic done here; and a rate whose average of daily rates is visibly
 *     not its recomposed components.
 *   * **Taxonomy** — the source × signal → cause matrix the `human_interventions` dimension rests
 *     on; a person's cause surviving a *re-mapped* rule's run while the rule moves every rule-origin
 *     event; an idempotent hook replay; and a re-categorization moving the numbers.
 *   * **I6 and the honesty gates over HTTP** — a workspace nothing prices, with real loops: its
 *     KPI untouched rate equals its scoreboard's (a human push excluded on both), and no dollar,
 *     alerts, suggestion or cluster-note key appears anywhere in the payload, scoreboard included.
 *   * **Isolation** — a second workspace mirroring the same repository at three times the volume:
 *     every series point, KPI and scoreboard row is its own.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/insights/insights.integration
 * ```
 */

import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import {
  fillRollups,
  insertMetricDays,
  markRollupRefreshed,
  type MetricDayRow,
} from "../../testing/metrics.fixture";
import {
  seedScoreboardLoops,
  UNPRICED_ROW,
  type FixtureRow,
} from "../../testing/scoreboard.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { METRICS_CLOCK, MetricsService } from "./metrics/metrics.service";
import { METRIC_RANGES, rangeDays, type MetricRange } from "./metrics/metrics.window";
import { keysOf, MONEY_KEY } from "./page/page.fixture";
import type { InsightsResource } from "./page/page.resources";
import { addDays, utcDay } from "./rollup/rollup.days";
import { median } from "./rollup/rollup.rows";

/** Noon UTC today: the instant the page is read at. */
const NOW = Date.parse(`${utcDay(new Date())}T12:00:00.000Z`);
const TODAY = utcDay(new Date(NOW));

/** Keys that would be a gated claim: #237's alerts, #209's suggestion, mockup 18's cluster note. */
const GATED_KEY = /alert|suggest|cluster|note/i;

/** The repository both isolation workspaces mirror, so their `repo_ref` strings are identical. */
const SHARED_REPO = "acme-robotics/helios-firmware";

// ---------------------------------------------------------------------------------------------
// The calendar-edge history: deterministic figures per UTC day, written once and twinned here.
// ---------------------------------------------------------------------------------------------

/** The history's first and last day — wide enough for a 90-day window and its prior at each edge. */
const HISTORY = { from: "2026-02-01", to: "2027-01-02" } as const;

/** A day's figures, from its number of days since 1970-01-01. */
interface DayFigures {
  readonly merged: number;
  readonly autonomous: number;
  readonly closed: number;
  readonly samples: readonly [number, number];
}

/**
 * The figures stored for a day — {@link HISTORY_SQL} written again in TypeScript.
 *
 * Every fourth day is a single autonomous merge of one closed PR (100%); the rest are 1 of 20 (5%).
 * Averaging those daily rates gives ~29%, recomposing them ~6.5% — the fixture where the two
 * computations cannot be confused.
 *
 * @param day - The UTC day.
 * @returns Its figures.
 */
function figuresOf(day: string): DayFigures {
  const n = Date.parse(`${day}T00:00:00.000Z`) / 86_400_000;
  const low = 60_000 * (1 + (n % 5));

  return {
    merged: 1 + (n % 7),
    autonomous: 1,
    closed: n % 4 === 0 ? 1 : 20,
    samples: [low, low + 30_000 * (1 + (n % 3))],
  };
}

/** The same figures, written into `metric_daily` for every day of {@link HISTORY}. */
const HISTORY_SQL = `
  with days as (
    select d::date as day, (d::date - date '1970-01-01') as n
      from generate_series($2::date, $3::date, interval '1 day') d
  ), figures as (
    select day, 1 + n % 7 as merged, 1 as autonomous,
           case when n % 4 = 0 then 1 else 20 end as closed,
           60000 * (1 + n % 5) as low, 60000 * (1 + n % 5) + 30000 * (1 + n % 3) as high
      from days
  )
  insert into ouroboros.metric_daily
    (organization_id, repo_ref, metric_id, is_rate, dimension, day, value, numerator, denominator,
     meta)
  select $1, $4, m.metric_id, m.is_rate, '', day, m.value, m.num, m.den, m.meta
    from figures,
         lateral (values
           ('merged_prs', false, merged::numeric, null::numeric, null::numeric, '{}'::jsonb),
           ('merge_rate', true, 100.0 * autonomous / closed, autonomous::numeric, closed::numeric,
            '{}'::jsonb),
           ('cycle_time', false, (low + high) / 2.0, null, null,
            jsonb_build_object('samples', jsonb_build_array(low, high)))
         ) as m(metric_id, is_rate, value, num, den, meta)`;

/** One calendar edge: an instant, in some offset, and the UTC day it is. */
interface Edge {
  readonly label: string;
  readonly at: string;
  readonly today: string;
}

const EDGES: readonly Edge[] = [
  { label: "a month's first minutes, UTC", at: "2026-09-01T00:30:00.000Z", today: "2026-09-01" },
  {
    label: "a local month start still in August, UTC+05:00",
    at: "2026-09-01T02:00:00+05:00",
    today: "2026-08-31",
  },
  {
    label: "a local August evening already in September, UTC−07:00",
    at: "2026-08-31T22:00:00-07:00",
    today: "2026-09-01",
  },
  { label: "a Sunday's last millisecond", at: "2026-09-06T23:59:59.999Z", today: "2026-09-06" },
  { label: "a Monday's first instant", at: "2026-09-07T00:00:00.000Z", today: "2026-09-07" },
  {
    label: "a local new year still in December, UTC+14:00",
    at: "2027-01-01T00:00:00+14:00",
    today: "2026-12-31",
  },
  {
    label: "a local New Year's Eve already in January, UTC−10:00",
    at: "2026-12-31T23:30:00-10:00",
    today: "2027-01-01",
  },
];

/** A figure over some days, as the reader must re-derive it. */
interface Expected {
  readonly merged: number;
  readonly rate: number | null;
  readonly cycle: number | null;
}

/**
 * A span's figures from {@link figuresOf}: sums add, the rate recomposes its components, the median
 * pools every sample. `today` is excluded — the live tail answers it, and this workspace has no
 * source rows for the tail to find.
 *
 * @param from - The first day.
 * @param to - The last day, inclusive.
 * @param today - The window's today.
 * @returns The figures.
 */
function expected(from: string, to: string, today: string): Expected {
  let merged = 0;
  let autonomous = 0;
  let closed = 0;
  const samples: number[] = [];

  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (day === today) {
      continue;
    }

    const figures = figuresOf(day);
    merged += figures.merged;
    autonomous += figures.autonomous;
    closed += figures.closed;
    samples.push(...figures.samples);
  }

  return {
    merged,
    rate: closed === 0 ? null : (100 * autonomous) / closed,
    cycle: samples.length === 0 ? null : median(samples.sort((a, b) => a - b)),
  };
}

describe("the Insights harness, against a migrated database", () => {
  let api: ApiHarness;
  let metrics: MetricsService;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" }, [
      { provide: METRICS_CLOCK, useValue: () => NOW },
    ]);
    metrics = api.nest.get(MetricsService);
  });

  afterAll(() => api.close());

  describe("windows and deltas at the calendar's edges", () => {
    let workspace: SeededWorkspace;

    beforeAll(async () => {
      workspace = await workspaceWithRepo(api, await api.signIn());
      await api.sql.query(HISTORY_SQL, [workspace.id, HISTORY.from, HISTORY.to, SHARED_REPO]);
    });

    afterAll(() => api.truncate());

    it.each(EDGES.map((edge) => [edge.label, edge]))(
      "answers %s in UTC days — value, prior and delta, every range",
      async (_label, edge) => {
        const now = new Date(edge.at);

        for (const range of METRIC_RANGES) {
          const days = rangeDays(range);
          const from = addDays(edge.today, -(days - 1));
          const prior = {
            from: addDays(edge.today, -(2 * days - 1)),
            to: addDays(edge.today, -days),
          };
          const current = expected(from, edge.today, edge.today);
          const before = expected(prior.from, prior.to, edge.today);
          const scope = { organizationId: workspace.id, range, now };
          const [merged, rate, cycle] = await Promise.all([
            metrics.window("merged_prs", scope),
            metrics.window("merge_rate", scope),
            metrics.window("cycle_time", scope),
          ]);

          expect({ range, from: merged.from, to: merged.to }).toEqual({
            range,
            from,
            to: edge.today,
          });
          expect(merged.series.map((point) => point.day)).toEqual(
            Array.from({ length: days }, (_unused, at) => addDays(from, at)),
          );
          expect({ range, value: merged.value, prior: merged.prior, delta: merged.delta }).toEqual({
            range,
            value: current.merged,
            prior: before.merged,
            delta: current.merged - before.merged,
          });
          expect(rate.value).toBeCloseTo(current.rate ?? NaN, 9);
          expect(rate.prior).toBeCloseTo(before.rate ?? NaN, 9);
          expect(rate.delta).toBeCloseTo((current.rate ?? NaN) - (before.rate ?? NaN), 9);
          expect(cycle.value).toBe(current.cycle);
          expect(cycle.prior).toBe(before.cycle);
        }
      },
    );

    it("recomposes a rate from its components — averaging the daily rates is visibly wrong here", async () => {
      const edge = EDGES[0];
      const range: MetricRange = "30d";
      const window = await metrics.window("merge_rate", {
        organizationId: workspace.id,
        range,
        now: new Date(edge.at),
      });
      const daily = window.series.flatMap((point) => (point.value === null ? [] : [point.value]));
      const averaged = daily.reduce((total, value) => total + value, 0) / daily.length;

      expect(window.components).toEqual({
        numerator: 29,
        denominator: expect.any(Number) as number,
      });
      expect(window.value).toBeCloseTo(
        (100 * (window.components?.numerator ?? NaN)) / (window.components?.denominator ?? NaN),
        9,
      );
      // ~6.5% recomposed against ~29% averaged: an implementation that averaged would be red.
      expect(Math.abs((window.value ?? NaN) - averaged)).toBeGreaterThan(15);
    });
  });

  describe("the intervention taxonomy", () => {
    afterEach(() => api.truncate());

    /** The signal each shipped rule matches, and the cause it maps to; anything else is `other`. */
    const SIGNALS: readonly (readonly [string | null, string])[] = [
      ["class:infra_rig", "infra_rig"],
      ["check:rig_offline", "infra_rig"],
      ["subtype:unclear_requirements", "ambiguous_ticket"],
      ["gate:human", "policy_gate"],
      ["check:review_required", "policy_gate"],
      ["vote:blocking", "model_disagreement"],
      ["class:test_failure", "other"],
      [null, "other"],
    ];
    const SOURCES = [
      "needs_human_run",
      "classification",
      "waiver",
      "policy_gate",
      "guardrail",
      "vote_block",
    ];

    it("maps every source × signal to its rule's cause, and the rest to other", async () => {
      const { rows } = await api.sql.query<{
        source: string;
        signal: string | null;
        cause: string;
      }>(
        `select s.source, g.signal, (${SCHEMA_NAME}.intervention_cause(s.source,
                case when g.signal is null then '{}'::text[] else array[g.signal] end)).cause
           from unnest($1::text[]) as s(source), unnest($2::text[]) as g(signal)`,
        [SOURCES, SIGNALS.map(([signal]) => signal)],
      );

      expect(rows).toHaveLength(SOURCES.length * SIGNALS.length);
      for (const row of rows) {
        const cause = SIGNALS.find(([signal]) => signal === row.signal)?.[1];

        expect(row).toEqual({ ...row, cause });
      }
    });

    /**
     * A loop that handed off just now with two waivers on it: three events today, all `other` by
     * the rules — today, so the windows read them through the live tail.
     *
     * @param workspace - Where.
     * @param author - Who waived.
     * @returns The run and the two waivers' events.
     */
    async function handoff(
      workspace: SeededWorkspace,
      author: Person,
    ): Promise<{ run: string; events: [string, string] }> {
      const {
        rows: [{ id: run }],
      } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.runs
           (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
            status, stage_label, stage_index, stage_total, started_at, finished_at)
         values ($1, $2, 482, 'Loop', 'standard-fix', 'claude-fable-5', 'needs_human', 'Test', 5, 8,
                 now() - interval '1 hour', now())
         returning id`,
        [workspace.id, workspace.repoId],
      );
      const events: string[] = [];

      for (const reason of ["rig runs at 22°C only", "the bench is booked"]) {
        const {
          rows: [{ id: waiver }],
        } = await api.sql.query<{ id: string }>(
          `insert into ${SCHEMA_NAME}.pr_waivers (organization_id, run_id, author, reason)
           values ($1, $2, $3, $4) returning id`,
          [workspace.id, run, author.id, reason],
        );
        const {
          rows: [{ id }],
        } = await api.sql.query<{ id: string }>(
          `select id from ${SCHEMA_NAME}.intervention_events
            where source = 'waiver' and source_ref = $1`,
          [waiver],
        );
        events.push(id);
      }

      return { run, events: [events[0], events[1]] };
    }

    /** Every event of a workspace, as `source:cause:origin`, sorted. */
    async function causes(workspace: SeededWorkspace): Promise<string[]> {
      const { rows } = await api.sql.query<{ line: string }>(
        `select source || ':' || cause || ':' || cause_origin as line
           from ${SCHEMA_NAME}.intervention_events where organization_id = $1 order by 1`,
        [workspace.id],
      );

      return rows.map((row) => row.line);
    }

    /**
     * Remove the harness's rule. The rule table is migration-shipped and survives `truncate()`, so
     * events naming the rule go first, then the rule — before the case (a run that died mid-case
     * left one) and after it, so no other case is mapped by it.
     */
    async function dropHarnessRule(): Promise<void> {
      await api.sql.query(
        `delete from ${SCHEMA_NAME}.intervention_events where rule_id = 'bj5-waiver-policy'`,
      );
      await api.sql.query(
        `delete from ${SCHEMA_NAME}.intervention_cause_rules where rule_id = 'bj5-waiver-policy'`,
      );
    }

    it("keeps a person's cause through a re-mapped rule's run, while the rule moves the rest", async () => {
      await dropHarnessRule();
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);
      const { run, events } = await handoff(workspace, owner);

      await api
        .as(owner)("post", `/api/v1/insights/interventions/${events[0]}/recategorize`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ cause: "infra_rig", reason: "The bench has no thermal chamber." })
        .expect(200);

      // A new rule — every waiver is a policy gate — and the rule run it calls for.
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.intervention_cause_rules
           (rule_id, priority, source, signal, cause, description)
         values ('bj5-waiver-policy', 5, 'waiver', null, 'policy_gate', 'BJ.5 harness rule.')`,
      );

      try {
        await api.sql.query(`select ${SCHEMA_NAME}.apply_intervention_rules($1)`, [workspace.id]);

        const moved = [
          "needs_human_run:other:rule",
          "waiver:infra_rig:human",
          "waiver:policy_gate:rule",
        ];

        expect(await causes(workspace)).toEqual(moved);

        // Replaying the run's hooks twice changes nothing: same events, same causes.
        await api.sql.query(`select ${SCHEMA_NAME}.sync_intervention_events($1)`, [run]);
        await api.sql.query(`select ${SCHEMA_NAME}.sync_intervention_events($1)`, [run]);

        expect(await causes(workspace)).toEqual(moved);
      } finally {
        await dropHarnessRule();
      }
    });

    it("moves the human_interventions numbers when a person re-categorizes", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);
      const { events } = await handoff(workspace, owner);
      const scope = { organizationId: workspace.id, range: "7d" as const, now: new Date() };
      const byCause = async () =>
        Object.fromEntries(
          await Promise.all(
            ["infra_rig", "other"].map(
              async (dimension) =>
                [
                  dimension,
                  (await metrics.window("human_interventions", { ...scope, dimension })).value,
                ] as const,
            ),
          ),
        );

      expect(await byCause()).toEqual({ infra_rig: 0, other: 3 });

      await api
        .as(owner)("post", `/api/v1/insights/interventions/${events[1]}/recategorize`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ cause: "infra_rig", reason: "Rig again." })
        .expect(200);
      await markRollupRefreshed(api, workspace.id, "interventions");

      expect(await byCause()).toEqual({ infra_rig: 1, other: 2 });
    });
  });

  describe("I6 and the honesty gates over HTTP, on real loops nothing prices", () => {
    /** A second unpriced row, with human pushes in both windows. */
    const LOCAL_ROW: FixtureRow = {
      taskKind: "implement",
      model: "byo/qwen-coder",
      hop: 1,
      current: { merged: 4, untouched: 2, centsPerMerge: null },
      prior: { merged: 2, untouched: 2, centsPerMerge: null },
    };

    let workspace: SeededWorkspace;
    let owner: Person;
    let payload: InsightsResource;

    beforeAll(async () => {
      owner = await api.signIn();
      workspace = await workspaceWithRepo(api, owner);
      await seedScoreboardLoops(
        api,
        {
          organizationId: workspace.id,
          repoId: workspace.repoId,
          today: TODAY,
          days: 7,
          firstNumber: 1,
        },
        [UNPRICED_ROW, LOCAL_ROW],
      );
      await fillRollups(api, workspace.id, 14);
      payload = bodyOf<InsightsResource>(
        await api
          .as(owner)("get", "/api/v1/insights?range=7d")
          .set(TENANT_HEADER, workspace.slug)
          .expect(200),
      );
    });

    afterAll(() => api.truncate());

    it("computes untouched once: the KPI row and the scoreboard agree, human pushes excluded", () => {
      const merged = payload.scoreboard.rows.reduce((total, row) => total + row.merged, 0);
      const untouched = payload.scoreboard.rows.reduce((total, row) => total + row.untouched, 0);
      const kpi = payload.kpis.find((card) => card.key === "merged_untouched_rate");

      // 12 + 4 merged, 9 + 2 untouched: five PRs a person pushed to.
      expect({ merged, untouched }).toEqual({ merged: 16, untouched: 11 });
      expect(kpi?.value).toBeCloseTo((100 * 11) / 16, 9);
      expect(kpi?.value).toBeCloseTo((100 * untouched) / merged, 9);
    });

    it("sends no dollar key anywhere — the scoreboard's rows included", () => {
      expect(payload.usage.pricing).toBe("unpriced");
      expect(payload.scoreboard.rows).toHaveLength(2);
      expect(payload.scoreboard.rows.map((row) => row.cost.pricing)).toEqual([
        "unpriced",
        "unpriced",
      ]);
      expect(keysOf(payload).filter((key) => MONEY_KEY.test(key))).toEqual([]);
    });

    it("makes no gated claim: no alerts, suggestion or cluster note, as keys or in the cards", () => {
      expect(keysOf(payload).filter((key) => GATED_KEY.test(key))).toEqual([]);
      expect(Object.keys(payload.series.cost).sort()).toEqual(["methodology", "points"]);
      expect(Object.keys(payload.series.builds).sort()).toEqual(["methodology", "points"]);
      expect(payload.scoreboard).not.toHaveProperty("suggestion");
    });
  });

  describe("isolation between two workspaces mirroring one repository", () => {
    afterAll(() => api.truncate());

    /**
     * Six days of history before today, every count times `scale`.
     *
     * @param scale - The multiplier.
     * @returns The rows.
     */
    function history(scale: number): MetricDayRow[] {
      return [1, 2, 3, 4, 5, 6].flatMap((ago) => {
        const day = addDays(TODAY, -ago);
        const at = (metricId: string, value: number, extra: Partial<MetricDayRow> = {}) => ({
          repoRef: SHARED_REPO,
          metricId,
          day,
          value,
          ...extra,
        });

        return [
          at("merged_prs", ago * scale),
          at("human_interventions", (ago % 3) * scale, { dimension: "infra_rig" }),
          at("cost_cents", 100 * ago * scale),
          at("tokens", 1_000 * ago * scale),
          at("builds", 10 * ago * scale),
          at("build_failures", ago * scale),
        ];
      });
    }

    it("draws every series point, KPI and scoreboard row from its own workspace only", async () => {
      const owner = await api.signIn();
      const mine = await workspaceWithRepo(api, owner);
      const theirs = await workspaceWithRepo(api, owner);

      await insertMetricDays(api, mine.id, history(1));
      await insertMetricDays(api, theirs.id, history(3));
      await seedScoreboardLoops(
        api,
        { organizationId: theirs.id, repoId: theirs.repoId, today: TODAY, days: 7, firstNumber: 1 },
        [UNPRICED_ROW],
      );

      const read = async (at: SeededWorkspace) =>
        bodyOf<InsightsResource>(
          await api
            .as(owner)("get", "/api/v1/insights?range=30d")
            .set(TENANT_HEADER, at.slug)
            .expect(200),
        );
      const [a, b] = [await read(mine), await read(theirs)];

      // Every numeric field of every point is the neighbour's divided by three — nothing shared.
      for (const series of ["throughput", "cost", "builds"] as const) {
        const triple = a.series[series].points.map((point) =>
          Object.fromEntries(
            Object.entries(point).map(([key, value]) => [
              key,
              typeof value === "number" ? 3 * value : value,
            ]),
          ),
        );

        expect({ series, points: b.series[series].points }).toEqual({ series, points: triple });
      }
      expect(a.series.throughput.points.some((point) => point.mergedPrs > 0)).toBe(true);
      expect(b.kpis.find((card) => card.key === "human_interventions")?.value).toBe(
        3 * (a.kpis.find((card) => card.key === "human_interventions")?.value ?? NaN),
      );
      expect(a.scoreboard.rows).toEqual([]);
      expect(b.scoreboard.rows.map((row) => [row.taskKind, row.merged])).toEqual([
        [UNPRICED_ROW.taskKind, 12],
      ]);
    });
  });
});
