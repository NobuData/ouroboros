import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { pendingProgress } from "../analysis.progress";
import { AnalysisRepository } from "../analysis.repository";
import {
  analyze,
  BENCH_ANALYZER_SET,
  BENCH_REPO,
  seedSeededIdsWorkspace,
} from "../analyzer.integration.fixture";
import { FORGE_02_ID, POOL_A_ID } from "../composer/composer.seed.fixture";
import {
  confidenceBasis,
  corpusWindow,
  DEFAULT_BUDGET,
  FULL_READ,
  manifestBudget,
  MINIMUM_DAYS_WITH_BUILDS,
  type CorpusManifest,
} from "./corpus.manifest";
import type { CorpusStateResource } from "./corpus.resources";

/**
 * The corpus-state read against a migrated database (BW.6,
 * [#521](https://github.com/NobuData/ouroboros/issues/521)).
 *
 * What only real rows can prove: the count is of builds that **finished inside the window a run
 * started now would read** — today's are not in it, nor is one from before it, nor one still
 * running — and of the distinct days they finished on; the floor is judged on those days; and
 * `analyzed` is the newest run that **ended having judged its corpus**, which a run in flight, a
 * failed one and one that stored no basis are not.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/analyzer/corpus
 * ```
 */

/** A UTC day, some days before today. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

describe("the corpus-state read", () => {
  let api: ApiHarness;
  let owner: Person;
  let workspace: Workspace;
  let repoId: string;
  let builds = 0;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    owner = await api.signIn();
    workspace = await api.workspace(owner);
    await seedSeededIdsWorkspace(api, workspace);
    const { rows } = await api.sql.query<{ id: string }>(
      `select repo.id from ${SCHEMA_NAME}.github_repos repo
         join ${SCHEMA_NAME}.github_orgs gh on gh.id = repo.org_id
        where gh.organization_id = $1`,
      [workspace.id],
    );
    repoId = rows[0].id;
    builds = 0;
  });

  afterEach(() => api.truncate());

  /** A build of the repository that reached `status` on `day` — finished, unless it is running. */
  async function build(day: string, status = "succeeded"): Promise<void> {
    builds += 1;
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.build_jobs
         (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, label, title,
          executor, command, status, queued_at, offered_at, started_at, finished_at, exit_code)
       values ($1, $2, $3, $4, $5, 'refs/heads/main', 'zephyr build', 'a build', 'shell', 'make',
               $6, $7::date + interval '9 hours', $7::date + interval '9 hours',
               $7::date + interval '9 hours',
               case when $6 = 'running' then null else $7::date + interval '9 hours 4 minutes' end,
               case when $6 = 'running' then null when $6 = 'succeeded' then 0 else 1 end)`,
      [workspace.id, builds, POOL_A_ID, FORGE_02_ID, repoId, status, day],
    );
  }

  /** The read, as somebody of the workspace. */
  async function state(person: Person = owner, repo = BENCH_REPO): Promise<CorpusStateResource> {
    return bodyOf<CorpusStateResource>(
      await api
        .as(person)("get", `/api/v1/analyzer/corpus?repo=${encodeURIComponent(repo)}`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200),
    );
  }

  /**
   * A run that ended `status` having read a corpus of this size — with the confidence basis the
   * orchestrator stores when it judges one, unless `judged` says it stored none.
   */
  async function ended(
    status: "complete" | "budget_exceeded" | "failed",
    corpus: { builds: number; daysWithBuilds: number },
    judged = true,
  ): Promise<string> {
    const runs = api.nest.get(AnalysisRepository);
    const inserted = await runs.insertRun({
      organizationId: workspace.id,
      repoRef: BENCH_REPO,
      trigger: "manual",
      scheduleId: null,
      analyzerSet: BENCH_ANALYZER_SET,
      progress: pendingProgress(BENCH_ANALYZER_SET),
    });
    if (!inserted.started) throw new Error("the run did not start");

    const window = corpusWindow(new Date());
    const manifest: CorpusManifest = {
      window,
      counts: { builds: corpus.builds, loops: 0, log_lines: 0, hil_sessions: 0 },
      sources: {
        builds: FULL_READ,
        loops: FULL_READ,
        log_lines: FULL_READ,
        hil_sessions: FULL_READ,
      },
      budget: manifestBudget(DEFAULT_BUDGET),
      duration_label: null,
      ...(judged ? { confidence: confidenceBasis({ window, ...corpus }) } : {}),
    };
    await runs.analyzing(inserted.run.id, manifest);
    await runs.finish(inserted.run.id, {
      status,
      phase: "composing",
      manifest,
      progress: null,
      computeSeconds: 1,
      confidenceNote: status === "failed" ? null : "low — the bench's corpus",
      failureReason: status === "complete" ? null : "ended by the suite",
    });

    return inserted.run.id;
  }

  it("counts the builds that finished inside the window, and the days they finished on", async () => {
    // Three days of the window: two builds on one of them, a failure and a retry on the others.
    await build(daysAgo(1));
    await build(daysAgo(1));
    await build(daysAgo(40), "failed");
    await build(daysAgo(90), "retried");
    // None of these is in it: today is not over, the window is ninety days, and this one never ended.
    await build(daysAgo(0));
    await build(daysAgo(91));
    await build(daysAgo(5), "running");

    expect(await state()).toEqual({
      repo: BENCH_REPO,
      window: { from: daysAgo(90), to: daysAgo(1), days: 90 },
      builds: 4,
      daysWithBuilds: 3,
      sufficient: false,
      minimumDaysWithBuilds: MINIMUM_DAYS_WITH_BUILDS,
      analyzed: null,
    });
  });

  it("clears the floor on the tenth day with a build, and not on the ninth", async () => {
    for (let day = 1; day < MINIMUM_DAYS_WITH_BUILDS; day += 1) await build(daysAgo(day));

    expect(await state()).toMatchObject({ daysWithBuilds: 9, sufficient: false });

    // More builds on a day already counted change the count, not the days.
    await build(daysAgo(1));
    expect(await state()).toMatchObject({ builds: 10, daysWithBuilds: 9, sufficient: false });

    await build(daysAgo(MINIMUM_DAYS_WITH_BUILDS));
    expect(await state()).toMatchObject({ builds: 11, daysWithBuilds: 10, sufficient: true });
  });

  it("answers no analysed corpus for a run in flight, a failed one, or one that stored no basis", async () => {
    // The bench's own complete run carries a manifest without a confidence basis.
    await analyze(api, workspace, [], { ending: "complete" });
    await ended("failed", { builds: 1284, daysWithBuilds: 89 });
    await analyze(api, workspace, [], { ending: "running" });

    expect((await state()).analyzed).toBeNull();
  });

  it("answers what the newest judged run read — complete or stopped at its budget — from its own manifest", async () => {
    const first = await ended("complete", { builds: 1284, daysWithBuilds: 89 });
    expect((await state()).analyzed).toMatchObject({
      runId: first,
      builds: 1284,
      daysWithBuilds: 89,
      sufficient: true,
    });

    // A later budget stop that judged a thinner corpus is the newest; a failed run after it is not.
    const second = await ended("budget_exceeded", { builds: 3, daysWithBuilds: 3 });
    await ended("failed", { builds: 9000, daysWithBuilds: 90 }, false);

    const answer = await state();
    expect(answer.analyzed).toMatchObject({
      runId: second,
      builds: 3,
      daysWithBuilds: 3,
      sufficient: false,
    });
    expect(Date.parse(answer.analyzed?.analyzedAt ?? "")).not.toBeNaN();
    // The current corpus is its own count: nothing was built here.
    expect(answer).toMatchObject({ builds: 0, daysWithBuilds: 0, sufficient: false });
  });

  it("lets a viewer read, reads a repository the workspace has none of as empty, and refuses a malformed one", async () => {
    await build(daysAgo(2));
    await ended("complete", { builds: 1284, daysWithBuilds: 89 });
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    expect(await state(viewer)).toMatchObject({ builds: 1, daysWithBuilds: 1 });
    expect(await state(viewer, "acme-robotics/atlas-scheduler")).toMatchObject({
      repo: "acme-robotics/atlas-scheduler",
      builds: 0,
      daysWithBuilds: 0,
      sufficient: false,
      analyzed: null,
    });

    const refusal = await api
      .as(owner)("get", "/api/v1/analyzer/corpus?repo=not-a-repository")
      .set(TENANT_HEADER, workspace.slug)
      .expect(422);
    expect(bodyOf<{ code: string }>(refusal).code).toBe("validation_failed");
  });
});
