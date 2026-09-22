import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type {
  ControlsFetchedResource,
  RunControlResource,
  RunControlsListResource,
} from "./controls.resources";

/**
 * The control queue against a migrated PostgreSQL (#306), driven the way the simulated-run
 * driver (AP.5, #307) will drive it: a run opened through the ingestion contract by the
 * simulator principal, a person pressing buttons through the public API, and the simulator
 * fetching and acknowledging over the internal channel.
 *
 * One test per acceptance criterion, in the issue's order:
 *
 *   * a steer appears in the transcript and is acked *"applied to attempt 2"*;
 *   * an abort mid-stage terminates the run, which reaches a terminal state with its branch;
 *   * TTL expiry is an expired control, distinguishable from a rejection;
 *   * double-submitting pause produces one control;
 *   * a member's abort is refused server-side even with a correct (forged) confirmation;
 *   * steering a terminal run is rejected with a reason the UI can display;
 *   * an audit row exists for every control, and no audit body contains steer text.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The simulator's credential. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** What a person types into the steering box in mockup 10. */
const STEER_TEXT = "prefer a fix inside the ISR; do not touch the test timeouts";

describe("the control queue", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
      // The periodic sweep stays out of the way: every route sweeps its own run first, which
      // is the behaviour under test.
      OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
    });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** A workspace (owned by `owner`), a mirrored ticket, and a run opened by the simulator. */
  interface Stage {
    readonly owner: Person;
    readonly bench: IngestBench;
    readonly run: RunOpenedResource;
  }

  /**
   * Set the stage every test starts from.
   *
   * @returns The owner, the bench and the open run.
   */
  async function stage(): Promise<Stage> {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await simulator("post", "/internal/runs", { idempotencyKey: "open-1", ...bench.open }).expect(
        201,
      ),
    );

    return { owner, bench, run };
  }

  /** Call the internal channel as the simulator. */
  function simulator(method: "post", path: string, body: unknown = {}) {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET)
      .send(body as object);
  }

  /** Call the public API as somebody, in the stage's workspace. */
  function as(person: Person, scene: Stage, method: "get" | "post", path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, scene.bench.workspace.slug);
  }

  /** Press a button, or type into the box. */
  function submit(person: Person, scene: Stage, body: Record<string, unknown>) {
    return as(person, scene, "post", `/api/v1/runs/${scene.run.id}/controls`).send(body);
  }

  /** Move a stage, as the simulator. */
  function move(scene: Stage, key: string, body: Record<string, unknown>) {
    return simulator("post", `/internal/runs/${scene.run.id}/stage-transitions`, {
      idempotencyKey: key,
      ...body,
    }).expect(200);
  }

  /** Walk the run into its second implement attempt — the mockup's story. */
  async function intoAttemptTwo(scene: Stage): Promise<void> {
    await move(scene, "t1", { stageKey: "analyze", status: "active" });
    await move(scene, "t2", { stageKey: "analyze", status: "succeeded" });
    await move(scene, "t3", { stageKey: "implement", status: "active" });
    await move(scene, "t4", { stageKey: "implement", status: "failed" });
    await move(scene, "t5", {
      stageKey: "implement",
      status: "active",
      attempt: 2,
      returnedFrom: { stageKey: "checks-green", kind: "gate", reason: "failed_tests" },
    });
  }

  /** Somebody else, holding `role` in the stage's workspace. */
  async function colleague(scene: Stage, role: "admin" | "member" | "viewer"): Promise<Person> {
    const person = await api.signUp();

    await api.join(scene.bench.workspace.id, person, role);

    return person;
  }

  /** Fetch as the simulator. */
  async function fetch(scene: Stage): Promise<ControlsFetchedResource> {
    return bodyOf<ControlsFetchedResource>(
      await simulator("post", `/internal/runs/${scene.run.id}/controls/fetch`).expect(200),
    );
  }

  /** Ack as the simulator. */
  function ack(scene: Stage, controlId: string, body: Record<string, unknown> = {}) {
    return simulator("post", `/internal/runs/${scene.run.id}/controls/${controlId}/ack`, body);
  }

  it("delivers a steer through the whole lifecycle: transcript, fetch, ack on attempt 2", async () => {
    const scene = await stage();
    const member = await colleague(scene, "member");

    await intoAttemptTwo(scene);

    const sent = bodyOf<RunControlResource>(
      await submit(member, scene, { kind: "steer", payload: STEER_TEXT }).expect(202),
    );

    expect(sent.state).toBe("pending");
    expect(sent.hasPayload).toBe(true);

    // The transcript shows who nudged the loop, on the attempt they were watching.
    const { rows: entries } = await api.sql.query<{
      actor: string;
      body: string;
      stage_key: string;
      attempt: number;
      payload: { controlId: string; requestedBy: { id: string } };
      simulated: boolean;
    }>(
      `select actor, body, stage_key, attempt, payload, simulated
         from ${SCHEMA_NAME}.run_events where run_id = $1 and actor = 'user'`,
      [scene.run.id],
    );

    expect(entries).toEqual([
      {
        actor: "user",
        body: STEER_TEXT,
        stage_key: "implement",
        attempt: 2,
        payload: { controlId: sent.id, requestedBy: { id: member.id, name: member.displayName } },
        simulated: true,
      },
    ]);

    // The executor claims it, and a second fetch finds nothing: delivery happens once.
    const fetched = await fetch(scene);

    expect(fetched.controls).toEqual([
      expect.objectContaining({ id: sent.id, kind: "steer", payload: STEER_TEXT }),
    ]);
    expect((await fetch(scene)).controls).toEqual([]);

    const acked = bodyOf<RunControlResource>(await ack(scene, sent.id, { attempt: 2 }).expect(200));

    expect(acked.state).toBe("acked");
    expect(acked.detail).toBe("steering applied to attempt 2");

    // Steering does not pause: the run is still in flight on attempt 2.
    const { rows: runs } = await api.sql.query<{ status: string; finished_at: Date | null }>(
      `select status, finished_at from ${SCHEMA_NAME}.runs where id = $1`,
      [scene.run.id],
    );

    expect(runs[0]).toEqual({ status: "coding", finished_at: null });

    // The console's chip reads it back, without the text.
    const listed = bodyOf<RunControlsListResource>(
      await as(member, scene, "get", `/api/v1/runs/${scene.run.id}/controls`).expect(200),
    );

    expect(listed.controls[0]).toEqual(
      expect.objectContaining({
        id: sent.id,
        state: "acked",
        detail: "steering applied to attempt 2",
      }),
    );
    expect(JSON.stringify(listed)).not.toContain("ISR");
  });

  it("terminates the run on an acked abort mid-stage, and keeps its branch", async () => {
    const scene = await stage();

    await move(scene, "t1", { stageKey: "analyze", status: "active" });

    const sent = bodyOf<RunControlResource>(
      await submit(scene.owner, scene, {
        kind: "abort",
        confirmation: String(scene.run.loopSeq),
      }).expect(202),
    );

    const [delivered] = (await fetch(scene)).controls;

    expect(delivered.id).toBe(sent.id);

    const acked = bodyOf<RunControlResource>(await ack(scene, sent.id).expect(200));

    expect(acked.detail).toBe("aborted — branch preserved");

    const { rows } = await api.sql.query<{
      status: string;
      finished_at: Date | null;
      branch_name: string;
    }>(`select status, finished_at, branch_name from ${SCHEMA_NAME}.runs where id = $1`, [
      scene.run.id,
    ]);

    expect(rows[0].status).toBe("canceled");
    expect(rows[0].finished_at).not.toBeNull();
    expect(rows[0].branch_name).toBe("loop/482-canbus-flake");

    // A run that has ended is terminal for the dashboard's read too.
    const run = bodyOf<{ status: string; finishedAt: string | null }>(
      await as(scene.owner, scene, "get", `/api/v1/runs/${scene.run.id}`).expect(200),
    );

    expect(run.status).toBe("canceled");
    expect(run.finishedAt).not.toBeNull();
  });

  it("expires an unanswered control, distinguishably from a rejection", async () => {
    const scene = await stage();

    // Two controls whose TTLs have elapsed — one never fetched, one fetched and never
    // answered — written directly, because the service will not write an expiry in the past.
    const { rows: stale } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.run_controls
         (run_id, kind, state, requested_by, requested_at, delivered_at, expires_at)
       values ($1, 'pause', 'pending', $2, now() - interval '10 minutes', null,
               now() - interval '8 minutes'),
              ($1, 'resume', 'delivered', $2, now() - interval '7 minutes',
               now() - interval '6 minutes', now() - interval '5 minutes')
       returning id`,
      [scene.run.id, scene.owner.id],
    );

    const listed = bodyOf<RunControlsListResource>(
      await as(scene.owner, scene, "get", `/api/v1/runs/${scene.run.id}/controls`).expect(200),
    );

    expect(listed.controls.map((control) => control.state)).toEqual(["expired", "expired"]);
    expect(listed.controls.every((control) => control.detail === null)).toBe(true);

    // The executor that answers too late is told so, and can tell it from a lost response.
    const late = bodyOf<ErrorEnvelope>(await ack(scene, stale[1].id).expect(409));

    expect(late.code).toBe("control_not_delivered");
    expect(late.details).toEqual({ controlId: stale[1].id, state: "expired" });

    // A rejection is a different state, and carries its reason.
    await move(scene, "t1", { stageKey: "analyze", status: "active" });
    await api.sql.query(
      `update ${SCHEMA_NAME}.runs set status = 'merged', finished_at = now(), pr_number = 512
        where id = $1`,
      [scene.run.id],
    );

    const rejected = bodyOf<RunControlResource>(
      await submit(scene.owner, scene, { kind: "pause" }).expect(202),
    );

    expect(rejected.state).toBe("rejected");
    expect(rejected.detail).not.toBeNull();
  });

  it("makes a double-submitted pause one control", async () => {
    const scene = await stage();

    const [first, second] = await Promise.all([
      submit(scene.owner, scene, { kind: "pause" }).expect(202),
      submit(scene.owner, scene, { kind: "pause" }).expect(202),
    ]);

    expect(bodyOf<RunControlResource>(second).id).toBe(bodyOf<RunControlResource>(first).id);

    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*)::text as count from ${SCHEMA_NAME}.run_controls where run_id = $1`,
      [scene.run.id],
    );

    expect(rows[0].count).toBe("1");
  });

  it("answers a retry under the same idempotency key with the same control", async () => {
    const scene = await stage();
    const member = await colleague(scene, "member");
    const body = { kind: "steer", payload: STEER_TEXT, idempotencyKey: "steer-1" };

    const first = bodyOf<RunControlResource>(await submit(member, scene, body).expect(202));
    const retry = bodyOf<RunControlResource>(await submit(member, scene, body).expect(202));

    expect(retry.id).toBe(first.id);

    const reused = bodyOf<ErrorEnvelope>(
      await submit(member, scene, { ...body, payload: "something else" }).expect(409),
    );

    expect(reused.code).toBe("control_key_reused");
  });

  describe("the role matrix", () => {
    it("refuses a member's abort server-side, even carrying the right confirmation", async () => {
      const scene = await stage();
      const member = await colleague(scene, "member");

      const refused = bodyOf<ErrorEnvelope>(
        await submit(member, scene, {
          kind: "abort",
          confirmation: String(scene.run.loopSeq),
        }).expect(403),
      );

      expect(refused.code).toBe("forbidden");

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.run_controls where run_id = $1`,
        [scene.run.id],
      );

      expect(rows[0].count).toBe("0");
    });

    it.each(["pause", "resume"] as const)("refuses a member's %s", async (kind) => {
      const scene = await stage();
      const member = await colleague(scene, "member");

      await submit(member, scene, { kind }).expect(403);
    });

    it("refuses a viewer's steer and lets them read the list", async () => {
      const scene = await stage();
      const viewer = await colleague(scene, "viewer");

      await submit(viewer, scene, { kind: "steer", payload: STEER_TEXT }).expect(403);
      await as(viewer, scene, "get", `/api/v1/runs/${scene.run.id}/controls`).expect(200);
    });

    it("lets an admin pause, resume and abort", async () => {
      const scene = await stage();
      const admin = await colleague(scene, "admin");

      await submit(admin, scene, { kind: "pause" }).expect(202);
      await submit(admin, scene, { kind: "resume" }).expect(202);
      await submit(admin, scene, {
        kind: "abort",
        confirmation: `#${String(scene.run.loopSeq)}`,
      }).expect(202);
    });

    it("refuses an abort whose confirmation names another loop", async () => {
      const scene = await stage();

      const refused = bodyOf<ErrorEnvelope>(
        await submit(scene.owner, scene, {
          kind: "abort",
          confirmation: String(scene.run.loopSeq + 1),
        }).expect(422),
      );

      expect(refused.code).toBe("abort_confirmation_invalid");
    });

    it("answers 404 for a run in another workspace", async () => {
      const scene = await stage();
      const other = await stage();

      await as(scene.owner, scene, "post", `/api/v1/runs/${other.run.id}/controls`)
        .send({ kind: "pause" })
        .expect(404);
    });
  });

  it("rejects a steer on a terminal run with a reason the UI can display", async () => {
    const scene = await stage();
    const member = await colleague(scene, "member");

    await api.sql.query(
      `update ${SCHEMA_NAME}.runs set status = 'failed', finished_at = now() where id = $1`,
      [scene.run.id],
    );

    const rejected = bodyOf<RunControlResource>(
      await submit(member, scene, { kind: "steer", payload: STEER_TEXT }).expect(202),
    );

    expect(rejected.state).toBe("rejected");
    expect(rejected.detail).toBe(
      "The run is failed and has already finished, so there is nothing left to control.",
    );

    // Nothing reaches the executor or the transcript.
    expect((await fetch(scene)).controls).toEqual([]);

    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*)::text as count from ${SCHEMA_NAME}.run_events
        where run_id = $1 and actor = 'user'`,
      [scene.run.id],
    );

    expect(rows[0].count).toBe("0");
  });

  it("audits every control, and no audit body contains the steer text", async () => {
    const scene = await stage();
    const member = await colleague(scene, "member");

    const steer = bodyOf<RunControlResource>(
      await submit(member, scene, { kind: "steer", payload: STEER_TEXT, remember: true }).expect(
        202,
      ),
    );
    const pause = bodyOf<RunControlResource>(
      await submit(scene.owner, scene, { kind: "pause" }).expect(202),
    );

    await fetch(scene);
    await ack(scene, steer.id, { attempt: 1 }).expect(200);

    const { rows } = await api.sql.query<{
      subject_id: string;
      action: string;
      actor_id: string | null;
      detail: unknown;
    }>(
      `select subject_id, action, actor_id, detail from ${SCHEMA_NAME}.audit_events
        where subject_type = 'run_control' order by occurred_at, action`,
    );

    expect(rows.filter((row) => row.subject_id === steer.id).map((row) => row.action)).toEqual([
      "run_control.requested",
      "run_control.delivered",
      "run_control.acked",
    ]);
    expect(rows.filter((row) => row.subject_id === pause.id).map((row) => row.action)).toEqual([
      "run_control.requested",
      "run_control.delivered",
    ]);

    // The actor is the person on the request, and nobody on the transitions.
    const requested = rows.find(
      (row) => row.subject_id === steer.id && row.action === "run_control.requested",
    );

    expect(requested?.actor_id).toBe(member.id);
    expect(requested?.detail).toEqual({
      run_id: scene.run.id,
      kind: "steer",
      state: "pending",
      has_payload: true,
    });

    for (const row of rows) {
      expect(JSON.stringify(row.detail)).not.toContain("ISR");
    }
  });

  describe("the internal channel", () => {
    it("refuses a stranger", async () => {
      const scene = await stage();

      await api.anonymous("post", `/internal/runs/${scene.run.id}/controls/fetch`).expect(401);
    });

    it("answers 404 for a control of another run", async () => {
      const scene = await stage();
      const other = await stage();
      const sent = bodyOf<RunControlResource>(
        await submit(other.owner, other, { kind: "pause" }).expect(202),
      );

      const refused = bodyOf<ErrorEnvelope>(await ack(scene, sent.id).expect(404));

      expect(refused.code).toBe("control_not_found");
    });

    it("refuses to acknowledge a control nobody fetched", async () => {
      const scene = await stage();
      const sent = bodyOf<RunControlResource>(
        await submit(scene.owner, scene, { kind: "pause" }).expect(202),
      );

      const refused = bodyOf<ErrorEnvelope>(await ack(scene, sent.id).expect(409));

      expect(refused.details).toEqual({ controlId: sent.id, state: "pending" });
    });
  });
});
