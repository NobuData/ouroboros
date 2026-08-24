import type { DatabaseService } from "../db/db.service";
import type { RoutingManagementRepository } from "./management.repository";
import type {
  ManagedHopRow,
  ManagedRouteRow,
  ManagedRuleRow,
  TaskKindRow,
} from "./management.rows";
import {
  RULE_TARGET_RACE_MESSAGE,
  RoutingManagementService,
  THEN_INVALID_MESSAGE,
  WHEN_INVALID_MESSAGE,
  unknownRuleTargetMessage,
} from "./management.service";
import { SAVE_MESSAGES } from "./management.validation";
import {
  CHECK_VIOLATION,
  RULE_SORT_ORDER_CONSTRAINT,
  RULE_TARGETS_CONSTRAINT,
  UNIQUE_VIOLATION,
} from "./routing.errors";
import type { RouteStatsResource, RoutingSpendResource } from "./resources";
import type { RoutingRepository } from "./routing.repository";
import type { RoutingStatsService } from "./stats.service";

/** What Z.5 measured for `implement` — carried onto the route unchanged, never recomputed. */
const MEASURED: RouteStatsResource = {
  costCentsPerRunAvg: 87,
  latencyP50Ms: 41_000,
  pricedCalls: 15,
  unpricedCalls: 0,
  timedCalls: 15,
};

/**
 * The spend card a workspace with no ledger rows gets — every zero-state, and a **null** share.
 *
 * Deliberately not a fixture with figures in it: this suite's subject is the orchestration, and
 * `stats.spec.ts` is where the arithmetic is asserted. What matters here is that the matrix
 * carries whatever the stats service answered, unmodified.
 */
const EMPTY_SPEND: RoutingSpendResource = {
  window: {
    days: 30,
    since: "2026-07-24T09:58:12.004Z",
    until: "2026-08-23T09:58:12.004Z",
  },
  providers: [],
  totalSpendCents: null,
  tokens: 0,
  localTokens: 0,
  localTokenShare: null,
  unpricedCalls: 0,
};

/**
 * The orchestration — what the statements and the pure functions cannot say between them.
 *
 * Four things live only here, and each is one of the ticket's criteria:
 *
 *   * **nothing is written when anything is wrong.** The refusals are decided before the
 *     transaction opens, so *"a failure in one route does not partially commit another"* is a
 *     write that never started — asserted as *the transaction was never entered*, which is the
 *     only form of the claim a unit spec can actually check;
 *   * **a route that did not move is not written**, and a batch in which nothing moved records
 *     no revision at all;
 *   * **the chain is only rewritten when the chain changed**, so a floor edit does not churn
 *     every `route_hops` row on the route; and
 *   * **the two refusals a pre-flight cannot close** — a position claimed between the read and
 *     the insert, an alias deleted between the check and the commit — arrive as their designed
 *     answers rather than as `500`s.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ACTOR = "66666666-6666-6666-6666-666666666666";
const ROUTE = "5eed0011-0000-4000-8000-000000000004";
const RULE = "f0000000-0000-4000-8000-000000000001";

/** The workspace's two kinds. */
const KINDS: TaskKindRow[] = [
  { id: "3ee0-1", name: "implement", description: "Write the change", sort_order: 4 },
  { id: "3ee0-2", name: "docs", description: "Write the docs", sort_order: 7 },
];

/** One route, for `implement`. `docs` deliberately has none — the matrix row with an empty cell. */
const ROUTES: ManagedRouteRow[] = [
  {
    route_id: ROUTE,
    task_kind: "implement",
    tag: "implement-primary",
    allow_local_fallback: true,
    floor_hop_index: null,
    max_cost_cents_per_run: 250,
    updated_by: null,
    updated_at: new Date("2026-08-23T09:58:12.004Z"),
  },
];

/** Its two hops. */
const HOPS: ManagedHopRow[] = [hop(1, "coder-max", "Primary"), hop(2, "coder-fallback", null)];

/** One hop row. */
function hop(position: number, alias: string, note: string | null): ManagedHopRow {
  return {
    route_id: ROUTE,
    position,
    note,
    alias,
    model_id: `${alias}-model`,
    params: {},
    connection_id: "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70",
    kind: "anthropic",
    display_name: "Anthropic",
    base_url: null,
  };
}

/** The stored rule the PATCH tests read first. */
const STORED_RULE: ManagedRuleRow = {
  id: RULE,
  enabled: true,
  sort_order: 1,
  when: { effort_gte: "l" },
  then: { use_alias: { task_kind: "implement", alias: "coder-max" } },
  display: "effort ≥ L → implement uses coder-max",
};

/** One route as a body asks for it — the state it is already in unless a test says otherwise. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    taskKind: "implement",
    allowLocalFallback: true,
    floorHopIndex: null,
    maxCostCentsPerRun: 250,
    hops: [
      { alias: "coder-max", note: "Primary" },
      { alias: "coder-fallback", note: null },
    ],
    ...overrides,
  } as Parameters<RoutingManagementService["save"]>[2][number];
}

describe("the routing management service", () => {
  let database: jest.Mocked<DatabaseService>;
  let routing: jest.Mocked<RoutingRepository>;
  let management: jest.Mocked<RoutingManagementRepository>;
  let stats: jest.Mocked<RoutingStatsService>;
  let service: RoutingManagementService;
  let entered: number;

  beforeEach(() => {
    entered = 0;
    database = {
      transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => {
        entered += 1;
        return work({});
      }),
    } as unknown as jest.Mocked<DatabaseService>;

    routing = {
      aliases: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<RoutingRepository>;

    management = {
      taskKinds: jest.fn().mockResolvedValue(KINDS),
      routes: jest.fn().mockResolvedValue(ROUTES),
      chains: jest.fn().mockResolvedValue(HOPS),
      rules: jest.fn().mockResolvedValue([STORED_RULE]),
      rule: jest.fn().mockResolvedValue(STORED_RULE),
      aliasIds: jest.fn().mockResolvedValue([
        { id: "aaaa-1", alias: "coder-max" },
        { id: "aaaa-2", alias: "coder-fallback" },
        { id: "aaaa-3", alias: "local-docs" },
      ]),
      nextRuleSortOrder: jest.fn().mockResolvedValue(4),
      ruleGrammar: jest.fn().mockResolvedValue({ when: true, then: true }),
      writeRoutePolicy: jest.fn().mockResolvedValue(undefined),
      replaceChain: jest.fn().mockResolvedValue(undefined),
      recordRevision: jest.fn().mockResolvedValue("a1000000-0000-4000-8000-000000000001"),
      insertRule: jest.fn().mockResolvedValue(STORED_RULE),
      updateRule: jest.fn().mockResolvedValue(STORED_RULE),
      deleteRule: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<RoutingManagementRepository>;

    stats = {
      read: jest.fn().mockResolvedValue({ byTaskKind: new Map(), spend: EMPTY_SPEND }),
    } as unknown as jest.Mocked<RoutingStatsService>;

    service = new RoutingManagementService(database, routing, management, stats);
  });

  describe("the matrix read", () => {
    it("draws every kind in order, with its route or without one", async () => {
      const matrix = await service.matrix(WORKSPACE);

      expect(matrix.taskKinds.map((kind) => kind.name)).toEqual(["implement", "docs"]);
      expect(matrix.taskKinds[0].route?.hops).toHaveLength(2);
      expect(matrix.taskKinds[1].route).toBeNull();
    });

    it("carries the spend card in the same payload, measured once for the whole page", async () => {
      // The matrix's `$/run avg` and this card's totals are aggregates over the same ledger
      // rows. Fetched apart they would be aggregates over those rows *at two instants*, which
      // is a page that can show a call in one figure and not the other.
      const matrix = await service.matrix(WORKSPACE);

      expect(matrix.spend).toBe(EMPTY_SPEND);
      expect(stats.read).toHaveBeenCalledTimes(1);
      expect(stats.read).toHaveBeenCalledWith(WORKSPACE);
    });

    it("hands each route what the window measured for its kind, and em-dashes for the rest", async () => {
      stats.read.mockResolvedValue({
        byTaskKind: new Map([["implement", MEASURED]]),
        spend: EMPTY_SPEND,
      });

      const matrix = await service.matrix(WORKSPACE);

      expect(matrix.taskKinds[0].route?.stats).toEqual(MEASURED);
      // `docs` has no route in this fixture, so the em-dash it renders is the missing route's;
      // what is asserted below is the other absence — a kind with a route and no measurements.
      stats.read.mockResolvedValue({ byTaskKind: new Map(), spend: EMPTY_SPEND });

      const unmeasured = await service.matrix(WORKSPACE);

      expect(unmeasured.taskKinds[0].route?.stats).toEqual({
        costCentsPerRunAvg: null,
        latencyP50Ms: null,
        pricedCalls: 0,
        unpricedCalls: 0,
        timedCalls: 0,
      });
    });

    it("carries the rules card beside the matrix, in one request", async () => {
      // The matrix's escalation column and the rules card render the same rows. Two requests
      // would let them disagree for as long as one of them was in flight.
      const matrix = await service.matrix(WORKSPACE);

      expect(matrix.rules).toHaveLength(1);
      expect(matrix.rules[0].display).toBe("effort ≥ L → implement uses coder-max");
    });

    it("answers a workspace with no foundations with empty arrays rather than a failure", async () => {
      management.taskKinds.mockResolvedValue([]);
      management.routes.mockResolvedValue([]);
      management.chains.mockResolvedValue([]);
      management.rules.mockResolvedValue([]);

      // The spend card is present and in its zero-state rather than absent: a workspace with
      // no foundations still has a card to draw, and `localTokenShare: null` is what it says —
      // *nothing ran*, not *nothing ran locally*.
      await expect(service.matrix(WORKSPACE)).resolves.toEqual({
        taskKinds: [],
        rules: [],
        spend: EMPTY_SPEND,
      });
    });
  });

  describe("the alias list", () => {
    it("is Z.1's read rather than a second one", async () => {
      await service.aliases(WORKSPACE);

      expect(routing.aliases).toHaveBeenCalledWith(WORKSPACE);
    });
  });

  describe("a batch that cannot be saved", () => {
    it("writes nothing at all, and never opens a transaction", async () => {
      await expect(
        service.save(WORKSPACE, ACTOR, [body({ floorHopIndex: 9 })]),
      ).rejects.toMatchObject({ response: { code: "route_save_invalid" } });

      expect(entered).toBe(0);
      expect(management.writeRoutePolicy).not.toHaveBeenCalled();
      expect(management.replaceChain).not.toHaveBeenCalled();
      expect(management.recordRevision).not.toHaveBeenCalled();
    });

    it("refuses the whole batch when one route in it is wrong", async () => {
      // The atomicity criterion from the client's side: the good route in this batch is not
      // committed either, so a corrected batch can simply be re-sent.
      const batch = [body(), body({ taskKind: "docs" })];

      await expect(service.save(WORKSPACE, ACTOR, batch)).rejects.toMatchObject({
        response: {
          details: { routes: { docs: { taskKind: [SAVE_MESSAGES.noRouteForTaskKind] } } },
        },
      });

      expect(entered).toBe(0);
    });
  });

  describe("a batch that changes nothing", () => {
    it("writes no route and records no revision", async () => {
      const result = await service.save(WORKSPACE, ACTOR, [body()]);

      expect(entered).toBe(0);
      expect(management.writeRoutePolicy).not.toHaveBeenCalled();
      expect(result.revisionId).toBeNull();
    });

    it("still answers with the route, so a client can re-read what it sent", async () => {
      const result = await service.save(WORKSPACE, ACTOR, [body()]);

      expect(result.routes.map((route) => route.taskKind)).toEqual(["implement"]);
    });
  });

  describe("a batch that changes something", () => {
    it("writes the policy, records the revision, and answers with its id", async () => {
      const result = await service.save(WORKSPACE, ACTOR, [body({ floorHopIndex: 2 })]);

      expect(entered).toBe(1);
      expect(management.writeRoutePolicy).toHaveBeenCalledWith(
        expect.anything(),
        WORKSPACE,
        ROUTE,
        expect.objectContaining({ floorHopIndex: 2 }),
        ACTOR,
      );
      expect(result.revisionId).toBe("a1000000-0000-4000-8000-000000000001");
    });

    it("does not rewrite a chain that did not move", async () => {
      // A floor edit that deleted and re-inserted every hop would be invisible in the answer
      // and visible in every stamp on `route_hops`.
      await service.save(WORKSPACE, ACTOR, [body({ floorHopIndex: 2 })]);

      expect(management.replaceChain).not.toHaveBeenCalled();
    });

    it("rewrites the chain when it did, with the aliases resolved to their ids", async () => {
      await service.save(WORKSPACE, ACTOR, [
        body({
          hops: [
            { alias: "local-docs", note: null },
            { alias: "coder-max", note: "Primary" },
          ],
        }),
      ]);

      expect(management.replaceChain).toHaveBeenCalledWith(expect.anything(), WORKSPACE, ROUTE, [
        { aliasId: "aaaa-3", note: null },
        { aliasId: "aaaa-1", note: "Primary" },
      ]);
    });

    it("records a diff describing exactly what moved", async () => {
      await service.save(WORKSPACE, ACTOR, [body({ maxCostCentsPerRun: 500 })]);

      expect(management.recordRevision).toHaveBeenCalledWith(expect.anything(), WORKSPACE, ACTOR, {
        routes: [
          {
            task_kind: "implement",
            changes: { max_cost_cents_per_run: { from: 250, to: 500 } },
          },
        ],
      });
    });

    it("treats an omitted note and an explicit null as the same state", async () => {
      // On a `PUT` there is no *leave this alone*, so collapsing the two here is what stops a
      // no-op save being recorded as a chain rewrite.
      await service.save(WORKSPACE, ACTOR, [
        body({ hops: [{ alias: "coder-max", note: "Primary" }, { alias: "coder-fallback" }] }),
      ]);

      expect(management.recordRevision).not.toHaveBeenCalled();
    });

    it("re-reads the routes after the commit rather than echoing the body", async () => {
      // *Round-trips through `PUT` and re-reads identically* is a property of the answer here
      // rather than a second request a client has to make to check.
      await service.save(WORKSPACE, ACTOR, [body({ floorHopIndex: 2 })]);

      expect(management.routes).toHaveBeenCalledTimes(2);
    });
  });

  describe("adding a rule", () => {
    it("asks the database's own grammar rather than a copy of it", async () => {
      await service.addRule(WORKSPACE, { when: { effort_gte: "l" }, then: { route_local: {} } });

      expect(management.ruleGrammar).toHaveBeenCalledWith({ effort_gte: "l" }, { route_local: {} });
    });

    it("refuses both halves at once when both are wrong", async () => {
      management.ruleGrammar.mockResolvedValue({ when: false, then: false });

      await expect(service.addRule(WORKSPACE, { when: {}, then: {} })).rejects.toMatchObject({
        response: {
          code: "escalation_rule_invalid",
          details: { fields: { when: [WHEN_INVALID_MESSAGE], then: [THEN_INVALID_MESSAGE] } },
        },
      });
    });

    it("refuses a rule naming a task kind or alias this workspace does not have", async () => {
      await expect(
        service.addRule(WORKSPACE, {
          when: { label: "security" },
          then: { add_vote: { task_kind: "triage", alias: "second-opinion" } },
        }),
      ).rejects.toMatchObject({
        response: {
          details: {
            fields: {
              then: [
                unknownRuleTargetMessage("task_kind", "triage"),
                unknownRuleTargetMessage("alias", "second-opinion"),
              ],
            },
          },
        },
      });
    });

    it("checks no names for route_local, which names none", async () => {
      await expect(
        service.addRule(WORKSPACE, { when: { diff_kind: "docs_only" }, then: { route_local: {} } }),
      ).resolves.toBeDefined();
    });

    it("appends when the body names no position, and defaults the switch to on", async () => {
      await service.addRule(WORKSPACE, { when: { effort_gte: "l" }, then: { route_local: {} } });

      expect(management.insertRule).toHaveBeenCalledWith(
        WORKSPACE,
        true,
        4,
        expect.anything(),
        expect.anything(),
      );
    });

    it("uses the position the body named when it named one", async () => {
      await service.addRule(WORKSPACE, {
        sortOrder: 2,
        enabled: false,
        when: { effort_gte: "l" },
        then: { route_local: {} },
      });

      expect(management.nextRuleSortOrder).not.toHaveBeenCalled();
      expect(management.insertRule).toHaveBeenCalledWith(
        WORKSPACE,
        false,
        2,
        expect.anything(),
        expect.anything(),
      );
    });

    it("answers a position another rule already holds with a 409", async () => {
      management.insertRule.mockRejectedValue({
        code: UNIQUE_VIOLATION,
        constraint: RULE_SORT_ORDER_CONSTRAINT,
        detail: "Key (organization_id, sort_order)=(org-x, 2) already exists.",
      });

      await expect(
        service.addRule(WORKSPACE, {
          sortOrder: 2,
          when: { effort_gte: "l" },
          then: { route_local: {} },
        }),
      ).rejects.toMatchObject({
        response: { code: "escalation_rule_sort_order_taken", details: { sortOrder: 2 } },
      });
    });

    it("answers the deferred target trigger with the same 422 the pre-flight would have", async () => {
      // The race the pre-flight cannot close. A caller that could not recognise it would report
      // a designed refusal as an unexplained `500`.
      management.insertRule.mockRejectedValue({
        code: CHECK_VIOLATION,
        constraint: RULE_TARGETS_CONSTRAINT,
      });

      await expect(
        service.addRule(WORKSPACE, { when: { effort_gte: "l" }, then: { route_local: {} } }),
      ).rejects.toMatchObject({
        response: {
          code: "escalation_rule_invalid",
          details: { fields: { then: [RULE_TARGET_RACE_MESSAGE] } },
        },
      });
    });

    it("re-throws anything it does not recognise", async () => {
      const boom = new Error("connection terminated");
      management.insertRule.mockRejectedValue(boom);

      await expect(
        service.addRule(WORKSPACE, { when: { effort_gte: "l" }, then: { route_local: {} } }),
      ).rejects.toBe(boom);
    });
  });

  describe("changing a rule", () => {
    it("answers 404 for an id this workspace does not have", async () => {
      management.rule.mockResolvedValue(undefined);

      await expect(service.changeRule(WORKSPACE, RULE, { enabled: false })).rejects.toMatchObject({
        response: { code: "escalation_rule_not_found" },
      });
    });

    it("does not re-check a grammar the body did not touch", async () => {
      await service.changeRule(WORKSPACE, RULE, { enabled: false });

      expect(management.ruleGrammar).not.toHaveBeenCalled();
    });

    it("checks the pair when only one half is sent, using the stored other half", async () => {
      // The grammar functions take one document each and the target check needs the `then` that
      // will be stored — the new one when the body carried it, and the stored one when it did
      // not.
      await service.changeRule(WORKSPACE, RULE, { when: { label: "security" } });

      expect(management.ruleGrammar).toHaveBeenCalledWith({ label: "security" }, STORED_RULE.then);
    });

    it("changes nothing and answers the rule for an empty body", async () => {
      const rule = await service.changeRule(WORKSPACE, RULE, {});

      expect(management.updateRule).not.toHaveBeenCalled();
      expect(rule.id).toBe(RULE);
    });

    it("answers 404 when the rule is deleted between the read and the write", async () => {
      management.updateRule.mockResolvedValue(undefined);

      await expect(service.changeRule(WORKSPACE, RULE, { enabled: false })).rejects.toMatchObject({
        response: { code: "escalation_rule_not_found" },
      });
    });
  });

  describe("removing a rule", () => {
    it("is quiet when a row went", async () => {
      await expect(service.removeRule(WORKSPACE, RULE)).resolves.toBeUndefined();
    });

    it("answers 404 when none did, which is also the answer for another workspace's", async () => {
      management.deleteRule.mockResolvedValue(false);

      await expect(service.removeRule(WORKSPACE, RULE)).rejects.toMatchObject({
        response: { code: "escalation_rule_not_found", details: { id: RULE } },
      });
    });
  });
});
