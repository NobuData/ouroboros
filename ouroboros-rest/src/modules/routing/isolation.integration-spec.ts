import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { API_BASE_PATH } from "../../application";
import { ApiHarness, type Method, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { ProviderHealthStripResource } from "../provider-health/resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { Resolution } from "./resolution";
import type {
  AliasListResource,
  EscalationRuleResource,
  RoutingMatrixResource,
  RoutingSpendResource,
} from "./resources";
import { insertUsage } from "./stats.fixture";
import {
  addRule,
  revisionsOf,
  seedRoutingBench,
  storedChain,
  type RoutingBench,
} from "./workspace.fixture";

/**
 * Every routing endpoint, against a second workspace's data
 * ([#199](https://github.com/NobuData/ouroboros/issues/199)).
 *
 * The ticket asks for isolation cases covering **every routing endpoint, not a sample**, and
 * the second half of that sentence is the whole design of this file. Isolation is not a
 * property one can test by picking the endpoints that look risky: a `where organization_id`
 * is one clause in one statement, the aggregate queries are where it is easiest to forget, and
 * the endpoint that leaks is by definition the one nobody suspected. A suite that tests three
 * of nine is a suite that reports *isolation: green* about six routes it never called.
 *
 * ---------------------------------------------------------------------------
 * **So the endpoint list is not written down here. It is read out of the running
 * application.**
 *
 * {@link routingOperations} asks `@nestjs/swagger` what this Nest actually routes under
 * `/api/v1/routing` — the framework's own answer, derived from the decorators rather than from
 * a list a person maintains — and {@link PROBES} is held to it exactly, in both directions. A
 * routing endpoint added without an isolation probe fails *the census*, by name, on the commit
 * that adds it. That is the difference between covering every endpoint today and covering
 * every endpoint.
 *
 * `routing/providers` — mockup 06's health strip, served by `provider-health` — is in the
 * census on purpose. It is a routing endpoint from every angle a client can see, it is drawn
 * on the same page, and the fact that its controller lives in a neighbouring module is exactly
 * the kind of detail an isolation audit written by hand forgets.
 *
 * ---------------------------------------------------------------------------
 * **Each probe is a caller acting in their own workspace, reaching for somebody else's rows.**
 *
 * Both workspaces hold the *same* bench — the same alias names, the same task kinds, the same
 * chain — so a leak cannot hide behind a coincidence of naming, and every assertion is over
 * ids. Where an endpoint takes an id, the probe sends the **other** workspace's, which must be
 * a `404` rather than a `403`: *this workspace has no rule by that id* is the truth, and
 * *forbidden* would confirm the row exists.
 *
 * The two workspaces differ in exactly two ways, both chosen to make a leak visible rather
 * than plausible: the stranger's has a `route_local` escalation rule, so a rule that reached
 * across would strip the caller's cloud primary out of a resolution, and the stranger's is the
 * only one with any usage, so a spend query missing its filter reports money the caller never
 * spent.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** Everything under here is a routing endpoint for the purposes of the census. */
const ROUTING_PREFIX = `${API_BASE_PATH}/routing`;

/** The verbs an OpenAPI path item may carry that are operations rather than metadata. */
const HTTP_METHODS: readonly Method[] = ["get", "post", "put", "patch", "delete"];

/** How an endpoint is named, in the census and in a probe — `PUT /api/v1/routing/routes`. */
type OperationKey = `${string} ${string}`;

/** The two workspaces a probe runs between. */
interface Stage {
  /** The caller's workspace, and the caller. */
  readonly mine: RoutingBench;
  /** The stranger's workspace — the rows no probe may reach. */
  readonly theirs: RoutingBench;
  /** The stranger's one escalation rule, which must never fire for the caller. */
  readonly theirRuleId: string;
}

/** One endpoint's isolation case. */
interface IsolationProbe {
  /** The verb, as the census spells it. */
  readonly method: Method;
  /** The path **template**, as the census spells it — `/api/v1/routing/rules/{id}`. */
  readonly template: string;
  /** What this endpoint must not do. */
  readonly it: string;
  /** Call it, and assert. */
  readonly probe: (api: ApiHarness, stage: Stage) => Promise<void>;
}

/**
 * Ask the application what it routes under `/api/v1/routing`.
 *
 * `openapi.spec.ts`'s trick, for its reason: a document generated purely to read the route set
 * out of it is the framework's own answer to *what does this serve*, and it carries the global
 * prefix and the URI version, so the paths it reports are the ones a client calls.
 *
 * @param app - The running application.
 * @returns Every routing operation, keyed `METHOD /path`.
 */
function routingOperations(app: INestApplication): Set<OperationKey> {
  const generated = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  const keys = new Set<OperationKey>();

  for (const [path, item] of Object.entries(generated.paths)) {
    if (path !== ROUTING_PREFIX && !path.startsWith(`${ROUTING_PREFIX}/`)) {
      continue;
    }

    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.includes(method as Method)) {
        keys.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }

  return keys;
}

/**
 * A probe's census key.
 *
 * @param probe - The probe.
 * @returns `PUT /api/v1/routing/routes`.
 */
function keyOf(probe: IsolationProbe): OperationKey {
  return `${probe.method.toUpperCase()} ${probe.template}`;
}

/** A chain the endpoints accept, naming aliases both workspaces have. */
const A_VALID_SAVE = {
  hops: [{ alias: "local-docs", note: null }],
  allowLocalFallback: true,
  floorHopIndex: null,
  maxCostCentsPerRun: 100,
};

describe("routing endpoints, one workspace and another", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * Two workspaces holding the same bench, owned by two different people.
   *
   * @returns The caller's, the stranger's, and the stranger's rule.
   */
  async function stage(): Promise<Stage> {
    const mine = await seedRoutingBench(api, await api.signIn());
    const theirs = await seedRoutingBench(api, await api.signIn());

    // Everything that makes the two workspaces distinguishable lives on the stranger's side,
    // so every assertion below reads "the caller saw nothing" rather than "the caller saw the
    // right thing", which is the claim that survives a query losing its filter.
    const theirRuleId = await addRule(api, theirs.id, {
      when: { diff_kind: "docs_only" },
      then: { route_local: {} },
    });

    await insertUsage(api, theirs.id, {
      provider: "anthropic",
      costCents: "4242.0000",
      tokens: 500_000,
      taskKind: "implement",
      latencyMs: 1_234,
    });

    return { mine, theirs, theirRuleId };
  }

  /**
   * A request from the caller, acting in the caller's own workspace.
   *
   * @param stage - The two workspaces.
   * @param method - The verb.
   * @param path - The path, already resolved.
   * @returns The Supertest request.
   */
  function asCaller(
    stage: Stage,
    method: Method,
    path: string,
  ): ReturnType<ReturnType<ApiHarness["as"]>> {
    return api.as(stage.mine.owner)(method, path).set(TENANT_HEADER, stage.mine.slug);
  }

  /**
   * The stranger's workspace, exactly as it was seeded — what no probe may have moved.
   *
   * @param stage - The two workspaces.
   * @returns Their chain, their rule count and their revision count.
   */
  async function strangersWorld(
    stage: Stage,
  ): Promise<{ chain: unknown[]; rules: number; revisions: number }> {
    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*)::text as count from ${SCHEMA_NAME}.escalation_rules
        where organization_id = $1`,
      [stage.theirs.id],
    );

    return {
      chain: await storedChain(api, stage.theirs.id, "implement"),
      rules: Number(rows[0].count),
      revisions: (await revisionsOf(api, stage.theirs.id)).length,
    };
  }

  /** The stranger's world as `stage()` leaves it — three hops, one rule, no revisions. */
  const UNTOUCHED = {
    chain: [
      { position: 1, alias: "coder-max", note: "Primary" },
      { position: 2, alias: "coder-fallback", note: "Fallback on 5xx / timeouts" },
      { position: 3, alias: "local-docs", note: null },
    ],
    rules: 1,
    revisions: 0,
  };

  /**
   * Every routing endpoint, and what it must not reach.
   *
   * Held to {@link routingOperations} in both directions by the census test below, so this
   * array is complete by assertion rather than by review.
   */
  const PROBES: readonly IsolationProbe[] = [
    {
      method: "get",
      template: `${ROUTING_PREFIX}`,
      it: "draws no row, route or rule belonging to the other workspace",
      probe: async (_api, stage) => {
        const matrix = bodyOf<RoutingMatrixResource>(
          await asCaller(stage, "get", ROUTING_PREFIX).expect(200),
        );

        const routeIds = matrix.taskKinds
          .map((kind) => kind.route?.id)
          .filter((id): id is string => id !== undefined && id !== null);

        expect(routeIds.length).toBeGreaterThan(0);
        expect(routeIds.every((id) => Object.values(stage.mine.routes).includes(id))).toBe(true);
        expect(matrix.rules).toEqual([]);

        // The stranger is the only workspace with usage. A stats aggregate that lost its
        // filter would report their bill on the caller's rows.
        for (const kind of matrix.taskKinds) {
          expect(kind.route?.stats.costCentsPerRunAvg ?? null).toBeNull();
        }

        expect(matrix.spend.totalSpendCents).toBeNull();
      },
    },
    {
      method: "get",
      template: `${ROUTING_PREFIX}/aliases`,
      it: "offers no alias belonging to the other workspace",
      probe: async (_api, stage) => {
        const listed = bodyOf<AliasListResource>(
          await asCaller(stage, "get", `${ROUTING_PREFIX}/aliases`).expect(200),
        );

        const theirConnections = Object.values(stage.theirs.connections);

        expect(listed.aliases.length).toBe(Object.keys(stage.mine.aliases).length);

        for (const alias of listed.aliases) {
          expect(theirConnections).not.toContain(alias.provider?.id ?? "");
        }
      },
    },
    {
      method: "get",
      template: `${ROUTING_PREFIX}/spend`,
      it: "adds none of the other workspace's usage into a total",
      probe: async (_api, stage) => {
        const spend = bodyOf<RoutingSpendResource>(
          await asCaller(stage, "get", `${ROUTING_PREFIX}/spend`).expect(200),
        );

        expect(spend.providers).toEqual([]);
        expect(spend.totalSpendCents).toBeNull();
        expect(spend.tokens).toBe(0);
        expect(spend.unpricedCalls).toBe(0);
      },
    },
    {
      method: "get",
      template: `${ROUTING_PREFIX}/providers`,
      it: "draws no chip for the other workspace's connections",
      probe: async (_api, stage) => {
        const strip = bodyOf<ProviderHealthStripResource>(
          await asCaller(stage, "get", `${ROUTING_PREFIX}/providers`).expect(200),
        );

        const mine = Object.values(stage.mine.connections);

        expect(strip.providers.length).toBe(mine.length);
        expect(strip.providers.every((provider) => mine.includes(provider.id))).toBe(true);
      },
    },
    {
      method: "put",
      template: `${ROUTING_PREFIX}/routes`,
      it: "writes nothing into the other workspace, and cannot borrow its aliases",
      probe: async (_api, stage) => {
        await asCaller(stage, "put", `${ROUTING_PREFIX}/routes`)
          .send({ routes: [{ ...A_VALID_SAVE, taskKind: "implement" }] })
          .expect(200);

        expect(await strangersWorld(stage)).toEqual(UNTOUCHED);

        // A save naming a kind only the *other* workspace routed would be the same leak from
        // the other side; both workspaces route the same three, so the reachable statement is
        // that the caller's save moved only the caller's rows — asserted above — and that an
        // alias this workspace does not have is refused rather than resolved elsewhere.
        await asCaller(stage, "put", `${ROUTING_PREFIX}/routes`)
          .send({
            routes: [{ ...A_VALID_SAVE, taskKind: "implement", hops: [{ alias: "not-here" }] }],
          })
          .expect(422);
      },
    },
    {
      method: "put",
      template: `${ROUTING_PREFIX}/routes/{taskKind}`,
      it: "rewrites only the caller's route of that kind",
      probe: async (_api, stage) => {
        await asCaller(stage, "put", `${ROUTING_PREFIX}/routes/implement`)
          .send(A_VALID_SAVE)
          .expect(200);

        expect(await storedChain(api, stage.mine.id, "implement")).toHaveLength(1);
        expect(await strangersWorld(stage)).toEqual(UNTOUCHED);
      },
    },
    {
      method: "post",
      template: `${ROUTING_PREFIX}/rules`,
      it: "adds the rule to the caller's workspace and to no other",
      probe: async (_api, stage) => {
        const created = bodyOf<EscalationRuleResource>(
          await asCaller(stage, "post", `${ROUTING_PREFIX}/rules`)
            .send({ when: { label: "security" }, then: { route_local: {} } })
            .expect(201),
        );

        const { rows } = await api.sql.query<{ organization_id: string }>(
          `select organization_id from ${SCHEMA_NAME}.escalation_rules where id = $1`,
          [created.id],
        );

        expect(rows[0].organization_id).toBe(stage.mine.id);
        expect(await strangersWorld(stage)).toEqual(UNTOUCHED);
      },
    },
    {
      method: "patch",
      template: `${ROUTING_PREFIX}/rules/{id}`,
      it: "cannot address the other workspace's rule by id",
      probe: async (_api, stage) => {
        await asCaller(stage, "patch", `${ROUTING_PREFIX}/rules/${stage.theirRuleId}`)
          .send({ enabled: false })
          .expect(404);

        const { rows } = await api.sql.query<{ enabled: boolean }>(
          `select enabled from ${SCHEMA_NAME}.escalation_rules where id = $1`,
          [stage.theirRuleId],
        );

        expect(rows[0].enabled).toBe(true);
      },
    },
    {
      method: "delete",
      template: `${ROUTING_PREFIX}/rules/{id}`,
      it: "cannot delete the other workspace's rule by id",
      probe: async (_api, stage) => {
        await asCaller(stage, "delete", `${ROUTING_PREFIX}/rules/${stage.theirRuleId}`).expect(404);
        expect(await strangersWorld(stage)).toEqual(UNTOUCHED);
      },
    },
    {
      method: "post",
      template: `${ROUTING_PREFIX}/simulate`,
      it: "resolves against the caller's providers, and never the other workspace's rules",
      probe: async (_api, stage) => {
        const simulated = bodyOf<Resolution>(
          await asCaller(stage, "post", `${ROUTING_PREFIX}/simulate`)
            .send({ taskKind: "implement", ctx: { diffKind: "docs_only" } })
            .expect(200),
        );

        // The stranger's rule routes everything local for exactly this context. If it reached
        // across, the caller's cloud primary would be dropped as `rule_route_local` — so the
        // primary surviving is the assertion, and the empty rule list is the reason.
        expect(simulated.rules).toEqual([]);
        expect(simulated.chain[0]).toMatchObject({ alias: "coder-max", decision: "kept" });

        const mine = Object.values(stage.mine.connections);

        for (const hop of simulated.chain) {
          expect(hop.provider === null || mine.includes(hop.provider.id)).toBe(true);
        }
      },
    },
  ];

  describe("the census", () => {
    it("has a probe for every routing endpoint this application serves, and no others", () => {
      const served = routingOperations(api.nest);
      const probed = new Set(PROBES.map(keyOf));

      expect([...probed].sort()).toEqual([...served].sort());
    });

    it("reaches every endpoint on the page, including the strip a neighbour serves", () => {
      // A guard on the guard: a census read from an application that had somehow registered
      // no routing controller at all would agree with an empty probe list, and this suite
      // would pass having tested nothing.
      expect(routingOperations(api.nest).size).toBeGreaterThanOrEqual(10);
    });
  });

  describe("each endpoint", () => {
    it.each(PROBES.map((probe) => [`${keyOf(probe)} — ${probe.it}`, probe] as const))(
      "%s",
      async (_name, probe) => {
        await probe.probe(api, await stage());
      },
    );
  });

  describe("what the caller is refused outright", () => {
    it("refuses a stranger with no session on every one of them", async () => {
      for (const probe of PROBES) {
        const path = probe.template
          .replace("{taskKind}", "implement")
          .replace("{id}", "00000000-0000-4000-8000-000000000000");

        await api.anonymous(probe.method, path).expect(401);
      }
    });

    it("tells a session naming a workspace it is not in that there is no such workspace", async () => {
      const { mine, theirs } = await stage();
      const outsider: Person = mine.owner;

      // The caller has a session and a workspace; what they do not have is membership of the
      // stranger's. Naming it in the header is the most direct form of the request every probe
      // above makes indirectly, and the answer is `404 tenant_not_found` on every endpoint —
      // never a `403`, which would confirm the workspace exists to somebody entitled to know
      // nothing about it. The whole list is asserted rather than a status class, because an
      // endpoint that answered `403` while the rest answered `404` is the leak.
      const answers: string[] = [];

      for (const probe of PROBES) {
        const path = probe.template
          .replace("{taskKind}", "implement")
          .replace("{id}", "00000000-0000-4000-8000-000000000000");

        const response = await api
          .as(outsider)(probe.method, path)
          .set(TENANT_HEADER, theirs.slug)
          .send(probe.method === "get" || probe.method === "delete" ? undefined : {});

        answers.push(
          `${keyOf(probe)} ${response.status.toString()} ${bodyOf<ErrorEnvelope>(response).code}`,
        );
      }

      expect(answers).toEqual(PROBES.map((probe) => `${keyOf(probe)} 404 tenant_not_found`));
    });
  });
});
