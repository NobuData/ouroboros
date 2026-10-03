import {
  ApiHarness,
  type Method,
  type Person,
  type Workspace,
} from "../../../testing/harness.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import type { EngineFinding } from "../../engine/engine.analysis";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { pendingProgress } from "../analysis.progress";
import { AnalysisRepository } from "../analysis.repository";
import {
  analyze,
  BENCH_ANALYZER_SET,
  BENCH_REPO,
  filledThrough,
  recordApplication,
  rollUp,
  seedSeededIdsWorkspace,
  suggestionId,
} from "../analyzer.integration.fixture";
import { POOL_A_ID } from "../composer/composer.seed.fixture";
import type { MeasurementsResource } from "./measurement.resources";
import { MeasurementService } from "./measurement.service";

/**
 * The measurement job and calibration against a migrated database (BV.6,
 * [#515](https://github.com/NobuData/ouroboros/issues/515)).
 *
 *   * mockup 18's pair verdicts as printed — the test-suite split **delivered**, the ccache
 *     warm-up **under** with *"under-delivered — analyzer revised its cache model"* — and both
 *     verdicts are V085's arithmetic over the stored numbers;
 *   * a second application on the same metric inside an open window is **confounded**, listed,
 *     and never a calibration input; so is a change-point detected in that metric;
 *   * another workspace's applications and change-points interfere with nothing here;
 *   * the factor is reproducible, bounded, cited — and **the next composition uses it**;
 *   * an open measurement reads *day N of 14*.
 *
 * The adversarial cases are written so that removing a control turns them red: no confound
 * detection ⇒ the confounded case closes clean; no calibration application ⇒ the recomposed
 * estimate is the raw one.
 *
 * ```bash
 * yarn test:integration src/modules/analyzer/measurement
 * ```
 */

/** The ccache warm-up's raw estimate in the seeded findings — the composer's −168 s. */
const CCACHE_RAW = -168;

/**
 * A change-point finding in the build-duration series, as the analyzer emits one.
 *
 * @param date - The breakpoint day.
 * @param poolId - A runner pool of the run's workspace, for the finding's evidence.
 * @returns The finding.
 */
function changePoint(date: string, poolId: string): EngineFinding {
  return {
    analyzer: "change_point",
    analyzer_version: 1,
    finding_type: "change_point",
    subject_key: `build.duration_median@${date}`,
    data: {
      metric: "build.duration_median",
      date,
      delta_seconds: -40,
      candidates: [
        { label: "west.yml bumped", score: 0.8, ref: { kind: "runner_pool", id: poolId } },
      ],
    },
    evidence_refs: [{ kind: "runner_pool", id: poolId }],
    confidence: 80,
    confidence_basis: {
      method: "change_point v1",
      sample_size: 30,
      effect_size: 1,
      stability: 0.9,
    },
  };
}

describe("the measurement job", () => {
  let api: ApiHarness;
  let owner: Person;
  let workspace: Workspace;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    owner = await api.signIn();
    workspace = await api.workspace(owner);
    await seedSeededIdsWorkspace(api, workspace);
    await analyze(api, workspace);
  });

  afterEach(() => api.truncate());

  /** A pass at an instant. */
  function pass(at: string) {
    return api.nest.get(MeasurementService).pass(new Date(at));
  }

  /** A measurement's stored outcome. */
  async function outcome(id: string) {
    const { rows } = await api.sql.query<{
      verdict: string;
      note: string | null;
      measured: { value: number; delta: number } | null;
      confounds: { kind: string; id: string; date: string }[];
      by_hand: string | null;
    }>(
      `select m.verdict, m.note, m.measured, m.confounds,
              ouroboros.suggestion_measurement_verdict(
                (m.predicted ->> 'delta')::numeric, (m.measured ->> 'delta')::numeric,
                m.verdict_under_below, m.verdict_over_above,
                jsonb_array_length(m.confounds) > 0) as by_hand
         from ${SCHEMA_NAME}.suggestion_measurements m where m.id = $1`,
      [id],
    );
    return rows[0];
  }

  /** A calibration cell and its newest history row. */
  async function cell(analyzer: string) {
    const { rows } = await api.sql.query<{
      factor: string;
      measurement_ids: string[];
      added_measurement_ids: string[];
      measured_sum: string;
      predicted_sum: string;
    }>(
      `select c.factor::text as factor, h.measurement_ids, h.added_measurement_ids,
              h.measured_sum::text as measured_sum, h.predicted_sum::text as predicted_sum
         from ${SCHEMA_NAME}.analyzer_calibration c
         join lateral (select * from ${SCHEMA_NAME}.analyzer_calibration_history h
                        where (h.organization_id, h.repo_ref, h.analyzer, h.impact_class)
                              = (c.organization_id, c.repo_ref, c.analyzer, c.impact_class)
                        order by h.id desc limit 1) h on true
        where c.organization_id = $1 and c.analyzer = $2`,
      [workspace.id, analyzer],
    );
    return rows[0];
  }

  /** The mockup's pair, applied a week apart on different metrics, with their windows rolled up. */
  async function mockupPair(): Promise<{ split: string; warm: string }> {
    const split = await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Split the test gate"),
      {
        at: "2026-07-02T10:00:00Z",
        metric: "cycle_time",
        baseline: 912,
        delta: -220,
        analyzer: "workflow_outcome",
      },
    );
    const warm = await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Move forge-02"),
      {
        at: "2026-07-09T10:00:00Z",
        metric: "stage_duration",
        baseline: 380,
        delta: -110,
        analyzer: "cache_window",
      },
    );
    await rollUp(api, workspace, "cycle_time", "2026-07-08", [677_000]);
    await rollUp(api, workspace, "stage_duration", "2026-07-15", [300_000, 316_000], "build");
    await filledThrough(api, workspace, "cycle", "2026-07-23");
    return { split, warm };
  }

  it("verdicts the mockup's pair as printed, by V085's arithmetic, and revises the cache model", async () => {
    const { split, warm } = await mockupPair();

    const result = await pass("2026-07-24T03:00:00Z");

    expect(result.failed).toEqual([]);
    expect(await outcome(split)).toMatchObject({
      verdict: "delivered",
      note: null,
      measured: { value: 677, delta: -235 },
      by_hand: "delivered",
      confounds: [],
    });
    expect(await outcome(warm)).toMatchObject({
      verdict: "under",
      note: "under-delivered — analyzer revised its cache model",
      measured: { value: 308, delta: -72 },
      by_hand: "under",
    });
    // −72 ÷ −110 = 0.6545, the measurement cited as the one that moved it.
    expect(await cell("cache_window")).toMatchObject({
      factor: "0.6545",
      added_measurement_ids: [warm],
      measured_sum: "-72.000000",
      predicted_sum: "-110.000000",
    });
    expect((await cell("workflow_outcome")).factor).toBe("1.0682");
  });

  it("closes a window muddied by a second application on the same metric as confounded — never clean", async () => {
    const first = await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Split the test gate"),
      {
        at: "2026-07-09T10:00:00Z",
        metric: "build_duration",
        baseline: 380,
        delta: -110,
        analyzer: "cache_window",
      },
    );
    const secondId = await suggestionId(api, workspace, "Move forge-02");
    const second = await recordApplication(api, workspace, owner, secondId, {
      at: "2026-07-15T10:00:00Z",
      metric: "build_duration",
      baseline: 330,
      delta: -50,
      analyzer: "cache_window",
    });
    await rollUp(api, workspace, "build_duration", "2026-07-20", [308_000], "zephyr build");
    await filledThrough(api, workspace, "build_duration", "2026-07-29");

    await pass("2026-07-30T03:00:00Z");

    expect(await outcome(first)).toMatchObject({
      verdict: "confounded",
      by_hand: "confounded",
      confounds: [{ kind: "application", id: secondId, date: "2026-07-15" }],
      note: "confounded — 1 interfering event in the window; not counted toward calibration",
    });
    // The second's window opens after the first was applied, so it is clean — and only it
    // calibrates: the confounded one is never an input.
    expect((await outcome(second)).verdict).not.toBe("confounded");
    expect((await cell("cache_window")).measurement_ids).toEqual([second]);
  });

  it("flags interference as soon as it lands, before the window closes", async () => {
    const first = await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Split the test gate"),
      {
        at: "2026-07-09T10:00:00Z",
        metric: "build_duration",
        baseline: 380,
        delta: -110,
        analyzer: "cache_window",
      },
    );
    await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Move forge-02"),
      {
        at: "2026-07-15T10:00:00Z",
        metric: "build_duration",
        baseline: 330,
        delta: -50,
        analyzer: "cache_window",
      },
    );

    await pass("2026-07-16T03:00:00Z");

    expect(await outcome(first)).toMatchObject({
      verdict: "pending",
      confounds: [{ kind: "application" }],
    });
  });

  it("is confounded by a change-point the analyzer detected in the metric inside the window", async () => {
    const id = await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Split the test gate"),
      {
        at: "2026-07-09T10:00:00Z",
        metric: "build_duration",
        baseline: 380,
        delta: -110,
        analyzer: "cache_window",
      },
    );
    await analyze(api, workspace, [changePoint("2026-07-12", POOL_A_ID)]);
    await rollUp(api, workspace, "build_duration", "2026-07-20", [308_000], "zephyr build");
    await filledThrough(api, workspace, "build_duration", "2026-07-23");

    await pass("2026-07-24T03:00:00Z");

    expect(await outcome(id)).toMatchObject({
      verdict: "confounded",
      confounds: [{ kind: "change_point", date: "2026-07-12" }],
    });
  });

  it("is not confounded by another workspace's change-point on the same repository and metric", async () => {
    const other = await api.signIn();
    const theirs = await api.workspace(other);
    const id = await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Split the test gate"),
      {
        at: "2026-07-09T10:00:00Z",
        metric: "build_duration",
        baseline: 380,
        delta: -110,
        analyzer: "cache_window",
      },
    );
    // Their change-point: the same repo_ref string, the same series, mid-window — in their workspace.
    const pool = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor)
       values ($1, 'pool-a', 'shell') returning id`,
      [theirs.id],
    );
    const runs = api.nest.get(AnalysisRepository);
    const inserted = await runs.insertRun({
      organizationId: theirs.id,
      repoRef: BENCH_REPO,
      trigger: "manual",
      scheduleId: null,
      analyzerSet: BENCH_ANALYZER_SET,
      progress: pendingProgress(BENCH_ANALYZER_SET),
    });
    if (!inserted.started) throw new Error("their run did not start");
    await runs.writeFindings(inserted.run, [changePoint("2026-07-12", pool.rows[0].id)]);
    await rollUp(api, workspace, "build_duration", "2026-07-20", [308_000], "zephyr build");
    await filledThrough(api, workspace, "build_duration", "2026-07-23");

    await pass("2026-07-24T03:00:00Z");

    expect(await outcome(id)).toMatchObject({ verdict: "under", confounds: [] });
  });

  it("feeds the next composition the new factor: the cache estimate becomes −168 × 0.6545", async () => {
    // Applied on the test-gate suggestion, predicted under the cache model's cell — so the ccache
    // suggestion itself stays open for the next composition to rewrite.
    await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Split the test gate"),
      {
        at: "2026-07-09T10:00:00Z",
        metric: "stage_duration",
        baseline: 380,
        delta: -110,
        analyzer: "cache_window",
      },
    );
    await rollUp(api, workspace, "stage_duration", "2026-07-15", [308_000], "build");
    await filledThrough(api, workspace, "cycle", "2026-07-23");
    await pass("2026-07-24T03:00:00Z");

    await analyze(api, workspace);

    const { rows } = await api.sql.query<{ estimate: string; factor: string }>(
      `select impact ->> 'estimate' as estimate,
              impact #>> '{basis,calibration,factor}' as factor
         from ${SCHEMA_NAME}.analysis_suggestions
        where organization_id = $1 and title like 'Re-warm ccache%'`,
      [workspace.id],
    );
    expect(rows).toEqual([{ estimate: String(Math.round(CCACHE_RAW * 0.6545)), factor: "0.6545" }]);
  });

  it("reads day N of 14 for an open measurement, with the calibration and its history", async () => {
    const appliedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await recordApplication(
      api,
      workspace,
      owner,
      await suggestionId(api, workspace, "Move forge-02"),
      {
        at: appliedAt,
        metric: "build_duration",
        baseline: 380,
        delta: -110,
        analyzer: "cache_window",
      },
    );
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    const call = (person: Person, method: Method, path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
    const body = (
      await call(viewer, "get", `/api/v1/analyzer/measurements?repo=${BENCH_REPO}`).expect(200)
    ).body as MeasurementsResource;

    expect(body.measurements).toEqual([
      expect.objectContaining({
        verdict: "pending",
        day: 3,
        windowDays: 14,
        targetMetric: "build_duration",
      }) as unknown,
    ]);
    expect(body.formula).toContain("clamp(measured ÷ raw, 0, 2)");
  });
});
