import { Logger } from "@nestjs/common";

import {
  contractViolation,
  engineFailure,
  estimateAnswer,
  offContractAnswer,
  startEngineStub,
  type EngineStub,
} from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME, type NewIssueEstimate } from "../db/schema";
import { ENGINE_ESTIMATE_BODY } from "../engine/engine.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { seedRoutingBench, type RoutingBench } from "../routing/workspace.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { ESTIMATION_ERRORS } from "./estimation.errors";
import { ESTIMATION_ATTEMPTS_PER_WINDOW } from "./estimation.limiter";
import { MAX_ENGINE_ATTEMPTS, EstimationOrchestrator } from "./estimation.orchestrator";
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
 * **L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108)) added a describe block at
 * the foot**, and it is the same argument one level up: its two routes are the pipeline's only
 * external trigger, and three of its acceptance criteria are claims about what PostgreSQL holds
 * afterwards — *a new version (v+1)*, *`estimate-all` touches only non-`estimating` rows*, and
 * the role gates, which no unit spec can see because none of them goes through the router that
 * reads `@Roles()`. L.5 ([#109](https://github.com/NobuData/ouroboros/issues/109)) keeps the
 * pipeline's own matrix; this is the leg that proves the buttons are wired to it.
 *
 * **L.5 ([#109](https://github.com/NobuData/ouroboros/issues/109)) did two things to this
 * file.** It replaced the engine — see below — and it added the last describe block, which is
 * the matrix as a matrix: the cases above are each written where the ticket that needed them
 * put them, and what was missing was the statements that are true of *every* path at once.
 * Provenance is the clearest example. L.3 asserted it on the happy path, because that is the
 * row L.3 wrote; the criterion is *every persisted estimate*, and the only way to hold the
 * pipeline to that is to drive every path that writes one and then read the table with no
 * `where` clause on it.
 *
 * ---------------------------------------------------------------------------
 * **The engine is a listening HTTP server rather than a stubbed client.** `EngineClient` takes
 * its `fetch` as a constructor parameter so its own suite can drive it over a function, but a
 * suite about *persistence* wants the whole leg: `OURO_ENGINE_URL` points at the server below,
 * the shared secret is checked on it, and the body that reaches V026 is one that went over a
 * socket and back through the real zod parse. What that catches is a `snake_case` key nobody
 * translated, which is precisely the failure between this ticket and #105.
 *
 * **And it holds itself to the engine's published contract** —
 * `testing/engine.stub.fixture.ts`, L.5's other half. Until this ticket the stub answered
 * whatever a test typed, which meant a suite could assert against a body `ouroboros-engine`
 * could never send and still be green. Now every answer is validated against
 * `ouroboros-engine/openapi.yaml` on the way out and every request against it on the way in,
 * so a fake that has drifted from the contract is a red suite here rather than a `502` in
 * production. {@link EngineStub.violations} is asserted empty in `afterEach`, once, for all
 * of them.
 *
 * **The pipeline is driven from the injector rather than by waiting for the sweeper.** The
 * loop's own behaviour is `estimation.sweeper.spec.ts`'s, under fake timers; the harness is
 * started with a day-long sweep interval so the application's own loop cannot fire a competing
 * sweep mid-test.
 *
 * ---------------------------------------------------------------------------
 * ## The two deletions this suite was checked against
 *
 * L.5 asks for one thing that is not a test: *removing the stale sweep turns tests red;
 * removing the retry turns tests red — verified once, deliberately.* A suite nobody has watched
 * fail is a suite that passes everything, so both were done by hand on 2026-09-10, against this
 * file, and the results are recorded here rather than left as a claim:
 *
 *   * **`sweep()` returning `{stale: 0, requeued: 0, inFlight: 0}` without reading** — five
 *     red: *re-estimates a row a restart left in `estimating`*, *recovers once the engine
 *     returns, having failed while it was down*, *re-queues a whole batch of stranded rows*,
 *     *writes exactly one estimate for a row it recovers*, and *leaves non-null provenance on
 *     every estimate, whichever path wrote it* — the last one because the sweep is one of the
 *     four paths it drives, which is the point of driving all four.
 *   * **`MAX_ENGINE_ATTEMPTS` reduced to `1`** — two red: *gives up after one retry and leaves
 *     the issue to a person* (one call where two were expected) and *names the failure, both
 *     attempts and the issue in the log*.
 *
 * The second mutation reddens **only** those two, and the recovery cases stay green under it.
 * That is the result worth recording: a suite where every deletion reddens everything cannot
 * tell one mechanism from another, and a reader would learn nothing from a failure.
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

describe("the estimation pipeline, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  let orchestrator: EstimationOrchestrator;
  let sweeper: EstimationSweeper;

  beforeAll(async () => {
    engine = await startEngineStub();
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
    engine.reset();
  });

  afterEach(async () => {
    // Read first, truncate, assert last. An assertion that throws would skip whatever came
    // after it, and the one thing that must not be skipped is emptying the tables for the next
    // test — so the contract check is the last statement rather than the first.
    const unfaithful = [...engine.violations];

    await api.truncate();

    // Nothing in this suite may ask the stub for an answer `ouroboros-engine` could not give,
    // and nothing in the service may send it a request the engine would refuse. Asserted once
    // here rather than per test, because it is a property of the whole run.
    expect(unfaithful).toEqual([]);
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
   * A second issue in a workspace that already has one, `unsized`.
   *
   * L.4's fan-out needs a backlog rather than a row: *touches only non-`estimating` rows* is
   * not a claim any single-issue fixture can be held to. It finds the repository rather than
   * being handed one, because {@link mirroredIssue} creates exactly one and nothing else does.
   *
   * @param bench - The workspace, from {@link mirroredIssue}.
   * @param number - The issue number, unique within the repository.
   * @returns The new issue's row id.
   */
  async function addIssue(bench: RoutingBench, number: number): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels,
               gh_created_at, gh_updated_at, gh_url, sizing_status)
       select $1, repos.id, $2::int, 'Expose battery health over BLE GATT', 'A second issue.',
              'open', '["feature"]'::jsonb, now(), now(),
              'https://github.com/acme-robotics/helios-firmware/issues/' || $2::int::text,
              'unsized'
         from ${SCHEMA_NAME}.github_repos repos
         join ${SCHEMA_NAME}.github_orgs orgs on orgs.id = repos.org_id
        where orgs.organization_id = $1
        limit 1
       returning id`,
      [bench.id, number],
    );

    return rows[0].id;
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
      engine.respond(() => estimateAnswer({ confidence: 61, effort: "xl" }));

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

      engine.respond(() => estimateAnswer({ effort: "l", confidence: 80 }));
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
      engine.respond(() => engineFailure());

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("needs_human");
      expect(engine.requests).toHaveLength(2);
    });

    it("stores no estimate at all for a failure", async () => {
      // There is nothing to store, and a fabricated row would put an effort chip on the
      // backlog table for an issue nothing sized.
      const { issueId } = await mirroredIssue();
      engine.respond(() => engineFailure());

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await estimatesOf(issueId)).toHaveLength(0);
    });

    it("refuses a body outside the /v0 contract rather than storing part of it", async () => {
      // The parse is the engine client's, and it is what stops a field that changed type from
      // reaching a column as an `undefined`.
      const { issueId } = await mirroredIssue();
      // Off-contract on purpose, and the stub is told so — an unmarked answer this far
      // outside `/v0` is the stub's failure to report rather than the service's to survive.
      engine.respond(() => offContractAnswer());

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
      engine.respond(() => engineFailure());

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("needs_human");

      // Now the engine is back, and a row another process had claimed is still sitting there.
      engine.respond(() => estimateAnswer());
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

  describe("the re-estimation endpoints", () => {
    const SINGLE = (issueId: string): string => `/api/v1/backlog/${issueId}/estimate`;
    const ALL = "/api/v1/backlog/estimate-all";

    /**
     * A workspace with routing, one sized issue, and somebody in every role.
     *
     * The issue is driven to `sized` through the real pipeline first, because *re*-estimation
     * is what these routes do: a `v+1` asserted against an issue that had no `v1` would be an
     * insert dressed up as the criterion.
     *
     * @param number - The issue number, for a test that wants a second one.
     * @returns The workspace, the issue, and one member of each role.
     */
    async function sizedIssue(number = 485): Promise<{
      bench: RoutingBench;
      issueId: string;
      owner: Person;
      member: Person;
      viewer: Person;
    }> {
      const { bench, issueId } = await mirroredIssue(number);

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      const owner = await api.signIn({ email: `owner-${String(number)}@ouroboros.invalid` });
      const member = await api.signIn({ email: `member-${String(number)}@ouroboros.invalid` });
      const viewer = await api.signIn({ email: `viewer-${String(number)}@ouroboros.invalid` });

      await api.join(bench.id, owner, "owner");
      await api.join(bench.id, member, "member");
      await api.join(bench.id, viewer, "viewer");

      return { bench, issueId, owner, member, viewer };
    }

    it("versions the estimate rather than editing the one in force", async () => {
      // The ticket's first acceptance criterion, end to end: a member presses the panel's
      // button, and what lands is `v+1` beside `v1` rather than over it.
      const { bench, issueId, member } = await sizedIssue();

      expect(await estimatesOf(issueId)).toHaveLength(1);

      const accepted = await api
        .as(member)("post", SINGLE(issueId))
        .set(TENANT_HEADER, bench.slug)
        .expect(202);

      expect(bodyOf(accepted)).toEqual({
        issueId,
        number: 485,
        repository: "acme-robotics/helios-firmware",
        status: "estimating",
      });

      // The status it answered with is already true — the row is claimed before the work is
      // queued, so a client that re-reads the issue sees the same word.
      expect(await statusOf(issueId)).toBe("estimating");

      await orchestrator.settled();

      const versions = (await estimatesOf(issueId)).map((estimate) => estimate.version);

      expect(versions).toEqual([1, 2]);
      expect(await statusOf(issueId)).toBe("sized");
    });

    it("refuses a double-fire with the current status, and queues nothing twice", async () => {
      const { bench, issueId, member } = await sizedIssue();

      await api.as(member)("post", SINGLE(issueId)).set(TENANT_HEADER, bench.slug).expect(202);

      const refused = await api
        .as(member)("post", SINGLE(issueId))
        .set(TENANT_HEADER, bench.slug)
        .expect(409);
      const envelope = bodyOf<ErrorEnvelope>(refused);

      expect(envelope.code).toBe(ESTIMATION_ERRORS.alreadyEstimating);
      expect(envelope.details).toEqual({ status: "estimating" });

      await orchestrator.settled();

      // One press, one version. A duplicate would have spent a second engine call to write the
      // same answer again.
      expect(await estimatesOf(issueId)).toHaveLength(2);
    });

    it("answers 404 for an issue in another workspace", async () => {
      // Cross-org id → 404, the criterion that has to be true against a real row: the issue
      // exists, and it is not this caller's to see.
      const theirs = await sizedIssue(485);
      const mine = await sizedIssue(486);

      await api
        .as(mine.member)("post", SINGLE(theirs.issueId))
        .set(TENANT_HEADER, mine.bench.slug)
        .expect(404);

      // And it was left entirely alone.
      expect(await statusOf(theirs.issueId)).toBe("sized");
    });

    it("answers 404 for an id that names nothing", async () => {
      const { bench, member } = await sizedIssue();

      const refused = await api
        .as(member)("post", SINGLE("5eed0018-0000-4000-8000-000000000999"))
        .set(TENANT_HEADER, bench.slug)
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(ESTIMATION_ERRORS.issueNotFound);
    });

    it("answers 422 for a path carrying GitHub's issue number", async () => {
      // The ticket's own diagram writes `POST /backlog/485/estimate`, and a reader could
      // transcribe that into a path. It is refused before a statement is issued.
      const { bench, member } = await sizedIssue();

      await api.as(member)("post", SINGLE("485")).set(TENANT_HEADER, bench.slug).expect(422);
    });

    it("lets a member re-estimate one issue and refuses them the whole backlog", async () => {
      // The role split, through the router that reads `@Roles()` — which is the only place it
      // is visible. Delete either decorator and every unit spec in this module still passes.
      const { bench, issueId, member } = await sizedIssue();

      await api.as(member)("post", SINGLE(issueId)).set(TENANT_HEADER, bench.slug).expect(202);

      const refused = await api.as(member)("post", ALL).set(TENANT_HEADER, bench.slug).expect(403);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("forbidden");

      await orchestrator.settled();
    });

    it("refuses a viewer both, and a stranger the way a missing workspace is refused", async () => {
      const { bench, issueId, viewer } = await sizedIssue();
      const stranger = await api.signIn({ email: "stranger@ouroboros.invalid" });

      await api.as(viewer)("post", SINGLE(issueId)).set(TENANT_HEADER, bench.slug).expect(403);
      await api.as(viewer)("post", ALL).set(TENANT_HEADER, bench.slug).expect(403);

      // A stranger is told nothing about whether the workspace exists.
      await api.as(stranger)("post", ALL).set(TENANT_HEADER, bench.slug).expect(404);
    });

    it("answers 401 to a browser with no session", async () => {
      await api.anonymous("post", ALL).expect(401);
      await api.anonymous("post", SINGLE("5eed0018-0000-4000-8000-000000000485")).expect(401);
    });

    it("fans out over the backlog, touching only rows that are not already estimating", async () => {
      // The second acceptance criterion, against three real rows: one sized, one stranded
      // `estimating`, one unsized. Only the two eligible ones move, and the count says so.
      const { bench, issueId, owner } = await sizedIssue();
      const second = await addIssue(bench, 486);
      const third = await addIssue(bench, 487);

      await strand(third);

      const accepted = await api.as(owner)("post", ALL).set(TENANT_HEADER, bench.slug).expect(202);

      expect(bodyOf(accepted)).toEqual({ enqueued: 2, skipped: 1, total: 3 });

      await orchestrator.settled();

      expect(await estimatesOf(issueId)).toHaveLength(2);
      expect(await estimatesOf(second)).toHaveLength(1);
    });

    it("refuses a second fan-out while the first is running", async () => {
      const { bench, owner } = await sizedIssue();

      await api.as(owner)("post", ALL).set(TENANT_HEADER, bench.slug).expect(202);

      const refused = await api.as(owner)("post", ALL).set(TENANT_HEADER, bench.slug).expect(409);
      const envelope = bodyOf<ErrorEnvelope>(refused);

      expect(envelope.code).toBe(ESTIMATION_ERRORS.backlogEstimating);
      expect(envelope.details).toEqual({ estimating: 1 });

      await orchestrator.settled();
    });

    it("answers zeros for a workspace that mirrors nothing", async () => {
      // *Empty* and *busy* are different states, and only one of them is a 409.
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const accepted = await api
        .as(owner)("post", ALL)
        .set(TENANT_HEADER, workspace.slug)
        .expect(202);

      expect(bodyOf(accepted)).toEqual({ enqueued: 0, skipped: 0, total: 0 });
    });

    it("rate-limits a hammering caller, and says how long to wait", async () => {
      // The fifth criterion. Every request that reaches the operation counts, which is what
      // makes a caller collecting `409`s visible to the limit at all.
      const { bench, issueId, member } = await sizedIssue();

      for (let attempt = 0; attempt < ESTIMATION_ATTEMPTS_PER_WINDOW; attempt += 1) {
        await api.as(member)("post", SINGLE(issueId)).set(TENANT_HEADER, bench.slug);
      }

      const refused = await api
        .as(member)("post", SINGLE(issueId))
        .set(TENANT_HEADER, bench.slug)
        .expect(429);
      const envelope = bodyOf<ErrorEnvelope>(refused);

      expect(envelope.code).toBe(ESTIMATION_ERRORS.rateLimited);
      expect(envelope.details.retryAfterSeconds).toBeGreaterThan(0);

      await orchestrator.settled();
    });
  });

  /**
   * The matrix, as a matrix — L.5 ([#109](https://github.com/NobuData/ouroboros/issues/109)).
   *
   * Everything above is written where the ticket that needed it put it: L.3's cases are about
   * the rows L.3 writes, L.4's are about the two buttons L.4 added. What that leaves out is the
   * statements that are true of the *whole* pipeline rather than of one path through it, and
   * those are the ones this ticket is for. Four of them:
   *
   *   * **Provenance is a claim about every persisted estimate**, not about the happy path's.
   *     The only honest way to hold the pipeline to it is to drive every path that writes a row
   *     and then read `issue_estimates` with no `where` clause.
   *   * **The contract runs in both directions.** The stub refuses to serve a body the engine
   *     could not send; this block asserts the other half — that what this service sends is a
   *     body the engine would accept.
   *   * **A failure is honest.** *Engine down → `needs_human` with a trace naming the failure*
   *     is two claims, and the second one is about the log, which is the only place a failure
   *     is recorded (`issue_estimates` deliberately holds no row for one).
   *   * **Concurrency is a property of the pipeline, not of one statement.** The repository's
   *     race is asserted above at the altitude it happens; these are the two shapes a *person*
   *     can produce — two presses at once on one issue, and a fan-out over a whole backlog.
   */
  describe("the pipeline's own matrix", () => {
    /**
     * A member of the workspace an issue is in, for the cases that press a button.
     *
     * @param bench - The workspace.
     * @param email - Their address, unique per test.
     * @returns The signed-in person, already joined as a `member`.
     */
    async function memberOf(bench: RoutingBench, email: string): Promise<Person> {
      const person = await api.signIn({ email });

      await api.join(bench.id, person, "member");

      return person;
    }

    /** Every estimate in the database, whichever issue it belongs to. */
    async function everyEstimate(): Promise<{ trace: Record<string, unknown> }[]> {
      const { rows } = await api.sql.query<{ trace: Record<string, unknown> }>(
        `select trace from ${SCHEMA_NAME}.issue_estimates`,
      );

      return rows;
    }

    it("sends the engine a body the engine's own contract accepts", async () => {
      // The stub would have answered `422` and recorded a violation, so this cannot fail
      // alone — but a suite that only ever asserted the *absence* of a violation would not say
      // what was checked. This is the criterion written out: the request that went over the
      // socket is a valid `EstimateRequest` against the committed document.
      const { issueId } = await mirroredIssue();

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(engine.requests).toHaveLength(1);
      expect(contractViolation("request", engine.requests[0])).toBeUndefined();
    });

    it("leaves non-null provenance on every estimate, whichever path wrote it", async () => {
      // Decision K10 across the matrix rather than on one row. Four paths write an estimate,
      // and all four are driven here: a first sizing, a re-estimate, an answer under the
      // confidence floor, and a row the recovery sweep picked up. The read at the foot has no
      // `where` clause on purpose — *every persisted estimate* is the criterion, and a query
      // that named an issue would only be re-asserting the paths it remembered.
      const { bench, issueId } = await mirroredIssue();
      const underFloor = await addIssue(bench, 486);
      const stranded = await addIssue(bench, 487);

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      engine.respond(() => estimateAnswer({ effort: "l" }));
      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      engine.respond(() => estimateAnswer({ confidence: 61 }));
      orchestrator.enqueue(underFloor);
      await orchestrator.settled();

      engine.respond(() => estimateAnswer());
      await strand(stranded);
      await orchestrator.sweep();
      await orchestrator.settled();

      const written = await everyEstimate();

      expect(written).toHaveLength(4);

      for (const { trace } of written) {
        expect(String(trace.estimator)).not.toHaveLength(0);
        expect(trace.sized_at).toEqual(expect.any(String));
      }

      // And the same thing asked of the server, which is where the constraint lives: a `null`
      // or blank estimator is a row V026 would not have taken, so a count of zero here says
      // the CHECK was satisfied by an answer rather than by a placeholder.
      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count
           from ${SCHEMA_NAME}.issue_estimates
          where trace->>'estimator' is null or btrim(trace->>'estimator') = ''`,
      );

      expect(rows[0].count).toBe("0");
    });

    it("names the failure, both attempts and the issue in the log", async () => {
      // The other half of *engine down → needs_human with an honest trace naming the failure*.
      // `issue_estimates` holds nothing for a failure by design, so the log is the trace, and
      // a pipeline that failed silently would satisfy every other assertion in this file.
      const failed = jest.spyOn(Logger.prototype, "error");
      const gaveUp = jest.spyOn(Logger.prototype, "warn");
      const { issueId } = await mirroredIssue();

      engine.respond(() => engineFailure());

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("needs_human");

      // The counts are literals, deliberately. Reading MAX_ENGINE_ATTEMPTS into the
      // expectation would make this case agree with whatever the constant says — including
      // `1`, which is the deletion it exists to catch — so the number is written out and the
      // constant is asserted separately to say which number it is.
      expect(MAX_ENGINE_ATTEMPTS).toBe(2);
      expect(engine.requests).toHaveLength(2);
      expect(failed).toHaveBeenCalledWith(
        expect.stringContaining(
          "Estimating acme-robotics/helios-firmware#485 failed (attempt 1 of 2)",
        ),
        expect.anything(),
      );
      expect(failed).toHaveBeenCalledWith(
        expect.stringContaining(
          "Estimating acme-robotics/helios-firmware#485 failed (attempt 2 of 2)",
        ),
        expect.anything(),
      );
      expect(gaveUp).toHaveBeenCalledWith(
        expect.stringContaining("acme-robotics/helios-firmware#485 needs a human"),
      );
    });

    it("sizes an issue on the next press once the engine is back", async () => {
      // *Recovery on the next trigger*, which is the half the sweep does not cover: nothing
      // stranded this row — the pipeline finished with it and left it `needs_human` — so the
      // only thing that can move it is a person pressing the button L.4 added.
      const { bench, issueId } = await mirroredIssue();
      const member = await memberOf(bench, "recovery@ouroboros.invalid");

      engine.respond(() => engineFailure());

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("needs_human");
      expect(await estimatesOf(issueId)).toHaveLength(0);

      engine.respond(() => estimateAnswer());

      await api
        .as(member)("post", `/api/v1/backlog/${issueId}/estimate`)
        .set(TENANT_HEADER, bench.slug)
        .expect(202);

      await orchestrator.settled();

      expect(await statusOf(issueId)).toBe("sized");
      // `v1`, not `v2`: the failure stored nothing, so the recovered estimate is the first
      // version this issue has ever had.
      expect(await estimatesOf(issueId)).toMatchObject([{ version: 1 }]);
    });

    it("re-queues a whole batch of stranded rows", async () => {
      // One stranded row proves the read has a `where`; a batch proves the sweep is a sweep.
      // Every one of them is a row a killed process left behind, and none of them has anything
      // else that could move it.
      const { bench, issueId } = await mirroredIssue();
      const second = await addIssue(bench, 486);
      const third = await addIssue(bench, 487);

      for (const stranded of [issueId, second, third]) {
        await strand(stranded);
      }

      const report = await orchestrator.sweep();
      await orchestrator.settled();

      expect(report).toMatchObject({ stale: 3, requeued: 3, inFlight: 0 });

      for (const recovered of [issueId, second, third]) {
        expect(await statusOf(recovered)).toBe("sized");
      }
    });

    it("writes exactly one estimate for a row it recovers", async () => {
      // The sweep re-queues; the queue de-duplicates. A sweep that ran twice over the same
      // stranded row — which is what a cadence shorter than an estimate takes produces — must
      // still leave one version, or every stale row would collect a version per sweep.
      const { issueId } = await mirroredIssue();

      await strand(issueId);

      const first = await orchestrator.sweep();
      const second = await orchestrator.sweep();

      await orchestrator.settled();

      expect(first).toMatchObject({ stale: 1, requeued: 1 });
      // The second sweep still finds it — the row is `estimating` and still old — and says so
      // rather than pretending it did not, which is what `inFlight` is for.
      expect(second).toMatchObject({ stale: 1, requeued: 0, inFlight: 1 });
      expect(await estimatesOf(issueId)).toHaveLength(1);
      expect(engine.requests).toHaveLength(1);
    });

    it("de-duplicates two presses that arrive together into one estimate", async () => {
      // Concurrency as a person produces it: two browsers, one issue, one moment. The status
      // codes are deliberately not asserted — whether the second press is refused `409` or
      // accepted and dropped by the queue depends on which of the two reads resolved first,
      // and both are correct. What is not allowed either way is a second engine call and a
      // second version, and that is what this asserts.
      const { bench, issueId } = await mirroredIssue();
      const member = await memberOf(bench, "presser@ouroboros.invalid");
      const press = (): Promise<unknown> =>
        api
          .as(member)("post", `/api/v1/backlog/${issueId}/estimate`)
          .set(TENANT_HEADER, bench.slug);

      orchestrator.enqueue(issueId);
      await orchestrator.settled();

      await Promise.all([press(), press()]);
      await orchestrator.settled();

      expect(await estimatesOf(issueId)).toMatchObject([{ version: 1 }, { version: 2 }]);
      expect(engine.requests).toHaveLength(2);
      expect(await statusOf(issueId)).toBe("sized");
    });

    it("gives every issue in a fan-out exactly one version, with no deadlock", async () => {
      // `OURO_ESTIMATION_CONCURRENCY` is four by default, so five issues is one more than the
      // pipeline runs at once: four transactions are genuinely in flight together while the
      // fifth waits. Different issues, so no version collides — what is under test is that
      // concurrent writers to one table each get their row and the run ends.
      const owner = await api.signIn({ email: "fanout@ouroboros.invalid" });
      const { bench, issueId } = await mirroredIssue();
      const rest = [];

      await api.join(bench.id, owner, "owner");

      for (const number of [486, 487, 488, 489]) {
        rest.push(await addIssue(bench, number));
      }

      const accepted = await api
        .as(owner)("post", "/api/v1/backlog/estimate-all")
        .set(TENANT_HEADER, bench.slug)
        .expect(202);

      expect(bodyOf(accepted)).toEqual({ enqueued: 5, skipped: 0, total: 5 });

      await orchestrator.settled();

      for (const sized of [issueId, ...rest]) {
        expect(await statusOf(sized)).toBe("sized");
        expect(await estimatesOf(sized)).toMatchObject([{ version: 1 }]);
      }
    });

    it("keeps versions sequential when four writers race on one issue", async () => {
      // The acceptance criterion at its limit. Two writers prove the retry exists; four prove
      // it converges — every collision moves somebody's version forward, so a writer that
      // loses three races still lands on the fourth, inside `MAX_VERSION_ATTEMPTS`. A lock
      // would have serialised these and a `max(version) + 1` with no retry would have lost
      // three of them to `issue_estimates_issue_version_key`.
      const { issueId } = await mirroredIssue();
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

      const versions = await Promise.all(
        [0, 1, 2, 3].map(() => repository.persist(issueId, "sized", row)),
      );

      expect([...versions].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
      expect((await estimatesOf(issueId)).map((stored) => stored.version)).toEqual([1, 2, 3, 4]);
    });
  });
});
