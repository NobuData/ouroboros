import { readFileSync } from "node:fs";
import { join } from "node:path";

import type request from "supertest";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { memberOf } from "../../testing/registry.seed.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { seedIngestBench, seedReservableJob, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { RUN_EXPORT_BATCH, RUN_EXPORT_WATERMARK } from "./console.policy";
import type { RunConsoleResource, RunEventsPage } from "./console.resources";

/**
 * The Run Console's three reads against a migrated PostgreSQL (#304, AP.2), one block per
 * acceptance criterion:
 *
 *   * **Seeded payloads reproduce every element of the mockup** — over the committed
 *     development seeds themselves (`R__dev_seed_run_console.sql` and the seeds it stands on),
 *     applied the way `registry.seed.fixture.ts` applies them, so the page is asserted against
 *     the rows design review looks at rather than a copy of them.
 *   * **Offset resume is exact under concurrent ingest** — a writer posting batches through the
 *     real ingestion contract while a reader pages the tail with a small `limit`.
 *   * **`live` is false for terminal runs** — on the page and on the tail, with the cadence.
 *   * **The export matches AO.2's projection fixture byte for byte, and streams** — the golden
 *     lines are read out of `ouroboros-db/tests/lib/run-events-jsonl.sql` itself.
 *   * **The unpriced case returns null cost with a token count** — never `$0`.
 *   * **A run in another org returns 404** — on all three routes, as an id that never existed.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The simulator's credential — the principal whose runs carry R4's watermark. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** Where the committed migrations and the database's own test fixtures are. */
const DB_ROOT = join(__dirname, "..", "..", "..", "..", "ouroboros-db");

/**
 * The seeds mockup 10's `#482` is built from, in the order Flyway applies them (by description):
 * the workspace, the dashboard's runs and stage history, the farm's `forge-02` and job `#483`,
 * the providers and routing matrix (`implement-primary`'s `$2.50` cap), the console's own rows,
 * and the workflows (`standard-fix` v14, whose `implement` inherits the `implement` route).
 */
const CONSOLE_SEEDS = [
  "R__dev_seed.sql",
  "R__dev_seed_dashboard.sql",
  "R__dev_seed_farm.sql",
  "R__dev_seed_providers.sql",
  "R__dev_seed_routing.sql",
  "R__dev_seed_run_console.sql",
  "R__dev_seed_workflows.sql",
  "R__model_price_catalog.sql",
] as const;

/**
 * AO.2's golden JSONL lines, parsed out of the SQL fixture that pins them.
 *
 * @returns The lines, by `seq`, exactly as the fixture writes them.
 */
function goldenLines(): string[] {
  const text = readFileSync(join(DB_ROOT, "tests", "lib", "run-events-jsonl.sql"), "utf8");
  const lines = [...text.matchAll(/\$line\$(.*?)\$line\$/g)].map((match) => match[1]);

  if (lines.length === 0) {
    throw new Error("run-events-jsonl.sql no longer holds $line$-quoted golden lines.");
  }

  return lines;
}

/** Collect a streamed text body whatever its media type. */
function asText(test: request.Test): request.Test {
  return test.buffer(true).parse((response, done) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => (text += chunk));
    response.on("end", () => done(null, text));
  });
}

describe("the run console's reads", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Read as somebody, in a workspace named by slug. */
  function as(person: Person, slug: string, path: string): request.Test {
    return api.as(person)("get", path).set(TENANT_HEADER, slug);
  }

  /** Call the internal channel as the simulator. */
  function simulator(method: "post" | "put", path: string, body: object): request.Test {
    return api.anonymous(method, path).set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET).send(body);
  }

  // -----------------------------------------------------------------------------------------
  describe("over the development seed — mockup 10's #482", () => {
    let workspace: Workspace;
    let owner: Person;
    let runId: string;

    beforeEach(async () => {
      for (const seed of CONSOLE_SEEDS) {
        const text = readFileSync(join(DB_ROOT, "migrations", seed), "utf8").replaceAll(
          "${ouro_dev_seed}",
          "true",
        );
        await api.sql.query(text);
      }

      const { rows } = await api.sql.query<{ id: string; slug: string; name: string }>(
        `select "id", "slug", "name" from ${SCHEMA_NAME}.organization where "slug" = 'acme-robotics'`,
      );
      workspace = rows[0];
      owner = await memberOf(api, workspace, "owner");

      const runs = await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.runs where organization_id = $1 and issue_number = 482`,
        [workspace.id],
      );
      runId = runs.rows[0].id;
    });

    it("states every element of the page head, stepper and three cards", async () => {
      const response = await as(owner, workspace.slug, `/api/v1/runs/${runId}`).expect(200);
      const page = bodyOf<RunConsoleResource>(response);

      expect(response.headers["cache-control"]).toBe("private, no-cache");

      // Run Console · Loop #1847 / #482 — Fix flaky CAN-bus telemetry test
      // (●coding) (standard-fix v14) (claude-fable-5) elapsed 12m 40s · loop/482-canbus-flake
      expect(page.run).toMatchObject({
        id: runId,
        issueNumber: 482,
        issueTitle: "Fix flaky CAN-bus telemetry test",
        workflowTag: "standard-fix",
        model: "claude-fable-5",
        status: "coding",
      });
      expect(page.head).toMatchObject({
        loopSeq: 1847,
        workflowVersion: 14,
        branchName: "loop/482-canbus-flake",
        simulated: true,
        live: true,
        repository: { name: "helios-firmware" },
      });
      // Measured to `asOf`, from a start the seed put 760 s before it ran.
      expect(page.resources.wallClock.elapsedSeconds).toBeGreaterThanOrEqual(760);
      expect(page.resources.wallClock.elapsedSeconds).toBeLessThan(760 + 120);
      expect(page.resources.wallClock.finishedAt).toBeNull();

      // ✓Queued 0m04s ══ ✓Analyze 1m12s ══ ✓Plan 2m05s ══ ●Implement attempt 2/3 ── ○ …
      const stages = page.timeline.stages;
      expect(page.timeline).toMatchObject({
        workflowTag: "standard-fix",
        workflowVersion: 14,
        currentStageKey: "implement",
      });
      expect(stages.slice(0, 3).map((stage) => [stage.label, stage.durationSeconds])).toEqual([
        ["Queued", 4],
        ["Analyze", 72],
        ["Plan", 125],
      ]);
      expect(stages[3]).toMatchObject({
        stageKey: "implement",
        status: "active",
        attempt: 2,
        maxAttempts: 3,
        note: "attempt 1 failed tests — loop returned from gate ↺",
      });
      expect(stages[3].attempts[1].returnedFrom).toEqual({
        stageKey: "checks-green",
        kind: "gate",
        reason: "failed_tests",
      });
      expect(stages.slice(4).every((stage) => stage.status === "pending")).toBe(true);

      // CHANGES 3 files  telemetry_buf.c +38 −12 …  a41c9e2 · 7f03b8d · [will squash on merge]
      expect(page.changes.totals).toEqual({ files: 3, additions: 68, deletions: 15 });
      expect(page.changes.files.map((file) => [file.path, file.additions, file.deletions])).toEqual(
        [
          ["drivers/can/telemetry_buf.c", 38, 12],
          ["drivers/can/isr_fastpath.c", 9, 3],
          ["tests/telemetry/test_frame_order.c", 21, 0],
        ],
      );
      expect(page.changes.commits.map((commit) => [commit.shortSha, commit.subject])).toEqual([
        ["a41c9e2", "can: replace telemetry k_fifo with k_msgq + frame seq"],
        ["7f03b8d", "can: assign frame seq in ISR before enqueue"],
      ]);
      expect(page.changes.mergeStrategy).toBe("squash");

      // RESOURCES  212k/400k · $1.14/$2.50 · forge-02 reserved · 12m 40s
      expect(page.resources.tokens).toMatchObject({ used: 212_000, budget: 400_000 });
      expect(Number(page.resources.cost.costCents)).toBe(114);
      expect(page.resources.cost).toMatchObject({
        unpricedEvents: 0,
        capCents: 250,
        routeTag: "implement-primary",
      });
      expect(page.resources.farm).toMatchObject({ jobNumber: 483, runnerName: "forge-02" });

      // GUARDRAILS (clean) ✓ paths ✓ no CI ✓ secrets ○ review — Policy: standard-fix v14 · tenant acme-robotics
      expect(page.guardrails.status).toBe("clean");
      expect(page.guardrails.checks.map((check) => [check.check, check.verdict])).toEqual([
        ["allowed_paths", "pass"],
        ["ci_config", "pass"],
        ["secrets", "pass"],
        ["review_required", "not_applicable"],
      ]);
      expect(page.guardrails.policy).toEqual({
        workflowTag: "standard-fix",
        workflowVersion: 14,
        tenant: "acme-robotics",
      });
      expect(page.guardrails.secrets.recallClass).toBe("~70%");
    });

    it("answers the issue's diagram: ?after=7 → two entries, live, latestSeq 9, pollAfter 5", async () => {
      const response = await as(
        owner,
        workspace.slug,
        `/api/v1/runs/${runId}/events?after=7`,
      ).expect(200);
      const page = bodyOf<RunEventsPage>(response);

      expect(page).toMatchObject({
        after: 7,
        nextAfter: 9,
        latestSeq: 9,
        hasMore: false,
        live: true,
        elided: false,
        pollAfter: 5,
      });
      expect(page.entries.map((entry) => [entry.seq, entry.actor, entry.toolTag])).toEqual([
        [8, "tool", "edit_file"],
        [9, "tool", "run_tests"],
      ]);
      expect(response.headers["x-ouro-poll-after"]).toBe("5");
    });

    it("reads the whole nine-entry transcript from the start, typed and watermarked", async () => {
      const page = bodyOf<RunEventsPage>(
        await as(owner, workspace.slug, `/api/v1/runs/${runId}/events`).expect(200),
      );

      expect(page.entries.map((entry) => entry.actor)).toEqual([
        "plan",
        "tool",
        "model",
        "tool",
        "tool",
        "gate",
        "model",
        "tool",
        "tool",
      ]);
      expect(page.entries.every((entry) => entry.simulated)).toBe(true);
      expect(page.entries[2].modelId).toBe("claude-fable-5");
      expect(page.entries[3].payload).toMatchObject({ hunks: expect.any(Array) as unknown });
      // The plan note names no tool: the field is absent rather than null.
      expect(page.entries[0]).not.toHaveProperty("toolTag");
    });

    it("exports the store's projection, watermarked, byte for byte", async () => {
      const response = await asText(
        as(owner, workspace.slug, `/api/v1/runs/${runId}/transcript.jsonl`),
      ).expect(200);

      const { rows } = await api.sql.query<{ line: string }>(
        `select line from ${SCHEMA_NAME}.run_events_jsonl where run_id = $1 order by seq`,
        [runId],
      );

      expect(response.headers["content-type"]).toBe("application/x-ndjson; charset=utf-8");
      expect(response.headers["content-disposition"]).toBe('inline; filename="loop-1847.jsonl"');
      expect(response.body).toBe(
        `${RUN_EXPORT_WATERMARK}\n${rows.map((row) => `${row.line}\n`).join("")}`,
      );
    });

    it("is readable by every role the workspace has", async () => {
      for (const role of ["admin", "member", "viewer"] as const) {
        const person = await memberOf(api, workspace, role);

        await as(person, workspace.slug, `/api/v1/runs/${runId}`).expect(200);
        await as(person, workspace.slug, `/api/v1/runs/${runId}/events`).expect(200);
        await as(person, workspace.slug, `/api/v1/runs/${runId}/transcript.jsonl`).expect(200);
      }
    });

    it("answers another org's run on all three routes as one that never existed", async () => {
      const stranger = await api.signIn();
      const elsewhere = await api.workspace(stranger);
      const absent = "5eed0009-0000-4000-8000-000000000999";

      for (const suffix of ["", "/events", "/transcript.jsonl"]) {
        const foreign = await as(stranger, elsewhere.slug, `/api/v1/runs/${runId}${suffix}`).expect(
          404,
        );
        const missing = await as(
          stranger,
          elsewhere.slug,
          `/api/v1/runs/${absent}${suffix}`,
        ).expect(404);

        expect(bodyOf<ErrorEnvelope>(foreign)).toEqual({
          code: "run_not_found",
          message: "No such run.",
          details: { runId },
        });
        expect(bodyOf<ErrorEnvelope>(missing).code).toBe("run_not_found");
        expect(bodyOf<ErrorEnvelope>(missing).message).toBe(bodyOf<ErrorEnvelope>(foreign).message);
        // Refusals carry no polling contract.
        expect(foreign.headers["x-ouro-poll-after"]).toBeUndefined();
      }
    });

    it("refuses a cursor past the end with where the end is", async () => {
      const response = await as(
        owner,
        workspace.slug,
        `/api/v1/runs/${runId}/events?after=10`,
      ).expect(422);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: "run_events_cursor_out_of_range",
        details: { latestSeq: 9 },
      });
    });

    it("goes quiet when the run is terminal — live false on the page and the tail", async () => {
      await api.sql.query(
        `update ${SCHEMA_NAME}.runs set status = 'failed', finished_at = now() where id = $1`,
        [runId],
      );

      const page = bodyOf<RunConsoleResource>(
        await as(owner, workspace.slug, `/api/v1/runs/${runId}`).expect(200),
      );
      const tail = await as(owner, workspace.slug, `/api/v1/runs/${runId}/events?after=9`).expect(
        200,
      );

      expect(page.head.live).toBe(false);
      expect(page.resources.wallClock.finishedAt).not.toBeNull();
      expect(bodyOf<RunEventsPage>(tail)).toMatchObject({
        live: false,
        entries: [],
        pollAfter: 15,
      });
      expect(tail.headers["x-ouro-poll-after"]).toBe("15");
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("over runs the simulator opens", () => {
    /** A workspace, its owner, and a run opened through the ingestion contract. */
    interface Scene {
      readonly owner: Person;
      readonly bench: IngestBench;
      readonly run: RunOpenedResource;
    }

    /**
     * Open a run as the simulator — so it carries R4's watermark — in a fresh workspace.
     *
     * @returns The scene.
     */
    async function scene(): Promise<Scene> {
      const owner = await api.signUp();
      const bench = await seedIngestBench(api, owner);
      const run = bodyOf<RunOpenedResource>(
        await simulator("post", "/internal/runs", {
          idempotencyKey: "open-1",
          ...bench.open,
        }).expect(201),
      );

      return { owner, bench, run };
    }

    /** GET a console path as the scene's owner. */
    function read(at: Scene, path: string): request.Test {
      return as(at.owner, at.bench.workspace.slug, `/api/v1/runs/${at.run.id}${path}`);
    }

    it("exports AO.2's fixture transcript as the fixture's own bytes", async () => {
      // The golden lines are inputs as well as the expectation: each is parsed back into the
      // row it was projected from and appended, and the export must reproduce it exactly.
      const at = await scene();
      const golden = goldenLines();

      for (const line of golden) {
        const entry = JSON.parse(line) as Record<string, unknown>;

        await api.sql.query(
          `insert into ${SCHEMA_NAME}.run_events
             (run_id, ts, actor, stage_key, attempt, tool_tag, model_id, body, payload)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
          [
            at.run.id,
            entry.ts,
            entry.actor,
            entry.stage_key ?? null,
            entry.attempt ?? null,
            entry.tool_tag ?? null,
            entry.model_id ?? null,
            entry.body ?? null,
            entry.payload === undefined ? null : JSON.stringify(entry.payload),
          ],
        );
      }

      const response = await asText(read(at, "/transcript.jsonl")).expect(200);

      expect(response.body).toBe(
        `${RUN_EXPORT_WATERMARK}\n${golden.map((line) => `${line}\n`).join("")}`,
      );
    });

    it("writes no watermark on a run no simulator opened", async () => {
      const at = await scene();
      await api.sql.query(`update ${SCHEMA_NAME}.runs set simulated = false where id = $1`, [
        at.run.id,
      ]);
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.run_events (run_id, actor, body) values ($1, 'system', 'hello')`,
        [at.run.id],
      );

      const response = await asText(read(at, "/transcript.jsonl")).expect(200);
      const lines = String(response.body).split("\n");

      expect(lines[0]).toMatch(/^\{"seq": 1, /);
      expect(String(response.body)).not.toContain(RUN_EXPORT_WATERMARK);
    });

    it("streams a transcript several batches long, every line once and in order", async () => {
      const at = await scene();
      const count = RUN_EXPORT_BATCH * 2 + 17;

      await api.sql.query(
        `insert into ${SCHEMA_NAME}.run_events (run_id, actor, body)
         select $1, 'system', 'entry ' || n from generate_series(1, $2) as n`,
        [at.run.id, count],
      );

      const response = await asText(read(at, "/transcript.jsonl")).expect(200);
      const lines = String(response.body).trimEnd().split("\n");

      // Streamed rather than buffered: no length was known when the headers went out.
      expect(response.headers["transfer-encoding"]).toBe("chunked");
      expect(response.headers["content-length"]).toBeUndefined();
      expect(lines[0]).toBe(RUN_EXPORT_WATERMARK);
      expect(lines.slice(1).map((line) => (JSON.parse(line) as { seq: number }).seq)).toEqual(
        Array.from({ length: count }, (_, index) => index + 1),
      );
    });

    it("resumes exactly under concurrent ingest — no gaps, no duplicates", async () => {
      const at = await scene();
      const batches = 25;
      const perBatch = 4;
      let writing = true;

      // The writer: sequential batches through the real contract, hints rising, as an executor
      // posts them.
      const writer = (async () => {
        for (let batch = 0; batch < batches; batch += 1) {
          await simulator("post", `/internal/runs/${at.run.id}/events`, {
            idempotencyKey: `batch-${String(batch)}`,
            events: Array.from({ length: perBatch }, (_, index) => ({
              hint: batch * perBatch + index + 1,
              actor: "system",
              body: `entry ${String(batch * perBatch + index + 1)}`,
            })),
          }).expect(200);
        }
        writing = false;
      })();

      // The reader: a small page, advancing only by what the server said, while the writer runs.
      const seen: number[] = [];
      let cursor = 0;
      let reads = 0;

      for (;;) {
        const page = bodyOf<RunEventsPage>(
          await read(at, `/events?after=${String(cursor)}&limit=3`).expect(200),
        );
        reads += 1;

        seen.push(...page.entries.map((entry) => entry.seq));
        expect(page.nextAfter).toBeLessThanOrEqual(page.latestSeq);
        cursor = page.nextAfter;

        if (!writing && !page.hasMore && cursor === batches * perBatch) break;
      }

      await writer;

      expect(seen).toEqual(Array.from({ length: batches * perBatch }, (_, index) => index + 1));
      expect(reads).toBeGreaterThan(1);
    });

    it("answers unpriced spend with a token count and a null cost — never $0", async () => {
      const at = await scene();

      await simulator("post", `/internal/runs/${at.run.id}/resources`, {
        idempotencyKey: "spend-1",
        spend: { provider: "ollama", model: "qwen3-coder", tokensIn: 1_500, tokensOut: 500 },
      }).expect(200);

      const response = await read(at, "").expect(200);
      const page = bodyOf<RunConsoleResource>(response);

      expect(page.resources.tokens.used).toBe(2_000);
      expect(page.resources.cost.costCents).toBeNull();
      expect(page.resources.cost.unpricedEvents).toBe(1);
      expect(response.text).not.toMatch(/"costCents":"0/);
    });

    it("omits the farm row for a run holding no reservation, and states one it holds", async () => {
      const at = await scene();

      const before = bodyOf<RunConsoleResource>(await read(at, "").expect(200));
      expect(before.resources).not.toHaveProperty("farm");

      const job = await seedReservableJob(api, at.bench);
      await simulator("post", `/internal/runs/${at.run.id}/resources`, {
        idempotencyKey: "reserve-1",
        reservedBuildJob: job,
      }).expect(200);

      const after = bodyOf<RunConsoleResource>(await read(at, "").expect(200));
      // Queued and not yet taken by any runner: the row is drawn, and names no runner.
      expect(after.resources.farm).toEqual({
        buildJobId: job,
        jobNumber: 483,
        jobStatus: "queued",
        runnerName: null,
      });
    });

    it("reads an empty run honestly: no stages, no changes, unevaluated guardrails", async () => {
      const at = await scene();

      const page = bodyOf<RunConsoleResource>(await read(at, "").expect(200));

      expect(page.timeline.stages).toEqual([]);
      expect(page.timeline.currentStageKey).toBeNull();
      expect(page.changes.totals).toEqual({ files: 0, additions: 0, deletions: 0 });
      expect(page.resources.tokens).toMatchObject({ used: 0, budget: null });
      expect(page.resources.cost).toMatchObject({ costCents: null, capCents: null });
      expect(page.guardrails.status).toBe("unevaluated");
      expect(page.head.simulated).toBe(true);
    });
  });
});
