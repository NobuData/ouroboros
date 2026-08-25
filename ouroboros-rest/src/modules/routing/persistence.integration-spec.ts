import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { EscalationRuleResource, SaveRoutesResource } from "./resources";
import {
  BENCH_MAX_COST_CENTS,
  revisionsOf,
  seedRoutingBench,
  storedChain,
  type RoutingBench,
} from "./workspace.fixture";

/**
 * What the database is holding the routing writes to
 * ([#199](https://github.com/NobuData/ouroboros/issues/199)).
 *
 * Z.2's own suite (`management.integration-spec.ts`) answers for the endpoints: the round trip,
 * the role gate, the refusals, one revision per save. This one answers for the three things
 * underneath them that a service test cannot see, and each is a named acceptance criterion:
 *
 *   * **`route_hops_alias_fk` is load-bearing.** The key is `on delete restrict` and it is
 *     **composite** — `(organization_id, model_alias_id)` → `model_aliases (organization_id,
 *     id)` — so it makes two guarantees at once: an alias a chain names cannot be retired out
 *     from under it, and a hop cannot name an alias belonging to another workspace *at all*,
 *     whatever the application believes. Relax it to a cascade, which is the refactor that
 *     really happens, and a retired alias silently shortens every chain that used it; drop the
 *     `organization_id` half and a workspace boundary stops being structural. Both turn this
 *     suite red, by the constraint's name.
 *   * **A chain rewrite is one unit of work.** V016's `route_chain_intact()` is a *deferred*
 *     constraint trigger, which is what lets a chain be rewritten rather than dropped and
 *     recreated — and it is why *position density* survives a save that grows one route and
 *     shrinks another in the same call. A writer that committed per route would be refused at
 *     the first intermediate state, and one that turned the deferral off would leave a sparse
 *     chain behind on the way through.
 *   * **The generated sentence is stable.** `escalation_rules.display` is
 *     `generated always … stored`, so the same rule written twice — in two workspaces, or as
 *     the same rule edited around — renders the same string. `management.integration-spec.ts`
 *     shows the sentence *changes* when the rule does; the other half is that it does not
 *     change when the rule does not, which is what makes it safe for the card and the
 *     resolution explanation to print the same value.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surfaces under test. */
const ROUTES = "/api/v1/routing/routes";
const RULES = "/api/v1/routing/rules";

/** PostgreSQL's class 23 code for a foreign key refusing a statement. */
const FOREIGN_KEY_VIOLATION = "23503";

/** The key V016 declares between a hop and the alias it names. */
const ALIAS_FK = "route_hops_alias_fk";

/** A driver error, as far as this suite reads one. */
interface DriverError {
  code?: string;
  constraint?: string;
}

/**
 * The code and constraint a caught driver error names.
 *
 * Read structurally rather than by matching a message: a message is the driver's to reword,
 * and the two fields are what `routing.errors.ts` itself branches on.
 *
 * @param failure - Whatever was thrown.
 * @returns Its SQLSTATE and the object that raised it.
 */
function refusalOf(failure: unknown): { code: string | undefined; constraint: string | undefined } {
  const error = failure as DriverError;

  return { code: error.code, constraint: error.constraint };
}

describe("what the routing writes are held to", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * One workspace with the bench, and its owner signed in.
   *
   * @returns The workspace.
   */
  async function bench(): Promise<RoutingBench> {
    return seedRoutingBench(api, await api.signIn());
  }

  /**
   * A request from a workspace's owner, acting in it.
   *
   * @param space - The workspace.
   * @param method - The verb.
   * @param path - The path.
   * @returns The Supertest request.
   */
  function as(
    space: RoutingBench,
    method: "get" | "post" | "put" | "patch" | "delete",
    path: string,
  ): ReturnType<ReturnType<ApiHarness["as"]>> {
    return api.as(space.owner)(method, path).set(TENANT_HEADER, space.slug);
  }

  /**
   * A chain body naming aliases the bench holds.
   *
   * @param aliases - The chain, primary first.
   * @param policy - Overrides for the three policy columns.
   * @returns The body a route save takes.
   */
  function chainOf(
    aliases: readonly string[],
    policy: Partial<{
      allowLocalFallback: boolean;
      floorHopIndex: number | null;
      maxCostCentsPerRun: number | null;
    }> = {},
  ): Record<string, unknown> {
    return {
      hops: aliases.map((alias) => ({ alias, note: null })),
      allowLocalFallback: policy.allowLocalFallback ?? true,
      floorHopIndex: policy.floorHopIndex ?? null,
      maxCostCentsPerRun:
        policy.maxCostCentsPerRun === undefined ? BENCH_MAX_COST_CENTS : policy.maxCostCentsPerRun,
    };
  }

  describe("the key between a hop and the alias it names", () => {
    it("refuses to retire an alias a chain is standing on", async () => {
      const space = await bench();

      // `local-docs` is hop 3 of `implement` and the whole of `docs`. Retiring it is the
      // change that looks harmless and silently shortens two chains.
      const refusal = await api.sql
        .query(`delete from ${SCHEMA_NAME}.model_aliases where id = $1`, [
          space.aliases["local-docs"],
        ])
        .then(
          () => null,
          (failure: unknown) => refusalOf(failure),
        );

      expect(refusal).toEqual({ code: FOREIGN_KEY_VIOLATION, constraint: ALIAS_FK });
      expect(await storedChain(api, space.id, "implement")).toHaveLength(3);
      expect(await storedChain(api, space.id, "docs")).toHaveLength(1);
    });

    it("lets an alias no chain names be retired", async () => {
      // The other half, and what makes the test above a statement about *references* rather
      // than about aliases being undeletable. `local-fast` is in the bench precisely because
      // nothing routes through it.
      const space = await bench();

      await api.sql.query(`delete from ${SCHEMA_NAME}.model_aliases where id = $1`, [
        space.aliases["local-fast"],
      ]);

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.model_aliases where id = $1`,
        [space.aliases["local-fast"]],
      );

      expect(rows[0].count).toBe("0");
    });

    it("refuses a hop naming another workspace's alias, whatever the application believes", async () => {
      // The composite half of the key. The application refuses this at its own boundary — the
      // test below shows it does — but a hop that reached across would be a workspace boundary
      // held by application code alone, and this is the statement that it never can be.
      const mine = await bench();
      const theirs = await bench();

      const refusal = await api.sql
        .query(
          `insert into ${SCHEMA_NAME}.route_hops
             (organization_id, route_id, position, model_alias_id)
           values ($1, $2, 4, $3)`,
          [mine.id, mine.routes.implement, theirs.aliases["coder-max"]],
        )
        .then(
          () => null,
          (failure: unknown) => refusalOf(failure),
        );

      expect(refusal).toEqual({ code: FOREIGN_KEY_VIOLATION, constraint: ALIAS_FK });
      expect(await storedChain(api, mine.id, "implement")).toHaveLength(3);
    });

    it("refuses the same reach over HTTP, naming the field rather than the constraint", async () => {
      const mine = await bench();
      await bench();

      // `deploy-only` is a name no workspace has an alias for, which is the shape a client
      // sees when it names something out of reach: a `422` against the hop, never a row. The
      // key above is what makes that a guarantee rather than this endpoint's good manners.
      const response = await as(mine, "put", `${ROUTES}/implement`)
        .send(chainOf(["deploy-only"]))
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe("route_save_invalid");
      expect(JSON.stringify(envelope.details)).toContain("hops.0.alias");
      expect(await storedChain(api, mine.id, "implement")).toHaveLength(3);
    });
  });

  describe("a chain rewrite, as one unit of work", () => {
    it("grows one route and shrinks another in the same save, and leaves both dense", async () => {
      // The deferral is the point. Growing `implement` from three hops to five and shrinking
      // `docs` from one to none-but-one passes through intermediate states V016 would refuse
      // if the constraint were immediate, and a writer that committed per route would be
      // refused at the first of them.
      const space = await bench();

      const saved = bodyOf<SaveRoutesResource>(
        await as(space, "put", ROUTES)
          .send({
            routes: [
              {
                ...chainOf([
                  "local-docs",
                  "coder-fallback",
                  "coder-max",
                  "local-fast",
                  "second-opinion",
                ]),
                taskKind: "implement",
              },
              { ...chainOf(["coder-max"]), taskKind: "docs" },
            ],
          })
          .expect(200),
      );

      expect((await storedChain(api, space.id, "implement")).map((hop) => hop.position)).toEqual([
        1, 2, 3, 4, 5,
      ]);
      expect(await storedChain(api, space.id, "docs")).toEqual([
        { position: 1, alias: "coder-max", note: null },
      ]);

      // One press of Save routes is one revision, however many routes it moved.
      const written = await revisionsOf(api, space.id);

      expect(written).toHaveLength(1);
      expect(written[0].id).toBe(saved.revisionId);
      expect(written[0].diff.routes.map((entry) => entry.task_kind)).toEqual(["implement", "docs"]);
    });

    it("keeps the chain dense from 1 through a grow, a shrink and a reorder", async () => {
      const space = await bench();

      const rewrites: readonly string[][] = [
        ["coder-max", "coder-fallback", "local-docs", "local-fast"],
        ["local-fast"],
        ["local-docs", "coder-max", "local-fast"],
        ["local-fast", "local-docs", "coder-max"],
      ];

      for (const aliases of rewrites) {
        await as(space, "put", `${ROUTES}/implement`).send(chainOf(aliases)).expect(200);

        const stored = await storedChain(api, space.id, "implement");

        expect(stored.map((hop) => hop.position)).toEqual(
          aliases.map((_alias, offset) => offset + 1),
        );
        expect(stored.map((hop) => hop.alias)).toEqual([...aliases]);
      }
    });

    it("records a combined edit as every column that moved, and nothing else", async () => {
      // The revision is what answers *"why did last Tuesday's runs go to the fallback
      // provider"*, so a save that moved a chain and all three policies has to record four
      // changes rather than a summary of them.
      const space = await bench();

      await as(space, "put", `${ROUTES}/implement`)
        .send({
          hops: [{ alias: "local-docs", note: "Local first now" }],
          allowLocalFallback: false,
          floorHopIndex: 1,
          maxCostCentsPerRun: null,
        })
        .expect(200);

      const [revision] = await revisionsOf(api, space.id);

      expect(revision.diff.routes).toHaveLength(1);
      expect(revision.diff.routes[0].task_kind).toBe("implement");
      expect(revision.diff.routes[0].changes).toEqual({
        hops: {
          from: [
            { alias: "coder-max", note: "Primary" },
            { alias: "coder-fallback", note: "Fallback on 5xx / timeouts" },
            { alias: "local-docs", note: null },
          ],
          to: [{ alias: "local-docs", note: "Local first now" }],
        },
        allow_local_fallback: { from: true, to: false },
        floor_hop_index: { from: null, to: 1 },
        max_cost_cents_per_run: { from: BENCH_MAX_COST_CENTS, to: null },
      });
    });

    it("commits none of a batch whose second route is refused, and writes no revision", async () => {
      const space = await bench();

      await as(space, "put", ROUTES)
        .send({
          routes: [
            { ...chainOf(["local-docs"]), taskKind: "implement" },
            { ...chainOf(["coder-max"], { floorHopIndex: 9 }), taskKind: "docs" },
          ],
        })
        .expect(422);

      expect(await storedChain(api, space.id, "implement")).toHaveLength(3);
      expect(await storedChain(api, space.id, "docs")).toEqual([
        { position: 1, alias: "local-docs", note: null },
      ]);
      expect(await revisionsOf(api, space.id)).toHaveLength(0);
    });
  });

  describe("the sentence PostgreSQL derives", () => {
    it("is the same string for the same rule in two different workspaces", async () => {
      const mine = await bench();
      const theirs = await bench();

      const rule = {
        when: { effort_gte: "l" },
        then: {
          use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
        },
      };

      const here = bodyOf<EscalationRuleResource>(
        await as(mine, "post", RULES).send(rule).expect(201),
      );
      const there = bodyOf<EscalationRuleResource>(
        await as(theirs, "post", RULES).send(rule).expect(201),
      );

      expect(here.display).toBe(there.display);
      expect(here.display).toBe("effort ≥ L → implement uses coder-max (max thinking)");
    });

    it("does not move when a rule is switched off, or moved in the order", async () => {
      const space = await bench();

      const created = bodyOf<EscalationRuleResource>(
        await as(space, "post", RULES)
          .send({ when: { diff_kind: "docs_only" }, then: { route_local: {} } })
          .expect(201),
      );

      const switched = bodyOf<EscalationRuleResource>(
        await as(space, "patch", `${RULES}/${created.id}`)
          .send({ enabled: false, sortOrder: 7 })
          .expect(200),
      );

      expect(switched.display).toBe(created.display);
      expect(switched).toMatchObject({ enabled: false, sortOrder: 7 });
    });

    it("is regenerated from the row rather than remembered, when the rule is rewritten back", async () => {
      // The round trip a stored generated column makes structural: a rule edited away from its
      // original shape and back again renders the original sentence, because there is nowhere
      // for an old one to have been kept.
      const space = await bench();

      const original = bodyOf<EscalationRuleResource>(
        await as(space, "post", RULES)
          .send({ when: { label: "security" }, then: { route_local: {} } })
          .expect(201),
      );

      await as(space, "patch", `${RULES}/${original.id}`)
        .send({ when: { effort_gte: "xs" } })
        .expect(200);

      const restored = bodyOf<EscalationRuleResource>(
        await as(space, "patch", `${RULES}/${original.id}`)
          .send({ when: { label: "security" } })
          .expect(200),
      );

      expect(restored.display).toBe(original.display);
    });

    it("cannot be written by a client on the way in, or on the way through", async () => {
      // Both write surfaces, because a `PATCH` that accepted one would be the same leak the
      // `POST` refuses. The column is `generated always … stored`, so this is the third of
      // three layers saying the same thing — and the only one a client can observe.
      const space = await bench();

      const created = bodyOf<EscalationRuleResource>(
        await as(space, "post", RULES)
          .send({ when: { label: "security" }, then: { route_local: {} } })
          .expect(201),
      );

      const refused = await as(space, "patch", `${RULES}/${created.id}`)
        .send({ display: "security label → whatever I feel like" })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("validation_failed");
      expect(Object.keys(bodyOf<ErrorEnvelope>(refused).details)).toContain("display");
    });
  });

  describe("who the trail names", () => {
    it("records the person who pressed Save routes, not the workspace", async () => {
      const space = await bench();
      const admin: Person = await api.signIn();

      await api.join(space.id, admin, "admin");

      await api
        .as(admin)("put", `${ROUTES}/implement`)
        .set(TENANT_HEADER, space.slug)
        .send(chainOf(["local-docs"]))
        .expect(200);

      const [revision] = await revisionsOf(api, space.id);

      expect(revision.actor).toBe(admin.id);
      expect(revision.actor).not.toBe(space.owner.id);
    });
  });
});
