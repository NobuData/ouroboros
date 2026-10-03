import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { ANALYZER_SET } from "./analysis.fixture";
import { pendingProgress } from "./analysis.progress";
import { AnalysisRepository } from "./analysis.repository";
import { CorpusRepository } from "./corpus/corpus.repository";

/**
 * The Build Analyzer's run orchestration against a migrated database (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510)).
 *
 * What only real rows and real concurrency can prove:
 *
 *   * **the every-50 trigger fires on the counter and resets it atomically** — a burst of
 *     completions, issued concurrently, fires exactly once per fifty and leaves the remainder;
 *   * **the concurrent-run guard holds** under a simultaneous manual and scheduled start, and the
 *     refusal names the run that won;
 *   * **the corpus counts are the definitions** — finished builds, HIL sessions by pool tag, the
 *     log lines V086 counts as the bytes land, loops by start — over rows rather than a fake;
 *   * the reaper fails a run its process abandoned, and only that one.
 *
 * ```bash
 * yarn test:integration src/modules/analyzer
 * ```
 */

const REPO = "analyzer-works/helios-firmware";

describe("Build Analyzer orchestration", () => {
  let api: ApiHarness;
  let owner: Person;
  let workspace: Workspace;
  let repoId: string;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    owner = await api.signIn();
    workspace = await api.workspace(owner);
    const {
      rows: [{ id: githubOrg }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'analyzer-works', true) returning id`,
      [workspace.id],
    );
    ({
      rows: [{ id: repoId }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled, default_branch)
       values ($1, 'helios-firmware', true, 'main') returning id`,
      [githubOrg],
    ));
  });

  afterEach(() => api.truncate());

  /** A schedule: every `n` builds, the counter at `counter`. */
  async function schedule(n: number | null, counter = 0): Promise<string> {
    const {
      rows: [{ id }],
    } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.analysis_schedules
         (organization_id, repo_ref, every_n_builds, build_counter)
       values ($1, $2, $3, $4) returning id`,
      [workspace.id, REPO, n, counter],
    );
    return id;
  }

  it("fires the every-50 trigger exactly once per fifty builds under a concurrent burst, and resets atomically", async () => {
    await schedule(50);
    const runs = api.nest.get(AnalysisRepository);

    const counted = await Promise.all(
      Array.from({ length: 120 }, () => runs.countBuild(workspace.id, REPO)),
    );

    expect(counted.filter((count) => count?.fired === true)).toHaveLength(2);
    const {
      rows: [{ build_counter }],
    } = await api.sql.query<{ build_counter: number }>(
      `select build_counter from ${SCHEMA_NAME}.analysis_schedules where organization_id = $1`,
      [workspace.id],
    );
    expect(build_counter).toBe(20);
  });

  it("counts without firing while the schedule is off, and fires on the next build once it is on", async () => {
    await schedule(50, 49);
    await api.sql.query(`update ${SCHEMA_NAME}.analysis_schedules set enabled = false`);
    const runs = api.nest.get(AnalysisRepository);

    expect(await runs.countBuild(workspace.id, REPO)).toMatchObject({ fired: false });
    expect(await runs.countBuild(workspace.id, REPO)).toMatchObject({ fired: false });

    await api.sql.query(`update ${SCHEMA_NAME}.analysis_schedules set enabled = true`);
    expect(await runs.countBuild(workspace.id, REPO)).toMatchObject({ fired: true });
  });

  it("re-arms a fired trigger so the next build fires it again", async () => {
    const id = await schedule(50, 0);
    const runs = api.nest.get(AnalysisRepository);

    await runs.rearm(id);

    expect(await runs.countBuild(workspace.id, REPO)).toMatchObject({ fired: true });
  });

  it("holds the guard under a simultaneous manual and scheduled start, naming the run that won", async () => {
    const scheduleId = await schedule(50);
    const runs = api.nest.get(AnalysisRepository);
    const start = (trigger: "manual" | "weekly") =>
      runs.insertRun({
        organizationId: workspace.id,
        repoRef: REPO,
        trigger,
        scheduleId: trigger === "weekly" ? scheduleId : null,
        analyzerSet: ANALYZER_SET,
        progress: pendingProgress(ANALYZER_SET),
      });

    const [manual, weekly] = await Promise.all([start("manual"), start("weekly")]);

    const outcomes = [manual, weekly];
    const won = outcomes.filter((outcome) => outcome.started);
    const refused = outcomes.filter((outcome) => !outcome.started);
    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].started === false && refused[0].running?.id).toBe(
      won[0].started && won[0].run.id,
    );
  });

  it("answers a second start over the API with an actionable 409", async () => {
    const runs = api.nest.get(AnalysisRepository);
    const inserted = await runs.insertRun({
      organizationId: workspace.id,
      repoRef: REPO,
      trigger: "weekly",
      scheduleId: null,
      analyzerSet: ANALYZER_SET,
      progress: pendingProgress(ANALYZER_SET),
    });
    expect(inserted.started).toBe(true);

    // Refused before the engine is asked anything, so no engine is needed to see it.
    const response = await api
      .as(owner)("post", "/api/v1/analyzer/runs")
      .set(TENANT_HEADER, workspace.slug)
      .send({ repo: REPO })
      .expect(409);

    expect(response.body).toMatchObject({
      code: "analysis_already_running",
      details: { repo: REPO, runId: inserted.started && inserted.run.id, trigger: "weekly" },
    });
  });

  it("refuses a start from a viewer, and a repository the workspace does not have", async () => {
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    await api
      .as(viewer)("post", "/api/v1/analyzer/runs")
      .set(TENANT_HEADER, workspace.slug)
      .send({ repo: REPO })
      .expect(403);

    await api
      .as(owner)("post", "/api/v1/analyzer/runs")
      .set(TENANT_HEADER, workspace.slug)
      .send({ repo: "analyzer-works/nope" })
      .expect(404);
  });

  it("lets a viewer read the latest run, null before the first", async () => {
    const viewer = await api.signIn();
    await api.join(workspace.id, viewer, "viewer");

    const response = await api
      .as(viewer)("get", `/api/v1/analyzer/runs/latest?repo=${encodeURIComponent(REPO)}`)
      .set(TENANT_HEADER, workspace.slug)
      .expect(200);

    expect(response.body).toEqual({ run: null });
  });

  it("round-trips the schedule over the API, keeping the live counter, and lets only an administrator save", async () => {
    const path = `/api/v1/analyzer/schedule?repo=${encodeURIComponent(REPO)}`;
    const member = await api.signIn();
    await api.join(workspace.id, member, "member");
    const body = {
      repo: REPO,
      enabled: true,
      weeklyEnabled: true,
      weeklyDay: 1,
      weeklyTime: "06:00",
      everyNBuilds: 50,
      maxBuilds: 2000,
      maxLogLines: 1_230_000,
      computeCeilingSeconds: 3600,
    };

    const before = await api.as(member)("get", path).set(TENANT_HEADER, workspace.slug).expect(200);
    expect(before.body).toMatchObject({ saved: false, everyNBuilds: null, maxLogLines: 5_000_000 });

    await api
      .as(member)("put", "/api/v1/analyzer/schedule")
      .set(TENANT_HEADER, workspace.slug)
      .send(body)
      .expect(403);

    await api
      .as(owner)("put", "/api/v1/analyzer/schedule")
      .set(TENANT_HEADER, workspace.slug)
      .send({ ...body, weeklyDay: null })
      .expect(422);

    await api
      .as(owner)("put", "/api/v1/analyzer/schedule")
      .set(TENANT_HEADER, workspace.slug)
      .send(body)
      .expect(200);
    await api.sql.query(
      `update ${SCHEMA_NAME}.analysis_schedules set build_counter = 12
        where organization_id = $1 and repo_ref = $2`,
      [workspace.id, REPO],
    );
    const resaved = await api
      .as(owner)("put", "/api/v1/analyzer/schedule")
      .set(TENANT_HEADER, workspace.slug)
      .send({ ...body, weeklyEnabled: false, everyNBuilds: 25 })
      .expect(200);
    expect(resaved.body).toMatchObject({ weeklyDay: 1, weeklyTime: "06:00", buildCounter: 12 });

    const after = await api.as(member)("get", path).set(TENANT_HEADER, workspace.slug).expect(200);
    expect(after.body).toEqual({
      repo: REPO,
      saved: true,
      enabled: true,
      weeklyEnabled: false,
      weeklyDay: 1,
      weeklyTime: "06:00",
      everyNBuilds: 25,
      buildCounter: 12,
      maxBuilds: 2000,
      maxLogLines: 1_230_000,
      computeCeilingSeconds: 3600,
    });

    const { rows } = await api.sql.query<{ n: string }>(
      `select count(*)::text as n from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = 'analyzer.schedule_updated'`,
      [workspace.id],
    );
    expect(rows[0].n).toBe("2");
  });

  it("reaps a run abandoned past its ceiling, and leaves a fresh one running", async () => {
    await schedule(null);
    const runs = api.nest.get(AnalysisRepository);
    const inserted = await runs.insertRun({
      organizationId: workspace.id,
      repoRef: REPO,
      trigger: "manual",
      scheduleId: null,
      analyzerSet: ANALYZER_SET,
      progress: pendingProgress(ANALYZER_SET),
    });
    if (!inserted.started) throw new Error("the first run must start");

    expect(await runs.reapStale(900, "abandoned")).toEqual([]);

    await api.sql.query(
      `update ${SCHEMA_NAME}.analysis_runs set started_at = now() - interval '2 hours' where id = $1`,
      [inserted.run.id],
    );
    expect(await runs.reapStale(900, "abandoned")).toEqual([inserted.run.id]);
    expect(await runs.run(workspace.id, inserted.run.id)).toMatchObject({
      status: "failed",
      failure_reason: "abandoned",
    });
  });

  it("counts the corpus by its definitions: finished builds, HIL by pool tag, stored lines, loops", async () => {
    const pool = async (name: string, tags: string[]) => {
      const {
        rows: [{ id }],
      } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor, tags)
         values ($1, $2, 'shell', $3::jsonb) returning id`,
        [workspace.id, name, JSON.stringify(tags)],
      );
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.runners
           (organization_id, pool_id, name, arch, status, desired_state, security_mode,
            cert_serial, capabilities)
         values ($1, $2, $3, 'linux/arm64', 'offline', 'active', 'mtls', $4,
                 '{"executors": ["shell"]}'::jsonb)`,
        [workspace.id, id, `${name}-runner`, `${name}-serial`],
      );
      return id;
    };
    const builds = await pool("pool-a", ["firmware"]);
    const hil = await pool("pool-b", ["hil"]);
    let number = 0;
    const job = async (poolId: string, status: string, daysAgo: number): Promise<string> => {
      number += 1;
      const {
        rows: [{ id }],
      } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.build_jobs
           (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, label, title,
            executor, command, status, queued_at, offered_at, started_at, finished_at, exit_code)
         values ($1, $2, $3, (select id from ${SCHEMA_NAME}.runners where pool_id = $3),
                 $4, 'refs/heads/main', 'zephyr build', 'Build', 'shell', 'make', $5,
                 now() - make_interval(days => $6) - interval '10 minutes',
                 now() - make_interval(days => $6) - interval '9 minutes',
                 now() - make_interval(days => $6) - interval '9 minutes',
                 now() - make_interval(days => $6),
                 case $5 when 'succeeded' then 0 when 'canceled' then null else 1 end)
         returning id`,
        [workspace.id, number, poolId, repoId, status, daysAgo],
      );
      return id;
    };

    const logged = await job(builds, "succeeded", 3);
    await job(builds, "failed", 10);
    await job(hil, "succeeded", 20);
    await job(builds, "canceled", 4); // not a build
    await job(builds, "succeeded", 120); // outside the window
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.build_log_chunks (job_id, seq, content)
       values ($1, 0, convert_to(E'one\\ntwo\\n', 'UTF8')), ($1, 1, convert_to(E'three\\n', 'UTF8'))`,
      [logged],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.runs
         (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model, status,
          stage_label, stage_index, stage_total, started_at, finished_at, pr_number)
       values ($1, $2, 1, 'Loop', 'standard-fix', 'claude-fable-5', 'merged', 'Done', 1, 1,
               now() - interval '5 days', now() - interval '5 days', 9)`,
      [workspace.id, repoId],
    );

    const corpus = api.nest.get(CorpusRepository);
    const scope = { organizationId: workspace.id, repoRef: REPO, repoId };
    const today = new Date();
    const to = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1),
    );
    const from = new Date(to.getTime() - 89 * 86_400_000);
    const window = {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      days: 90,
    };

    expect(await corpus.repository(workspace.id, REPO)).toBe(repoId);
    expect(await corpus.counts(scope, window)).toEqual({
      builds: 3,
      hilSessions: 1,
      logLines: 3,
      loops: 1,
      daysWithBuilds: 3,
    });

    const tail = await corpus.logChunks(logged, null);
    expect(tail.map((chunk) => chunk.seq)).toEqual([1, 0]);
    const page = await corpus.buildPage(scope, window, null);
    expect(page).toHaveLength(3);
    expect(page.filter((row) => row.hil)).toHaveLength(1);
  });
});
