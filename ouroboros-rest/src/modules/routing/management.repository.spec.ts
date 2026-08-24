import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { RoutingManagementRepository } from "./management.repository";
import type { DesiredRoute } from "./management.rows";

/**
 * The editor's statements — asserted as SQL, for the reason `routing.repository.spec.ts` gives:
 * this layer holds statements rather than rules, so mocking a method would prove nothing about
 * the three things that can actually be wrong here.
 *
 * The first is **tenancy**, and here it is the ticket's own criterion rather than a
 * convention. *"A route from another organization is not readable or writable"* is a `where`
 * clause on every statement below, reads and writes alike — and a write with one predicate
 * instead of two is the failure that would not surface until somebody else's matrix changed.
 *
 * The second is the **chain rewrite**. V016 wrote the transaction down for us; what has to be
 * true of it is that the delete and the insert are the whole of it, that positions come from
 * the array index, and that no `set constraints` ceremony crept in — the deferred constraints
 * make it unnecessary, and a `set constraints` here would mean somebody had stopped believing
 * that.
 *
 * The third is that **`display` never appears in a write**. The column is generated, so an
 * insert naming it does not compile — but the assertion is worth having as SQL too, because
 * the next person to add a column to a rule write will be looking at this file.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ROUTE = "5eed0011-0000-4000-8000-000000000004";
const RULE = "f0000000-0000-4000-8000-000000000001";
const ACTOR = "66666666-6666-6666-6666-666666666666";
const ALIAS = "aaaa0011-0000-4000-8000-00000000000a";

/** One route as a body asks for it. */
const DESIRED: DesiredRoute = {
  taskKind: "implement",
  allowLocalFallback: false,
  floorHopIndex: 2,
  maxCostCentsPerRun: 500,
  hops: [
    { alias: "coder-max", note: "Primary" },
    { alias: "local-docs", note: null },
  ],
};

/** The transaction markers the recording driver notes beside the statements. */
const MARKERS = new Set(["begin", "commit", "rollback"]);

describe("the routing management repository", () => {
  let database: RecordingDatabase;
  let management: RoutingManagementRepository;

  beforeEach(() => {
    database = recordingDatabase();
    management = new RoutingManagementRepository(database.service);
  });

  /**
   * The statements, without the transaction's own markers.
   *
   * The recording driver notes `begin` and `commit` the way PostgreSQL sees them, which is
   * right — a spec that could not tell whether a write was inside a transaction would be
   * missing the property this module is mostly about — and it means the assertions below index
   * past them rather than counting them as SQL.
   *
   * @returns The recorded statements a compiler produced.
   */
  const queries = () => database.statements.filter((statement) => !MARKERS.has(statement.sql));

  /** Those statements' SQL. */
  const querySql = () => queries().map((statement) => statement.sql);

  /** Every read this module issues, as a callable. */
  const everyRead: readonly [string, (r: RoutingManagementRepository) => Promise<unknown>][] = [
    ["taskKinds", (r) => r.taskKinds(WORKSPACE)],
    ["routes", (r) => r.routes(WORKSPACE)],
    ["chains", (r) => r.chains(WORKSPACE)],
    ["rules", (r) => r.rules(WORKSPACE)],
    ["rule", (r) => r.rule(WORKSPACE, RULE)],
    ["aliasIds", (r) => r.aliasIds(WORKSPACE)],
    ["nextRuleSortOrder", (r) => r.nextRuleSortOrder(WORKSPACE)],
  ];

  /** Every write, as a callable. The transactional ones run inside one. */
  const everyWrite: readonly [string, (r: RoutingManagementRepository) => Promise<unknown>][] = [
    [
      "writeRoutePolicy",
      (r) =>
        database.service.transaction((trx) =>
          r.writeRoutePolicy(trx, WORKSPACE, ROUTE, DESIRED, ACTOR),
        ),
    ],
    [
      "replaceChain",
      (r) =>
        database.service.transaction((trx) =>
          r.replaceChain(trx, WORKSPACE, ROUTE, [{ aliasId: ALIAS, note: null }]),
        ),
    ],
    [
      "recordRevision",
      (r) =>
        database.service.transaction((trx) =>
          r.recordRevision(trx, WORKSPACE, ACTOR, {
            routes: [
              { task_kind: "implement", changes: { floor_hop_index: { from: null, to: 2 } } },
            ],
          }),
        ),
    ],
    [
      "insertRule",
      (r) => r.insertRule(WORKSPACE, true, 1, { effort_gte: "l" }, { route_local: {} }),
    ],
    ["updateRule", (r) => r.updateRule(WORKSPACE, RULE, { enabled: false })],
    ["deleteRule", (r) => r.deleteRule(WORKSPACE, RULE)],
  ];

  describe("what every statement does", () => {
    it.each([...everyRead, ...everyWrite])("carries the workspace in %s", async (_name, issue) => {
      database.answers({ rows: [{ id: RULE }] });
      await issue(management);

      const scoped = queries().filter((statement) => statement.sql.includes("organization_id"));

      for (const statement of scoped) {
        expect(statement.parameters).toContain(WORKSPACE);
      }

      expect(scoped).not.toHaveLength(0);
    });

    it.each([...everyRead, ...everyWrite])(
      "does not name a sealed credential in %s",
      async (_name, issue) => {
        database.answers({ rows: [{ id: RULE }] });
        await issue(management);

        for (const statement of querySql()) {
          expect(statement).not.toContain("credentials_encrypted");
        }
      },
    );

    it.each(everyRead)("reads and nothing else in %s", async (_name, issue) => {
      await issue(management);

      for (const statement of querySql()) {
        expect(statement).toMatch(/^select /);
      }
    });

    it.each([...everyRead, ...everyWrite])(
      "parameterises every value in %s",
      async (_name, issue) => {
        database.answers({ rows: [{ id: RULE }] });
        await issue(management);

        for (const statement of queries()) {
          expect(statement.sql).not.toContain(WORKSPACE);
        }
      },
    );
  });

  describe("reading the matrix", () => {
    it("reads the kinds without joining the routes, so a kind with no route survives", () => {
      // V016 makes `routes.task_kind_id` unique but not mandatory. An inner join would hide the
      // matrix row with an empty cell rather than draw it.
      return management.taskKinds(WORKSPACE).then(() => {
        expect(database.statements[0].sql).not.toContain("join");
        expect(database.statements[0].sql).toContain('order by "sort_order"');
      });
    });

    it("joins a route to its kind's name, which is what every caller has", async () => {
      await management.routes(WORKSPACE);

      expect(database.statements[0].sql).toContain('inner join "ouroboros"."task_kinds"');
      expect(database.statements[0].sql).toContain(
        'on "k"."organization_id" = "r"."organization_id"',
      );
    });

    it("left-joins the connection on the chain, so an unbound alias is still a hop", async () => {
      await management.chains(WORKSPACE);

      expect(database.statements[0].sql).toContain('left join "ouroboros"."provider_connections"');
      expect(database.statements[0].sql).toContain('inner join "ouroboros"."model_aliases"');
    });

    it("orders the chain by route and then by position, so one pass splits it", async () => {
      await management.chains(WORKSPACE);

      expect(database.statements[0].sql).toContain('order by "h"."route_id", "h"."position"');
    });

    it("reads a provider's status nowhere", async () => {
      // The strip is the one place a status comes from (Z.3). A second source selected here
      // would be a value that can disagree with it on the same page.
      await management.chains(WORKSPACE);

      expect(database.sql()[0]).not.toContain("status");
    });
  });

  describe("reading the rules", () => {
    it("does not filter on enabled, because the card counts what it does not hide", async () => {
      // The deliberate difference from `routing.repository.ts`'s read, which carries
      // `where enabled` because resolution asks *which rules fire*.
      await management.rules(WORKSPACE);

      expect(database.statements[0].sql).not.toContain('"enabled" =');
      expect(database.statements[0].sql).toContain('order by "sort_order"');
    });

    it("selects the generated sentence rather than the structure alone", async () => {
      await management.rules(WORKSPACE);

      expect(database.statements[0].sql).toContain('"display"');
    });

    it("scopes one rule by the workspace as well as by its id", async () => {
      await management.rule(WORKSPACE, RULE);

      expect(database.statements[0].sql).toContain('"organization_id" = $1');
      expect(database.statements[0].sql).toContain('"id" = $2');
    });

    it("appends a new rule one past the highest, and starts a workspace at 1", async () => {
      database.answers({ rows: [{ highest: 3 }] }, { rows: [{ highest: null }] });

      expect(await management.nextRuleSortOrder(WORKSPACE)).toBe(4);
      expect(await management.nextRuleSortOrder(WORKSPACE)).toBe(1);
    });
  });

  describe("asking V018 whether a rule is one it would store", () => {
    it("calls the migration's own functions rather than a copy of them", async () => {
      database.answers({ rows: [{ when_ok: true, then_ok: false }] });

      const verdict = await management.ruleGrammar({ effort_gte: "l" }, { nope: {} });

      expect(database.statements[0].sql).toContain("escalation_rule_when_valid");
      expect(database.statements[0].sql).toContain("escalation_rule_then_valid");
      expect(verdict).toEqual({ when: true, then: false });
    });

    it("asks both in one round trip, so a client is told both halves at once", async () => {
      database.answers({ rows: [{ when_ok: false, then_ok: false }] });
      await management.ruleGrammar({}, {});

      expect(database.statements).toHaveLength(1);
    });

    it("treats an answer it did not get as a refusal", async () => {
      // A `strict` function given null answers null. Reading that as *valid* would be the one
      // direction this check must never fail in.
      database.answers({ rows: [] });

      expect(await management.ruleGrammar({}, {})).toEqual({ when: false, then: false });
    });
  });

  describe("writing a route", () => {
    it("sets the policy triple and the actor, and never the stamp", async () => {
      // `updated_at` is the V001 trigger's, everywhere in this schema.
      await database.service.transaction((trx) =>
        management.writeRoutePolicy(trx, WORKSPACE, ROUTE, DESIRED, ACTOR),
      );

      const [statement] = queries();

      expect(statement.sql).toContain('update "ouroboros"."routes"');
      expect(statement.sql).toContain('"allow_local_fallback"');
      expect(statement.sql).toContain('"floor_hop_index"');
      expect(statement.sql).toContain('"max_cost_cents_per_run"');
      expect(statement.sql).toContain('"updated_by"');
      expect(statement.sql).not.toContain('"updated_at"');
      expect(statement.parameters).toContain(ACTOR);
    });
  });

  describe("rewriting a chain", () => {
    it("is a delete and an insert, and nothing else", async () => {
      await database.service.transaction((trx) =>
        management.replaceChain(trx, WORKSPACE, ROUTE, [
          { aliasId: ALIAS, note: "Primary" },
          { aliasId: ALIAS, note: null },
        ]),
      );

      const statements = querySql();

      expect(statements[0]).toMatch(/^delete from "ouroboros"."route_hops"/);
      expect(statements[1]).toMatch(/^insert into "ouroboros"."route_hops"/);
      expect(statements).toHaveLength(2);
    });

    it("needs no set constraints, because V016 deferred both rules to commit", async () => {
      await database.service.transaction((trx) =>
        management.replaceChain(trx, WORKSPACE, ROUTE, [{ aliasId: ALIAS, note: null }]),
      );

      for (const statement of querySql()) {
        expect(statement).not.toContain("set constraints");
      }
    });

    it("numbers the hops from the array, so a dense array is all it can produce", async () => {
      await database.service.transaction((trx) =>
        management.replaceChain(trx, WORKSPACE, ROUTE, [
          { aliasId: ALIAS, note: null },
          { aliasId: ALIAS, note: null },
          { aliasId: ALIAS, note: null },
        ]),
      );

      const insert = queries()[1];

      expect(insert.parameters).toContain(1);
      expect(insert.parameters).toContain(2);
      expect(insert.parameters).toContain(3);
    });

    it("refuses an empty chain rather than letting the commit discover it", async () => {
      await expect(
        database.service.transaction((trx) => management.replaceChain(trx, WORKSPACE, ROUTE, [])),
      ).rejects.toThrow(RangeError);
    });
  });

  describe("recording a revision", () => {
    it("casts the diff rather than handing pg an object", async () => {
      // `pg` sends a JavaScript object to a jsonb column as `[object Object]`, which the column
      // accepts as a string and nothing can read back.
      database.answers({ rows: [{ id: "a1000000-0000-4000-8000-000000000001" }] });

      const id = await database.service.transaction((trx) =>
        management.recordRevision(trx, WORKSPACE, ACTOR, {
          routes: [{ task_kind: "docs", changes: { floor_hop_index: { from: null, to: 1 } } }],
        }),
      );

      expect(queries()[0].sql).toContain("::jsonb");
      expect(queries()[0].parameters).toContain(
        '{"routes":[{"task_kind":"docs","changes":{"floor_hop_index":{"from":null,"to":1}}}]}',
      );
      expect(id).toBe("a1000000-0000-4000-8000-000000000001");
    });

    it("names the actor, so the trail says who and not only what", async () => {
      database.answers({ rows: [{ id: "a1000000-0000-4000-8000-000000000001" }] });

      await database.service.transaction((trx) =>
        management.recordRevision(trx, WORKSPACE, ACTOR, {
          routes: [{ task_kind: "docs", changes: { floor_hop_index: { from: null, to: 1 } } }],
        }),
      );

      expect(queries()[0].sql).toContain('"actor"');
      expect(queries()[0].parameters).toContain(ACTOR);
    });
  });

  describe("writing a rule", () => {
    it("never names the generated sentence", async () => {
      database.answers({ rows: [{ id: RULE }] }, { rows: [{ id: RULE }] });

      await management.insertRule(WORKSPACE, true, 1, { effort_gte: "l" }, { route_local: {} });
      await management.updateRule(WORKSPACE, RULE, { when: { label: "security" } });

      for (const statement of querySql()) {
        expect(statement).not.toContain('"display" =');
        expect(statement).not.toMatch(/insert into[^)]*"display"/);
      }
    });

    it("casts both documents rather than handing pg an object", async () => {
      database.answers({ rows: [{ id: RULE }] });

      await management.insertRule(WORKSPACE, true, 2, { label: "security" }, { route_local: {} });

      expect(database.statements[0].parameters).toContain('{"label":"security"}');
      expect(database.statements[0].parameters).toContain('{"route_local":{}}');
    });

    it("returns the sentence PostgreSQL derived, so the card renders what was stored", async () => {
      database.answers({
        rows: [
          {
            id: RULE,
            enabled: true,
            sort_order: 1,
            display: "docs-only diff → everything routes local",
          },
        ],
      });

      const rule = await management.insertRule(
        WORKSPACE,
        true,
        1,
        { diff_kind: "docs_only" },
        {
          route_local: {},
        },
      );

      expect(rule.display).toBe("docs-only diff → everything routes local");
    });

    it("sets only what a PATCH carried", async () => {
      database.answers({ rows: [{ id: RULE }] });

      await management.updateRule(WORKSPACE, RULE, { enabled: false });

      const set = /set (.*) where/.exec(queries()[0].sql)?.[1] ?? "";

      expect(set).toContain('"enabled"');
      expect(set).not.toContain('"sort_order"');
      expect(set).not.toContain('"when"');
    });

    it("refuses an update with nothing to set, rather than sending invalid SQL", async () => {
      await expect(management.updateRule(WORKSPACE, RULE, {})).rejects.toThrow(RangeError);
    });

    it("reports whether a delete removed anything", async () => {
      database.answers({ rows: [], numAffectedRows: 1n }, { rows: [], numAffectedRows: 0n });

      expect(await management.deleteRule(WORKSPACE, RULE)).toBe(true);
      expect(await management.deleteRule(WORKSPACE, RULE)).toBe(false);
    });
  });
});
