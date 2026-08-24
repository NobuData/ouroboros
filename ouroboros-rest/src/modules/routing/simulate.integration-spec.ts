import type request from "supertest";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf, containing } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { FLOOR_CODES, HOP_CODES, RULE_CODES } from "./explanations";
import type { Resolution } from "./resolution";
import { RESOLUTION_VERSION } from "./resolution";

/**
 * `POST /api/v1/routing/simulate`, over a socket and against a migrated database
 * ([#197](https://github.com/NobuData/ouroboros/issues/197)).
 *
 * `resolve.spec.ts` runs the whole decision matrix over hand-written inputs and
 * `routing.integration-spec.ts` runs the service against real rows; what is left — and what
 * this ticket's criteria are actually about — only exists at the endpoint:
 *
 *   * **all eight seeded kinds answer with a chain and explanations.** Not one worked example:
 *     the matrix has eight rows and the panel is offered on every one of them, so a kind whose
 *     route resolves to nothing renderable is a row of the product that does not work;
 *   * **the three rule-triggering contexts each name the rule that fired**, using the sentence
 *     PostgreSQL generated from the rule's structure — which is decision **M5** proved through
 *     the wire rather than against a fixture that could have been written to match;
 *   * **a floor breach is a `200` carrying `fail_run`**, not an error. The caller asked a
 *     well-formed question about a route that exists and is entitled to be told what the route
 *     did; a `4xx` here would throw away the explanation the whole roadmap is about;
 *   * **a member may simulate, and only within their workspace.** Simulating is reading, and
 *     the isolation is the tenant guard's rather than a `where` clause a test can inspect.
 *
 * Rows are seeded with SQL rather than through the management API, for
 * `routing.integration-spec.ts`'s reason: arranging a fixture through a service under test in
 * the same suite makes the arrangement part of what is being asserted.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test. */
const SIMULATE = "/api/v1/routing/simulate";

/**
 * The eight kinds Y.4 seeds, with the chains the dev seed gives them.
 *
 * The seed's own values to the letter — a fixture that invented its own workspace would prove
 * the endpoint handles the workspace the fixture invented. `implement` keeps its three hops and
 * its `$2.50` cap; the other seven have two hops and no cap.
 */
const MATRIX: readonly { kind: string; tag: string; chain: readonly string[] }[] = [
  { kind: "analyze", tag: "analyze-primary", chain: ["coder-std", "local-docs"] },
  { kind: "estimate", tag: "estimate-primary", chain: ["sizer", "local-free"] },
  { kind: "plan", tag: "plan-primary", chain: ["coder-max", "coder-std"] },
  {
    kind: "implement",
    tag: "implement-primary",
    chain: ["coder-max", "coder-fallback", "local-docs"],
  },
  { kind: "test-gen", tag: "testgen-primary", chain: ["coder-fallback", "coder-std"] },
  { kind: "review", tag: "review-primary", chain: ["coder-max", "coder-std"] },
  { kind: "docs", tag: "docs-primary", chain: ["local-docs", "sizer"] },
  { kind: "commit-msg", tag: "commitmsg-primary", chain: ["local-free", "sizer"] },
];

/** The three rules the seed writes, in evaluation order. Structure only — `display` is derived. */
const RULES: readonly { when: Record<string, unknown>; then: Record<string, unknown> }[] = [
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

describe("the routing simulate endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace with mockup 06's matrix in it — five connections, seven aliases, eight kinds
   * with their routes and chains, and the three escalation rules.
   *
   * @param owner - Who owns it.
   * @returns The workspace.
   */
  async function seeded(owner: Person): Promise<Workspace> {
    const workspace = await api.workspace(owner);

    const anthropic = await connection(workspace.id, "anthropic", "Anthropic Claude", "active", 42);
    const copilot = await connection(workspace.id, "copilot", "GitHub Copilot", "active", null);
    const ollama = await connection(workspace.id, "ollama", "Ollama", "active", 8);

    const aliases: Record<string, string> = {
      "coder-max": await alias(workspace.id, "coder-max", anthropic, "claude-fable-5"),
      "coder-std": await alias(workspace.id, "coder-std", anthropic, "claude-sonnet-5"),
      "coder-fallback": await alias(workspace.id, "coder-fallback", copilot, "gpt-5-codex"),
      "local-docs": await alias(workspace.id, "local-docs", ollama, "qwen3-coder:32b"),
      "local-free": await alias(workspace.id, "local-free", ollama, "llama3.3:70b"),
      sizer: await alias(workspace.id, "sizer", anthropic, "claude-haiku-4-5-20251001"),
      "second-opinion": await alias(workspace.id, "second-opinion", anthropic, "claude-opus-5"),
    };

    for (const [offset, row] of MATRIX.entries()) {
      await kind(workspace.id, row.kind, offset + 1);
      await route(
        workspace.id,
        row.kind,
        row.tag,
        row.chain.map((name) => aliases[name]),
        row.kind === "implement" ? 250 : null,
      );
    }

    for (const [offset, rule] of RULES.entries()) {
      await escalationRule(workspace.id, offset + 1, rule.when, rule.then);
    }

    return workspace;
  }

  /**
   * Insert one provider connection, with the state a check left on it.
   *
   * V015 refuses a non-empty `health` without a `last_checked_at`, so the two are written
   * together or not at all.
   *
   * @param organizationId - The workspace.
   * @param providerKind - Which adapter reaches it.
   * @param displayName - What a hop's sentence prints.
   * @param status - What the last check concluded.
   * @param latencyMs - What it measured, or null when nothing did. Never `0` as a stand-in.
   * @returns The connection's id.
   */
  async function connection(
    organizationId: string,
    providerKind: string,
    displayName: string,
    status: string,
    latencyMs: number | null,
  ): Promise<string> {
    const health = latencyMs === null ? {} : { check: "reachability", latency_ms: latencyMs };

    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (organization_id, kind, display_name, base_url, status, last_checked_at, health)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id`,
      [
        organizationId,
        providerKind,
        displayName,
        providerKind === "ollama" ? "http://workstation:11434" : null,
        status,
        status === "unknown" ? null : new Date(),
        JSON.stringify(health),
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
   * @param modelId - The raw provider model string — the only place one lives (decision M1).
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
   */
  async function kind(organizationId: string, name: string, sortOrder: number): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
       values ($1, $2, $3, $4)`,
      [organizationId, name, `Everything ${name} needs`, sortOrder],
    );
  }

  /**
   * Insert a route and its chain, in one transaction.
   *
   * V016's `route_chain_intact()` is a **deferred** constraint trigger, so a route committed on
   * its own — with no hops yet — is refused at commit. The deferral exists precisely so a chain
   * may be written in one unit of work.
   *
   * @param organizationId - The workspace.
   * @param taskKind - The kind this route answers for.
   * @param tag - The route's tag.
   * @param aliasIds - The chain, primary first.
   * @param maxCostCents - The route's cap, or null for none.
   * @param floorHopIndex - The route's floor, or null for the switch being off.
   */
  async function route(
    organizationId: string,
    taskKind: string,
    tag: string,
    aliasIds: readonly string[],
    maxCostCents: number | null,
    floorHopIndex: number | null = null,
  ): Promise<void> {
    const client = await api.sql.connect();

    try {
      await client.query("begin");

      const { rows } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.routes
           (organization_id, task_kind_id, tag, max_cost_cents_per_run, floor_hop_index)
         select $1, k.id, $2, $3, $4 from ${SCHEMA_NAME}.task_kinds k
          where k.organization_id = $1 and k.name = $5
         returning id`,
        [organizationId, tag, maxCostCents, floorHopIndex, taskKind],
      );

      for (const [offset, aliasId] of aliasIds.entries()) {
        await client.query(
          `insert into ${SCHEMA_NAME}.route_hops
             (organization_id, route_id, position, model_alias_id)
           values ($1, $2, $3, $4)`,
          [organizationId, rows[0].id, offset + 1, aliasId],
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
   * Insert one escalation rule.
   *
   * `display` is never written: V018 generates it from the pair below, which is what makes the
   * sentence in a resolution one PostgreSQL derived rather than one this file chose.
   *
   * @param organizationId - The workspace.
   * @param sortOrder - Where it evaluates.
   * @param when - The predicate.
   * @param then - The route modification.
   */
  async function escalationRule(
    organizationId: string,
    sortOrder: number,
    when: Record<string, unknown>,
    then: Record<string, unknown>,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.escalation_rules
         (organization_id, enabled, sort_order, "when", "then")
       values ($1, true, $2, $3::jsonb, $4::jsonb)`,
      [organizationId, sortOrder, JSON.stringify(when), JSON.stringify(then)],
    );
  }

  /**
   * Simulate, as somebody, in a workspace.
   *
   * @param person - Whose session.
   * @param workspace - Which workspace.
   * @param body - The request.
   * @returns The pending request, so a caller states the status it expects.
   */
  function simulate(
    person: Person,
    workspace: Workspace,
    body: Record<string, unknown>,
  ): request.Test {
    return api.as(person)("post", SIMULATE).set(TENANT_HEADER, workspace.slug).send(body);
  }

  describe("who may ask", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("post", SIMULATE).send({ taskKind: "review" }).expect(401);
    });

    it("refuses a session acting in no workspace", async () => {
      const nomad = await api.signIn();

      const response = await api
        .as(nomad)("post", SIMULATE)
        .send({ taskKind: "review" })
        .expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it.each(["member", "viewer"] as const)(
      "lets a %s simulate, because simulating is reading",
      async (role) => {
        const owner = await api.signIn();
        const workspace = await seeded(owner);

        const reader = await api.signIn();
        await api.join(workspace.id, reader, role);

        const response = await simulate(reader, workspace, { taskKind: "review" }).expect(200);

        expect(bodyOf<Resolution>(response).outcome).toBe("resolved");
      },
    );

    it("does not reach another workspace's routes", async () => {
      // The kind exists — in somebody else's matrix. The tenant guard establishes the
      // workspace and the resolution never sees the other one, so this is the same `404` a
      // kind that exists nowhere gets.
      const owner = await api.signIn();
      await seeded(owner);

      const stranger = await api.signIn();
      const elsewhere = await api.workspace(stranger);

      const response = await simulate(stranger, elsewhere, { taskKind: "review" }).expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("route_not_found");
    });
  });

  describe("the matrix, all eight rows of it", () => {
    it.each(MATRIX.map((row) => [row.kind, row.tag, row.chain] as const))(
      "resolves %s with a chain and a sentence on every hop",
      async (taskKind, tag, chain) => {
        const owner = await api.signIn();
        const workspace = await seeded(owner);

        const response = await simulate(owner, workspace, { taskKind }).expect(200);
        const resolution = bodyOf<Resolution>(response);

        expect(resolution.resolutionVersion).toBe(RESOLUTION_VERSION);
        expect(resolution.taskKind).toBe(taskKind);
        expect(resolution.routeTag).toBe(tag);
        expect(resolution.outcome).toBe("resolved");
        expect(resolution.chain.map((hop) => hop.alias)).toEqual([...chain]);

        // The ticket's *chain **with explanations***: a hop with a code and no sentence is a
        // hop the panel renders as an empty line.
        for (const hop of resolution.chain) {
          expect(hop.decision).toBe("kept");
          expect(hop.code).toBe(HOP_CODES.healthy);
          expect(hop.explanation).not.toBe("");
        }

        expect(resolution.floor).toEqual({
          hopIndex: null,
          code: FLOOR_CODES.none,
          explanation: containing("No floor is set"),
        });
      },
    );

    it("carries the route's cost cap, and null where no cap is set", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const capped = bodyOf<Resolution>(
        await simulate(owner, workspace, { taskKind: "implement" }).expect(200),
      );
      const uncapped = bodyOf<Resolution>(
        await simulate(owner, workspace, { taskKind: "docs" }).expect(200),
      );

      expect(capped.maxCostCents).toBe(250);
      expect(uncapped.maxCostCents).toBeNull();
    });

    it("answers 404 for a kind this workspace has no route for", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const response = await simulate(owner, workspace, { taskKind: "translate" }).expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("route_not_found");
    });
  });

  describe("the contexts that fire a rule", () => {
    it("names the effort rule, in the sentence the database generated", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const resolution = bodyOf<Resolution>(
        await simulate(owner, workspace, { taskKind: "implement", ctx: { effort: "l" } }).expect(
          200,
        ),
      );

      const applied = resolution.rules.filter((rule) => rule.applied);

      expect(applied).toHaveLength(1);
      expect(applied[0].display).toBe("effort ≥ L → implement uses coder-max (max thinking)");
      expect(applied[0].code).toBe(RULE_CODES.paramsMerged);
      expect(resolution.chain[0].params).toEqual({ thinking: "max" });
    });

    it("names the security rule, and attaches the vote it asked for", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const resolution = bodyOf<Resolution>(
        await simulate(owner, workspace, {
          taskKind: "review",
          ctx: { labels: ["security"] },
        }).expect(200),
      );

      const applied = resolution.rules.filter((rule) => rule.applied);

      expect(applied).toHaveLength(1);
      expect(applied[0].display).toBe("security label → review adds second-opinion vote");
      expect(applied[0].code).toBe(RULE_CODES.voteAdded);

      // A vote is a requirement rather than a hop: it is not somewhere the run falls back to.
      expect(resolution.votes.map((vote) => vote.alias)).toEqual(["second-opinion"]);
      expect(resolution.votes[0].ruleId).toBe(applied[0].id);
      expect(resolution.chain.map((hop) => hop.alias)).toEqual(["coder-max", "coder-std"]);
    });

    it("names the docs-only rule, and drops the hops it is not about", async () => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const resolution = bodyOf<Resolution>(
        await simulate(owner, workspace, {
          taskKind: "implement",
          ctx: { diffKind: "docs_only" },
        }).expect(200),
      );

      const applied = resolution.rules.filter((rule) => rule.applied);

      expect(applied).toHaveLength(1);
      expect(applied[0].display).toBe("docs-only diff → everything routes local");
      expect(applied[0].code).toBe(RULE_CODES.routedLocal);

      // The two hosted hops are dropped with a stated reason and stay in the array — a chain
      // that quietly omitted them is the silence this roadmap exists to remove.
      expect(resolution.chain.map((hop) => [hop.alias, hop.decision, hop.code])).toEqual([
        ["coder-max", "dropped", HOP_CODES.notLocal],
        ["coder-fallback", "dropped", HOP_CODES.notLocal],
        ["local-docs", "kept", HOP_CODES.healthy],
      ]);
    });

    it("fires no rule for a context that states nothing", async () => {
      // An unstated fact is *unknown*, never *small* — a resolution asked with `{}` must not
      // put a run on the most expensive model in the workspace because a client omitted a field.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const resolution = bodyOf<Resolution>(
        await simulate(owner, workspace, { taskKind: "implement", ctx: {} }).expect(200),
      );

      expect(resolution.rules.filter((rule) => rule.applied)).toEqual([]);
      expect(resolution.chain[0].params).toEqual({});
    });

    it("lists a rule that matched but did nothing, with the reason it did nothing", async () => {
      // *Nothing happened and here is why* is the answer an operator needs when a rule they can
      // see on the card did not change the run they are looking at.
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const resolution = bodyOf<Resolution>(
        await simulate(owner, workspace, { taskKind: "docs", ctx: { effort: "xl" } }).expect(200),
      );

      const matched = resolution.rules.find((rule) => !rule.applied);

      expect(matched?.code).toBe(RULE_CODES.otherTaskKind);
      expect(matched?.explanation).toContain("this rule modifies implement");
    });
  });

  describe("a floor breach", () => {
    it("answers 200 carrying fail_run and its reason, not an error", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      // A two-hop chain whose primary is unreachable, floored at hop 1: the run could degrade
      // to hop 2, and the policy is what forbids it.
      const down = await connection(workspace.id, "anthropic", "Anthropic Claude", "error", null);
      const ollama = await connection(workspace.id, "ollama", "Ollama", "active", 8);

      await kind(workspace.id, "implement", 4);
      await route(
        workspace.id,
        "implement",
        "implement-primary",
        [
          await alias(workspace.id, "coder-max", down, "claude-fable-5"),
          await alias(workspace.id, "local-docs", ollama, "qwen3-coder:32b"),
        ],
        250,
        1,
      );

      const response = await simulate(owner, workspace, { taskKind: "implement" }).expect(200);
      const resolution = bodyOf<Resolution>(response);

      expect(resolution.outcome).toBe("fail_run");
      expect(resolution.failure).toEqual({
        code: "floor_breached",
        explanation: containing("this run fails rather than degrading below it"),
      });
      expect(resolution.floor.code).toBe(FLOOR_CODES.breached);

      // The chain still lists every hop, so the panel can draw exactly what went.
      expect(resolution.chain.map((hop) => [hop.alias, hop.code])).toEqual([
        ["coder-max", HOP_CODES.unreachable],
        ["local-docs", HOP_CODES.belowFloor],
      ]);
    });
  });

  describe("what it refuses", () => {
    it.each([
      ["a kind outside the column's shape", { taskKind: "Implement" }],
      ["a size that is not on the scale", { taskKind: "implement", ctx: { effort: "xxl" } }],
      ["a fact no rule could read", { taskKind: "implement", ctx: { priority: "high" } }],
      ["a body field this endpoint does not take", { taskKind: "implement", organizationId: "x" }],
    ])("answers 422 for %s", async (_what, body) => {
      const owner = await api.signIn();
      const workspace = await seeded(owner);

      const response = await simulate(owner, workspace, body).expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
    });
  });
});
