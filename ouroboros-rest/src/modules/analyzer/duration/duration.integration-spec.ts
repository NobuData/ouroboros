import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { SOURCE_CONFIG } from "../../ticket-sources/providers/github.provider.fixture";
import { pendingProgress } from "../analysis.progress";
import { AnalysisRepository } from "../analysis.repository";
import {
  annotate,
  BENCH_ANALYZER_SET,
  BENCH_REPO,
  changePointFinding,
  rollUp,
  seedSeededIdsWorkspace,
} from "../analyzer.integration.fixture";
import { FORGE_02_ID, POOL_A_ID } from "../composer/composer.seed.fixture";
import type { DurationChartResource } from "./duration.resources";

/**
 * The duration chart's read against a migrated database (BW.2,
 * [#517](https://github.com/NobuData/ouroboros/issues/517)).
 *
 * What only real rows can prove: the run the chart is drawn from is the newest whose change-point
 * analyzer **completed** — a run in flight or a failed one never blanks it; the series is the
 * run's own job label inside its own window; and each evidence reference resolves, in this
 * workspace, to the surface it opens on — a merge to its mirrored PR through the merge plan's
 * recorded sha, to the farm when the mirror has none, and to nothing once retention has removed
 * the row.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/analyzer/duration
 * ```
 */

/** The commit a mirrored PR merged as, and one only the farm built. */
const MIRRORED_SHA = "0c5eed47a1b2c3d4e5f60718293a4b5c6d7e8f90";
const FARM_ONLY_SHA = "1ad1ba5cb805810baf727abc1e6c7d0eb94300eb";

/** What every reference of these kinds answers for the test-results fields: none opens there. */
const NOT_TEST_RESULTS = { runId: null, attempt: null, suiteName: null, caseName: null };

describe("the duration chart read", () => {
  let api: ApiHarness;
  let owner: Person;
  let workspace: Workspace;
  let repoId: string;
  let versionId: string;
  let prId: string;
  let lastBefore: string;
  let firstAfter: string;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    owner = await api.signIn();
    workspace = await api.workspace(owner);
    await seedSeededIdsWorkspace(api, workspace);
    repoId = await one(
      `select repo.id from ${SCHEMA_NAME}.github_repos repo
         join ${SCHEMA_NAME}.github_orgs gh on gh.id = repo.org_id
        where gh.organization_id = $1`,
      [workspace.id],
    );
    versionId = await one(
      `select v.id from ${SCHEMA_NAME}.workflow_versions v
         join ${SCHEMA_NAME}.workflows w on w.id = v.workflow_id
        where w.organization_id = $1 and w.slug = 'standard-fix'
        order by v.created_at limit 1`,
      [workspace.id],
    );

    lastBefore = await build(1, "2026-06-21", FARM_ONLY_SHA, "can: driver timeout tweak");
    firstAfter = await build(2, "2026-06-22", MIRRORED_SHA, "ccache enabled");
    prId = await mergedPr(MIRRORED_SHA);

    await rollUp(
      api,
      workspace,
      "build_duration",
      "2026-06-21",
      [341_000, 343_000],
      "zephyr build",
    );
    await rollUp(api, workspace, "build_duration", "2026-06-22", [212_000], "zephyr build");
    // Another job's durations, and a day outside the run's window: neither is this chart's.
    await rollUp(api, workspace, "build_duration", "2026-06-22", [900_000], "twister sweep");
    await rollUp(api, workspace, "build_duration", "2026-04-01", [500_000], "zephyr build");
  });

  afterEach(() => api.truncate());

  /** The one value a statement returns. */
  async function one(text: string, values: unknown[]): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(text, values);

    return rows[0].id;
  }

  /** A succeeded build of a commit on main, queued on `day`. */
  async function build(number: number, day: string, sha: string, title: string): Promise<string> {
    return one(
      `insert into ${SCHEMA_NAME}.build_jobs
         (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha, label,
          title, executor, command, status, queued_at, offered_at, started_at, finished_at,
          exit_code)
       values ($1, $2, $3, $4, $5, 'refs/heads/main', $6, 'zephyr build', $7, 'shell', 'make',
               'succeeded', $8::date + interval '9 hours', $8::date + interval '9 hours',
               $8::date + interval '9 hours', $8::date + interval '9 hours 4 minutes', 0)
       returning id`,
      [workspace.id, number, POOL_A_ID, FORGE_02_ID, repoId, sha, title, day],
    );
  }

  /** A mirrored PR whose merge plan recorded `sha` as the merge it made. */
  async function mergedPr(sha: string): Promise<string> {
    const source = await one(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub', $2::jsonb) returning id`,
      [workspace.id, JSON.stringify(SOURCE_CONFIG)],
    );
    const pr = await one(
      `insert into ${SCHEMA_NAME}.pull_requests
         (organization_id, source_id, external_number, external_url, title, head_branch, base_branch)
       values ($1, $2, 482, 'https://github.example/acme-robotics/helios-firmware/pull/482',
               'ccache enabled', 'ccache', 'main') returning id`,
      [workspace.id, source],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.pr_merge_plans (pr_id, commit_message) values ($1, 'ccache enabled')`,
      [pr],
    );
    await api.sql.query(
      `update ${SCHEMA_NAME}.pr_merge_plans
          set merged_result = jsonb_build_object(
                'sha', $2::text, 'identity_used', 'ken', 'actions_executed', '[]'::jsonb,
                'merged_at', '2026-06-22T09:00:00Z')
        where pr_id = $1`,
      [pr, sha],
    );

    return pr;
  }

  /** The June 22 shift, ranked: the mirrored merge, a farm-only merge, a pool, a workflow version. */
  function ccacheShift() {
    return changePointFinding(
      "2026-06-22",
      -130,
      [
        candidate("ccache enabled", 0.7, "merge", MIRRORED_SHA, 0),
        candidate("can: driver timeout tweak", 0.525, "merge", FARM_ONLY_SHA, -1),
        candidate("pool-a image zephyr-sdk:0.17", 0.3, "runner_pool", POOL_A_ID, -2),
        candidate("standard-fix published", 0.2, "workflow_version", versionId, -2),
      ],
      [
        { kind: "runner", id: FORGE_02_ID },
        { kind: "build", id: lastBefore },
        { kind: "build", id: firstAfter },
      ],
    );
  }

  /** One ranked candidate. */
  function candidate(label: string, score: number, kind: string, id: string, offset: number) {
    const eventKind = {
      merge: "merge",
      runner_pool: "infra_event",
      workflow_version: "policy_version",
    }[kind];

    return {
      label,
      score,
      ref: { kind, id },
      event_kind: eventKind ?? null,
      days_from_breakpoint: offset,
    };
  }

  /** The chart, read by a person. */
  async function chart(person: Person = owner, repo = BENCH_REPO): Promise<DurationChartResource> {
    return bodyOf<DurationChartResource>(
      await api
        .as(person)("get", `/api/v1/analyzer/duration?repo=${encodeURIComponent(repo)}`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200),
    );
  }

  it("answers the run's window, its job label's series and its ranked change-point", async () => {
    const runId = await annotate(api, workspace, [ccacheShift()]);

    const body = await chart();

    expect(body).toMatchObject({
      repo: BENCH_REPO,
      runId,
      durationLabel: "zephyr build",
      window: { from: "2026-05-10", to: "2026-08-07", days: 90 },
      series: [
        { day: "2026-06-21", medianSeconds: 342, builds: 2 },
        { day: "2026-06-22", medianSeconds: 212, builds: 1 },
      ],
    });
    expect(body.analyzedAt).not.toBeNull();
    expect(body.changePoints).toHaveLength(1);
    expect(body.changePoints[0]).toMatchObject({
      analyzerVersion: 1,
      date: "2026-06-22",
      metric: "build.duration_median",
      deltaSeconds: -130,
      beforeMedianSeconds: 342,
      afterMedianSeconds: 212,
      attributionWindowDays: 3,
      confidence: 90,
      confidenceBasis: { method: "change_point v1", sampleSize: 40, effectSize: 9, stability: 1 },
    });
    expect(
      body.changePoints[0].candidates.map((entry) => [
        entry.label,
        entry.score,
        entry.daysFromBreakpoint,
      ]),
    ).toEqual([
      ["ccache enabled", 0.7, 0],
      ["can: driver timeout tweak", 0.525, -1],
      ["pool-a image zephyr-sdk:0.17", 0.3, -2],
      ["standard-fix published", 0.2, -2],
    ]);
  });

  it("resolves each evidence reference to the surface it opens on, in this workspace", async () => {
    await annotate(api, workspace, [ccacheShift()]);

    const [point] = (await chart()).changePoints;

    expect(point.evidence).toEqual([
      {
        kind: "merge",
        id: MIRRORED_SHA,
        label: "ccache enabled",
        surface: "pull_request",
        pullRequestId: prId,
        workflowSlug: null,
        ...NOT_TEST_RESULTS,
      },
      {
        kind: "merge",
        id: FARM_ONLY_SHA,
        label: "can: driver timeout tweak",
        surface: "farm",
        pullRequestId: null,
        workflowSlug: null,
        ...NOT_TEST_RESULTS,
      },
      {
        kind: "runner_pool",
        id: POOL_A_ID,
        label: "pool-a",
        surface: "farm",
        pullRequestId: null,
        workflowSlug: null,
        ...NOT_TEST_RESULTS,
      },
      {
        kind: "workflow_version",
        id: versionId,
        label: expect.stringMatching(/^standard-fix (draft|v\d+)$/) as string,
        surface: "workflow",
        pullRequestId: null,
        workflowSlug: "standard-fix",
        ...NOT_TEST_RESULTS,
      },
      {
        kind: "runner",
        id: FORGE_02_ID,
        label: "forge-02",
        surface: "farm",
        pullRequestId: null,
        workflowSlug: null,
        ...NOT_TEST_RESULTS,
      },
      {
        kind: "build",
        id: lastBefore,
        label: "#1 · zephyr build",
        surface: "farm",
        pullRequestId: null,
        workflowSlug: null,
        ...NOT_TEST_RESULTS,
      },
      {
        kind: "build",
        id: firstAfter,
        label: "#2 · zephyr build",
        surface: "farm",
        pullRequestId: null,
        workflowSlug: null,
        ...NOT_TEST_RESULTS,
      },
    ]);
  });

  it("leaves a reference retention has removed named by its id alone, opening nothing", async () => {
    await annotate(api, workspace, [ccacheShift()]);
    await api.sql.query(`delete from ${SCHEMA_NAME}.build_jobs where id = $1`, [lastBefore]);

    const [point] = (await chart()).changePoints;

    expect(point.evidence.find((entry) => entry.id === lastBefore)).toEqual({
      kind: "build",
      id: lastBefore,
      label: null,
      surface: null,
      pullRequestId: null,
      workflowSlug: null,
      ...NOT_TEST_RESULTS,
    });
    // The farm-only merge was known through that build alone, so it no longer opens either.
    expect(point.evidence.find((entry) => entry.id === FARM_ONLY_SHA)).toMatchObject({
      label: null,
      surface: null,
    });
  });

  it("keeps the annotated chart under a newer run that is in flight, and one that failed", async () => {
    const annotated = await annotate(api, workspace, [ccacheShift()]);
    const runs = api.nest.get(AnalysisRepository);
    const later = await runs.insertRun({
      organizationId: workspace.id,
      repoRef: BENCH_REPO,
      trigger: "manual",
      scheduleId: null,
      analyzerSet: BENCH_ANALYZER_SET,
      progress: pendingProgress(BENCH_ANALYZER_SET),
    });
    if (!later.started) throw new Error("the later run must start");

    expect((await chart()).runId).toBe(annotated);

    await runs.finish(later.run.id, {
      status: "failed",
      phase: null,
      manifest: null,
      progress: null,
      computeSeconds: 1,
      confidenceNote: null,
      failureReason: "the engine could not be reached",
    });

    const body = await chart();
    expect(body.runId).toBe(annotated);
    expect(body.changePoints).toHaveLength(1);
  });

  it("follows the newest annotated run, drawing only its findings", async () => {
    await annotate(api, workspace, [ccacheShift()]);
    const newest = await annotate(api, workspace, [
      changePointFinding("2026-07-30", 40, [
        candidate("no recorded change within ±3 days", 0, "build", firstAfter, 0),
      ]),
    ]);

    const body = await chart();

    expect(body.runId).toBe(newest);
    expect(body.changePoints.map((point) => [point.date, point.deltaSeconds])).toEqual([
      ["2026-07-30", 40],
    ]);
    expect(body.changePoints[0].candidates[0]).toMatchObject({ score: 0, eventKind: null });
  });

  it("reads no series for a run whose corpus timed nothing", async () => {
    const runId = await annotate(api, workspace, [], null);

    expect(await chart()).toMatchObject({
      runId,
      durationLabel: null,
      series: [],
      changePoints: [],
    });
  });

  it("lets a viewer read, answers an unanalyzed repository empty, and refuses a malformed one", async () => {
    await annotate(api, workspace, [ccacheShift()]);
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    expect((await chart(viewer)).changePoints).toHaveLength(1);
    expect(await chart(viewer, "acme-robotics/atlas-scheduler")).toEqual({
      repo: "acme-robotics/atlas-scheduler",
      runId: null,
      analyzedAt: null,
      durationLabel: null,
      window: null,
      series: [],
      changePoints: [],
    });

    const refused = await api
      .as(viewer)("get", "/api/v1/analyzer/duration?repo=nope")
      .set(TENANT_HEADER, workspace.slug)
      .expect(422);
    expect(bodyOf<{ code: string }>(refused).code).toBe("validation_failed");
  });
});
