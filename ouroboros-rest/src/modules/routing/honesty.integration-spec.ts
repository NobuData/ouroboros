import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { RoutingMatrixResource, RoutingSpendResource, TaskKindResource } from "./resources";
import { RoutingStatsCache } from "./stats.cache";
import { insertUsage } from "./stats.fixture";
import { seedRoutingBench, type RoutingBench } from "./workspace.fixture";

/**
 * The three things money can be, in one payload
 * ([#199](https://github.com/NobuData/ouroboros/issues/199)).
 *
 * Z.5's suite proves each of the honest states is reachable, one workspace at a time: a
 * provider nobody has priced reports an em-dash, a workspace that has run nothing reports no
 * total, a local row that really did cost nothing reports `$0.00`. This suite asks the question
 * those tests cannot ask separately — **are they still three states when they arrive
 * together?**
 *
 * That is the regression the ticket names, and it is a regression a per-state test cannot see.
 * The failure is not a state disappearing; it is a `?? 0`, a `coalesce`, a well-meant
 * "normalise the payload" pass that collapses *nobody priced this* into *this was free*. Both
 * render as a number, both look right in a screenshot, and the difference between them is a
 * bill nobody can explain. So every assertion below is a **comparison between rows in one
 * response** rather than a check of one row against a literal:
 *
 *   * `null` — nobody priced these calls;
 *   * `0` — these calls were priced, and the price was nothing, which is what a local model
 *     genuinely costs; and
 *   * a positive number — this is what it cost.
 *
 * Read at the HTTP boundary rather than off the service, because serialisation is the last
 * place the three can be flattened into each other: `JSON.stringify` renders a `null` and a `0`
 * differently, and a DTO layer that did not would be invisible to a service-level assertion.
 *
 * ---------------------------------------------------------------------------
 * **Replacing an em-dash path with `$0.00` turns this suite red**, which is the ticket's fourth
 * acceptance criterion — and it turns it red in the reading that matters, as *two rows that
 * must differ now agree*, rather than as a literal that stopped matching.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surfaces under test. */
const MATRIX = "/api/v1/routing";
const SPEND = "/api/v1/routing/spend";

describe("what routing's figures never round away", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  afterEach(async () => {
    const { rows } = await api.sql.query<{ id: string }>(`select "id" from "organization"`);

    await api.truncate();

    // The cache is a map in this process and the harness empties the database, so a figure
    // could otherwise survive the workspace it was computed for. Z.5's suite does the same,
    // for the same reason.
    for (const row of rows) {
      api.nest.get(RoutingStatsCache).invalidate(row.id);
    }
  });

  /**
   * A workspace whose ledger holds all three states at once.
   *
   * One provider was charged for, one charged nothing, and one was never priced — each on its
   * own task kind, so the matrix's column and the spend card can be read for the same three
   * facts. `review` is left with no usage at all, which is the fourth state and the one a
   * client draws as an untouched row.
   *
   * @returns The workspace.
   */
  async function ledger(): Promise<RoutingBench> {
    const space = await seedRoutingBench(api, await api.signIn());

    // Priced, and it cost something — the ordinary case every other row is compared against.
    await insertUsage(api, space.id, {
      provider: "anthropic",
      costCents: "87.0000",
      tokens: 200_000,
      taskKind: "implement",
      latencyMs: 41_000,
    });

    // Priced at nothing. A local model really is free to run, and `$0.00` is the true answer.
    await insertUsage(api, space.id, {
      provider: "ollama",
      costCents: "0.0000",
      tokens: 40_000,
      taskKind: "docs",
      latencyMs: 6_300,
    });

    // Never priced, and never timed either — the two absences travel together often enough
    // that a fixture pairing them is the realistic one, and it keeps the `implement` row's p50
    // a measurement rather than an interpolation between two calls.
    await insertUsage(api, space.id, {
      provider: "cursor",
      costCents: null,
      tokens: 10_000,
      taskKind: "implement",
      latencyMs: null,
    });

    return space;
  }

  /**
   * The matrix, as the caller's client receives it.
   *
   * @param space - The workspace.
   * @returns The payload.
   */
  async function matrixOf(space: RoutingBench): Promise<RoutingMatrixResource> {
    return bodyOf<RoutingMatrixResource>(
      await api.as(space.owner)("get", MATRIX).set(TENANT_HEADER, space.slug).expect(200),
    );
  }

  /**
   * One row of it.
   *
   * @param matrix - The payload.
   * @param name - Which kind.
   * @returns The row.
   * @throws {Error} When the matrix has no such row, which would mean the bench changed.
   */
  function rowOf(matrix: RoutingMatrixResource, name: string): TaskKindResource {
    const row = matrix.taskKinds.find((kind) => kind.name === name);

    if (row === undefined) {
      throw new Error(`The matrix has no ${name} row`);
    }

    return row;
  }

  describe("the matrix's money column", () => {
    it("distinguishes priced, priced-at-nothing and never-priced in one response", async () => {
      const space = await ledger();
      const matrix = await matrixOf(space);

      // `implement` carries one priced call at 87¢ and one call nobody priced, so its average
      // is over *part* of the work and the count beside it says how much.
      expect(rowOf(matrix, "implement").route?.stats).toEqual({
        costCentsPerRunAvg: 87,
        latencyP50Ms: 41_000,
        pricedCalls: 1,
        unpricedCalls: 1,
        timedCalls: 1,
      });

      // `docs` cost nothing, and `0` is the measurement rather than the absence of one.
      expect(rowOf(matrix, "docs").route?.stats).toEqual({
        costCentsPerRunAvg: 0,
        latencyP50Ms: 6_300,
        pricedCalls: 1,
        unpricedCalls: 0,
        timedCalls: 1,
      });

      // `review` is routed by nothing and billed for nothing: two em-dashes and three honest
      // counts of zero, which are a number of rows rather than a claim about money.
      expect(rowOf(matrix, "review").route).toBeNull();
    });

    it("never reports the same number for a free call and an unpriced one", async () => {
      // The comparison the criterion is really about. Stated as a relation between two rows so
      // that a `?? 0` fails it whichever row it is applied to.
      const space = await seedRoutingBench(api, await api.signIn());

      await insertUsage(api, space.id, {
        provider: "ollama",
        costCents: "0.0000",
        taskKind: "docs",
      });
      await insertUsage(api, space.id, {
        provider: "cursor",
        costCents: null,
        taskKind: "implement",
      });

      const matrix = await matrixOf(space);
      const free = rowOf(matrix, "docs").route?.stats;
      const unpriced = rowOf(matrix, "implement").route?.stats;

      expect(free?.costCentsPerRunAvg).toBe(0);
      expect(unpriced?.costCentsPerRunAvg).toBeNull();
      expect(free?.costCentsPerRunAvg).not.toBe(unpriced?.costCentsPerRunAvg);
      expect(unpriced?.unpricedCalls).toBe(1);
    });
  });

  describe("the spend card", () => {
    it("meters the priced rows, and refuses to draw a meter for an unpriced one", async () => {
      const space = await ledger();

      const spend = bodyOf<RoutingSpendResource>(
        await api.as(space.owner)("get", SPEND).set(TENANT_HEADER, space.slug).expect(200),
      );

      // Rows are found by what they are rather than by their key: the key is the group's
      // provider kinds joined, so pinning it here would make this suite fail on the day a sixth
      // local kind joins the group rather than on the day a figure stops being honest.
      const by = new Map(spend.providers.map((provider) => [provider.kinds.join(","), provider]));
      const local = spend.providers.find((provider) => provider.local);

      expect(by.get("anthropic")).toMatchObject({ spendCents: 87, meterFraction: 1 });
      expect(local).toMatchObject({ spendCents: 0, meterFraction: 0 });
      expect(by.get("cursor")).toMatchObject({ spendCents: null, meterFraction: null });

      // The three states survive addition: the total is over the rows that carry a price, and
      // the calls nobody priced are published beside it rather than folded into it.
      expect(spend.totalSpendCents).toBe(87);
      expect(spend.unpricedCalls).toBe(1);
    });

    it("claims no share and no total for a workspace that has run nothing", async () => {
      const space = await seedRoutingBench(api, await api.signIn());

      const spend = bodyOf<RoutingSpendResource>(
        await api.as(space.owner)("get", SPEND).set(TENANT_HEADER, space.slug).expect(200),
      );

      expect(spend).toMatchObject({
        providers: [],
        totalSpendCents: null,
        localTokenShare: null,
        tokens: 0,
        unpricedCalls: 0,
      });
    });

    it("empties the window rather than the ledger, so an old call is absent and not free", async () => {
      // The third honesty fixture: a workspace that *has* spent money, outside the window it is
      // being asked about. The answer is the empty-window one — no total — and never `$0.00`,
      // which would be a claim that the thirty days it did not cover were free.
      const space = await seedRoutingBench(api, await api.signIn());

      await insertUsage(api, space.id, {
        provider: "anthropic",
        costCents: "4200.0000",
        taskKind: "implement",
        occurredAt: "31 days",
      });

      const spend = bodyOf<RoutingSpendResource>(
        await api.as(space.owner)("get", SPEND).set(TENANT_HEADER, space.slug).expect(200),
      );

      expect(spend.providers).toEqual([]);
      expect(spend.totalSpendCents).toBeNull();
      expect(rowOf(await matrixOf(space), "implement").route?.stats.costCentsPerRunAvg).toBeNull();
    });
  });

  describe("the window it publishes", () => {
    it("says what it measured, so a client is never guessing what a figure covers", async () => {
      const space = await ledger();
      const matrix = await matrixOf(space);

      expect(matrix.spend.window.days).toBeGreaterThan(0);
      expect(Date.parse(matrix.spend.window.since)).toBeLessThan(
        Date.parse(matrix.spend.window.until),
      );
    });
  });
});
