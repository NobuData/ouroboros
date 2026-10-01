import { workspaceWithRepo, type SeededWorkspace } from "../../../testing/dashboard.fixture";
import { ApiHarness } from "../../../testing/harness.fixture";
import { fillRollups } from "../../../testing/metrics.fixture";
import {
  MOCKUP_15_RENDERED,
  MOCKUP_15_SCOREBOARD,
  renderScoreboardRow,
  seedScoreboardLoop,
  seedScoreboardLoops,
  SPARSE_ROW,
  UNPRICED_ROW,
} from "../../../testing/scoreboard.fixture";
import { MetricsService } from "../metrics/metrics.service";
import { addDays, utcDay } from "../rollup/rollup.days";
import { ScoreboardService } from "./scoreboard.service";

/**
 * The model scoreboard against a migrated database (BJ.3,
 * [#439](https://github.com/NobuData/ouroboros/issues/439)).
 *
 * One workspace holds mockup 15's scoreboard as real loops — runs, resolution snapshots, merged
 * PRs, revisions, loop commits and usage — plus a sparse row and an unpriced one; a neighbour holds
 * the same shape. The suite checks the mockup's rows come back, that the untouched rate is the KPI
 * row's computation, a human push's exclusion, token display, the low-sample badge, and isolation.
 *
 * ```bash
 * yarn test:integration src/modules/insights/scoreboard
 * ```
 */

/** The range the suite reads; the fixture's prior merges sit this many days before the current. */
const DAYS = 7;

describe("the model scoreboard, against PostgreSQL", () => {
  let api: ApiHarness;
  let scoreboards: ScoreboardService;
  let metrics: MetricsService;
  let mine: SeededWorkspace;
  let neighbour: SeededWorkspace;
  let today: string;

  beforeAll(async () => {
    api = await ApiHarness.start();
    scoreboards = api.nest.get(ScoreboardService);
    metrics = api.nest.get(MetricsService);
    today = utcDay(new Date());

    const owner = await api.signIn();
    mine = await workspaceWithRepo(api, owner);
    neighbour = await workspaceWithRepo(api, owner);

    await seedScoreboardLoops(
      api,
      { organizationId: mine.id, repoId: mine.repoId, today, days: DAYS, firstNumber: 1 },
      [...MOCKUP_15_SCOREBOARD, SPARSE_ROW, UNPRICED_ROW],
    );
    await seedScoreboardLoops(
      api,
      { organizationId: neighbour.id, repoId: neighbour.repoId, today, days: DAYS, firstNumber: 1 },
      [{ ...SPARSE_ROW, model: "neighbour-model" }],
    );
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  it("reproduces mockup 15's rows — the fallback annotated, the local model at $0.00", async () => {
    const board = await scoreboards.scoreboard({ organizationId: mine.id, range: "7d" });
    const mockupModels = new Set(MOCKUP_15_SCOREBOARD.map((row) => `${row.taskKind}:${row.model}`));
    const mockupRows = board.rows.filter((row) => mockupModels.has(`${row.taskKind}:${row.model}`));

    expect(mockupRows.map(renderScoreboardRow)).toEqual(MOCKUP_15_RENDERED.map((row) => [...row]));
    expect(mockupRows.find((row) => row.role === "fallback")).toMatchObject({
      taskKind: "implement",
      model: "copilot/gpt-5-codex",
      hop: 2,
    });
    expect(board.methodology.untouched.metricId).toBe("merged_untouched_rate");
    expect(board.methodology.costPerSuccess.metricId).toBe("scoreboard_cost_per_success");
    expect(board.methodology.trend.metricId).toBe("scoreboard_trend");
    expect(board.methodology.sample.metricId).toBe("scoreboard_merged");
    expect(board).not.toHaveProperty("suggestion");
  });

  it("badges the sparse row rather than dropping it", async () => {
    const board = await scoreboards.scoreboard({ organizationId: mine.id, range: "7d" });
    const sparse = board.rows.find((row) => row.taskKind === SPARSE_ROW.taskKind);

    expect(sparse).toMatchObject({ merged: 3, untouchedRate: 100, lowSample: true });
    expect(board.rows.filter((row) => row.lowSample)).toEqual([sparse]);
  });

  it("shows the unpriced row in tokens, with no dollar figure", async () => {
    const board = await scoreboards.scoreboard({ organizationId: mine.id, range: "7d" });
    const unpriced = board.rows.find((row) => row.taskKind === UNPRICED_ROW.taskKind);

    expect(unpriced?.cost).toEqual({
      pricing: "unpriced",
      tokens: 12_000,
      unpricedTokens: 12_000,
      tokensPerSuccess: 1000,
    });
  });

  it("computes untouched exactly as the KPI row does, over the same fixture and days", async () => {
    await fillRollups(api, mine.id, 2 * DAYS);

    const [board, kpi] = await Promise.all([
      scoreboards.scoreboard({ organizationId: mine.id, range: "7d" }),
      metrics.window("merged_untouched_rate", { organizationId: mine.id, range: "7d" }),
    ]);
    const merged = board.rows.reduce((total, row) => total + row.merged, 0);
    const untouched = board.rows.reduce((total, row) => total + row.untouched, 0);

    expect(kpi.components).toEqual({ numerator: untouched, denominator: merged });
    expect(kpi.value).toBeCloseTo((100 * untouched) / merged, 10);
  });

  it("excludes a PR with a human push after the loop's last revision, as the KPI row does", async () => {
    const owner = await api.signIn();
    const solo = await workspaceWithRepo(api, owner);
    const row = { taskKind: "implement", model: "claude-fable-5", hop: 1 };
    const target = { organizationId: solo.id, repoId: solo.repoId };
    const mergedAt = `${addDays(today, -1)}T09:00:00.000Z`;

    await seedScoreboardLoop(api, target, row, {
      number: 1,
      mergedAt,
      humanPush: false,
      cents: 10,
    });
    await seedScoreboardLoop(api, target, row, { number: 2, mergedAt, humanPush: true, cents: 10 });
    await fillRollups(api, solo.id, 2);

    const [board, kpi] = await Promise.all([
      scoreboards.scoreboard({ organizationId: solo.id, range: "7d" }),
      metrics.window("merged_untouched_rate", { organizationId: solo.id, range: "7d" }),
    ]);

    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]).toMatchObject({ merged: 2, untouched: 1, untouchedRate: 50 });
    expect(kpi.components).toEqual({ numerator: 1, denominator: 2 });
  });

  it("reads one workspace only", async () => {
    const [board, other] = await Promise.all([
      scoreboards.scoreboard({ organizationId: mine.id, range: "7d" }),
      scoreboards.scoreboard({ organizationId: neighbour.id, range: "7d" }),
    ]);

    expect(board.rows.map((row) => row.model)).not.toContain("neighbour-model");
    expect(other.rows.map((row) => [row.taskKind, row.model, row.merged])).toEqual([
      [SPARSE_ROW.taskKind, "neighbour-model", 3],
    ]);
  });

  it("narrows to one repository, and to none for a repository with no loops", async () => {
    const all = await scoreboards.scoreboard({ organizationId: mine.id, range: "7d" });
    const own = await scoreboards.scoreboard({
      organizationId: mine.id,
      range: "7d",
      repo: `${mine.slug}/helios-firmware`,
    });
    const elsewhere = await scoreboards.scoreboard({
      organizationId: mine.id,
      range: "7d",
      repo: `${mine.slug}/no-such-repo`,
    });

    expect(own.rows).toEqual(all.rows);
    expect(elsewhere.rows).toEqual([]);
  });
});
