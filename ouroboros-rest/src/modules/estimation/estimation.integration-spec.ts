import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME, type NewIssueEstimate } from "../db/schema";
import { ENGINE_ESTIMATE_BODY } from "../engine/engine.fixture";
import { seedRoutingBench, type RoutingBench } from "../routing/workspace.fixture";
import { EstimationOrchestrator } from "./estimation.orchestrator";
import { EstimationRepository } from "./estimation.repository";
import { EstimationSweeper } from "./estimation.sweeper";

/**
 * The pipeline against a migrated database and a listening engine
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * The unit suites run this code over recorded statements and stand-ins, which is what makes
 * this one necessary: **every acceptance criterion this ticket has is a claim about what
 * PostgreSQL holds afterwards**, and V026 is a table nothing in this service had ever written
 * a row of before this ticket.
 *
 *   * *A newly synced issue reaches `sized` end to end with no manual action* — through the
 *     real engine client, the real `POST /v0/estimate` parse, V026's two document grammars,
 *     its five efforts, its confidence bounds and decision **K10**'s provenance constraint. A
 *     unit test cannot say whether the row the translation produced is a row the server takes.
 *   * *Engine down → `needs_human` with an honest trace naming the failure; the recovery sweep
 *     re-processes stale `estimating` rows once the engine returns.* Both halves need a real
 *     row to be left behind and found again.
 *   * *Concurrent estimation of the same issue produces sequential versions with no deadlock.*
 *     This is the one that cannot be faked at all: it is `issue_estimates_issue_version_key`
 *     and V026's monotonicity trigger doing their jobs while two transactions race, and the
 *     harness has to be a real one.
 *   * *Every persisted estimate carries non-null trace provenance.*
 *
 * ---------------------------------------------------------------------------
 * **The engine is a listening HTTP server rather than a stubbed client.** `EngineClient` takes
 * its `fetch` as a constructor parameter so its own suite can drive it over a function, but a
 * suite about *persistence* wants the whole leg: `OURO_ENGINE_URL` points at the server below,
 * the shared secret is checked on it, and the body that reaches V026 is one that went over a
 * socket and back through the real zod parse. What that catches is a `snake_case` key nobody
 * translated, which is precisely the failure between this ticket and #105.
 *
 * **The pipeline is driven from the injector rather than by waiting for the sweeper.** The
 * loop's own behaviour is `estimation.sweeper.spec.ts`'s, under fake timers; the harness is
 * started with a day-long sweep interval so the application's own loop cannot fire a competing
 * sweep mid-test.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** One `issue_estimates` row, as an assertion reads it. */
interface StoredEstimate {
  version: number;
  effort: string;
  confidence: number;
  suggested_workflow: string;
  routed_model: string;
  breakdown: Record<string, unknown>;
  risk: string;
  risk_note: string;
  trace: Record<string, unknown>;
  created_at: Date;
}

/** An engine a test scripts, listening on a real port. */
interface EngineStub {
  /** Where it is, as `OURO_ENGINE_URL` wants it. */
  readonly url: string;
  /** Every request body it received, parsed. */
  readonly requests: Record<string, unknown>[];
  /** Answer the next `n` calls with a status and body of the test's choosing. */
  respond(handler: (attempt: number) => { status: number; body: unknown }): void;
  /** Stop listening. */
  stop(): Promise<void>;
}

/**
 * Start an engine that answers whatever a test says.
 *
 * @returns The stub, already listening on a loopback port.
 */
async function startEngine(): Promise<EngineStub> {
  const requests: Record<string, unknown>[] = [];
  let handler = (_attempt: number) => ({ status: 200, body: ENGINE_ESTIMATE_BODY as unknown });

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);

      const answer = handler(requests.length);

      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    respond: (next) => {
      handler = next;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("the estimation pipeline, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  let orchestrator: EstimationOrchestrator;
  let sweeper: EstimationSweeper;

  beforeAll(async () => {
    engine = await startEngine();
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      // A day, so neither background loop can fire in the middle of a test.
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
      OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS: "86400",
    });

    orchestrator = api.nest.get(EstimationOrchestrator);
    sweeper = api.nest.get(EstimationSweeper);
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  beforeEach(() => {
    engine.requests.length = 0;
    engine.respond(() => ({ status: 200, body: ENGINE_ESTIMATE_BODY }));
  });

  afterEach(async () => {
    await api.truncate();
  });

  /**
   * A workspace with routing configured and one mirrored, unsized issue.
   *
   * The routing bench is Z.6's, unchanged: its `implement` route resolves to `claude-fable-5`
   * and its `docs` route to `qwen3-coder:32b`, which is exactly the two-key `model_defaults`
   * map `estimation.context.ts` builds. Using it rather than a private copy is what keeps this
   * suite asserting against the *same* rows a routing suite does.
   *
   * @param number - The issue number, for a suite that wants two.
   * @returns The workspace and the issue's row id.
   */
  async function mirroredIssue(number = 485): Promise<{ bench: RoutingBench; issueId: string }> {
    const bench = await seedRoutingBench(api, await api.signIn());

    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [bench.id],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true) returning id`,
      [orgs[0].id],
    );
    const { rows: issues } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels,
               gh_created_at, gh_updated_at, gh_url, sizing_status)
       values ($1, $2, $3::int, 'I2C bus lockup after IMU sleep/wake cycle',
               'After entering low-power sleep and waking the BMI270, the bus locks up.',
               'open', '["bug","i2c"]'::jsonb, now(), now(),
               'https://github.com/acme-robotics/helios-firmware/issues/' || $3::int::text,
               'unsized')
       returning id`,
      [bench.id, repos[0].id, number],
    );

    return { bench, issueId: issues[0].id };
  }

  /**
   * Leave an issue claimed an hour ago and abandoned — what a process killed mid-estimate
   * leaves behind.
   *
   * **The touch trigger has to be stepped around, and that is the point.** V014's
   * `github_issues_touch_updated_at` stamps `updated_at` from the server clock and *ignores
   * whatever the statement supplied* — which is exactly why the sweep can trust that column as
   * the age of the claim, and exactly why a test cannot back-date one with an ordinary
   * `update`. Disabling the trigger for the length of one transaction is the smallest way to
   * arrange the state; the `alter` is inside the transaction, so a failure mid-test cannot
   * leave the trigger off for the next one.
   *
   * @param issueId - The issue to strand.
   * @param age - How long ago it was claimed, as a PostgreSQL interval.
   */
  async function strand(issueId: string, age = "1 hour"): Promise<void> {
    const client = await api.sql.connect();

    try {
      await client.query("begin");
      await client.query(
        `alter table ${SCHEMA_NAME}.github_issues disable trigger github_issues_touch_updated_at`,
      );
      await client.query(
        `update ${SCHEMA_NAME}.github_issues
            set sizing_status = 'estimating', updated_at = now() - $2::interval
          where id = $1`,
        [issueId, age],
      );
      await client.query(
        `alter table ${SCHEMA_NAME}.github_issues enable trigger github_issues_touch_updated_at`,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** What the issue's `sizing_status` column says now. */
  async function statusOf(issueId: string): Promise<string> {
    const { rows } = await api.sql.query<{ sizing_status: string }>(
      `select sizing_status from ${SCHEMA_NAME}.github_issues where id = $1`,
      [issueId],
    );

    return rows[0].sizing_status;
  }

  /** Every estimate stored for an issue, newest version last. */
  async function estimatesOf(issueId: string): Promise<StoredEstimate[]> {
    const { rows } = await api.sql.query<StoredEstimate>(
      `select version, effort, confidence, suggested_workflow, routed_model, breakdown,
              risk, risk_note, trace, created_at
         from ${SCHEMA_NAME}.issue_estimates
        where github_issue_id = $1
        order by version asc`,
      [issueId],
    );

    return rows;
  }

  describe("an issue reaching `sized`", () => {
    it("stores the estimate the engine answered and flips the status", async () => {
      const { issueId } = await mirroredIssue();

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("sized");

      const [stored] = await estimatesOf(issueId);
      expect(stored).toMatchObject({
        version: 1,
        effort: "m",
        confidence: 92,
        suggested_workflow: "standard-fix",
        routed_model: "claude-fable-5",
        risk: "low",
      });
      expect(stored.risk_note).toContain("I²C driver path");
    });

    it("writes both jsonb documents in the shapes V026's CHECKs accept", async () => {
      // The value of asserting this *here* is that the grammars are functions in the database:
      // a camelCase key or a missing one is a `23514` on `issue_estimates_breakdown_shape`,
      // and this row got past both of them.
      const { issueId } = await mirroredIssue();

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      const [stored] = await estimatesOf(issueId);

      expect(stored.breakdown).toEqual({
        files: ENGINE_ESTIMATE_BODY.breakdown.files,
        est_tokens: 180_000,
        cycle_min: 12,
        cycle_max: 18,
        est_minutes: 23,
      });
      expect(stored.trace).toMatchObject({
        estimator: "heuristic-v0",
        tokens_used: 41_000,
        signals: ENGINE_ESTIMATE_BODY.trace.signals,
      });
    });

    it("carries non-null trace provenance — decision K10", async () => {
      const { issueId } = await mirroredIssue();

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      const [stored] = await estimatesOf(issueId);

      expect(stored.trace.estimator).toBe("heuristic-v0");
      // The column would have refused a blank one; asserting the value is what says the
      // constraint was satisfied by an answer rather than by a placeholder.
      expect(String(stored.trace.estimator)).not.toHaveLength(0);
    });

    it("stamps `sized_at` as an instant the trace grammar accepts", async () => {
      const { issueId } = await mirroredIssue();

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      const [stored] = await estimatesOf(issueId);

      expect(String(stored.trace.sized_at)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
      );
    });

    it("sends the models this workspace's routing resolved, not a configured list", async () => {
      // The Z.4 amendment's remaining half (#197, decision M6). `implement` resolves to
      // `coder-max` → `claude-fable-5` and `docs` to `local-docs` → `qwen3-coder:32b` on the
      // routing bench, and those are the values the engine is offered.
      const { issueId } = await mirroredIssue();

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(engine.requests[0]).toMatchObject({
        issue: {
          number: 485,
          repo: "acme-robotics/helios-firmware",
          labels: ["bug", "i2c"],
        },
        context: {
          workflow_tags: ["standard-fix", "docs-loop", "feature-loop", "deps-refresh"],
          model_defaults: { default: "claude-fable-5", docs: "qwen3-coder:32b" },
        },
      });
    });

    it("routes an estimate under the floor to needs_human, and stores it in full", async () => {
      const { issueId } = await mirroredIssue();
      engine.respond(() => ({
        status: 200,
        body: { ...ENGINE_ESTIMATE_BODY, confidence: 61, effort: "xl" },
      }));

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("needs_human");
      expect(await estimatesOf(issueId)).toMatchObject([{ confidence: 61, effort: "xl" }]);
    });
  });

  describe("re-estimation", () => {
    it("adds the next version rather than editing the one in force", async () => {
      // Decision K4. The predecessor has to still be there: the trace is only worth reading
      // beside the answer it replaced.
      const { issueId } = await mirroredIssue();

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      engine.respond(() => ({
        status: 200,
        body: { ...ENGINE_ESTIMATE_BODY, effort: "l", confidence: 80 },
      }));
      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await estimatesOf(issueId)).toMatchObject([
        { version: 1, effort: "m" },
        { version: 2, effort: "l" },
      ]);
    });

    it("produces sequential versions when the same issue is estimated concurrently", async () => {
      // The acceptance criterion, and the one that needs a real database: two transactions
      // computing `max(version) + 1` cannot both commit, because neither sees the other's
      // uncommitted row and `issue_estimates_issue_version_key` sees both. What resolves it is
      // the repository's retry, not a lock — so the property to assert is that both answers
      // landed, on distinct ascending versions, without a deadlock.
      const { issueId } = await mirroredIssue();

      // The orchestrator's queue de-duplicates by design — that is what it is for — so two
      // *simultaneous* writes are arranged one layer down, at the thing that actually races:
      // the repository, driven twice at once, which is what two processes doing this look like
      // to PostgreSQL. Reached through the injector rather than constructed, so the statements
      // under test are the application's own.
      const repository = api.nest.get(EstimationRepository);

      const row = (version: number): NewIssueEstimate => ({
        github_issue_id: issueId,
        version,
        effort: "m",
        confidence: 92,
        suggested_workflow: "standard-fix",
        routed_model: "claude-fable-5",
        breakdown: JSON.stringify({
          files: [],
          est_tokens: 1,
          cycle_min: 1,
          cycle_max: 2,
          est_minutes: 1,
        }),
        risk: "low",
        risk_note: "Concurrent write.",
        trace: JSON.stringify({
          estimator: "heuristic-v0",
          sized_at: new Date().toISOString(),
          tokens_used: 0,
          signals: [],
        }),
      });

      const versions = await Promise.all([
        repository.persist(issueId, "sized", row),
        repository.persist(issueId, "sized", row),
      ]);

      expect([...versions].sort((a, b) => a - b)).toEqual([1, 2]);
      expect((await estimatesOf(issueId)).map((stored) => stored.version)).toEqual([1, 2]);
    });
  });

  describe("when the engine is down", () => {
    it("gives up after one retry and leaves the issue to a person", async () => {
      const { issueId } = await mirroredIssue();
      engine.respond(() => ({ status: 503, body: { code: "unavailable", message: "no" } }));

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("needs_human");
      expect(engine.requests).toHaveLength(2);
    });

    it("stores no estimate at all for a failure", async () => {
      // There is nothing to store, and a fabricated row would put an effort chip on the
      // backlog table for an issue nothing sized.
      const { issueId } = await mirroredIssue();
      engine.respond(() => ({ status: 503, body: {} }));

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await estimatesOf(issueId)).toHaveLength(0);
    });

    it("refuses a body outside the /v0 contract rather than storing part of it", async () => {
      // The parse is the engine client's, and it is what stops a field that changed type from
      // reaching a column as an `undefined`.
      const { issueId } = await mirroredIssue();
      engine.respond(() => ({
        status: 200,
        body: { ...ENGINE_ESTIMATE_BODY, effort: "enormous" },
      }));

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("needs_human");
      expect(await estimatesOf(issueId)).toHaveLength(0);
    });
  });

  describe("the recovery sweep", () => {
    it("re-estimates a row a restart left in `estimating`", async () => {
      // The case the sweep exists for: a process that stopped existing between the claim and
      // the write. Arranged by writing the state that process would have left behind, and
      // ageing it past the threshold the way a real stranding would.
      const { issueId } = await mirroredIssue();

      await strand(issueId);

      const report = await orchestrator.sweep();
      await orchestrator.settled();

      expect(report).toMatchObject({ stale: 1, requeued: 1 });
      expect(await statusOf(issueId)).toBe("sized");
      expect(await estimatesOf(issueId)).toHaveLength(1);
    });

    it("leaves a row that has only just been claimed alone", async () => {
      const { issueId } = await mirroredIssue();

      await api.sql.query(
        `update ${SCHEMA_NAME}.github_issues set sizing_status = 'estimating' where id = $1`,
        [issueId],
      );

      expect(await orchestrator.sweep()).toMatchObject({ stale: 0, requeued: 0 });
      expect(await statusOf(issueId)).toBe("estimating");
    });

    it("touches nothing that is not `estimating`", async () => {
      const { issueId } = await mirroredIssue();

      // Old enough to be swept, and in the wrong status to be: the read's two predicates are
      // an `and`, and this is the half a `where updated_at < …` alone would get wrong.
      await strand(issueId);
      await api.sql.query(
        `update ${SCHEMA_NAME}.github_issues set sizing_status = 'needs_human' where id = $1`,
        [issueId],
      );

      expect(await orchestrator.sweep()).toMatchObject({ stale: 0 });
      expect(await statusOf(issueId)).toBe("needs_human");
    });

    it("recovers once the engine returns, having failed while it was down", async () => {
      // Both halves of the acceptance criterion, in order: engine down leaves `needs_human`,
      // and a row stranded mid-flight is re-processed when the engine is back.
      const { issueId } = await mirroredIssue();
      engine.respond(() => ({ status: 503, body: {} }));

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("needs_human");

      // Now the engine is back, and a row another process had claimed is still sitting there.
      engine.respond(() => ({ status: 200, body: ENGINE_ESTIMATE_BODY }));
      await strand(issueId);

      await sweeper.tick();
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("sized");
      expect(await estimatesOf(issueId)).toHaveLength(1);
    });
  });

  describe("a workspace with no routing", () => {
    it("leaves its issues `unsized` and calls no engine", async () => {
      // `issue_estimates.routed_model` is not null, so there is genuinely no estimate to
      // store. Deliberately not `needs_human`: nothing about the issue is the problem.
      const { bench, issueId } = await mirroredIssue();

      await api.sql.query(`delete from ${SCHEMA_NAME}.routes where organization_id = $1`, [
        bench.id,
      ]);

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("unsized");
      expect(engine.requests).toHaveLength(0);
      expect(await estimatesOf(issueId)).toHaveLength(0);
    });
  });
});
