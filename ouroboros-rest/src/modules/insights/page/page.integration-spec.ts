/**
 * `GET /api/v1/insights` against a migrated database (BJ.2,
 * [#438](https://github.com/NobuData/ouroboros/issues/438)).
 *
 * What only a database and a socket can answer:
 *
 *   * **One truth.** Every figure on the page equals what `MetricsService.window()` answers for
 *     that metric alone — the page is a composition, never a second computation.
 *   * **The grain accepts what the page reads.** V083's `tokens_by_task_kind` and `local_tokens`
 *     rows pass V078's shape guard, and today's are computed live by the cost extractor from real
 *     `token_usage` rows.
 *   * **The lines are the stored rows' arithmetic**, and move when a row moves.
 *   * **The gates hold over HTTP**: a workspace nothing prices is sent no dollar key; the budget
 *     guide is the enabled connections' real caps.
 *   * **Access**: every member reads it, a bad range is a `422` naming the field, a stranger is a
 *     `401`, and another workspace's header is a `404` — while a second workspace mirroring the
 *     same repository sees none of the first's numbers.
 *
 * The clock is held to noon UTC of the day the suite starts, so a run across midnight reads one
 * day throughout; every source row is written with an explicit instant inside it.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/insights/page
 * ```
 */

import { PRIMARY_REPO, SECOND_REPO, addRepo } from "../../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { insertMetricDays, type MetricDayRow } from "../../../testing/metrics.fixture";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { METRICS_CLOCK, MetricsService } from "../metrics/metrics.service";
import { addDays, utcDay } from "../rollup/rollup.days";
import { barCards } from "./page.fixture";
import type { InsightsResource } from "./page.resources";
import { PAGE_METRICS } from "./page.service";

/** Noon UTC today: the one instant the application reads the page at. */
const NOW = Date.parse(`${utcDay(new Date())}T12:00:00.000Z`);
const TODAY = utcDay(new Date(NOW));
/** Days before today, as `YYYY-MM-DD`. */
const ago = (days: number): string => addDays(TODAY, -days);

/** The account both workspaces mirror — so their `repo_ref`s are the same strings. */
const ACCOUNT = "acme-robotics";
const HELIOS = `${ACCOUNT}/${PRIMARY_REPO}`;
const ATLAS = `${ACCOUNT}/${SECOND_REPO}`;

/** A workspace mirroring `acme-robotics`'s two repositories. */
interface Bench {
  readonly owner: Person;
  readonly id: string;
  readonly slug: string;
  /** `github_repos.id` of helios-firmware. */
  readonly repoId: string;
}

/**
 * Keys that carry dollars: every `…Cents` figure and the cost chart's three money-only sections.
 */
const MONEY_KEY = /cents$|^budget$|^projection$|^spike$/i;

/**
 * Every key anywhere in a JSON value.
 *
 * @param value - The value.
 * @returns The keys, with repeats.
 */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysOf);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

describe("the Insights page, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" }, [
      { provide: METRICS_CLOCK, useValue: () => NOW },
    ]);
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace mirroring `acme-robotics/helios-firmware` and `acme-robotics/atlas-control`.
   *
   * @param owner - Its owner; signed in when omitted.
   * @returns The bench.
   */
  async function bench(owner?: Person): Promise<Bench> {
    const person = owner ?? (await api.signIn());
    const workspace = await api.workspace(person);
    const { rows: accounts } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, $2, true) returning id`,
      [workspace.id, ACCOUNT],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_repos (org_id, name, enabled)
       values ($1, $2, true) returning id`,
      [accounts[0].id, PRIMARY_REPO],
    );
    const seeded = { id: workspace.id, slug: workspace.slug, repoId: repos[0].id };

    await addRepo(api, seeded);

    return { owner: person, ...seeded };
  }

  /**
   * One repository's rolled-up history: a full day yesterday and a thinner one in the prior week.
   *
   * @param repoRef - The repository.
   * @param scale - A multiplier on every count, so two populations never agree by accident.
   * @returns The rows.
   */
  function history(repoRef: string, scale = 1): MetricDayRow[] {
    const day = ago(1);
    const prior = ago(10);
    const at = (
      metricId: string,
      value: number,
      extra: Partial<MetricDayRow> = {},
    ): MetricDayRow => ({
      repoRef,
      metricId,
      day,
      value,
      ...extra,
    });
    const rate = (metricId: string, numerator: number, denominator: number, on = day) =>
      at(metricId, (100 * numerator) / denominator, { numerator, denominator, day: on });
    const median = (metricId: string, dimension: string, samples: number[]) =>
      at(metricId, samples[Math.floor(samples.length / 2)], { dimension, samples });

    return [
      at("merged_prs", 4 * scale),
      rate("merge_rate", 4 * scale, 5 * scale),
      rate("merged_untouched_rate", 3 * scale, 4 * scale),
      at("cycle_time", 800_000, { samples: [600_000, 800_000, 1_000_000] }),
      at("cost_cents", 400 * scale),
      at("tokens", 10_000 * scale),
      at("unpriced_tokens", 1_000 * scale),
      at("local_tokens", 3_000 * scale),
      // 1 000 of the day's tokens named no task kind: in the total, in no bar.
      at("tokens_by_task_kind", 7_000 * scale, { dimension: "implement" }),
      at("tokens_by_task_kind", 2_000 * scale, { dimension: "docs" }),
      at("builds", 10 * scale),
      at("build_failures", scale),
      rate("build_success_rate", 9 * scale, 10 * scale),
      at("test_cases_run", 500 * scale),
      rate("test_pass_rate", 495 * scale, 500 * scale),
      at("test_failures_by_suite", 3 * scale, { dimension: "OTA update" }),
      at("test_failures_by_suite", 2 * scale, { dimension: "physical · HIL" }),
      median("stage_duration", "plan", [60_000]),
      median("stage_duration", "implement", [300_000]),
      median("stage_duration", "test", [120_000]),
      median("completion_time_by_effort", "xs", [360_000]),
      median("completion_time_by_effort", "s", [660_000]),
      at("human_interventions", 3 * scale, { dimension: "infra_rig" }),
      at("human_interventions", scale, { dimension: "other" }),
      at("deploy_frequency", 4 * scale),
      // Lead time and MTTR are means: a duration total over a count.
      at("lead_time", 900_000, { numerator: 3_600_000 * scale, denominator: 4 * scale }),
      rate("change_failure_rate", scale, 4 * scale),
      at("mttr", 1_200_000, { numerator: 1_200_000 * scale, denominator: scale }),
      // the prior week
      at("merged_prs", 2 * scale, { day: prior }),
      rate("merge_rate", scale, 4 * scale, prior),
      at("cost_cents", 900 * scale, { day: prior }),
      at("tokens", 5_000 * scale, { day: prior }),
      at("unpriced_tokens", 0, { day: prior }),
      at("human_interventions", 5 * scale, { dimension: "infra_rig", day: prior }),
    ];
  }

  /**
   * Usage recorded today, on a loop of helios-firmware — what the live tail reads.
   *
   * @param at - The bench.
   * @param usage - The call: provider kind, task kind, tokens and priced cost (null = unpriced).
   */
  async function usageToday(
    at: Bench,
    usage: { provider: string; taskKind: string | null; tokens: number; costCents: number | null },
  ): Promise<void> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runs
              (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
               status, stage_label, stage_index, stage_total, started_at)
       values ($1, $2, (select coalesce(max(issue_number), 480) + 1 from ouroboros.runs
                         where organization_id = $1),
               'A loop', 'standard-fix', 'claude-fable-5', 'coding', 'Code', 3, 6, $3)
       returning id`,
      [at.id, at.repoId, new Date(NOW - 3_600_000)],
    );

    await api.sql.query(
      `insert into ouroboros.token_usage
              (organization_id, run_id, provider, model, tokens_in, tokens_out, cost_cents,
               task_kind, occurred_at)
       values ($1, $2, $3, 'a-model', $4, 0, $5, $6, $7)`,
      [
        at.id,
        rows[0].id,
        usage.provider,
        usage.tokens,
        usage.costCents,
        usage.taskKind,
        new Date(NOW - 1_800_000),
      ],
    );
  }

  /** `GET /api/v1/insights` as somebody in a workspace. */
  function page(at: Pick<Bench, "slug">, person: Person, query = "") {
    return api.as(person)("get", `/api/v1/insights${query}`).set(TENANT_HEADER, at.slug);
  }

  /** The page's payload for the owner. */
  async function read(at: Bench, query = ""): Promise<InsightsResource> {
    return bodyOf<InsightsResource>(await page(at, at.owner, query).expect(200));
  }

  describe("one truth", () => {
    it("draws every figure exactly as the windowed metrics service answers it alone", async () => {
      const at = await bench();
      await insertMetricDays(api, at.id, [...history(HELIOS), ...history(ATLAS, 3)]);
      const metrics = api.nest.get(MetricsService);
      const scope = {
        organizationId: at.id,
        repo: HELIOS,
        range: "7d" as const,
        now: new Date(NOW),
      };

      const payload = await read(at, `?range=7d&repo=${encodeURIComponent(HELIOS)}`);
      const alone = new Map(
        await Promise.all(
          PAGE_METRICS.map(
            async (metricId) => [metricId, await metrics.window(metricId, scope)] as const,
          ),
        ),
      );
      const value = (metricId: string) => alone.get(metricId)?.value ?? null;

      expect(payload.window).toEqual({ from: ago(6), to: TODAY });
      expect(payload.repo).toBe(HELIOS);
      expect(payload.kpis.map((card) => [card.key, card.value, card.prior])).toEqual([
        ["autonomous_merge_rate", value("merge_rate"), alone.get("merge_rate")?.prior],
        ["merged_untouched_rate", value("merged_untouched_rate"), null],
        ["cycle_time", value("cycle_time"), null],
        ["cost_per_merged_pr", value("cost_per_merged_pr"), alone.get("cost_per_merged_pr")?.prior],
        ["human_interventions", value("human_interventions"), 5],
      ]);
      // 4 of 5 against 1 of 4; $4.00 over 4 merges against $9.00 over 2.
      expect(payload.kpis.map((card) => card.value)).toEqual([80, 75, 800_000, 100, 4]);
      expect(payload.kpis[0]).toMatchObject({ prior: 25, delta: 55, trend: { good: true } });
      expect(payload.kpis[3]).toMatchObject({ unit: "cents", prior: 450, delta: -350 });
      expect(payload.performance.map((cell) => [cell.key, cell.value])).toEqual([
        ["builds", value("builds")],
        ["build_success_rate", value("build_success_rate")],
        ["test_cases_run", value("test_cases_run")],
        ["test_pass_rate", value("test_pass_rate")],
        ["tokens", value("tokens")],
        ["total_cost", value("cost_cents")],
      ]);
      expect(payload.dora.map((cell) => [cell.key, cell.value, cell.proxy])).toEqual([
        ["deploy_frequency", (value("deploy_frequency") ?? 0) / 7, false],
        ["lead_time", value("lead_time"), false],
        ["change_failure_rate", value("change_failure_rate"), true],
        ["mttr", value("mttr"), true],
      ]);
      // Every methodology on the page is the registry's own row, version included.
      for (const card of payload.kpis) {
        expect(card.methodology).toEqual(alone.get(card.methodology.metricId)?.methodology);
      }
    });

    it("keeps the head on the last seven days whatever range the page shows", async () => {
      const at = await bench();
      await insertMetricDays(api, at.id, history(HELIOS));

      const payload = await read(at, "?range=30d");

      expect(payload.head).toEqual({ range: "7d", mergedPrs: 4, interventions: 4 });
      // The 30-day page also holds the prior week's two merges and five interventions.
      expect(payload.kpis[4].value).toBe(9);
      expect(payload.series.throughput.points).toHaveLength(30);
    });

    it("sums the workspace when no repository is named, and one repository when it is", async () => {
      const at = await bench();
      await insertMetricDays(api, at.id, [...history(HELIOS), ...history(ATLAS, 3)]);

      const workspace = await read(at, "?range=7d");
      const helios = await read(at, `?range=7d&repo=${encodeURIComponent(HELIOS.toUpperCase())}`);

      expect(workspace.repo).toBeNull();
      expect(workspace.performance[0].value).toBe(40);
      expect(helios.repo).toBe(HELIOS);
      expect(helios.performance[0].value).toBe(10);
    });
  });

  describe("the bar cards, from stored rows", () => {
    it("computes each line from the rows under it, and recomputes when a row moves", async () => {
      const at = await bench();
      await insertMetricDays(api, at.id, history(HELIOS));

      const { hbars } = await read(at, "?range=7d");

      expect(hbars.interventions).toMatchObject({
        total: 4,
        bars: [
          { key: "infra_rig", label: "Flaky env / rig", value: 3 },
          { key: "other", label: "Other", value: 1 },
        ],
        line: "Fix the top row and interventions drop ~75%.",
      });
      expect(hbars.stages).toMatchObject({
        total: null,
        bars: [
          { label: "Plan", value: 60_000 },
          { label: "Implement", value: 300_000 },
          { label: "Test", value: 120_000 },
        ],
        line: "Implement dominates the loop — the other two stages sum to 3m.",
      });
      expect(hbars.suites).toMatchObject({
        total: 5,
        line: "5 failing cases total — 1% of everything that ran.",
      });
      expect(hbars.effort.bars.map((bar) => bar.label)).toEqual(["XS", "S"]);
      // Nothing was graded in this workspace, so calibration has nothing to say.
      expect(hbars.effort.line).toBeNull();
      expect(hbars.tokens).toMatchObject({
        total: 10_000,
        bars: [
          { key: "implement", value: 7_000 },
          { key: "docs", value: 2_000 },
        ],
        line: "≈ 2.5k tokens per merged PR · 30% served by local models.",
      });

      // One more intervention of another cause, yesterday: the sentence follows the rows.
      await insertMetricDays(api, at.id, [
        {
          repoRef: HELIOS,
          metricId: "human_interventions",
          day: ago(2),
          value: 4,
          dimension: "policy_gate",
        },
      ]);
      // A new row is a rollup refresh; without one the page may serve its 30-second cache.
      await api.sql.query(
        `insert into ouroboros.metric_rollup_state
                (organization_id, family, last_run_status, last_run_at)
         values ($1, 'interventions', 'succeeded', clock_timestamp())`,
        [at.id],
      );

      const moved = await read(at, "?range=7d");

      expect(moved.hbars.interventions).toMatchObject({
        total: 8,
        bars: [{ label: "Policy gate" }, { label: "Flaky env / rig" }, { label: "Other" }],
        line: "Fix the top row and interventions drop ~50%.",
      });
    });

    it("reads today's tokens by task kind and local share live, through the cost extractor", async () => {
      const at = await bench();
      await insertMetricDays(api, at.id, history(HELIOS));
      // A local model served a review today, priced at nothing; a cloud call named no task kind.
      await usageToday(at, { provider: "ollama", taskKind: "review", tokens: 2_000, costCents: 0 });
      await usageToday(at, { provider: "anthropic", taskKind: null, tokens: 500, costCents: 25 });

      const payload = await read(at, "?range=7d");

      expect(payload.usage).toEqual({
        pricing: "priced",
        tokens: 12_500,
        unpricedTokens: 1_000,
        costCents: 425,
      });
      expect(payload.hbars.tokens).toMatchObject({
        // The untagged 500 are in the total and in no bar.
        total: 12_500,
        bars: [
          { key: "implement", value: 7_000 },
          { key: "docs", value: 2_000 },
          { key: "review", value: 2_000 },
        ],
        // 3 000 stored + today's 2 000 local, of 12 500.
        line: "≈ 3.1k tokens per merged PR · 40% served by local models.",
      });
      // Today's point: a real $0.25 beside 2 500 tokens.
      expect(payload.series.cost.points.at(-1)).toEqual({
        day: TODAY,
        tokens: 2_500,
        costCents: 25,
      });
      expect(payload.series.throughput.points.at(-2)).toEqual({
        day: ago(1),
        mergedPrs: 4,
        interventions: 4,
        costCents: 400,
      });
    });
  });

  describe("the honesty gates, over HTTP", () => {
    it("sends a workspace nothing prices tokens and no dollar key", async () => {
      const at = await bench();
      await insertMetricDays(
        api,
        at.id,
        history(HELIOS).filter((row) => row.metricId !== "cost_cents" && row.day === ago(1)),
      );
      // Every token unpriced.
      await api.sql.query(
        `update ouroboros.metric_daily set value = 10000
          where organization_id = $1 and metric_id = 'unpriced_tokens'`,
        [at.id],
      );
      await api.sql.query(
        `insert into ouroboros.provider_connections
                (organization_id, kind, display_name, status, monthly_cap_cents)
         values ($1, 'anthropic', 'Anthropic', 'unknown', 60000)`,
        [at.id],
      );

      const { scoreboard, ...payload } = await read(at, "?range=7d");

      expect(payload.usage).toEqual({
        pricing: "unpriced",
        tokens: 10_000,
        unpricedTokens: 10_000,
      });
      expect(keysOf(payload).filter((key) => MONEY_KEY.test(key))).toEqual([]);
      expect(payload.kpis[3]).toMatchObject({ unit: "tokens", value: 2_500 });
      expect(payload.performance.at(-1)).toMatchObject({ key: "total_cost", value: null });
      // Even with a cap configured: a guide to compare unknown spend against would be a claim.
      expect(Object.keys(payload.series.cost).sort()).toEqual(["methodology", "points"]);
      expect(scoreboard).not.toHaveProperty("suggestion");
    });

    it("draws the budget guide from the enabled connections' real caps, and no alerts claim", async () => {
      const at = await bench();
      await insertMetricDays(api, at.id, history(HELIOS));
      await api.sql.query(
        `insert into ouroboros.provider_connections
                (organization_id, kind, display_name, status, monthly_cap_cents, enabled, base_url)
         values ($1, 'anthropic', 'Anthropic', 'unknown', 60000, true, null),
                ($1, 'cursor', 'Cursor', 'unknown', 12000, true, null),
                ($1, 'ollama', 'Ollama', 'unknown', null, true, 'http://localhost:11434'),
                ($1, 'copilot', 'Copilot', 'unknown', 9500, false, null)`,
        [at.id],
      );

      const { cost } = (await read(at, "?range=7d")).series;
      const daysInMonth = new Date(
        Date.UTC(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)), 0),
      ).getUTCDate();

      // The uncapped connection adds nothing; the disabled one's cap is not part of the budget.
      expect(cost.budget).toEqual({
        monthlyCapCents: 72_000,
        dailyCents: Math.round(72_000 / daysInMonth),
        connections: 2,
      });
      expect(keysOf(cost).filter((key) => /alert/i.test(key))).toEqual([]);
    });

    it("answers a workspace with nothing measured: nulls, empty cards, no lines, no claims", async () => {
      const at = await bench();

      const payload = await read(at);

      expect(payload.range).toBe("30d");
      expect(payload.usage).toEqual({ pricing: "none", tokens: 0, unpricedTokens: 0 });
      expect(payload.head).toEqual({ range: "7d", mergedPrs: 0, interventions: 0 });
      expect(payload.kpis.map((card) => card.value)).toEqual([null, null, null, null, 0]);
      expect(barCards(payload.hbars).map((card) => [card.bars.length, card.line])).toEqual([
        [0, null],
        [0, null],
        [0, null],
        [0, null],
        [0, null],
      ]);
      expect(payload.flaky.cases).toEqual([]);
      expect(payload.scoreboard.rows).toEqual([]);
      expect(keysOf(payload).filter((key) => MONEY_KEY.test(key))).toEqual([]);
    });
  });

  describe("access", () => {
    it("is open to every member, and refuses a stranger", async () => {
      const at = await bench();
      const viewer = await api.signIn();
      await api.join(at.id, viewer, "viewer");

      await page(at, viewer, "?range=90d").expect(200);
      await api.anonymous("get", "/api/v1/insights").expect(401);
    });

    it.each([["custom"], ["1y"], ["30D"]])(
      "refuses range %p with 422, naming the field",
      async (range) => {
        const at = await bench();

        const response = await page(at, at.owner, `?range=${range}`).expect(422);

        expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
          code: "validation_failed",
          details: { range: [expect.stringContaining("7d, 30d, 90d") as unknown] },
        });
      },
    );

    it("refuses a repository that is not owner/name", async () => {
      const at = await bench();

      const response = await page(at, at.owner, "?repo=..%2Fetc").expect(422);

      expect(bodyOf<ErrorEnvelope>(response).details).toHaveProperty("repo");
    });

    it("answers another workspace's header 404 — never 403", async () => {
      const at = await bench();
      const stranger = await api.signIn();
      await api.workspace(stranger);

      const response = await page(at, stranger).expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("tenant_not_found");
    });

    it("shows a second workspace mirroring the same repository none of the first's numbers", async () => {
      const mine = await bench();
      const theirs = await bench();
      // The same repo_ref strings in both workspaces; theirs is three times the size.
      await insertMetricDays(api, mine.id, history(HELIOS));
      await insertMetricDays(api, theirs.id, history(HELIOS, 3));
      await usageToday(theirs, {
        provider: "ollama",
        taskKind: "review",
        tokens: 9_000,
        costCents: 0,
      });
      // Each has one capped connection of its own.
      await api.sql.query(
        `insert into ouroboros.provider_connections
                (organization_id, kind, display_name, status, monthly_cap_cents)
         values ($1, 'anthropic', 'Anthropic', 'unknown', 60000),
                ($2, 'anthropic', 'Anthropic', 'unknown', 90000)`,
        [mine.id, theirs.id],
      );

      const query = `?range=7d&repo=${encodeURIComponent(HELIOS)}`;
      const [a, b] = [await read(mine, query), await read(theirs, query)];

      expect(a.head).toEqual({ range: "7d", mergedPrs: 4, interventions: 4 });
      expect(b.head).toEqual({ range: "7d", mergedPrs: 12, interventions: 12 });
      expect(a.usage.tokens).toBe(10_000);
      expect(b.usage.tokens).toBe(39_000);
      expect(a.hbars.tokens.bars.map((bar) => bar.key)).toEqual(["implement", "docs"]);
      expect(a.hbars.interventions.total).toBe(4);
      expect(b.hbars.interventions.total).toBe(12);
      expect(a.series.cost.budget).toMatchObject({ monthlyCapCents: 60_000, connections: 1 });
      expect(b.series.cost.budget).toMatchObject({ monthlyCapCents: 90_000, connections: 1 });
    });
  });

  it("answers a warm page well inside a second", async () => {
    const at = await bench();
    await insertMetricDays(api, at.id, [...history(HELIOS), ...history(ATLAS, 2)]);
    await read(at, "?range=90d");

    const started = Date.now();
    await read(at, "?range=90d");

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
