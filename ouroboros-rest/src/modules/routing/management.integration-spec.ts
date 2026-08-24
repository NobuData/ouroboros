import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME, type RouteRevisionDiff } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type {
  AliasListResource,
  EscalationRuleResource,
  RoutingMatrixResource,
  SaveRoutesResource,
} from "./resources";

/**
 * `/api/v1/routing`, over a socket and against a migrated database
 * ([#195](https://github.com/NobuData/ouroboros/issues/195)).
 *
 * Every one of this ticket's criteria only exists end to end, and this suite is what they are:
 *
 *   * **the round trip.** A reorder, an alias swap and a policy edit go out through `PUT` and
 *     come back identical from `GET` — which is only meaningful against V016's real
 *     constraints, because a chain rewrite is legal here *because* both ordering rules are
 *     deferred, and a fixture cannot demonstrate a deferral;
 *   * **the revision.** Each save writes one `route_revisions` row whose diff is exactly what
 *     moved, and a save that moved nothing writes none — the second half being V021's CHECK
 *     rather than a habit;
 *   * **atomicity.** A batch with one bad route leaves the good one untouched, which is a
 *     claim about the database and not about a mock;
 *   * **the role gate.** A member reads and cannot write, refused by the server rather than by
 *     a hidden button, on every endpoint;
 *   * **`display` is not writable**, in all three places that refuse it; and
 *   * **isolation.** Another workspace's route is neither readable nor writable, and its rules
 *     are unaddressable by id.
 *
 * Rows are seeded with SQL rather than through a second service, for
 * `routing.integration-spec.ts`'s reason: the surface under test is the only writer this
 * roadmap has, and staging its fixtures through it would make the arrangement and the
 * assertion the same code.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surfaces under test. */
const MATRIX = "/api/v1/routing";
const ALIASES = "/api/v1/routing/aliases";
const ROUTES = "/api/v1/routing/routes";
const RULES = "/api/v1/routing/rules";

describe("the routing management endpoints", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace with mockup 06's routing foundations.
   *
   * Two connections, four aliases (one of them V019's unbound row), and two routed kinds —
   * `implement` with a three-hop chain and `docs` with one. `review` is a kind with **no
   * route**, which is the matrix row with an empty cell V016 permits on purpose.
   *
   * @param owner - Who owns it.
   * @returns The workspace.
   */
  async function seeded(owner: Person): Promise<Workspace> {
    const workspace = await api.workspace(owner);

    const anthropic = await connection(workspace.id, "anthropic", "Anthropic");
    const ollama = await connection(workspace.id, "ollama", "Ollama");

    const aliases = {
      "coder-max": await alias(workspace.id, "coder-max", anthropic, "claude-fable-5"),
      "coder-fallback": await alias(workspace.id, "coder-fallback", anthropic, "claude-sonnet-5"),
      "local-docs": await alias(workspace.id, "local-docs", ollama, "qwen3-coder:32b"),
      "second-opinion": await alias(workspace.id, "second-opinion", null, "gpt-5-preview"),
    };

    await kind(workspace.id, "implement", 4);
    await kind(workspace.id, "docs", 7);
    await kind(workspace.id, "review", 6);

    await route(workspace.id, "implement", "implement-primary", [
      { id: aliases["coder-max"], note: "Primary" },
      { id: aliases["coder-fallback"], note: "Fallback on 5xx / timeouts" },
      { id: aliases["local-docs"], note: null },
    ]);
    await route(workspace.id, "docs", "docs-primary", [{ id: aliases["local-docs"], note: null }]);

    return workspace;
  }

  /**
   * Insert one provider connection.
   *
   * @param organizationId - The workspace.
   * @param providerKind - Which adapter reaches it.
   * @param displayName - What the resolution line prints.
   * @returns The connection's id.
   */
  async function connection(
    organizationId: string,
    providerKind: string,
    displayName: string,
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (organization_id, kind, display_name, base_url)
       values ($1, $2, $3, $4) returning id`,
      [
        organizationId,
        providerKind,
        displayName,
        providerKind === "ollama" ? "http://workstation:11434" : null,
      ],
    );

    return rows[0].id;
  }

  /**
   * Insert one alias. A null connection is V019's **unbound** state, which V015's CHECK
   * requires to be disabled.
   *
   * @param organizationId - The workspace.
   * @param name - The alias.
   * @param connectionId - Where it runs, or null.
   * @param modelId - The raw provider model string.
   * @returns The alias's id.
   */
  async function alias(
    organizationId: string,
    name: string,
    connectionId: string | null,
    modelId: string,
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.model_aliases
         (organization_id, alias, provider_connection_id, model_id, enabled)
       values ($1, $2, $3, $4, $5) returning id`,
      [organizationId, name, connectionId, modelId, connectionId !== null],
    );

    return rows[0].id;
  }

  /**
   * Insert one task kind.
   *
   * @param organizationId - The workspace.
   * @param name - The kind's name.
   * @param sortOrder - Where the matrix draws it.
   * @returns The kind's id.
   */
  async function kind(organizationId: string, name: string, sortOrder: number): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
       values ($1, $2, $3, $4) returning id`,
      [organizationId, name, `Everything ${name} needs`, sortOrder],
    );

    return rows[0].id;
  }

  /**
   * Insert a route and its chain, in one transaction.
   *
   * V016's `route_chain_intact()` is a **deferred** constraint trigger, so a route committed
   * on its own — with no hops yet — is refused at commit. The deferral exists precisely so a
   * chain may be written, or rewritten, in one unit of work; this is what using it looks like,
   * and it is the same shape the endpoint under test uses.
   *
   * @param organizationId - The workspace.
   * @param taskKind - The kind this route answers for.
   * @param tag - The route's tag.
   * @param hops - The chain, primary first.
   */
  async function route(
    organizationId: string,
    taskKind: string,
    tag: string,
    hops: readonly { id: string; note: string | null }[],
  ): Promise<void> {
    const client = await api.sql.connect();

    try {
      await client.query("begin");

      const { rows } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.routes
           (organization_id, task_kind_id, tag, max_cost_cents_per_run)
         select $1, k.id, $2, 250 from ${SCHEMA_NAME}.task_kinds k
          where k.organization_id = $1 and k.name = $3
         returning id`,
        [organizationId, tag, taskKind],
      );

      for (const [offset, hop] of hops.entries()) {
        await client.query(
          `insert into ${SCHEMA_NAME}.route_hops
             (organization_id, route_id, position, model_alias_id, note)
           values ($1, $2, $3, $4, $5)`,
          [organizationId, rows[0].id, offset + 1, hop.id, hop.note],
        );
      }

      await client.query("commit");
    } catch (failure) {
      await client.query("rollback");
      throw failure;
    } finally {
      client.release();
    }
  }

  /**
   * A route's chain, straight from the table — what a refusal must not have moved.
   *
   * @param organizationId - The workspace.
   * @param taskKind - Which route.
   * @returns The chain as `position`, alias and note, in order.
   */
  async function storedChain(
    organizationId: string,
    taskKind: string,
  ): Promise<{ position: number; alias: string; note: string | null }[]> {
    const { rows } = await api.sql.query<{ position: number; alias: string; note: string | null }>(
      `select h.position, a.alias, h.note
         from ${SCHEMA_NAME}.route_hops h
         join ${SCHEMA_NAME}.model_aliases a on a.id = h.model_alias_id
         join ${SCHEMA_NAME}.routes r on r.id = h.route_id
         join ${SCHEMA_NAME}.task_kinds k on k.id = r.task_kind_id
        where h.organization_id = $1 and k.name = $2
        order by h.position`,
      [organizationId, taskKind],
    );

    return rows;
  }

  /**
   * The workspace's revisions, newest first.
   *
   * @param organizationId - The workspace.
   * @returns The rows, as the audit log (#26) will read them.
   */
  async function revisions(
    organizationId: string,
  ): Promise<{ id: string; actor: string | null; diff: RouteRevisionDiff }[]> {
    const { rows } = await api.sql.query<{
      id: string;
      actor: string | null;
      diff: RouteRevisionDiff;
    }>(
      `select id, actor, diff from ${SCHEMA_NAME}.route_revisions
        where organization_id = $1 order by created_at desc, id desc`,
      [organizationId],
    );

    return rows;
  }

  /** The whole `implement` chain, as a body that changes nothing. */
  const IMPLEMENT_AS_IS = {
    hops: [
      { alias: "coder-max", note: "Primary" },
      { alias: "coder-fallback", note: "Fallback on 5xx / timeouts" },
      { alias: "local-docs", note: null },
    ],
    allowLocalFallback: true,
    floorHopIndex: null,
    maxCostCentsPerRun: 250,
  };

  describe("who may ask", () => {
    it("refuses a stranger on every endpoint", async () => {
      await api.anonymous("get", MATRIX).expect(401);
      await api.anonymous("get", ALIASES).expect(401);
      await api.anonymous("put", ROUTES).expect(401);
      await api.anonymous("post", RULES).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", MATRIX).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it("lets a viewer read the matrix, because a viewer exists to look", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);
      const viewer = await api.signIn();
      await api.join(workspace.id, viewer, "viewer");

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(viewer)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.taskKinds.map((row) => row.name)).toEqual(["implement", "review", "docs"]);
    });

    it.each([
      [
        "a batch save",
        "put" as const,
        ROUTES,
        { routes: [{ ...IMPLEMENT_AS_IS, taskKind: "implement" }] },
      ],
      ["a single save", "put" as const, `${ROUTES}/implement`, IMPLEMENT_AS_IS],
      [
        "adding a rule",
        "post" as const,
        RULES,
        { when: { effort_gte: "l" }, then: { route_local: {} } },
      ],
    ])("refuses %s from a member, server-side", async (_what, method, path, body) => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);
      const member = await api.signIn();
      await api.join(workspace.id, member, "member");

      const response = await api
        .as(member)(method, path)
        .set(TENANT_HEADER, workspace.slug)
        .send(body)
        .expect(403);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("forbidden");
      expect(await revisions(workspace.id)).toHaveLength(0);
    });

    it("refuses a member's rule edit and delete too", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);
      const member = await api.signIn();
      await api.join(workspace.id, member, "member");

      const rule = bodyOf<EscalationRuleResource>(
        await api
          .as(owner)("post", RULES)
          .set(TENANT_HEADER, workspace.slug)
          .send({ when: { diff_kind: "docs_only" }, then: { route_local: {} } })
          .expect(201),
      );

      await api
        .as(member)("patch", `${RULES}/${rule.id}`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: false })
        .expect(403);
      await api
        .as(member)("delete", `${RULES}/${rule.id}`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(403);
    });
  });

  describe("the matrix", () => {
    it("draws every kind, its chain and each hop's resolution", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      const implement = matrix.taskKinds.find((row) => row.name === "implement");

      expect(implement?.route?.tag).toBe("implement-primary");
      expect(implement?.route?.hops.map((hop) => [hop.position, hop.alias, hop.modelId])).toEqual([
        [1, "coder-max", "claude-fable-5"],
        [2, "coder-fallback", "claude-sonnet-5"],
        [3, "local-docs", "qwen3-coder:32b"],
      ]);
      expect(implement?.route?.hops[2].provider).toMatchObject({
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: "http://workstation:11434",
      });
    });

    it("draws a kind with no route as a row with an empty cell", async () => {
      // V016 makes `routes.task_kind_id` unique but not mandatory, so this is a legal state —
      // and hiding it would hide a kind the workspace has.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.taskKinds.find((row) => row.name === "review")?.route).toBeNull();
    });

    it("reports both stats as null for a route whose kind nothing has been spent on", async () => {
      // Decision M7. Z.5 (#198) computes them from `token_usage`, and this workspace's ledger is
      // empty — so the honest answer is the em-dash a null renders as, never a fabricated
      // `$0.00`. The three counts are counts of rows and not claims about money.
      // `stats.integration-spec.ts` is where the figures a populated ledger produces are
      // asserted.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.taskKinds.find((row) => row.name === "docs")?.route?.stats).toEqual({
        costCentsPerRunAvg: null,
        latencyP50Ms: null,
        pricedCalls: 0,
        unpricedCalls: 0,
        timedCalls: 0,
      });
    });

    it("answers a workspace with no foundations with empty arrays", async () => {
      const owner = await api.signIn();
      const bare = await api.workspace(owner);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, bare.slug).expect(200),
      );

      // The spend card is present and in its zero-state rather than absent: a workspace with no
      // foundations still has a card to draw, and `localTokenShare: null` is what it says —
      // *nothing ran*, not *nothing ran locally*.
      expect(matrix.taskKinds).toEqual([]);
      expect(matrix.rules).toEqual([]);
      expect(matrix.spend).toMatchObject({
        providers: [],
        totalSpendCents: null,
        tokens: 0,
        localTokens: 0,
        localTokenShare: null,
        unpricedCalls: 0,
      });
    });
  });

  describe("the alias list", () => {
    it("offers every alias, unbound ones included", async () => {
      // Mockup 21 draws the unbound row as first-class, and a swap menu that hid it would make
      // an alias created ahead of its key unreachable from the surface that would use it.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const list = bodyOf<AliasListResource>(
        await api.as(owner)("get", ALIASES).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(list.aliases.map((entry) => entry.alias)).toEqual([
        "coder-fallback",
        "coder-max",
        "local-docs",
        "second-opinion",
      ]);
      expect(list.aliases.find((entry) => entry.alias === "second-opinion")?.provider).toBeNull();
    });
  });

  describe("saving a route", () => {
    it("round-trips a reorder, an alias swap and a policy edit", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const saved = bodyOf<SaveRoutesResource>(
        await api
          .as(owner)("put", `${ROUTES}/implement`)
          .set(TENANT_HEADER, workspace.slug)
          .send({
            hops: [{ alias: "coder-fallback", note: "Now primary" }, { alias: "second-opinion" }],
            allowLocalFallback: false,
            floorHopIndex: 2,
            maxCostCentsPerRun: 500,
          })
          .expect(200),
      );

      expect(saved.routes[0].hops).toEqual([
        expect.objectContaining({ position: 1, alias: "coder-fallback", note: "Now primary" }),
        expect.objectContaining({ position: 2, alias: "second-opinion", note: null }),
      ]);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.taskKinds.find((row) => row.name === "implement")?.route).toEqual(
        saved.routes[0],
      );
    });

    it("leaves the chain dense from 1 after a shortening rewrite", async () => {
      // V016's `route_chain_intact()` would refuse anything else at commit — this is what
      // proves the rewrite goes through the deferral rather than around it.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      await api
        .as(owner)("put", `${ROUTES}/implement`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ ...IMPLEMENT_AS_IS, hops: [{ alias: "local-docs" }, { alias: "coder-max" }] })
        .expect(200);

      expect(await storedChain(workspace.id, "implement")).toEqual([
        { position: 1, alias: "local-docs", note: null },
        { position: 2, alias: "coder-max", note: null },
      ]);
    });

    it("records who saved it", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      await api
        .as(owner)("put", `${ROUTES}/implement`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ ...IMPLEMENT_AS_IS, maxCostCentsPerRun: 900 })
        .expect(200);

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.taskKinds.find((row) => row.name === "implement")?.route?.updatedBy).toBe(
        owner.id,
      );
    });
  });

  describe("the revision trail", () => {
    it("writes one row per save, with the actor and exactly what moved", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const saved = bodyOf<SaveRoutesResource>(
        await api
          .as(owner)("put", ROUTES)
          .set(TENANT_HEADER, workspace.slug)
          .send({
            routes: [
              { ...IMPLEMENT_AS_IS, taskKind: "implement", floorHopIndex: 2 },
              {
                taskKind: "docs",
                hops: [{ alias: "local-docs" }],
                allowLocalFallback: false,
                floorHopIndex: null,
                maxCostCentsPerRun: 250,
              },
            ],
          })
          .expect(200),
      );

      const [revision] = await revisions(workspace.id);

      expect(revision.id).toBe(saved.revisionId);
      expect(revision.actor).toBe(owner.id);
      expect(revision.diff).toEqual({
        routes: [
          { task_kind: "implement", changes: { floor_hop_index: { from: null, to: 2 } } },
          { task_kind: "docs", changes: { allow_local_fallback: { from: true, to: false } } },
        ],
      });
    });

    it("records a reorder as the chain it was, and the chain it is", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      await api
        .as(owner)("put", `${ROUTES}/docs`)
        .set(TENANT_HEADER, workspace.slug)
        .send({
          hops: [{ alias: "coder-max", note: "Swapped" }],
          allowLocalFallback: true,
          floorHopIndex: null,
          maxCostCentsPerRun: 250,
        })
        .expect(200);

      const [revision] = await revisions(workspace.id);

      expect(revision.diff.routes[0].changes.hops).toEqual({
        from: [{ alias: "local-docs", note: null }],
        to: [{ alias: "coder-max", note: "Swapped" }],
      });
    });

    it("writes nothing at all for a save that changed nothing", async () => {
      // V021 refuses an empty diff by CHECK, so this is structural rather than a habit: there
      // is no row to write, and `revisionId` says so.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const saved = bodyOf<SaveRoutesResource>(
        await api
          .as(owner)("put", `${ROUTES}/implement`)
          .set(TENANT_HEADER, workspace.slug)
          .send(IMPLEMENT_AS_IS)
          .expect(200),
      );

      expect(saved.revisionId).toBeNull();
      expect(await revisions(workspace.id)).toHaveLength(0);
    });
  });

  describe("what a save is refused for", () => {
    it.each([
      ["an empty chain", { ...IMPLEMENT_AS_IS, hops: [] }, "validation_failed", "hops"],
      [
        "an alias this workspace does not have",
        { ...IMPLEMENT_AS_IS, hops: [{ alias: "nope" }] },
        "route_save_invalid",
        "hops.0.alias",
      ],
      [
        "a floor deeper than the chain",
        { ...IMPLEMENT_AS_IS, floorHopIndex: 9 },
        "route_save_invalid",
        "floorHopIndex",
      ],
    ])("refuses %s with a 422 naming the field", async (_what, body, code, field) => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const response = await api
        .as(owner)("put", `${ROUTES}/implement`)
        .set(TENANT_HEADER, workspace.slug)
        .send(body)
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe(code);
      expect(JSON.stringify(envelope.details)).toContain(field);
      expect(await storedChain(workspace.id, "implement")).toHaveLength(3);
    });

    it("refuses a task kind this workspace does not route, naming the kind", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const response = await api
        .as(owner)("put", `${ROUTES}/review`)
        .set(TENANT_HEADER, workspace.slug)
        .send(IMPLEMENT_AS_IS)
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).details).toEqual({
        routes: {
          review: { taskKind: [expect.stringContaining("no route") as unknown as string] },
        },
      });
    });

    it("commits none of a batch when one route in it is wrong", async () => {
      // The atomicity criterion. Every refusal is decided before the transaction opens, so the
      // good route is not written either — and a corrected batch can simply be re-sent.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const response = await api
        .as(owner)("put", ROUTES)
        .set(TENANT_HEADER, workspace.slug)
        .send({
          routes: [
            { ...IMPLEMENT_AS_IS, taskKind: "implement", hops: [{ alias: "local-docs" }] },
            {
              taskKind: "docs",
              hops: [{ alias: "local-docs" }],
              allowLocalFallback: true,
              floorHopIndex: 4,
              maxCostCentsPerRun: 250,
            },
          ],
        })
        .expect(422);

      expect(Object.keys(bodyOf<ErrorEnvelope>(response).details.routes as object)).toEqual([
        "docs",
      ]);
      expect(await storedChain(workspace.id, "implement")).toHaveLength(3);
      expect(await revisions(workspace.id)).toHaveLength(0);
    });
  });

  describe("the escalation rules", () => {
    it("stores the mockup's three and derives each sentence server-side", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const rules = [
        {
          when: { effort_gte: "l" },
          then: {
            use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
          },
        },
        {
          when: { label: "security" },
          then: { add_vote: { task_kind: "review", alias: "second-opinion" } },
        },
        { when: { diff_kind: "docs_only" }, then: { route_local: {} } },
      ];

      for (const rule of rules) {
        await api
          .as(owner)("post", RULES)
          .set(TENANT_HEADER, workspace.slug)
          .send(rule)
          .expect(201);
      }

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(matrix.rules.map((rule) => rule.display)).toEqual([
        "effort ≥ L → implement uses coder-max (max thinking)",
        "security label → review adds second-opinion vote",
        "docs-only diff → everything routes local",
      ]);
      expect(matrix.rules.map((rule) => rule.sortOrder)).toEqual([1, 2, 3]);
    });

    it("refuses a hand-written sentence rather than silently overwriting it", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const response = await api
        .as(owner)("post", RULES)
        .set(TENANT_HEADER, workspace.slug)
        .send({
          when: { diff_kind: "docs_only" },
          then: { route_local: {} },
          display: "docs-only diff → everything routes to my favourite model",
        })
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe("validation_failed");
      expect(Object.keys(envelope.details)).toContain("display");
    });

    it.each([
      ["a predicate with no condition", { when: {}, then: { route_local: {} } }, "when"],
      [
        "a condition nothing evaluates",
        { when: { phase: "night" }, then: { route_local: {} } },
        "when",
      ],
      ["an action nothing performs", { when: { effort_gte: "l" }, then: { explode: {} } }, "then"],
      [
        "two actions at once",
        {
          when: { effort_gte: "l" },
          then: { route_local: {}, add_vote: { task_kind: "review", alias: "second-opinion" } },
        },
        "then",
      ],
    ])("refuses %s, by V018's own grammar", async (_what, rule, field) => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const response = await api
        .as(owner)("post", RULES)
        .set(TENANT_HEADER, workspace.slug)
        .send(rule)
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe("escalation_rule_invalid");
      expect(Object.keys(envelope.details.fields as object)).toContain(field);
    });

    it("refuses a rule naming a task kind or alias this workspace does not have", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const response = await api
        .as(owner)("post", RULES)
        .set(TENANT_HEADER, workspace.slug)
        .send({
          when: { label: "security" },
          then: { add_vote: { task_kind: "triage", alias: "nope" } },
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("escalation_rule_invalid");
    });

    it("regenerates the sentence when the rule changes", async () => {
      // The column recomputes on every write that touches `"when"` or `"then"`, so an edited
      // rule cannot keep the sentence it used to have.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const created = bodyOf<EscalationRuleResource>(
        await api
          .as(owner)("post", RULES)
          .set(TENANT_HEADER, workspace.slug)
          .send({ when: { effort_gte: "l" }, then: { route_local: {} } })
          .expect(201),
      );

      const changed = bodyOf<EscalationRuleResource>(
        await api
          .as(owner)("patch", `${RULES}/${created.id}`)
          .set(TENANT_HEADER, workspace.slug)
          .send({ when: { diff_kind: "docs_only" } })
          .expect(200),
      );

      expect(created.display).not.toBe(changed.display);
      expect(changed.display).toBe("docs-only diff → everything routes local");
    });

    it("keeps a switched-off rule in place, with its sentence", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const created = bodyOf<EscalationRuleResource>(
        await api
          .as(owner)("post", RULES)
          .set(TENANT_HEADER, workspace.slug)
          .send({ when: { diff_kind: "docs_only" }, then: { route_local: {} } })
          .expect(201),
      );

      const off = bodyOf<EscalationRuleResource>(
        await api
          .as(owner)("patch", `${RULES}/${created.id}`)
          .set(TENANT_HEADER, workspace.slug)
          .send({ enabled: false })
          .expect(200),
      );

      expect(off).toEqual({ ...created, enabled: false });
    });

    it("refuses a position another rule already holds", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      await api
        .as(owner)("post", RULES)
        .set(TENANT_HEADER, workspace.slug)
        .send({ sortOrder: 1, when: { diff_kind: "docs_only" }, then: { route_local: {} } })
        .expect(201);

      const response = await api
        .as(owner)("post", RULES)
        .set(TENANT_HEADER, workspace.slug)
        .send({ sortOrder: 1, when: { effort_gte: "l" }, then: { route_local: {} } })
        .expect(409);

      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe("escalation_rule_sort_order_taken");
      // The position is read out of the driver's own `detail` — the statement that failed is
      // behind a callback and the value is not in hand where the error is caught. Asserted
      // against a real violation rather than a hand-written error object, because a `detail`
      // this service parses is a string PostgreSQL owns the wording of.
      expect(envelope.details).toEqual({ sortOrder: 1 });
    });

    it("removes one, and answers 404 for it afterwards", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const created = bodyOf<EscalationRuleResource>(
        await api
          .as(owner)("post", RULES)
          .set(TENANT_HEADER, workspace.slug)
          .send({ when: { diff_kind: "docs_only" }, then: { route_local: {} } })
          .expect(201),
      );

      await api
        .as(owner)("delete", `${RULES}/${created.id}`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(204);

      const response = await api
        .as(owner)("patch", `${RULES}/${created.id}`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: false })
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("escalation_rule_not_found");
    });
  });

  describe("one workspace and another", () => {
    it("does not draw another workspace's matrix", async () => {
      const owner = await api.signIn();
      const mine = await seeded(owner);
      const theirs = await seeded(await api.signIn());

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(owner)("get", MATRIX).set(TENANT_HEADER, mine.slug).expect(200),
      );

      expect(matrix.taskKinds).toHaveLength(3);
      expect(await storedChain(theirs.id, "implement")).toHaveLength(3);
    });

    it("does not write another workspace's route", async () => {
      const owner = await api.signIn();
      const mine = await seeded(owner);
      const theirs = await seeded(await api.signIn());

      await api
        .as(owner)("put", `${ROUTES}/implement`)
        .set(TENANT_HEADER, mine.slug)
        .send({ ...IMPLEMENT_AS_IS, hops: [{ alias: "local-docs" }] })
        .expect(200);

      expect(await storedChain(theirs.id, "implement")).toHaveLength(3);
      expect(await revisions(theirs.id)).toHaveLength(0);
    });

    it("cannot address another workspace's rule by id", async () => {
      const stranger = await api.signIn();
      const theirs = await seeded(stranger);
      const owner = await api.signIn();
      const mine = await seeded(owner);

      const rule = bodyOf<EscalationRuleResource>(
        await api
          .as(stranger)("post", RULES)
          .set(TENANT_HEADER, theirs.slug)
          .send({ when: { diff_kind: "docs_only" }, then: { route_local: {} } })
          .expect(201),
      );

      await api
        .as(owner)("patch", `${RULES}/${rule.id}`)
        .set(TENANT_HEADER, mine.slug)
        .send({ enabled: false })
        .expect(404);
      await api
        .as(owner)("delete", `${RULES}/${rule.id}`)
        .set(TENANT_HEADER, mine.slug)
        .expect(404);
    });
  });
});
