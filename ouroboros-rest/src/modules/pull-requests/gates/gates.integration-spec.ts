import { ApiHarness } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { AWS_ACCESS_KEY_ID } from "../../guardrails/guardrails.fixture";
import { seedIngestBench, type IngestBench } from "../../ingest/ingest.fixture";
import type { RunOpenedResource } from "../../ingest/ingest.resources";
import { fixtureFile, textFile } from "../../test-results/test-results.fixture";
import { TestResultIngestService } from "../../test-results/test-results.service";
import { MEMORY_MAP } from "./gate.matrix.fixture";
import { GateEngineService } from "./gate.service";

/**
 * **The gate engine against a migrated database** — AX.2
 * ([#358](https://github.com/NobuData/ouroboros/issues/358)).
 *
 * What only this scale proves: V056 accepts what the engine writes (the evidence references
 * resolve in the PR's workspace, the latest view and `pr_gate_aggregate` read it back), V052's
 * state graph admits every edge the engine walks, the definitions upsert touches nothing on a
 * re-sync, and the four emitters reach the engine through the real modules.
 *
 * The scene is mockup 12's: PR #514 on run #482 pinned to `standard-fix`, a `security` label a
 * vote rule matches, Revision 1 judged on an attempt whose overshoot is 2.4% over a 2.0% ceiling,
 * and Revision 2 on a green farm build and an attempt with the overshoot fixed.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/pull-requests/gates
 * ```
 */

/** Revision 1's head. */
const REV_1 = "3f9c2ae0";
/** Revision 2's head. */
const REV_2 = "b7e41d0a";
/** The plan's files, and both revisions' snapshot. */
const PLAN = ["drivers/can/telemetry_buf.c", "drivers/can/isr_fastpath.c"];

describe("the gate engine, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The one row a statement returns. */
  async function one<T extends object>(text: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query<T>(text, values);

    return rows[0];
  }

  /** Post as the executor. */
  function post(method: "post" | "put", path: string, body: unknown) {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body as object);
  }

  /** Everything a case starts from. */
  interface Scene {
    readonly bench: IngestBench;
    readonly runId: string;
    readonly prId: string;
  }

  /**
   * The run, its plan and vote rule, a clean change-set, and PR #514 at Revision 1 with Build 1's
   * failing rig results.
   *
   * @returns The scene.
   */
  async function scene(): Promise<Scene> {
    const bench = await seedIngestBench(api, await api.signUp());
    const org = bench.workspace.id;
    const issue = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels,
               gh_created_at, gh_updated_at, gh_url, sizing_status)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', null, 'open', '["security"]'::jsonb,
               now(), now(), 'https://github.com/acme/helios/issues/482', 'sized')
       returning id`,
      [org, bench.workspace.repoId],
    );

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.issue_estimates
              (github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
               breakdown, risk, risk_note, trace)
       values ($1, 1, 'm', 90, 'standard-fix', 'claude-fable-5', $2::jsonb, 'low', 'Small.',
               '{"estimator":"heuristic-v0","sized_at":"2026-09-16T15:00:00.000Z","tokens_used":0,"signals":[]}'::jsonb)`,
      [
        issue.id,
        JSON.stringify({
          files: PLAN,
          est_tokens: 1000,
          cycle_min: 5,
          cycle_max: 10,
          est_minutes: 20,
        }),
      ],
    );
    // The vote rule's task kind and alias, as V018 requires them to exist — the alias unbound.
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
       values ($1, 'review', 'Review the change.', 1)`,
      [org],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.model_aliases
         (organization_id, alias, provider_connection_id, model_id, enabled)
       values ($1, 'second-opinion', null, 'cursor/composer-2', false)`,
      [org],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.escalation_rules (organization_id, enabled, sort_order, "when", "then")
       values ($1, true, 1, '{"label": "security"}'::jsonb,
               '{"add_vote": {"task_kind": "review", "alias": "second-opinion"}}'::jsonb)`,
      [org],
    );

    const run = bodyOf<RunOpenedResource>(
      await post("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(201),
    );

    await post("post", `/internal/runs/${run.id}/stage-transitions`, {
      idempotencyKey: "implement",
      stageKey: "implement",
      status: "active",
    }).expect(200);
    await report(run.id, "files-1", "int x = 1;");

    const pr = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pull_requests
              (organization_id, source_id, external_number, external_url, title, head_branch,
               base_branch, state, run_id)
       values ($1, $2, 514, 'https://github.com/acme/helios/pull/514',
               'can: fix flaky telemetry frame order under ISR load', 'loop/482-canbus-flake',
               'main', 'open', $3)
       returning id`,
      [org, bench.source, run.id],
    );

    await revision(pr.id, 1, REV_1);
    await attempt(bench, run.id, 1, REV_1, fixtureFile("hil-valid.json"));

    return { bench, runId: run.id, prId: pr.id };
  }

  /** Report a change-set whose one added line is `line`. */
  async function report(runId: string, key: string, line: string): Promise<void> {
    await post("put", `/internal/runs/${runId}/files`, {
      idempotencyKey: key,
      files: PLAN.map((path) => ({
        path,
        status: "modified",
        additions: 1,
        hunks: [{ newStart: 10, lines: [{ kind: "add", text: line }] }],
      })),
    }).expect(200);
  }

  /** Record a revision, as the sync would. */
  async function revision(prId: string, seq: number, head: string): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.pr_revisions (pr_id, revision_seq, head_sha, pushed_at, files)
       values ($1, $2, $3, now(), $4::jsonb)`,
      [prId, seq, head, JSON.stringify(PLAN.map((path) => ({ path, additions: 4, deletions: 1 })))],
    );
  }

  /** A test attempt at a head, parsed from a rig results file. */
  async function attempt(
    bench: IngestBench,
    runId: string,
    seq: number,
    head: string,
    file: ReturnType<typeof fixtureFile>,
  ): Promise<string> {
    const row = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_runs (organization_id, run_id, attempt_seq, commit_sha, status)
       values ($1, $2, $3, $4, 'complete') returning id`,
      [bench.workspace.id, runId, seq, head],
    );

    await api.nest
      .get(TestResultIngestService)
      .parseAttempt({ organizationId: bench.workspace.id, testRunId: row.id, files: [file] });

    return row.id;
  }

  /** A finished forge-01 build of a head, with the memory map in its log. */
  async function build(bench: IngestBench, runId: string, head: string): Promise<string> {
    const org = bench.workspace.id;
    const pool = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor)
       values ($1, 'pool-a', 'shell') returning id`,
      [org],
    );
    const runner = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runners
         (organization_id, pool_id, name, arch, status, desired_state, security_mode, cert_serial,
          capabilities)
       values ($1, $2, 'forge-01', 'linux/x86_64', 'online', 'active', 'mtls', '4a730002',
               '{"executors": ["shell"]}'::jsonb)
       returning id`,
      [org, pool.id],
    );
    const job = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.build_jobs
         (organization_id, number, pool_id, runner_id, run_id, github_repo_id, git_ref,
          commit_sha, label, title, executor, command, status, queued_at, offered_at,
          started_at, finished_at, exit_code)
       values ($1, 485, $2, $3, $4, $5, 'refs/heads/loop/482-canbus-flake', $6, 'build',
               'zephyr build', 'shell', 'west build', 'succeeded', now() - interval '4 minutes',
               now() - interval '4 minutes', now() - interval '3 minutes', now(), 0)
       returning id`,
      [org, pool.id, runner.id, runId, bench.workspace.repoId, head],
    );

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.build_log_chunks (job_id, seq, byte_start, content)
       values ($1, 1, 0, convert_to($2, 'UTF8'))`,
      [job.id, MEMORY_MAP],
    );

    return job.id;
  }

  /** A revision's card: the latest verdict and line per gate. */
  async function card(prId: string, seq: number): Promise<Record<string, [string, string | null]>> {
    const { rows } = await api.sql.query<{
      gate_key: string;
      verdict: string;
      evidence: string | null;
    }>(
      `select l.gate_key, l.verdict, l.evidence
         from ${SCHEMA_NAME}.pr_gate_results_latest l
         join ${SCHEMA_NAME}.pr_revisions v on v.id = l.revision_id
        where v.pr_id = $1 and v.revision_seq = $2
        order by l.sort_order`,
      [prId, seq],
    );

    return Object.fromEntries(rows.map((row) => [row.gate_key, [row.verdict, row.evidence]]));
  }

  /** V056's aggregate for a revision. */
  async function aggregateOf(prId: string, seq: number) {
    return one<{
      required_count: number;
      green_count: number;
      red_count: number;
      merge_ready: boolean;
    }>(
      `select a.* from ${SCHEMA_NAME}.pr_revisions v,
              lateral ${SCHEMA_NAME}.pr_gate_aggregate(v.id) a
        where v.pr_id = $1 and v.revision_seq = $2`,
      [prId, seq],
    );
  }

  /** The PR's state. */
  async function stateOf(prId: string): Promise<string> {
    return (
      await one<{ state: string }>(`select state from ${SCHEMA_NAME}.pull_requests where id = $1`, [
        prId,
      ])
    ).state;
  }

  it("materializes the seven definitions from the pin, recording which pin produced them", async () => {
    const { prId } = await scene();

    await api.nest.get(GateEngineService).evaluate(prId);

    const { rows } = await api.sql.query<{ gate_key: string; source: string; required: boolean }>(
      `select gate_key, source, required from ${SCHEMA_NAME}.pr_gate_definitions
        where pr_id = $1 order by sort_order`,
      [prId],
    );

    expect(rows.map((row) => row.gate_key)).toEqual([
      "build",
      "test_suite",
      "physical_hil",
      "diff_vs_plan",
      "secrets_license",
      "model_review",
      "human_approval",
    ]);
    expect(rows.every((row) => row.required && row.source === "standard-fix@v1 pin")).toBe(true);
  });

  it("blocks Revision 1 on two red gates, then reads Revision 2 as 5 of 7 green — leaving Revision 1 intact", async () => {
    const { bench, runId, prId } = await scene();
    const engine = api.nest.get(GateEngineService);

    await engine.evaluate(prId);

    expect(await card(prId, 1)).toMatchObject({
      build: ["pending", "no build of 3f9c2ae yet"],
      test_suite: ["red", expect.stringMatching(/ · 1 failing after attempt 1$/) as unknown],
      physical_hil: ["red", "overshoot 2.4% > 2.0% · rig helios-rig-02"],
      diff_vs_plan: ["green", "all hunks map to planned files · 0 out-of-scope edits"],
      model_review: ["unavailable", "unavailable — arrives with the provider stack"],
      human_approval: ["not_required", "not required by policy"],
    });
    expect(await aggregateOf(prId, 1)).toMatchObject({
      required_count: 7,
      red_count: 2,
      merge_ready: false,
    });
    expect(await stateOf(prId)).toBe("blocked");

    const revision1 = await api.sql.query(
      `select r.* from ${SCHEMA_NAME}.pr_gate_results r
         join ${SCHEMA_NAME}.pr_revisions v on v.id = r.revision_id
        where v.pr_id = $1 and v.revision_seq = 1 order by r.id`,
      [prId],
    );

    // Revision 2: a green build, and the overshoot fixed.
    await revision(prId, 2, REV_2);
    await build(bench, runId, REV_2);
    await attempt(
      bench,
      runId,
      2,
      REV_2,
      textFile(
        "ouro-hil-results.json",
        Buffer.from(fixtureFile("hil-valid.json").bytes)
          .toString("utf8")
          .replace('"value": 2.4', '"value": 1.7'),
      ),
    );
    await engine.notify(bench.workspace.id, { kind: "revision_pushed", prId });

    expect(await card(prId, 2)).toMatchObject({
      build: ["green", "forge-01 · zephyr.elf · FLASH 43.5%"],
      test_suite: ["green", "3/3 after attempt 2"],
      physical_hil: ["green", expect.stringMatching(/ · rig helios-rig-02$/) as unknown],
      diff_vs_plan: ["green", "all hunks map to planned files · 0 out-of-scope edits"],
      secrets_license: [
        "green",
        "clean (secrets only — no diff to check headers or manifest delta)",
      ],
      model_review: ["unavailable", "unavailable — arrives with the provider stack"],
      human_approval: ["not_required", "not required by policy"],
    });
    expect(await aggregateOf(prId, 2)).toEqual({
      required_count: 7,
      green_count: 5,
      red_count: 0,
      satisfied_count: 6,
      merge_ready: false,
    });
    expect(await stateOf(prId)).toBe("verifying");
    expect(
      (
        await api.sql.query(
          `select r.* from ${SCHEMA_NAME}.pr_gate_results r
             join ${SCHEMA_NAME}.pr_revisions v on v.id = r.revision_id
            where v.pr_id = $1 and v.revision_seq = 1 order by r.id`,
          [prId],
        )
      ).rows,
    ).toEqual(revision1.rows);
  });

  it("appends nothing and touches no definition when nothing changed", async () => {
    const { prId } = await scene();
    const engine = api.nest.get(GateEngineService);

    await engine.evaluate(prId);
    const before = await api.sql.query<{ count: string; stamp: Date }>(
      `select (select count(*) from ${SCHEMA_NAME}.pr_gate_results)::text as count,
              (select max(updated_at) from ${SCHEMA_NAME}.pr_gate_definitions) as stamp`,
      [],
    );
    const again = await engine.evaluate(prId);
    const after = await api.sql.query<{ count: string; stamp: Date }>(
      `select (select count(*) from ${SCHEMA_NAME}.pr_gate_results)::text as count,
              (select max(updated_at) from ${SCHEMA_NAME}.pr_gate_definitions) as stamp`,
      [],
    );

    expect(again?.written).toBe(0);
    expect(after.rows).toEqual(before.rows);
  });

  it("re-evaluates the secrets gate when the run's change-set is judged — through the real modules", async () => {
    const { runId, prId } = await scene();

    await api.nest.get(GateEngineService).evaluate(prId);
    expect((await card(prId, 1)).secrets_license[0]).toBe("green");

    // A planted AWS key: AP.3 fails secrets, and the ingest service tells the engine.
    await report(runId, "files-2", `aws_access_key_id = "${AWS_ACCESS_KEY_ID}"`);

    expect(await card(prId, 1)).toMatchObject({
      secrets_license: ["red", "secrets: a known credential format in the added lines"],
    });
  });
});
