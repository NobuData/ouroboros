import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ControlsFetchedResource } from "../controls/controls.resources";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type {
  ClassificationsListResource,
  ClassifyResultResource,
  RerunResource,
  TestRunHintsResource,
  WaiverResource,
} from "./triage.resources";

/**
 * Classification & routing against a migrated PostgreSQL (#332), one test per acceptance
 * criterion:
 *
 *   * the hints: each failing case's rule, `confidence: null`, the `heuristic` actor;
 *   * classify → correction round reaches the executor: the note is in the transcript, the fetch
 *     hands over a stage-retry steer, and the next attempt opens;
 *   * the receipt (control id, target attempt) is stored and readable;
 *   * *Re-run failed* carries only the failed set and *Re-run full suite* all of them;
 *   * with no eligible runner the re-run answers an honest queue state;
 *   * the infra path flags the runner with a farm health note;
 *   * a waiver requires a reason and records its author, and no annotation is attempted;
 *   * every classification and dispatch is audited with the person as the actor.
 *
 * The executor here is the simulated driver's half of the contract, called over the internal
 * channel exactly as `ouroboros_simulator` calls it; the driver's own reaction to the steer
 * (`correction-round`) is pinned in ouroboros-engine's `tests/test_simulator_scenarios.py`.
 *
 * ```bash
 * yarn test:integration src/modules/triage
 * ```
 */

/** The simulator's credential. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** Mockup 11's correction note. */
const NOTE = "Keep k_msgq, but move PID velocity sampling off the telemetry path.";

/** The build's commit. */
const COMMIT = "f42b9a0".padEnd(40, "0");

describe("classification & routing", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
      OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
    });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Everything a test starts from. */
  interface Scene {
    readonly owner: Person;
    readonly bench: IngestBench;
    readonly run: RunOpenedResource;
    readonly runnerId: string;
    readonly sourceJobId: string;
    /** Build 2 — the attempt the card is looking at. */
    readonly testRunId: string;
    /** Build 2's cases, by name. */
    readonly cases: Readonly<Record<"overshoot" | "telemetry" | "estop" | "boot", CaseSeed>>;
  }

  /** A seeded case. */
  interface CaseSeed {
    readonly id: string;
    readonly key: string;
  }

  /**
   * A run opened by the simulator; a rig pool with one (offline) runner; Build 1, where every
   * case passed, and Build 2, produced by a farm build on that runner:
   *
   *   overshoot  failed — new, in drivers/motor/pid.c, which the run changed
   *   telemetry  flaky  — passed on retry 2 of 2
   *   estop      error  — the rig went unreachable
   *   boot       passed
   *
   * @returns The scene.
   */
  async function scene(): Promise<Scene> {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await simulator("post", "/internal/runs", { idempotencyKey: "open-1", ...bench.open }).expect(
        201,
      ),
    );
    const org = bench.workspace.id;

    const pool = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor)
       values ($1, 'rig-pool', 'shell') returning id`,
      [org],
    );
    const runner = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runners
         (organization_id, pool_id, name, arch, status, desired_state, security_mode,
          cert_serial, capabilities)
       values ($1, $2, 'helios-rig-02', 'linux/arm64', 'offline', 'active', 'mtls', '4a730001',
               '{"executors": ["shell"]}'::jsonb)
       returning id`,
      [org, pool.id],
    );
    const job = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.build_jobs
         (organization_id, number, pool_id, runner_id, run_id, github_repo_id, git_ref,
          commit_sha, label, title, executor, command, status, queued_at, offered_at, started_at, finished_at,
          exit_code)
       values ($1, 1, $2, $3, $4, $5, 'refs/heads/loop/482-canbus-flake', $6, 'rig', 'Build 2',
               'shell', 'make hil', 'failed', now() - interval '7 minutes', now() - interval '6 minutes',
               now() - interval '5 minutes', now(), 1)
       returning id`,
      [org, pool.id, runner.id, run.id, bench.workspace.repoId, COMMIT],
    );

    const build1 = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_runs (organization_id, run_id, attempt_seq, commit_sha, status)
       values ($1, $2, 1, 'a3f19c2', 'complete') returning id`,
      [org, run.id],
    );
    const build2 = await one<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_runs
         (organization_id, run_id, build_job_id, attempt_seq, commit_sha, status)
       values ($1, $2, $3, 2, 'f42b9a0', 'complete') returning id`,
      [org, run.id, job.id],
    );

    const seeded: Record<string, CaseSeed> = {};

    for (const [testRunId, rows] of [
      [
        build1.id,
        [
          ["overshoot", "passed", 0, ["passed"], null],
          ["telemetry", "passed", 0, ["passed"], null],
          ["estop", "passed", 0, ["passed"], null],
          ["boot", "passed", 0, ["passed"], null],
        ],
      ],
      [
        build2.id,
        [
          [
            "overshoot",
            "failed",
            0,
            ["failed"],
            { message: "2.4% > 2.0%", path: "drivers/motor/pid.c" },
          ],
          ["telemetry", "flaky", 1, ["failed", "passed"], { message: "frame order" }],
          ["estop", "error", 0, ["error"], { message: "rig helios-rig-02 unreachable" }],
          ["boot", "passed", 0, ["passed"], null],
        ],
      ],
    ] as const) {
      const suite = await one<{ id: string }>(
        `insert into ${SCHEMA_NAME}.test_suites
           (organization_id, test_run_id, name, platform, kind, meta)
         values ($1, $2, 'motor control', 'qemu_cortex_m3', 'sim', '{}') returning id`,
        [org, testRunId],
      );

      for (const [name, status, retries, outcomes, failure] of rows) {
        const row = await one<{ id: string; case_key: string }>(
          `insert into ${SCHEMA_NAME}.test_cases
             (organization_id, test_suite_id, name, classname, status, retries, retry_outcomes,
              failure)
           values ($1, $2, $3, 'motor', $4, $5, $6::jsonb, $7::jsonb) returning id, case_key`,
          [
            org,
            suite.id,
            name,
            status,
            retries,
            JSON.stringify(outcomes),
            failure === null ? null : JSON.stringify(failure),
          ],
        );

        if (testRunId === build2.id) seeded[name] = { id: row.id, key: row.case_key };
      }
    }

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.run_files (run_id, path, additions, deletions, status)
       values ($1, 'drivers/motor/pid.c', 14, 3, 'modified')`,
      [run.id],
    );

    return {
      owner,
      bench,
      run,
      runnerId: runner.id,
      sourceJobId: job.id,
      testRunId: build2.id,
      cases: seeded as unknown as Scene["cases"],
    };
  }

  /** The one row a statement returns. */
  async function one<T extends object>(text: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query<T>(text, values);

    return rows[0];
  }

  /** Call the internal channel as the simulator. */
  function simulator(method: "post", path: string, body: unknown = {}) {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET)
      .send(body as object);
  }

  /** Call the public API as somebody, in the scene's workspace. */
  function as(person: Person, at: Scene, method: "get" | "post", path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, at.bench.workspace.slug);
  }

  /** Somebody else, holding `role` in the scene's workspace. */
  async function colleague(at: Scene, role: "admin" | "member" | "viewer"): Promise<Person> {
    const person = await api.signUp();

    await api.join(at.bench.workspace.id, person, role);

    return person;
  }

  /** Move a stage, as the simulator. */
  function move(at: Scene, key: string, body: Record<string, unknown>) {
    return simulator("post", `/internal/runs/${at.run.id}/stage-transitions`, {
      idempotencyKey: key,
      ...body,
    }).expect(200);
  }

  /** Classify a case. */
  function classify(person: Person, at: Scene, caseId: string, body: Record<string, unknown>) {
    return as(
      person,
      at,
      "post",
      `/api/v1/test-runs/${at.testRunId}/cases/${caseId}/classify`,
    ).send(body);
  }

  /** Press a re-run button. */
  function rerun(person: Person, at: Scene, scope: "failed" | "full") {
    return as(person, at, "post", `/api/v1/test-runs/${at.testRunId}/rerun`).send({ scope });
  }

  /** A build job's selection and run. */
  async function jobSelection(jobId: string) {
    return one<{
      test_selection: { scope: string; case_keys: string[] };
      run_id: string;
      status: string;
    }>(`select test_selection, run_id, status from ${SCHEMA_NAME}.build_jobs where id = $1`, [
      jobId,
    ]);
  }

  /** The workspace's audit rows. */
  async function trail(at: Scene) {
    const { rows } = await api.sql.query<{
      action: string;
      actor_id: string | null;
      subject_type: string;
      detail: Record<string, unknown>;
    }>(
      `select action, actor_id, subject_type, detail from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 order by occurred_at, action`,
      [at.bench.workspace.id],
    );

    return rows;
  }

  it("hints every failing case with a rule, confidence null and the heuristic actor", async () => {
    const at = await scene();
    const viewer = await colleague(at, "viewer");

    // A runner that is offline would make every case of the attempt an infra hint (the rule's
    // precedence); this one is up, so each case is judged on its own.
    await api.sql.query(`update ${SCHEMA_NAME}.runners set status = 'online' where id = $1`, [
      at.runnerId,
    ]);

    const hints = bodyOf<TestRunHintsResource>(
      await as(viewer, at, "get", `/api/v1/test-runs/${at.testRunId}/hints`).expect(200),
    );

    expect(
      hints.cases.map((entry) => [entry.name, entry.hint?.ruleId, entry.hint?.suggestedClass]),
    ).toEqual([
      ["estop", "infra.rig_error", "infra_rig"],
      ["overshoot", "product.new_failure_in_diff", "product_bug"],
      ["telemetry", "flake.pass_on_retry", "flake_retry"],
    ]);
    for (const entry of hints.cases) {
      expect(entry.hint).toEqual(expect.objectContaining({ confidence: null, actor: "heuristic" }));
      expect(entry.triage?.provenance).toEqual(
        expect.objectContaining({ actor: "heuristic", contract: "triage/v0", model: null }),
      );
      expect(entry.rules).toHaveLength(3);
    }
  });

  it("classify → correction round reaches the executor: transcript, retry steer, attempt 2", async () => {
    const at = await scene();
    const member = await colleague(at, "member");

    await move(at, "t1", { stageKey: "implement", status: "active" });

    const answer = bodyOf<ClassifyResultResource>(
      await classify(member, at, at.cases.overshoot.id, {
        class: "product_bug",
        note: NOTE,
      }).expect(201),
    );

    expect(answer.routing.route).toBe("correction_round");
    expect(answer.routing.control).toEqual(
      expect.objectContaining({ state: "pending", retryStage: true }),
    );
    expect(answer.routing.targetAttempt).toBe(2);

    // The note is in the run console's transcript, as the person's entry, on attempt 1.
    const { rows: entries } = await api.sql.query<{
      body: string;
      stage_key: string;
      attempt: number;
      payload: Record<string, unknown>;
    }>(
      `select body, stage_key, attempt, payload from ${SCHEMA_NAME}.run_events
        where run_id = $1 and actor = 'user'`,
      [at.run.id],
    );
    expect(entries).toEqual([
      expect.objectContaining({
        body: NOTE,
        stage_key: "implement",
        attempt: 1,
        payload: expect.objectContaining({ correctionRound: true }) as unknown,
      }),
    ]);

    // The executor claims it: the steer text, and the stage retry.
    const fetched = bodyOf<ControlsFetchedResource>(
      await simulator("post", `/internal/runs/${at.run.id}/controls/fetch`).expect(200),
    );
    expect(fetched.controls).toEqual([
      expect.objectContaining({ kind: "steer", payload: NOTE, retryStage: true }),
    ]);

    // …acknowledges naming the attempt it opens, and opens it.
    await simulator("post", `/internal/runs/${at.run.id}/controls/${fetched.controls[0].id}/ack`, {
      effect: "correction round queued: implement attempt 2",
    }).expect(200);
    await move(at, "t2", { stageKey: "implement", status: "failed" });
    await move(at, "t3", { stageKey: "implement", status: "active", attempt: 2 });

    const { rows: stages } = await api.sql.query<{ attempt: number; status: string }>(
      `select attempt, status from ${SCHEMA_NAME}.run_stages
        where run_id = $1 and stage_key = 'implement' order by attempt`,
      [at.run.id],
    );
    expect(stages).toEqual([
      { attempt: 1, status: "failed" },
      { attempt: 2, status: "active" },
    ]);
  });

  it("stores the receipt on the classification, readable by the UI", async () => {
    const at = await scene();

    await move(at, "t1", { stageKey: "implement", status: "active" });
    const answer = bodyOf<ClassifyResultResource>(
      await classify(at.owner, at, at.cases.overshoot.id, {
        class: "test_update",
        note: NOTE,
      }).expect(201),
    );

    const stored = await one<{
      routed: Record<string, unknown>;
      actor: string;
      created_by: string;
    }>(
      `select routed, actor, created_by from ${SCHEMA_NAME}.failure_classifications where id = $1`,
      [answer.classification.id],
    );
    expect(stored).toEqual({
      routed: {
        control_id: answer.routing.control?.id,
        target_attempt: 2,
        route: "correction_round",
      },
      actor: "human",
      created_by: at.owner.id,
    });

    const listed = bodyOf<ClassificationsListResource>(
      await as(at.owner, at, "get", `/api/v1/test-runs/${at.testRunId}/classifications`).expect(
        200,
      ),
    );
    expect(listed.classifications).toEqual([
      expect.objectContaining({
        id: answer.classification.id,
        routed: {
          controlId: answer.routing.control?.id,
          rerunJobId: null,
          targetAttempt: 2,
          route: "correction_round",
        },
      }),
    ]);
  });

  it("Re-run failed carries only the failed set; Re-run full suite carries all of them", async () => {
    const at = await scene();

    const failed = bodyOf<RerunResource>(await rerun(at.owner, at, "failed").expect(202));
    const full = bodyOf<RerunResource>(await rerun(at.owner, at, "full").expect(202));

    const expectedFailed = [at.cases.overshoot.key, at.cases.estop.key].sort();
    const expectedFull = Object.values(at.cases)
      .map((entry) => entry.key)
      .sort();

    expect([...failed.caseKeys].sort()).toEqual(expectedFailed);
    expect((await jobSelection(failed.job.id)).test_selection.case_keys.sort()).toEqual(
      expectedFailed,
    );
    expect((await jobSelection(failed.job.id)).run_id).toBe(at.run.id);
    expect(failed.job.title).toBe("Re-run failed (2)");

    expect([...full.caseKeys].sort()).toEqual(expectedFull);
    expect((await jobSelection(full.job.id)).test_selection).toEqual(
      expect.objectContaining({ scope: "full", test_run_id: at.testRunId }),
    );
  });

  it("answers an honest queue state when no runner is eligible, and another when one is", async () => {
    const at = await scene();

    const waiting = bodyOf<RerunResource>(await rerun(at.owner, at, "failed").expect(202));
    expect(waiting.queueState).toBe("queued_no_eligible_runner");
    expect(waiting.job.status).toBe("queued");

    await api.sql.query(
      `update ${SCHEMA_NAME}.runners set status = 'online', last_seen_at = now() where id = $1`,
      [at.runnerId],
    );
    const placeable = bodyOf<RerunResource>(await rerun(at.owner, at, "failed").expect(202));
    expect(placeable.queueState).toBe("queued_runner_available");
  });

  it("refuses a re-run of a run no farm build produced, rather than inventing one", async () => {
    const at = await scene();

    await api.sql.query(`update ${SCHEMA_NAME}.test_runs set build_job_id = null where id = $1`, [
      at.testRunId,
    ]);

    const refusal = await rerun(at.owner, at, "failed").expect(409);
    expect((refusal.body as { code: string }).code).toBe("rerun_source_missing");
  });

  it("flags the rig's runner with a farm health note on the infra path, and can requeue", async () => {
    const at = await scene();
    const member = await colleague(at, "member");

    const answer = bodyOf<ClassifyResultResource>(
      await classify(member, at, at.cases.estop.id, {
        class: "infra_rig",
        note: "Rig PSU browned out mid-trial.",
        toggles: { requeue: true },
      }).expect(201),
    );

    const runner = await one<{
      health_note: string;
      health_noted_by: string;
      health_noted_at: Date;
    }>(
      `select health_note, health_noted_by, health_noted_at from ${SCHEMA_NAME}.runners where id = $1`,
      [at.runnerId],
    );
    expect(runner).toEqual(
      expect.objectContaining({
        health_note: "Rig PSU browned out mid-trial.",
        health_noted_by: member.id,
      }),
    );
    expect(answer.routing.runnerFlag).toEqual(expect.objectContaining({ runnerId: at.runnerId }));
    expect(answer.classification.routed?.rerunJobId).toBe(answer.routing.rerun?.job.id);
    expect((await jobSelection(answer.routing.rerun?.job.id as string)).test_selection.scope).toBe(
      "full",
    );
  });

  it("marks the flake's history and re-runs only that case", async () => {
    const at = await scene();

    const answer = bodyOf<ClassifyResultResource>(
      await classify(at.owner, at, at.cases.telemetry.id, { class: "flake_retry" }).expect(201),
    );

    const history = await one<{ pass_on_retry: boolean }>(
      `select pass_on_retry from ${SCHEMA_NAME}.test_case_history where test_case_id = $1`,
      [at.cases.telemetry.id],
    );
    expect(history.pass_on_retry).toBe(true);
    expect(answer.routing.historyMarked).toBe(true);
    expect(
      (await jobSelection(answer.routing.rerun?.job.id as string)).test_selection.case_keys,
    ).toEqual([at.cases.telemetry.key]);
  });

  it("requires a reason for a waiver, records its author, and attempts no annotation", async () => {
    const at = await scene();
    const admin = await colleague(at, "admin");
    const member = await colleague(at, "member");
    const path = `/api/v1/test-runs/${at.testRunId}/waivers`;

    await as(admin, at, "post", path).send({ reason: "   " }).expect(422);
    await as(admin, at, "post", path).send({}).expect(422);
    await as(member, at, "post", path).send({ reason: "not mine to waive" }).expect(403);

    const waiver = bodyOf<WaiverResource>(
      await as(admin, at, "post", path)
        .send({ reason: "Known rig drift; tracked in #512.", caseIds: [at.cases.estop.id] })
        .expect(201),
    );

    const stored = await one<{ author: string; annotation_state: string; case_keys: string[] }>(
      `select author, annotation_state, case_keys from ${SCHEMA_NAME}.pr_waivers where id = $1`,
      [waiver.id],
    );
    expect(stored).toEqual({
      author: admin.id,
      annotation_state: "pending_pr_plane",
      case_keys: [at.cases.estop.key],
    });
  });

  it("audits every classification and every dispatch with the person as the actor", async () => {
    const at = await scene();
    const member = await colleague(at, "member");

    await move(at, "t1", { stageKey: "implement", status: "active" });
    await classify(member, at, at.cases.overshoot.id, { class: "product_bug", note: NOTE }).expect(
      201,
    );
    await classify(member, at, at.cases.telemetry.id, { class: "flake_retry" }).expect(201);
    await rerun(member, at, "full").expect(202);

    const rows = await trail(at);
    const by = (action: string) => rows.filter((row) => row.action === action);

    expect(by("triage.classified").map((row) => [row.actor_id, row.detail.class])).toEqual([
      [member.id, "product_bug"],
      [member.id, "flake_retry"],
    ]);
    expect(by("run_control.requested").map((row) => row.actor_id)).toEqual([member.id]);
    expect(by("runner.job_submitted").map((row) => row.actor_id)).toEqual([member.id, member.id]);
    expect(by("triage.rerun_requested").map((row) => [row.actor_id, row.detail.scope])).toEqual([
      [member.id, "full"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("PID velocity");
  });

  it("refuses what the card must not do, before anything is written", async () => {
    const at = await scene();
    const viewer = await colleague(at, "viewer");

    await classify(viewer, at, at.cases.overshoot.id, { class: "flake_retry" }).expect(403);
    await classify(at.owner, at, at.cases.overshoot.id, { class: "product_bug" }).expect(422);
    await classify(at.owner, at, at.cases.overshoot.id, { class: "wontfix" }).expect(422);
    await classify(at.owner, at, at.cases.boot.id, { class: "flake_retry" }).expect(409);

    const count = await one<{ n: string }>(
      `select count(*)::text as n from ${SCHEMA_NAME}.failure_classifications`,
      [],
    );
    expect(count.n).toBe("0");
  });

  it("answers 404 for another workspace's test run", async () => {
    const at = await scene();
    const stranger = await api.signUp();
    const elsewhere = await seedIngestBench(api, stranger, "483");

    await api
      .as(stranger)("get", `/api/v1/test-runs/${at.testRunId}/hints`)
      .set(TENANT_HEADER, elsewhere.workspace.slug)
      .expect(404);
    await api
      .as(stranger)("post", `/api/v1/test-runs/${at.testRunId}/rerun`)
      .set(TENANT_HEADER, elsewhere.workspace.slug)
      .send({ scope: "full" })
      .expect(404);
  });
});
