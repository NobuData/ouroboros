import request from "supertest";

import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { REPLAY_ERRORS } from "./replay.errors";
import type { ReplayEstimate } from "./replay.estimate";
import type { ReplayEstimateResource } from "./replay.service";

/**
 * The replay estimators against a real PostgreSQL (CD.3,
 * [#561](https://github.com/NobuData/ouroboros/issues/561)): the route, the statements and
 * V121's functions together, over a farm history whose answer is known by inspection.
 *
 * The fixture is the mockup's figure on purpose — 214 similar builds whose median is 4m 02s and
 * whose median absolute deviation is 20 s — beside builds that must not count, a class with too
 * little history, and test runs keyed by suite set.
 */

/**
 * The duration, in seconds, of the `k`-th of 214 builds, as SQL: 242 s give or take a distance
 * that climbs from 0 to 40 in pairs, below the median for an odd `k` and above it for an even
 * one. So the median is 242 s by symmetry, and the median distance — the 107th and 108th of 214,
 * both 20 — is the median absolute deviation.
 */
const BUILD_SECONDS = "242 + (case when k % 2 = 0 then 1 else -1 end) * (((k - 1) / 2) * 40 / 106)";

/** A `200`'s body. */
const resource = (response: request.Response) => bodyOf<ReplayEstimateResource>(response);

/** A refusal's body. */
const refusal = (response: request.Response) => bodyOf<ErrorEnvelope>(response);

describe("the replay estimators, on the database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * Ask for an estimate the way the engine does.
   *
   * @param dryRun - The dry run.
   * @param body - The stage.
   * @returns The request, with the internal key set.
   */
  function estimate(dryRun: string, body: object) {
    return request(api.baseUrl)
      .post(`/internal/dry-runs/${dryRun}/replay-estimates`)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body);
  }

  /**
   * A workspace with a mirrored repository, a container pool, a shell pool with no default
   * command, a runner on each, and a dry run on a ticket of that repository.
   *
   * @param repository - The name the ticket gives its repository. Defaults to the mirrored one,
   *   in another letter case.
   * @returns The ids the cases need.
   */
  async function farm(repository = "Helios-Firmware") {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const one = async (sql: string, values: unknown[]): Promise<string> =>
      (await api.sql.query<{ id: string }>(sql, values)).rows[0].id;

    const githubOrg = await one(
      `insert into ouroboros.github_orgs (organization_id, login, enabled) values ($1, 'acme-robotics', true) returning id`,
      [workspace.id],
    );
    const repo = await one(
      `insert into ouroboros.github_repos (org_id, name, enabled, default_branch) values ($1, 'helios-firmware', true, 'main') returning id`,
      [githubOrg],
    );
    const poolA = await one(
      `insert into ouroboros.runner_pools (organization_id, name, executor, image, default_command)
       values ($1, 'pool-a', 'container', 'ghcr.io/acme-robotics/zephyr-sdk:0.17', 'west build -b helios_mainboard app') returning id`,
      [workspace.id],
    );
    const poolB = await one(
      `insert into ouroboros.runner_pools (organization_id, name, executor) values ($1, 'pool-b', 'shell') returning id`,
      [workspace.id],
    );
    const runner = await one(
      `insert into ouroboros.runners (organization_id, pool_id, name, arch, security_mode, cert_serial)
       values ($1, $2, 'forge-01', 'linux/arm64', 'mtls', 'a5610001') returning id`,
      [workspace.id, poolA],
    );
    const source = await one(
      `insert into ouroboros.ticket_sources (organization_id, kind, display_name) values ($1, 'github', 'GitHub · acme-robotics') returning id`,
      [workspace.id],
    );
    const ticket = await one(
      `insert into ouroboros.tickets (organization_id, source_id, external_id, external_key, external_url, title, state,
                                      source_created_at, source_updated_at, meta)
       values ($1, $2, '489', '#489', 'https://github.com/acme-robotics/helios-firmware/issues/489',
               'CAN arbitration-lost storm', 'open', now(), now(),
               jsonb_build_object('github', jsonb_build_object('owner', 'ACME-Robotics', 'repo', $3::text)))
       returning id`,
      [workspace.id, source, repository],
    );
    const workflow = await one(
      `insert into ouroboros.workflows (organization_id, slug, name) values ($1, 'security-patch', 'security-patch') returning id`,
      [workspace.id],
    );
    const dryRun = await one(
      `insert into ouroboros.dry_runs (organization_id, workflow_id, draft_rev, ticket_id, pinned_sha)
       values ($1, $2, 1, $3, '8c1b2e40d6a5f3c19b7e2a4d8f0c6b13e5a7d9f2') returning id`,
      [workspace.id, workflow, ticket],
    );

    return { workspace: workspace.id, repo, poolA, poolB, runner, dryRun };
  }

  /**
   * Succeeded builds of one configuration, one finishing every hour back from an hour ago.
   *
   * @param ids - The farm's ids.
   * @param build - How many, on which image and command, their duration in seconds as SQL over
   *   `k` (the build's position, itself SQL over the row number `n`; `n` when omitted), where
   *   their numbers start, and — for the first `warm` and next `cold` — ccache stats.
   */
  async function builds(
    ids: { workspace: string; repo: string; poolA: string; runner: string },
    build: {
      count: number;
      image: string;
      command: string;
      seconds: string;
      k?: string;
      from: number;
      status?: "succeeded" | "failed";
      warm?: number;
      cold?: number;
    },
  ): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.build_jobs
         (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, label, title, executor, image,
          command, status, queued_at, started_at, finished_at, exit_code, ccache_stats)
       select $1, $6 + n, $2, $3, $4, 'refs/heads/main', 'zephyr build', 'Build ' || n, 'container', $5, $7, $8,
              now() - make_interval(hours => n) - make_interval(secs => (${build.seconds}) + 1),
              now() - make_interval(hours => n) - make_interval(secs => ${build.seconds}),
              now() - make_interval(hours => n),
              case when $8 = 'succeeded' then 0 else 2 end,
              case when n <= $9 then '{"hits": 80, "misses": 20}'::jsonb
                   when n <= $9 + $10 then '{"hits": 30, "misses": 70}'::jsonb end
         from generate_series(1, $11::int) n
         cross join lateral (select ${build.k ?? "n"} as k) position`,
      [
        ids.workspace,
        ids.poolA,
        ids.runner,
        ids.repo,
        build.image,
        build.from,
        build.command,
        build.status ?? "succeeded",
        build.warm ?? 0,
        build.cold ?? 0,
        build.count,
      ],
    );
  }

  it("reproduces the mockup's estimate from the farm's own history: 4m 02s, n = 214, ±20s", async () => {
    const ids = await farm();
    // 214 similar builds across two SDK tags, the pool's default command.
    await builds(ids, {
      count: 107,
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.16",
      command: "west build -b helios_mainboard app",
      seconds: BUILD_SECONDS,
      k: "2 * n",
      from: 0,
      warm: 90,
      cold: 10,
    });
    await builds(ids, {
      count: 107,
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      command: "  west build   -b helios_mainboard app ",
      seconds: BUILD_SECONDS,
      k: "2 * n - 1",
      from: 1000,
    });
    // What must not count: another command, a failure, another image.
    await builds(ids, {
      count: 30,
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      command: "west build -b helios_mainboard app -- -DCONFIG_DEBUG=y",
      seconds: "900",
      from: 2000,
    });
    await builds(ids, {
      count: 30,
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      command: "west build -b helios_mainboard app",
      seconds: "50",
      from: 3000,
      status: "failed",
    });
    await builds(ids, {
      count: 30,
      image: "ghcr.io/acme-robotics/other-sdk:0.17",
      command: "west build -b helios_mainboard app",
      seconds: "900",
      from: 4000,
    });

    const answer = await estimate(ids.dryRun, { kind: "build", runnerPool: "pool-a" }).expect(200);
    const similarityClass =
      "pool-a · helios-firmware · container · ghcr.io/acme-robotics/zephyr-sdk · west build -b helios_mainboard app";

    expect(resource(answer).estimate).toMatchObject({
      status: "estimate",
      kind: "build",
      estimateMs: 242_000,
      spreadMs: 20_000,
      sampleCount: 214,
      windowDays: 30,
      similarityClass,
      note: "est. 4m 02s (214 similar builds, ±20s)",
      formula: {
        id: "build_duration_replay",
        version: 1,
        inputs: { similarityClass, windowDays: 30, sampleFloor: 20, sampleCount: 214 },
      },
    });
    // Cache context beside the estimate: both halves exist, and neither is the headline.
    expect(resource(answer).estimate).toHaveProperty("cache");
    expect((resource(answer).estimate as ReplayEstimate).cache).toMatchObject({
      measured: 100,
      warm: { count: 90 },
      cold: { count: 10 },
    });
    expect(resource(answer).stage).toEqual({
      how: "replayed",
      note: "est. 4m 02s (214 similar builds, ±20s)",
      metrics: {
        estimate_ms: 242_000,
        spread_ms: 20_000,
        sample_count: 214,
        similarity_class: similarityClass,
        window_days: 30,
      },
    });

    // The row it hands back is one the dry-run table accepts, as it is.
    await api.sql.query(
      `update ouroboros.dry_runs set status = 'running', precheck_findings = '[]' where id = $1`,
      [ids.dryRun],
    );
    await api.sql.query(
      `insert into ouroboros.dry_run_stages (organization_id, dry_run_id, seq, stage_key, display_name, verdict, how, note, metrics)
       values ($1, $2, 1, 'build', 'build', 'ok', $3, $4, $5::jsonb)`,
      [
        ids.workspace,
        ids.dryRun,
        resource(answer).stage.how,
        resource(answer).stage.note,
        JSON.stringify(resource(answer).stage.metrics),
      ],
    );
  });

  it("answers insufficient history with the count found, and no number, below the floor", async () => {
    const ids = await farm();
    await builds(ids, {
      count: 7,
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      command: "west build -b helios_mainboard app",
      seconds: "242",
      from: 0,
    });

    const answer = await estimate(ids.dryRun, { kind: "build", runnerPool: "pool-a" }).expect(200);

    expect(resource(answer).estimate).toMatchObject({
      status: "insufficient_history",
      sampleCount: 7,
      sampleFloor: 20,
      windowDays: 30,
      note: "insufficient history — the first real build will measure this (7 similar builds found)",
    });
    expect(resource(answer).estimate).not.toHaveProperty("estimateMs");
    expect(resource(answer).estimate).not.toHaveProperty("spreadMs");
    expect(JSON.stringify(resource(answer))).not.toMatch(/4m 02s|242000/);

    // And the honest row is storable too.
    await api.sql.query(
      `update ouroboros.dry_runs set status = 'running', precheck_findings = '[]' where id = $1`,
      [ids.dryRun],
    );
    await api.sql.query(
      `insert into ouroboros.dry_run_stages (organization_id, dry_run_id, seq, stage_key, display_name, verdict, how, note, metrics)
       values ($1, $2, 1, 'build', 'build', 'ok', $3, $4, $5::jsonb)`,
      [
        ids.workspace,
        ids.dryRun,
        resource(answer).stage.how,
        resource(answer).stage.note,
        JSON.stringify(resource(answer).stage.metrics),
      ],
    );
  });

  it("estimates a test stage from test history by suite set, never from build history", async () => {
    const ids = await farm();
    // Plenty of build history, all of it 242 s — which a test estimate must not see.
    await builds(ids, {
      count: 40,
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      command: "west build -b helios_mainboard app",
      seconds: "242",
      from: 0,
    });
    const run = (
      await api.sql.query<{ id: string }>(
        `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
                                     status, stage_label, stage_index, stage_total, started_at)
         values ($1, $2, 482, 'Fix flaky test', 'standard-fix', 'claude-fable-5', 'building', 'Test', 6, 8, now() - interval '3 days')
         returning id`,
        [ids.workspace, ids.repo],
      )
    ).rows[0].id;
    // 24 full sweeps of 600 s ± up to 11 s, then 3 smoke runs of 60 s.
    await api.sql.query(
      `insert into ouroboros.test_runs (organization_id, run_id, attempt_seq, status, wall_ms, sim_ms, physical_ms, started_at)
       select $1, $2, n, 'complete', ms, ms, 0, now() - make_interval(hours => 30 - n)
         from generate_series(1, 27) n
         cross join lateral (select case when n <= 24 then (600 + (n - 12)) * 1000 else 60000 end as ms) d`,
      [ids.workspace, run],
    );
    await api.sql.query(
      `insert into ouroboros.test_suites (organization_id, test_run_id, name, platform, kind)
       select t.organization_id, t.id, s.name, 'native_sim', 'sim'
         from ouroboros.test_runs t
         cross join lateral unnest(case when t.attempt_seq <= 24 then array['unit', 'hil'] else array['smoke'] end) s (name)
        where t.run_id = $1`,
      [run],
    );

    const full = await estimate(ids.dryRun, { kind: "test", suites: ["unit", "hil"] }).expect(200);

    expect(resource(full).estimate).toMatchObject({
      status: "estimate",
      kind: "test",
      sampleCount: 24,
      windowDays: 30,
      similarityClass: "helios-firmware · tests · hil + unit",
      formula: { id: "test_duration_replay" },
      cache: null,
    });
    // Around ten minutes — the tests' own time, nowhere near the builds' 242 s.
    expect((resource(full).estimate as ReplayEstimate).estimateMs).toBeGreaterThan(590_000);
    expect((resource(full).estimate as ReplayEstimate).estimateMs).toBeLessThan(612_000);
    expect(resource(full).estimate.note).toMatch(
      /^est\. 10m \d\ds \(24 similar test runs, ±\ds\)$/,
    );

    // No suite set named: the set the repository last measured — the smoke runs, too few to say.
    const latest = await estimate(ids.dryRun, { kind: "test" }).expect(200);

    expect(resource(latest).estimate).toMatchObject({
      status: "insufficient_history",
      sampleCount: 3,
      similarityClass: "helios-firmware · tests · smoke",
    });
  });

  it("says what it could not sample, rather than estimating from everything", async () => {
    const ids = await farm();

    const missing = await estimate("5eed008b-0000-4000-8000-000000000999", {
      kind: "build",
      runnerPool: "pool-a",
    });
    expect(missing.status).toBe(404);
    expect(refusal(missing).code).toBe(REPLAY_ERRORS.dryRunNotFound);

    const noPool = await estimate(ids.dryRun, { kind: "build" });
    expect(noPool.status).toBe(422);
    expect(refusal(noPool).code).toBe(REPLAY_ERRORS.poolRequired);

    const unknownPool = await estimate(ids.dryRun, { kind: "build", runnerPool: "pool-z" });
    expect(unknownPool.status).toBe(422);
    expect(refusal(unknownPool).code).toBe(REPLAY_ERRORS.poolNotFound);

    const noCommand = await estimate(ids.dryRun, { kind: "build", runnerPool: "pool-b" });
    expect(noCommand.status).toBe(422);
    expect(refusal(noCommand).code).toBe(REPLAY_ERRORS.commandRequired);

    const shaped = await estimate(ids.dryRun, {
      kind: "build",
      runnerPool: "pool-a",
      organizationId: ids.workspace,
    });
    expect(shaped.status).toBe(422);
    expect(refusal(shaped).code).toBe("validation_failed");
  });

  it("refuses a dry run whose ticket names a repository the workspace does not mirror", async () => {
    const ids = await farm("some-other-repository");

    const answer = await estimate(ids.dryRun, { kind: "build", runnerPool: "pool-a" });

    expect(answer.status).toBe(422);
    expect(refusal(answer).code).toBe(REPLAY_ERRORS.repositoryUnresolved);
  });

  it("is closed without the internal key", async () => {
    const ids = await farm();

    await request(api.baseUrl)
      .post(`/internal/dry-runs/${ids.dryRun}/replay-estimates`)
      .send({ kind: "build", runnerPool: "pool-a" })
      .expect(401);
  });

  it("never reads another workspace's history through a dry run", async () => {
    const mine = await farm();
    const theirs = await farm();
    await builds(theirs, {
      count: 40,
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      command: "west build -b helios_mainboard app",
      seconds: "242",
      from: 0,
    });

    const answer = await estimate(mine.dryRun, { kind: "build", runnerPool: "pool-a" }).expect(200);

    expect(resource(answer).estimate).toMatchObject({
      status: "insufficient_history",
      sampleCount: 0,
    });
  });
});
