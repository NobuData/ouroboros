import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { RoutingRepository } from "./routing.repository";

/**
 * The four statements — asserted as SQL, for the reason `registry.repository.spec.ts` gives:
 * this layer holds statements rather than rules, so mocking a method would prove nothing about
 * the three things that can actually be wrong here.
 *
 * The first is **tenancy**. Every statement must carry the workspace, including the two whose
 * other key is globally unique, because a lookup that *could* cross a workspace boundary is one
 * that eventually does.
 *
 * The second is **`status`**. A resolution has exactly one opinion about whether a provider is
 * usable — Z.3's health snapshot — and a `provider_connections.status` selected here would be a
 * second value that can disagree with it. It is the kind of column somebody adds while
 * debugging and does not remove, so it is asserted over every statement rather than over the
 * one that was easy to remember.
 *
 * The third is the **left join**. An unbound alias must arrive as a hop with no binding rather
 * than not arrive at all: a chain that lost a hop that way would be shorter than the operator
 * configured it, which is the silence the whole ticket exists to remove.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ROUTE = "5eed0011-0000-4000-8000-000000000004";

describe("the routing repository", () => {
  let database: RecordingDatabase;
  let routes: RoutingRepository;

  beforeEach(() => {
    database = recordingDatabase();
    routes = new RoutingRepository(database.service);
  });

  /** Every statement this module issues, as a callable. */
  const everyStatement: readonly [string, (repository: RoutingRepository) => Promise<unknown>][] = [
    ["route", (repository) => repository.route(WORKSPACE, "implement")],
    ["hops", (repository) => repository.hops(WORKSPACE, ROUTE)],
    ["aliases", (repository) => repository.aliases(WORKSPACE)],
    ["rules", (repository) => repository.rules(WORKSPACE)],
  ];

  describe("what every statement does", () => {
    it.each(everyStatement)("carries the workspace in %s", async (_name, issue) => {
      await issue(routes);

      const [statement] = database.statements;

      expect(statement.sql).toContain('"organization_id" = $1');
      expect(statement.parameters[0]).toBe(WORKSPACE);
    });

    it.each(everyStatement)("does not read a provider's status in %s", async (_name, issue) => {
      await issue(routes);

      for (const statement of database.sql()) {
        expect(statement).not.toContain("status");
      }
    });

    it.each(everyStatement)("does not name a sealed credential in %s", async (_name, issue) => {
      // The same probe `registry.repository.spec.ts` and `provider-health.repository.spec.ts`
      // run, for the same reason: this module joins `provider_connections`, and a `selectAll`
      // on that table would pull a workspace's sealed keys into a resolution that has no use
      // for them.
      await issue(routes);

      for (const statement of database.sql()) {
        expect(statement).not.toContain("credentials_encrypted");
      }
    });

    it.each(everyStatement)("writes nothing in %s", async (_name, issue) => {
      // Decision M2: the write surface over V016 and V018 is Z.2's (#195). Asserted rather than
      // reviewed, because "this module only reads" is a claim that decays silently.
      await issue(routes);

      for (const statement of database.sql()) {
        expect(statement).toMatch(/^select /);
      }
    });

    it.each(everyStatement)("parameterises every value in %s", async (_name, issue) => {
      await issue(routes);

      for (const statement of database.statements) {
        expect(statement.sql).not.toContain(WORKSPACE);
        expect(statement.sql).not.toContain("implement");
      }
    });
  });

  describe("reading a route", () => {
    it("finds it through the task kind's name, which is what a caller has", async () => {
      await routes.route(WORKSPACE, "implement");

      const [statement] = database.statements;

      expect(statement.sql).toContain('inner join "ouroboros"."task_kinds"');
      expect(statement.sql).toContain('"k"."name" = $2');
      expect(statement.parameters[1]).toBe("implement");
    });

    it("holds the join to one workspace rather than to one id", async () => {
      await routes.route(WORKSPACE, "implement");

      expect(database.statements[0].sql).toContain(
        'on "k"."organization_id" = "r"."organization_id"',
      );
    });

    it("answers undefined for a kind this workspace does not route", async () => {
      // Absence is the ordinary answer for a name a caller supplied. Turning it into a 404 is
      // the service's job, one layer up, where the name is known to have come from a request.
      expect(await routes.route(WORKSPACE, "triage")).toBeUndefined();
    });
  });

  describe("reading a chain", () => {
    it("left-joins the connection, so an unbound alias is still a hop", async () => {
      await routes.hops(WORKSPACE, ROUTE);

      expect(database.statements[0].sql).toContain('left join "ouroboros"."provider_connections"');
    });

    it("inner-joins the alias, which a hop always has by foreign key", async () => {
      // V016's `route_hops_alias_fk` makes the alias row mandatory. A left join here would be
      // admitting a state the database refuses.
      await routes.hops(WORKSPACE, ROUTE);

      expect(database.statements[0].sql).toContain('inner join "ouroboros"."model_aliases"');
    });

    it("orders by position, which is what the floor counts", async () => {
      await routes.hops(WORKSPACE, ROUTE);

      expect(database.statements[0].sql).toContain('order by "h"."position"');
    });

    it("returns the rows the join produced, unmapped", async () => {
      database.answers({ rows: [{ position: 1, alias: "coder-max" }] });

      expect(await routes.hops(WORKSPACE, ROUTE)).toEqual([{ position: 1, alias: "coder-max" }]);
    });
  });

  describe("reading the aliases", () => {
    it("left-joins the connection too, and orders by name", async () => {
      // Ordered so the input to a pure function is stable, which is half of what makes its
      // output deterministic.
      await routes.aliases(WORKSPACE);

      const [statement] = database.statements;

      expect(statement.sql).toContain('left join "ouroboros"."provider_connections"');
      expect(statement.sql).toContain('order by "a"."alias"');
    });
  });

  describe("reading the rules", () => {
    it("filters to the enabled ones in the statement rather than in the resolver", async () => {
      // V018's distinction: *the rules this workspace has* and *the rules that currently fire*
      // are different questions. A resolver that filtered in memory would be a resolver that
      // could be handed a disabled rule.
      await routes.rules(WORKSPACE);

      expect(database.statements[0].sql).toContain('"enabled" = $2');
      expect(database.statements[0].parameters[1]).toBe(true);
    });

    it("selects the generated sentence rather than the structure alone", async () => {
      // Decision M5. `display` is derived by PostgreSQL from `"when"` and `"then"`, so
      // selecting it is what stops the explanation panel and the rules card printing two
      // sentences for one rule.
      await routes.rules(WORKSPACE);

      expect(database.statements[0].sql).toContain('"display"');
      expect(database.statements[0].sql).toContain('"when"');
      expect(database.statements[0].sql).toContain('"then"');
    });

    it("orders by sort_order, which is what gives two matching rules one answer", async () => {
      await routes.rules(WORKSPACE);

      expect(database.statements[0].sql).toContain('order by "sort_order"');
    });
  });
});
