import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { INGEST_ERRORS } from "./ingest.errors";
import {
  IMPLEMENT_MAX_ATTEMPTS,
  WORKFLOW_VERSION,
  seedIngestBench,
  seedReservableJob,
  type IngestBench,
} from "./ingest.fixture";
import type {
  ChangeSetResource,
  CommitsAppendedResource,
  EventsAppendedResource,
  ResourcesReportedResource,
  RunOpenedResource,
  StageTransitionResource,
} from "./ingest.resources";

/**
 * **The ingestion contract, over a socket and against a migrated database** — AP.1
 * ([#303](https://github.com/NobuData/ouroboros/issues/303)).
 *
 * Every acceptance criterion this ticket has is here, because none of them exists at any
 * smaller scale: they are about what the *database* does with what the contract writes.
 *
 *   * a full simulated lifecycle lands, including a gate return producing a second
 *     `Implement` attempt with a **composed** note;
 *   * interleaved batches from concurrent posts produce a dense, correctly ordered `seq`
 *     with no gaps and no duplicates;
 *   * replaying any write with the same idempotency key is a no-op returning the original
 *     result;
 *   * an invalid stage transition is rejected with a machine-readable reason;
 *   * exceeding the pinned `max_attempts` is rejected;
 *   * a file report triggers guardrail evaluation, and a run with no file changes triggers
 *     none;
 *   * the dashboard read-model reflects runs ingested here;
 *   * `simulated` cannot be cleared by a client claim — it follows the principal.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The simulator's credential, which is what makes a run simulated. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

describe("the ingestion contract", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The engine's own secret, from the configuration this stack was built with. */
  const executorKey = (): string => api.configuration.engineSharedSecret;

  /** Post as one of the two principals. */
  function as(
    principal: "executor" | "simulator",
    method: "post" | "put",
    path: string,
    body: unknown,
  ): ReturnType<ApiHarness["anonymous"]> {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, principal === "simulator" ? SIMULATOR_SECRET : executorKey())
      .send(body as object);
  }

  /** A workspace with a mirrored ticket and a published workflow version. */
  async function bench(externalId?: string): Promise<IngestBench> {
    return seedIngestBench(api, await api.signUp(), externalId);
  }

  /** Open a run as the simulator, which is what every lifecycle test starts with. */
  async function openRun(
    seeded: IngestBench,
    idempotencyKey = "open-1",
  ): Promise<RunOpenedResource> {
    return bodyOf<RunOpenedResource>(
      await as("simulator", "post", "/internal/runs", {
        idempotencyKey,
        ...seeded.open,
      }).expect(201),
    );
  }

  describe("opening a run", () => {
    it("resolves the workspace from the ticket the request named", async () => {
      // Two workspaces exist and the request names neither; the answer names the one the
      // ticket belongs to, which is the only place it could have come from.
      const first = await bench();
      await bench();

      const run = await openRun(first);

      expect(run.organizationId).toBe(first.workspace.id);
      expect(run.issueNumber).toBe(482);
      expect(run.issueTitle).toBe("Fix flaky CAN-bus telemetry test");
    });

    it("lets the database allocate the loop counter, per workspace", async () => {
      const seeded = await bench();

      const first = await openRun(seeded, "open-a");
      const second = await openRun(seeded, "open-b");

      expect(second.loopSeq).toBe(first.loopSeq + 1);
      expect(first.loopSeq).toBeGreaterThanOrEqual(1);
    });

    it("pins the version, the branch and the merge strategy onto the row", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      const { rows } = await api.sql.query<{
        workflow_version_pin: number;
        branch_name: string;
        merge_strategy: string;
        stage_total: number;
      }>(
        `select workflow_version_pin, branch_name, merge_strategy, stage_total
           from ${SCHEMA_NAME}.runs where id = $1`,
        [run.id],
      );

      expect(rows[0]).toEqual({
        workflow_version_pin: WORKFLOW_VERSION,
        branch_name: "loop/482-canbus-flake",
        merge_strategy: "squash",
        // The pinned document's own node count — `standard-fix.json` draws twelve.
        stage_total: 12,
      });
    });

    it("refuses a ticket whose identifier a run cannot hold, rather than inventing one", async () => {
      // V008 gave a run an integer issue number and V030 made a ticket's identity text. The
      // disagreement is named rather than papered over with a hash.
      const seeded = await bench("PROJ-142");

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "post", "/internal/runs", {
          idempotencyKey: "open-1",
          ...seeded.open,
        }).expect(409),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.ticketNotNumbered);
    });

    it("refuses a repository belonging to another workspace", async () => {
      const first = await bench();
      const second = await bench();

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "post", "/internal/runs", {
          idempotencyKey: "open-1",
          ...first.open,
          repository: second.workspace.repoId,
        }).expect(404),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.repositoryNotFound);
    });

    it("refuses a workflow version nobody published", async () => {
      const seeded = await bench();

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "post", "/internal/runs", {
          idempotencyKey: "open-1",
          ...seeded.open,
          workflow: { tag: "standard-fix", version: 99 },
        }).expect(404),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.workflowPinNotFound);
    });
  });

  describe("the simulated watermark", () => {
    it("follows the principal, and a client cannot claim or clear it", async () => {
      const seeded = await bench();

      const simulated = await openRun(seeded, "open-sim");
      const real = bodyOf<RunOpenedResource>(
        await as("executor", "post", "/internal/runs", {
          idempotencyKey: "open-real",
          ...seeded.open,
        }).expect(201),
      );

      expect(simulated.simulated).toBe(true);
      expect(real.simulated).toBe(false);

      // And the field does not exist to be sent: the pipe refuses a body carrying one.
      const refused = bodyOf<ErrorEnvelope>(
        await as("executor", "post", "/internal/runs", {
          idempotencyKey: "open-claim",
          ...seeded.open,
          simulated: true,
        }).expect(422),
      );

      expect(refused.code).toBe("validation_failed");
    });

    it("reaches every transcript entry the run writes", async () => {
      // V046 raises each entry's flag to the run's own, so a simulated run cannot write an
      // unmarked line — which is what the JSONL export's watermark rests on.
      const seeded = await bench();
      const run = await openRun(seeded);

      await as("simulator", "post", `/internal/runs/${run.id}/events`, {
        idempotencyKey: "events-1",
        events: [{ hint: 1, actor: "system", body: "loop opened" }],
      }).expect(200);

      const { rows } = await api.sql.query<{ simulated: boolean }>(
        `select simulated from ${SCHEMA_NAME}.run_events where run_id = $1`,
        [run.id],
      );

      expect(rows.map((row) => row.simulated)).toEqual([true]);
    });
  });

  describe("a full simulated lifecycle", () => {
    it("walks the stages, returns from the gate, and composes the note", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);
      const move = (key: string, body: Record<string, unknown>) =>
        as("simulator", "post", `/internal/runs/${run.id}/stage-transitions`, {
          idempotencyKey: key,
          ...body,
        });

      await move("t1", { stageKey: "analyze", status: "active" }).expect(200);
      await move("t2", { stageKey: "analyze", status: "succeeded" }).expect(200);
      await move("t3", { stageKey: "implement", status: "active" }).expect(200);
      await move("t4", { stageKey: "implement", status: "failed" }).expect(200);

      // The gate sends the loop back, and the second attempt is a *new row* rather than an
      // overwrite — which is what makes attempt 1 still answerable.
      const second = bodyOf<StageTransitionResource>(
        await move("t5", {
          stageKey: "implement",
          status: "active",
          attempt: 2,
          returnedFrom: { stageKey: "checks-green", kind: "gate", reason: "failed_tests" },
        }).expect(200),
      );

      expect(second.attempt).toBe(2);
      expect(second.maxAttempts).toBe(IMPLEMENT_MAX_ATTEMPTS);
      expect(second.tokenBudget).toBe(400_000);
      expect(second.stageLabel).toBe("Code the change");
      // Composed by the database from the recorded transition, never typed by a writer.
      expect(second.note).toBe("attempt 1 failed tests — loop returned from gate ↺");

      const { rows } = await api.sql.query<{
        attempt: number;
        status: string;
        note: string | null;
      }>(
        `select attempt, status, note from ${SCHEMA_NAME}.run_stages
          where run_id = $1 and stage_key = 'implement' order by attempt`,
        [run.id],
      );

      expect(rows).toEqual([
        { attempt: 1, status: "failed", note: null },
        {
          attempt: 2,
          status: "active",
          note: "attempt 1 failed tests — loop returned from gate ↺",
        },
      ]);
    });

    it("reports the change-set, the commits and the spend, and reads back as one run", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      const changes = bodyOf<ChangeSetResource>(
        await as("simulator", "put", `/internal/runs/${run.id}/files`, {
          idempotencyKey: "files-1",
          files: [
            {
              path: "drivers/can/telemetry_buf.c",
              status: "modified",
              additions: 38,
              deletions: 12,
            },
            { path: "tests/telemetry/test_frame_order.c", status: "added", additions: 21 },
          ],
        }).expect(200),
      );

      expect(changes).toEqual({
        changeSetSeq: 1,
        files: 2,
        additions: 59,
        deletions: 12,
        guardrailChecks: 4,
      });

      const commits = bodyOf<CommitsAppendedResource>(
        await as("simulator", "post", `/internal/runs/${run.id}/commits`, {
          idempotencyKey: "commits-1",
          commits: [
            {
              sha: "a41c9e2",
              message: "can: replace telemetry k_fifo with k_msgq + frame seq",
              committedAt: "2026-09-22T14:30:12.000Z",
            },
          ],
        }).expect(200),
      );

      expect(commits).toEqual({ submitted: 1, appended: 1, duplicates: 0, lastSeq: 1 });

      const resources = bodyOf<ResourcesReportedResource>(
        await as("simulator", "post", `/internal/runs/${run.id}/resources`, {
          idempotencyKey: "resources-1",
          spend: {
            provider: "anthropic",
            model: "claude-fable-5",
            tokensIn: 164_000,
            tokensOut: 48_000,
            costCents: "114.0000",
            taskKind: "implement",
          },
        }).expect(200),
      );

      expect(resources).toEqual({
        tokensIn: 164_000,
        tokensOut: 48_000,
        costCents: "114.0000",
        unpricedEvents: 0,
        reservedBuildJobId: null,
      });
    });

    it("replaces the change-set rather than adding to it", async () => {
      // V047: "an ingestion path that adds instead of replacing produces counts that climb
      // for ever". A file the run reverted leaves the card rather than lingering at +0 −0.
      const seeded = await bench();
      const run = await openRun(seeded);
      const report = (key: string, files: unknown[]) =>
        as("simulator", "put", `/internal/runs/${run.id}/files`, { idempotencyKey: key, files });

      await report("f1", [
        { path: "a.c", status: "modified", additions: 10, deletions: 2 },
        { path: "b.c", status: "added", additions: 5 },
      ]).expect(200);

      const second = bodyOf<ChangeSetResource>(
        await report("f2", [
          { path: "a.c", status: "modified", additions: 38, deletions: 12 },
        ]).expect(200),
      );

      expect(second).toMatchObject({ changeSetSeq: 2, files: 1, additions: 38, deletions: 12 });

      const { rows } = await api.sql.query<{ path: string }>(
        `select path from ${SCHEMA_NAME}.run_files where run_id = $1`,
        [run.id],
      );

      expect(rows.map((row) => row.path)).toEqual(["a.c"]);
    });

    it("holds and releases a build-farm reservation", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);
      const job = await seedReservableJob(api, seeded);

      const held = bodyOf<ResourcesReportedResource>(
        await as("simulator", "post", `/internal/runs/${run.id}/resources`, {
          idempotencyKey: "reserve-1",
          reservedBuildJob: job,
        }).expect(200),
      );
      expect(held.reservedBuildJobId).toBe(job);

      const released = bodyOf<ResourcesReportedResource>(
        await as("simulator", "post", `/internal/runs/${run.id}/resources`, {
          idempotencyKey: "reserve-2",
          reservedBuildJob: null,
        }).expect(200),
      );
      expect(released.reservedBuildJobId).toBeNull();
    });

    it("refuses a build job of another workspace", async () => {
      const first = await bench();
      const second = await bench();
      const run = await openRun(first);
      const job = await seedReservableJob(api, second, 900);

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "post", `/internal/runs/${run.id}/resources`, {
          idempotencyKey: "reserve-1",
          reservedBuildJob: job,
        }).expect(404),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.buildJobNotFound);
    });
  });

  describe("the transcript's ordering", () => {
    it("assigns a dense sequence with no gaps and no duplicates under interleaving", async () => {
      // The criterion. Five batches are posted **concurrently**, so they reach the service in
      // whatever order the event loop and the pool produce; the run's lock serialises them,
      // and the ones that lost the race are refused with their own numbers rather than
      // silently reordered. What lands is dense.
      const seeded = await bench();
      const run = await openRun(seeded);

      const batches = Array.from({ length: 5 }, (_unused, index) => ({
        idempotencyKey: `batch-${String(index)}`,
        events: [
          { hint: index * 2 + 1, actor: "system", body: `a${String(index)}` },
          { hint: index * 2 + 2, actor: "system", body: `b${String(index)}` },
        ],
      }));

      const answers = await Promise.all(
        batches.map((batch) =>
          as("simulator", "post", `/internal/runs/${run.id}/events`, batch).then(
            (response) => response,
          ),
        ),
      );

      const accepted = answers.filter((response) => response.status === 200);
      const refused = answers.filter((response) => response.status === 409);

      expect(accepted.length + refused.length).toBe(answers.length);
      for (const response of refused) {
        expect(bodyOf<ErrorEnvelope>(response).code).toBe(INGEST_ERRORS.eventsOutOfOrder);
      }

      const { rows } = await api.sql.query<{ seq: number }>(
        `select seq from ${SCHEMA_NAME}.run_events where run_id = $1 order by seq`,
        [run.id],
      );

      // Dense from 1, and one row per accepted entry — no gaps, no duplicates.
      expect(rows.map((row) => row.seq)).toEqual(
        Array.from({ length: rows.length }, (_unused, index) => index + 1),
      );
      expect(rows).toHaveLength(accepted.length * 2);
    });

    it("refuses a batch that does not continue the accepted order, with both numbers", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      await as("simulator", "post", `/internal/runs/${run.id}/events`, {
        idempotencyKey: "batch-1",
        events: [{ hint: 5, actor: "system", body: "a" }],
      }).expect(200);

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "post", `/internal/runs/${run.id}/events`, {
          idempotencyKey: "batch-2",
          events: [{ hint: 3, actor: "system", body: "b" }],
        }).expect(409),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.eventsOutOfOrder);
      expect(refusal.details).toEqual({ accepted: 5, offered: 3 });

      // Nothing was written: a refused batch is refused whole.
      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*) as count from ${SCHEMA_NAME}.run_events where run_id = $1`,
        [run.id],
      );
      expect(rows[0].count).toBe("1");
    });

    it("answers with the sequence the store allocated, not with the caller's hints", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      const appended = bodyOf<EventsAppendedResource>(
        await as("simulator", "post", `/internal/runs/${run.id}/events`, {
          idempotencyKey: "batch-1",
          events: [
            { hint: 100, actor: "plan", body: "a" },
            { hint: 200, actor: "tool", toolTag: "pytest", body: "b" },
          ],
        }).expect(200),
      );

      expect(appended).toEqual({
        submitted: 2,
        stored: 2,
        firstSeq: 1,
        lastSeq: 2,
        hint: 200,
        elided: false,
      });
    });

    it("reports elision honestly once a cap has refused an entry", async () => {
      // The cap is a column so a test can set one low enough to watch it work — V046's own
      // argument for that being a column at all.
      const seeded = await bench();
      const run = await openRun(seeded);
      await api.sql.query(`update ${SCHEMA_NAME}.runs set event_cap = 1 where id = $1`, [run.id]);

      const appended = bodyOf<EventsAppendedResource>(
        await as("simulator", "post", `/internal/runs/${run.id}/events`, {
          idempotencyKey: "batch-1",
          events: [
            { hint: 1, actor: "system", body: "kept" },
            { hint: 2, actor: "system", body: "refused" },
          ],
        }).expect(200),
      );

      expect(appended).toMatchObject({ submitted: 2, stored: 1, elided: true });
    });
  });

  describe("replaying a key", () => {
    /** Every write, as `[name, method, path suffix, body]`. */
    function everyWrite(run: string) {
      return [
        [
          "a stage transition",
          "post" as const,
          `/internal/runs/${run}/stage-transitions`,
          { idempotencyKey: "replay", stageKey: "analyze", status: "active" },
        ],
        [
          "an event batch",
          "post" as const,
          `/internal/runs/${run}/events`,
          { idempotencyKey: "replay", events: [{ hint: 1, actor: "system", body: "x" }] },
        ],
        [
          "a change-set report",
          "put" as const,
          `/internal/runs/${run}/files`,
          { idempotencyKey: "replay", files: [{ path: "a.c", status: "added", additions: 1 }] },
        ],
        [
          "a commit report",
          "post" as const,
          `/internal/runs/${run}/commits`,
          {
            idempotencyKey: "replay",
            commits: [{ sha: "a41c9e2", message: "m", committedAt: "2026-09-22T14:30:12.000Z" }],
          },
        ],
        [
          "a resource report",
          "post" as const,
          `/internal/runs/${run}/resources`,
          {
            idempotencyKey: "replay",
            spend: { provider: "anthropic", model: "m", tokensIn: 10, tokensOut: 2 },
          },
        ],
      ] as const;
    }

    it("returns the original result, and writes nothing the second time", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      for (const [name, method, path, body] of everyWrite(run.id)) {
        const first = bodyOf(await as("simulator", method, path, body).expect(200));
        const second = bodyOf(await as("simulator", method, path, body).expect(200));

        // Field for field, not byte for byte: the stored answer is `jsonb`, which sorts an
        // object's keys, so a replay returns the same values in PostgreSQL's order rather than
        // in the mapper's. Every value is one `jsonb` round-trips unchanged —
        // `ingest.resources.spec.ts` is what holds each shape to that.
        expect(`${name}: ${JSON.stringify(second, Object.keys(first as object).sort())}`).toBe(
          `${name}: ${JSON.stringify(first, Object.keys(first as object).sort())}`,
        );
      }

      // One of each row, not two — the clearest statement that a replay did no work.
      const counts = await api.sql.query<{
        stages: string;
        events: string;
        commits: string;
        usage: string;
      }>(
        `select (select count(*) from ${SCHEMA_NAME}.run_stages where run_id = $1) as stages,
                (select count(*) from ${SCHEMA_NAME}.run_events where run_id = $1) as events,
                (select count(*) from ${SCHEMA_NAME}.run_commits where run_id = $1) as commits,
                (select count(*) from ${SCHEMA_NAME}.token_usage where run_id = $1) as usage`,
        [run.id],
      );

      expect(counts.rows[0]).toEqual({ stages: "1", events: "1", commits: "1", usage: "1" });
    });

    it("returns the same run for a replayed create, rather than opening a second", async () => {
      const seeded = await bench();

      const first = await openRun(seeded, "open-once");
      const second = bodyOf<RunOpenedResource>(
        await as("simulator", "post", "/internal/runs", {
          idempotencyKey: "open-once",
          ...seeded.open,
        }).expect(201),
      );

      expect(second).toEqual(first);

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*) as count from ${SCHEMA_NAME}.runs where organization_id = $1`,
        [seeded.workspace.id],
      );
      expect(rows[0].count).toBe("1");
    });

    it("refuses a key presented with a different body", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      await as("simulator", "put", `/internal/runs/${run.id}/files`, {
        idempotencyKey: "files-1",
        files: [{ path: "a.c", status: "added", additions: 1 }],
      }).expect(200);

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "put", `/internal/runs/${run.id}/files`, {
          idempotencyKey: "files-1",
          files: [{ path: "b.c", status: "added", additions: 1 }],
        }).expect(409),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.idempotencyKeyReused);
      expect(refusal.details).toEqual({ operation: "run.files", idempotencyKey: "files-1" });
    });

    it("answers a concurrent first delivery once, with one set of rows", async () => {
      // Two deliveries of one key in flight at the same time. Both pass the replay check and
      // race to insert the receipt; the loser is answered with the winner's response rather
      // than with a `500`.
      const seeded = await bench();
      const run = await openRun(seeded);
      const body = {
        idempotencyKey: "race",
        commits: [{ sha: "a41c9e2", message: "m", committedAt: "2026-09-22T14:30:12.000Z" }],
      };

      const answers = await Promise.all([
        as("simulator", "post", `/internal/runs/${run.id}/commits`, body),
        as("simulator", "post", `/internal/runs/${run.id}/commits`, body),
      ]);

      for (const response of answers) {
        expect(response.status).toBe(200);
      }
      expect(bodyOf(answers[0])).toEqual(bodyOf(answers[1]));

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*) as count from ${SCHEMA_NAME}.run_commits where run_id = $1`,
        [run.id],
      );
      expect(rows[0].count).toBe("1");
    });
  });

  describe("refusing a transition", () => {
    it("rejects an invalid move with a machine-readable reason, not a generic 400", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      await as("simulator", "post", `/internal/runs/${run.id}/stage-transitions`, {
        idempotencyKey: "t1",
        stageKey: "implement",
        status: "pending",
      }).expect(200);

      const response = await as("simulator", "post", `/internal/runs/${run.id}/stage-transitions`, {
        idempotencyKey: "t2",
        stageKey: "implement",
        status: "succeeded",
      }).expect(409);
      const refusal = bodyOf<ErrorEnvelope>(response);

      expect(refusal.code).toBe(INGEST_ERRORS.stageTransitionInvalid);
      expect(refusal.details).toEqual({
        stageKey: "implement",
        attempt: 1,
        from: "pending",
        to: "succeeded",
      });
    });

    it("rejects an attempt past the pinned limit", async () => {
      // `implement` allows two retries under `standard-fix.json`, so attempt 4 is one too
      // many and the refusal names the number the pin allows.
      const seeded = await bench();
      const run = await openRun(seeded);

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "post", `/internal/runs/${run.id}/stage-transitions`, {
          idempotencyKey: "t1",
          stageKey: "implement",
          status: "active",
          attempt: IMPLEMENT_MAX_ATTEMPTS + 1,
        }).expect(409),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.attemptLimitExceeded);
      expect(refusal.details).toMatchObject({ maxAttempts: IMPLEMENT_MAX_ATTEMPTS });
    });

    it("rejects a stage the pinned document does not name", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "post", `/internal/runs/${run.id}/stage-transitions`, {
          idempotencyKey: "t1",
          stageKey: "deploy",
          status: "active",
        }).expect(409),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.stageNotInPin);
    });

    it("refuses a note, because the database composes one", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      const refusal = bodyOf<ErrorEnvelope>(
        await as("simulator", "post", `/internal/runs/${run.id}/stage-transitions`, {
          idempotencyKey: "t1",
          stageKey: "implement",
          status: "active",
          note: "attempt 1 failed tests",
        }).expect(422),
      );

      expect(refusal.code).toBe("validation_failed");
    });
  });

  describe("guardrail evaluation", () => {
    it("is triggered by a file report, carrying the report's own number", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      await as("simulator", "put", `/internal/runs/${run.id}/files`, {
        idempotencyKey: "files-1",
        files: [{ path: "a.c", status: "added", additions: 1 }],
      }).expect(200);

      const { rows } = await api.sql.query<{
        check: string;
        verdict: string;
        change_set_seq: number;
      }>(
        `select "check", verdict, change_set_seq from ${SCHEMA_NAME}.guardrail_evaluations
          where run_id = $1 order by "check"`,
        [run.id],
      );

      expect(rows).toEqual([
        { check: "allowed_paths", verdict: "pending", change_set_seq: 1 },
        { check: "ci_config", verdict: "pending", change_set_seq: 1 },
        { check: "review_required", verdict: "pending", change_set_seq: 1 },
        { check: "secrets", verdict: "pending", change_set_seq: 1 },
      ]);
    });

    it("is not triggered by a run with no file changes", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      const answer = bodyOf<ChangeSetResource>(
        await as("simulator", "put", `/internal/runs/${run.id}/files`, {
          idempotencyKey: "files-1",
          files: [],
        }).expect(200),
      );

      expect(answer).toEqual({
        changeSetSeq: 0,
        files: 0,
        additions: 0,
        deletions: 0,
        guardrailChecks: 0,
      });

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*) as count from ${SCHEMA_NAME}.guardrail_evaluations where run_id = $1`,
        [run.id],
      );
      expect(rows[0].count).toBe("0");
    });

    it("numbers re-evaluations as a sequence rather than a pile", async () => {
      const seeded = await bench();
      const run = await openRun(seeded);

      for (const key of ["f1", "f2", "f3"]) {
        await as("simulator", "put", `/internal/runs/${run.id}/files`, {
          idempotencyKey: key,
          files: [{ path: "a.c", status: "modified", additions: 1 }],
        }).expect(200);
      }

      const { rows } = await api.sql.query<{ change_set_seq: number }>(
        `select distinct change_set_seq from ${SCHEMA_NAME}.guardrail_evaluations
          where run_id = $1 order by change_set_seq`,
        [run.id],
      );

      expect(rows.map((row) => row.change_set_seq)).toEqual([1, 2, 3]);
    });
  });

  describe("the dashboard read-model", () => {
    it("reflects a run this contract ingested", async () => {
      // The cross-roadmap criterion, verified against #64's own view: a run opened here, with
      // stage history written here, resolves its meter through `runs_with_stage` exactly as a
      // seeded one does.
      const seeded = await bench();
      const run = await openRun(seeded);

      await as("simulator", "post", `/internal/runs/${run.id}/stage-transitions`, {
        idempotencyKey: "t1",
        stageKey: "analyze",
        status: "active",
      }).expect(200);

      const { rows } = await api.sql.query<{
        stage_label: string;
        stage_index: number;
        stage_total: number;
        status: string;
        loop_seq: number;
      }>(
        `select stage_label, stage_index, stage_total, status, loop_seq
           from ${SCHEMA_NAME}.runs_with_stage where id = $1`,
        [run.id],
      );

      expect(rows[0]).toEqual({
        // Resolved from `run_stage_current` now that the run has history, rather than from
        // V008's frozen columns.
        stage_label: "Understand & scope",
        stage_index: 1,
        stage_total: 1,
        status: "coding",
        loop_seq: run.loopSeq,
      });
    });

    it("is reachable through the workspace's own run listing", async () => {
      const owner = await api.signUp();
      const seeded = await seedIngestBench(api, owner);
      const run = await openRun(seeded);

      const page = bodyOf<{ items: { id: string; issueTitle: string }[] }>(
        await api
          .as(owner)("get", "/api/v1/runs?status=active")
          .set("X-Ouro-Tenant", seeded.workspace.slug)
          .expect(200),
      );

      expect(page.items.map((item) => item.id)).toContain(run.id);
    });
  });

  describe("the guard", () => {
    it.each([
      ["open a run", "post" as const, "/internal/runs"],
      ["a stage transition", "post" as const, "/internal/runs/{id}/stage-transitions"],
      ["an event batch", "post" as const, "/internal/runs/{id}/events"],
      ["a change-set report", "put" as const, "/internal/runs/{id}/files"],
      ["a commit report", "post" as const, "/internal/runs/{id}/commits"],
      ["a resource report", "post" as const, "/internal/runs/{id}/resources"],
    ])("refuses %s carrying no key", async (_name, method, path) => {
      const response = await api
        .anonymous(method, path.replace("{id}", "5eed0009-0000-4000-8000-000000000482"))
        .send({});

      expect(response.status).toBe(401);
      expect(bodyOf<ErrorEnvelope>(response).code).toBe("unauthenticated");
    });

    it("refuses a run that does not exist, whatever the principal", async () => {
      const refusal = bodyOf<ErrorEnvelope>(
        await as("executor", "post", "/internal/runs/5eed0009-0000-4000-8000-000000000999/events", {
          idempotencyKey: "k",
          events: [{ hint: 1, actor: "system", body: "x" }],
        }).expect(404),
      );

      expect(refusal.code).toBe(INGEST_ERRORS.runNotFound);
    });
  });
});
