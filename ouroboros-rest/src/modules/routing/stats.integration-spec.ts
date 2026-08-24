import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { RoutingMatrixResource, RoutingSpendResource } from "./resources";
import { RoutingStatsCache } from "./stats.cache";
import { insertUsage, MOCKUP_06, seedRoutingUsage } from "./stats.fixture";
import { RoutingStatsService } from "./stats.service";

/**
 * The figures, against a migrated database and the ledger Y.4 seeds
 * ([#198](https://github.com/NobuData/ouroboros/issues/198)).
 *
 * `stats.spec.ts` runs the honesty rules over hand-written rows, and that is exactly what makes
 * this suite necessary: a hand-written row is written to the aggregate its author believes
 * PostgreSQL computes. Five things can only be asserted here, and every one of them is one of
 * the ticket's criteria:
 *
 *   * **the seeded figures reproduce the mockup** — `$412.80`, a 31% local share, and the
 *     matrix's eight `$/run avg` and `p50 latency` pairs, computed by `avg` and
 *     `percentile_cont` rather than by a fixture that was written to match;
 *   * **an empty organization yields em-dashes and zero-states**, never `$0.00` for unpriced;
 *   * **zero-priced local usage and unpriced usage stay apart** — Ollama's routed `docs` calls
 *     cost nothing and its earlier calls are priced by nobody, in one workspace, in one row;
 *   * **p50 is absent where timings do not exist**, which is `percentile_cont` over an
 *     all-null column and not a branch anybody wrote; and
 *   * **the window is relative to `now()`**, which only a real clock and a real `occurred_at`
 *     can demonstrate.
 *
 * Isolation is asserted twice over, because it is the criterion that fails invisibly: once at
 * the service, where two seeded workspaces must not add up, and once over HTTP.
 *
 * Rows are inserted with SQL rather than through a service, for `routing.integration-spec.ts`'s
 * reason — and here there is no alternative at all: nothing in `ouroboros-rest` writes
 * `token_usage`.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surfaces under test. */
const MATRIX = "/api/v1/routing";
const SPEND = "/api/v1/routing/spend";

describe("routing stats and spend aggregation", () => {
  let api: ApiHarness;
  let stats: RoutingStatsService;

  beforeAll(async () => {
    api = await ApiHarness.start();
    stats = api.nest.get(RoutingStatsService);
  });

  afterAll(() => api.close());

  afterEach(async () => {
    const { rows } = await api.sql.query<{ id: string }>(`select "id" from "organization"`);

    await api.truncate();

    // The cache outlives a truncation — it is a map in this process and the harness empties the
    // database — so a suite whose subject is *what the ledger says* could otherwise pass by
    // reading what a previous test's ledger said.
    for (const row of rows) {
      api.nest.get(RoutingStatsCache).invalidate(row.id);
    }
  });

  /**
   * A workspace whose ledger is Y.4's.
   *
   * @param owner - Who owns it.
   * @returns The workspace.
   */
  async function seeded(owner: Person): Promise<Workspace> {
    const workspace = await api.workspace(owner);
    await seedRoutingUsage(api, workspace.id);

    return workspace;
  }

  describe("the matrix's two numeric columns", () => {
    it("reproduces every seeded kind's $/run avg and p50 latency", async () => {
      // The centre of each symmetric sequence, which is what `avg` and `percentile_cont`
      // return over it. Spelled out as literals rather than read from MOCKUP_06: this is the
      // suite whose subject is the arithmetic, and it is that constant's oracle.
      const workspace = await seeded(await api.signIn());

      const { byTaskKind } = await stats.read(workspace.id);

      expect(byTaskKind.get("analyze")).toMatchObject({
        costCentsPerRunAvg: 4,
        latencyP50Ms: 3_100,
      });
      expect(byTaskKind.get("estimate")).toMatchObject({
        costCentsPerRunAvg: 1,
        latencyP50Ms: 1_200,
      });
      expect(byTaskKind.get("plan")).toMatchObject({ costCentsPerRunAvg: 31, latencyP50Ms: 9_800 });
      expect(byTaskKind.get("implement")).toMatchObject({
        costCentsPerRunAvg: 87,
        latencyP50Ms: 41_000,
      });
      expect(byTaskKind.get("test-gen")).toMatchObject({
        costCentsPerRunAvg: 12,
        latencyP50Ms: 17_400,
      });
      expect(byTaskKind.get("review")).toMatchObject({
        costCentsPerRunAvg: 22,
        latencyP50Ms: 12_600,
      });
      expect(byTaskKind.get("docs")).toMatchObject({ costCentsPerRunAvg: 0, latencyP50Ms: 6_300 });
      expect(byTaskKind.get("commit-msg")).toMatchObject({
        costCentsPerRunAvg: 0,
        latencyP50Ms: 800,
      });
    });

    it("counts the calls each figure is over", async () => {
      const workspace = await seeded(await api.signIn());

      const { byTaskKind } = await stats.read(workspace.id);

      expect(byTaskKind.get("commit-msg")).toEqual({
        costCentsPerRunAvg: 0,
        latencyP50Ms: 800,
        pricedCalls: MOCKUP_06.kinds["commit-msg"].calls,
        unpricedCalls: 0,
        timedCalls: MOCKUP_06.kinds["commit-msg"].calls,
      });
    });

    it("leaves out the spend no route placed", async () => {
      // A null `task_kind` is not routed work (V020) — the provider-level rows the earlier
      // seeds wrote. They are on the spend card and nowhere on the matrix.
      const workspace = await seeded(await api.signIn());

      const { byTaskKind } = await stats.read(workspace.id);

      expect([...byTaskKind.keys()].toSorted()).toEqual([
        "analyze",
        "commit-msg",
        "docs",
        "estimate",
        "implement",
        "plan",
        "review",
        "test-gen",
      ]);
    });

    it("reports no p50 for a kind whose calls were never timed", async () => {
      // `percentile_cont` over a column of nulls is null. The em-dash is a property of the
      // aggregate rather than of a branch, which is what V020 argued when it made the column
      // nullable — and it is why this can only be asserted against a real server.
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await insertUsage(api, workspace.id, {
        provider: "anthropic",
        taskKind: "review",
        costCents: "12.0000",
        latencyMs: null,
      });

      const { byTaskKind } = await stats.read(workspace.id);

      expect(byTaskKind.get("review")).toMatchObject({
        costCentsPerRunAvg: 12,
        latencyP50Ms: null,
        timedCalls: 0,
      });
    });

    it("reports an em-dash rather than a zero for a kind whose calls are all unpriced", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await insertUsage(api, workspace.id, {
        provider: "anthropic",
        taskKind: "plan",
        costCents: null,
        latencyMs: 900,
      });

      const { byTaskKind } = await stats.read(workspace.id);

      expect(byTaskKind.get("plan")).toMatchObject({
        costCentsPerRunAvg: null,
        pricedCalls: 0,
        unpricedCalls: 1,
        latencyP50Ms: 900,
      });
    });
  });

  describe("the spend card", () => {
    it("reproduces the seeded thirty-day totals, largest bill first", async () => {
      // Anthropic and the local `$0.00` are mockup 06's exactly. Copilot and Cursor are mockup
      // 07's for the reason #192's header sets out: a thirty-day window contains the calendar
      // month it is asked to be smaller than, so the card's own figures are unreachable.
      const workspace = await seeded(await api.signIn());

      const { spend } = await stats.read(workspace.id);

      expect(spend.providers.map((provider) => [provider.key, provider.spendCents])).toEqual([
        ["anthropic", 41_280],
        ["copilot", 7_600],
        ["cursor", 6_410],
        ["ollama+openai_compatible", 0],
      ]);
    });

    it("meters every row against the largest bill", async () => {
      const workspace = await seeded(await api.signIn());

      const { spend } = await stats.read(workspace.id);

      expect(spend.providers[0].meterFraction).toBe(1);
      expect(spend.providers[1].meterFraction).toBeCloseTo(7_600 / 41_280, 10);
      expect(spend.providers[3].meterFraction).toBe(0);
    });

    it("keeps the local row's zero-priced total apart from its unpriced calls", async () => {
      // The acceptance criterion, and the whole reason Y.4 seeds both states in one workspace:
      // the routed `docs` calls were priced at nothing, and the earlier Ollama calls were
      // priced by nobody. `$0.00` and *five calls unpriced* are both true of this row.
      const workspace = await seeded(await api.signIn());

      const { spend } = await stats.read(workspace.id);
      const local = spend.providers.find((provider) => provider.local);

      expect(local).toMatchObject({
        spendCents: 0,
        pricedCalls: MOCKUP_06.kinds.docs.calls + MOCKUP_06.kinds["commit-msg"].calls,
        unpricedCalls: MOCKUP_06.unpricedCalls,
      });
    });

    it("computes the footnote's 31% from the tokens the ledger actually holds", async () => {
      const workspace = await seeded(await api.signIn());

      const { spend } = await stats.read(workspace.id);

      expect(spend.tokens).toBe(MOCKUP_06.tokens);
      expect(spend.localTokens).toBe(MOCKUP_06.localTokens);
      expect(spend.localTokenShare).toBeCloseTo(0.31, 10);
    });

    it("adds the priced rows into a total and leaves the unpriced calls visible beside it", async () => {
      const workspace = await seeded(await api.signIn());

      const { spend } = await stats.read(workspace.id);

      expect(spend.totalSpendCents).toBe(41_280 + 7_600 + 6_410);
      expect(spend.unpricedCalls).toBe(MOCKUP_06.unpricedCalls);
    });

    it("says unpriced rather than zero for a provider nothing has priced", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await insertUsage(api, workspace.id, { provider: "cursor", costCents: null, tokens: 500 });

      const { spend } = await stats.read(workspace.id);

      expect(spend.providers[0]).toMatchObject({
        key: "cursor",
        spendCents: null,
        meterFraction: null,
        unpricedCalls: 1,
      });
      expect(spend.totalSpendCents).toBeNull();
    });
  });

  describe("a workspace that has run nothing", () => {
    it("draws no meters, claims no share, and never reports $0.00", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const { byTaskKind, spend } = await stats.read(workspace.id);

      expect(byTaskKind.size).toBe(0);
      expect(spend.providers).toEqual([]);
      expect(spend.totalSpendCents).toBeNull();
      expect(spend.localTokenShare).toBeNull();
      expect(spend.tokens).toBe(0);
    });
  });

  describe("the window", () => {
    it("is measured back from now, so a call outside it is not in any figure", async () => {
      // The acceptance criterion *window arithmetic is relative to `now()`, matching the seeded
      // windows*. Both rows are the same call in every respect but when it happened.
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await insertUsage(api, workspace.id, {
        provider: "anthropic",
        taskKind: "implement",
        costCents: "100.0000",
        occurredAt: "31 days",
      });
      await insertUsage(api, workspace.id, {
        provider: "anthropic",
        taskKind: "implement",
        costCents: "50.0000",
        occurredAt: "29 days",
      });

      const { byTaskKind, spend } = await stats.read(workspace.id);

      expect(byTaskKind.get("implement")).toMatchObject({ costCentsPerRunAvg: 50, pricedCalls: 1 });
      expect(spend.providers[0].spendCents).toBe(50);
    });

    it("is published with the figures, so a client knows what it is looking at", async () => {
      const workspace = await seeded(await api.signIn());

      const { spend } = await stats.read(workspace.id);
      const since = Date.parse(spend.window.since);
      const until = Date.parse(spend.window.until);

      expect(spend.window.days).toBe(30);
      expect(until - since).toBe(30 * 24 * 60 * 60 * 1_000);
    });
  });

  describe("isolation", () => {
    it("does not add another workspace's usage into a total", async () => {
      // The criterion that fails invisibly: a leaked total looks entirely plausible.
      const owner = await api.signIn();
      const mine = await seeded(owner);
      const theirs = await api.workspace(await api.signIn());

      await insertUsage(api, theirs.id, {
        provider: "anthropic",
        taskKind: "implement",
        costCents: "999999.0000",
        tokens: 500_000_000,
      });

      const { spend, byTaskKind } = await stats.read(mine.id);

      expect(spend.totalSpendCents).toBe(41_280 + 7_600 + 6_410);
      expect(spend.tokens).toBe(MOCKUP_06.tokens);
      expect(byTaskKind.get("implement")?.costCentsPerRunAvg).toBe(87);
    });
  });

  describe("over HTTP", () => {
    it("folds the spend card into the matrix payload, measured over one window", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.spend.providers).toHaveLength(4);
      expect(matrix.spend.localTokenShare).toBeCloseTo(0.31, 10);
    });

    it("carries the measured figures onto the matrix row's route", async () => {
      // What AA.2 renders: the two numerics arrive on the route rather than beside it, which is
      // where the contract has always said they would be.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      await route(workspace.id, "implement", "implement-primary");
      api.nest.get(RoutingStatsCache).invalidate(workspace.id);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.taskKinds[0].route?.stats).toMatchObject({
        costCentsPerRunAvg: 87,
        latencyP50Ms: 41_000,
        pricedCalls: 15,
      });
    });

    it("reports em-dashes on a kind whose route exists and whose ledger does not", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await route(workspace.id, "implement", "implement-primary");

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.taskKinds[0].route?.stats).toEqual({
        costCentsPerRunAvg: null,
        latencyP50Ms: null,
        pricedCalls: 0,
        unpricedCalls: 0,
        timedCalls: 0,
      });
    });

    it("serves the same card at the spend endpoint AB.4 will read", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );
      const spend = bodyOf<RoutingSpendResource>(
        await api.as(owner)("get", SPEND).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(spend).toEqual(matrix.spend);
    });

    it("lets a viewer read the spend card, because it is a read", async () => {
      // A viewer is a role that exists to be able to look. What a workspace spends on models is
      // squarely inside that, and the roles guard's bare-route rule is what says so.
      const owner = await api.signIn();
      const workspace = await seeded(owner);
      const viewer = await api.signIn();
      await api.join(workspace.id, viewer, "viewer");

      const spend = bodyOf<RoutingSpendResource>(
        await api.as(viewer)("get", SPEND).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(spend.providers).toHaveLength(4);
    });

    it("refuses a session acting in no workspace", async () => {
      const nomad = await api.signIn();

      await api.as(nomad)("get", SPEND).expect(400);
    });

    it("does not serve one workspace's card to somebody who is not in it", async () => {
      // `404 tenant_not_found` rather than `403`: the tenant guard's own answer, and the right
      // one — a workspace a caller is not in is a workspace they should not learn the existence
      // of from the shape of a refusal, let alone learn the size of its bill from.
      const owner = await api.signIn();
      const workspace = await seeded(owner);
      const stranger = await api.signIn();

      await api.as(stranger)("get", SPEND).set(TENANT_HEADER, workspace.slug).expect(404);
    });
  });

  /**
   * Insert a task kind, a route for it, and a one-hop chain — the least a matrix row needs.
   *
   * Written with SQL rather than through Z.2's `PUT`, for this suite's own reason: the subject
   * is what the ledger says, and staging the arrangement through the editor would make a
   * failure there look like a failure here.
   *
   * @param organizationId - The workspace.
   * @param name - The kind's name, which is also what the ledger's `task_kind` holds.
   * @param tag - The route's tag.
   * @returns When the row is in.
   */
  async function route(organizationId: string, name: string, tag: string): Promise<void> {
    const { rows: kinds } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
       values ($1, $2, 'Write the change, run tests, iterate to green', 1)
       returning id`,
      [organizationId, name],
    );

    const { rows: connections } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections (organization_id, kind, display_name)
       values ($1, 'anthropic', 'Anthropic')
       returning id`,
      [organizationId],
    );

    const { rows: aliases } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.model_aliases
         (organization_id, alias, provider_connection_id, model_id, enabled)
       values ($1, 'coder-max', $2, 'claude-fable-5', true)
       returning id`,
      [organizationId, connections[0].id],
    );

    // The route and its hop go in one transaction, because V016's `route_chain_intact()` is a
    // deferred constraint trigger: a route with no chain is not a state that may survive a
    // commit, and inserting the two in separate statements would ask it to.
    const client = await api.sql.connect();

    try {
      await client.query("begin");

      const { rows: routes } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.routes (organization_id, task_kind_id, tag)
         values ($1, $2, $3)
         returning id`,
        [organizationId, kinds[0].id, tag],
      );

      await client.query(
        `insert into ${SCHEMA_NAME}.route_hops
           (organization_id, route_id, position, model_alias_id, note)
         values ($1, $2, 1, $3, 'Primary')`,
        [organizationId, routes[0].id, aliases[0].id],
      );

      await client.query("commit");
    } catch (failure) {
      await client.query("rollback");
      throw failure;
    } finally {
      client.release();
    }
  }
});
