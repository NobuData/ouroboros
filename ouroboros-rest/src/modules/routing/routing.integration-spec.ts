import { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { ResolutionService } from "./resolution.service";
import { ROUTING_ERRORS } from "./routing.errors";

/**
 * Resolution against a migrated database — V016's chain, V018's rules, and V015's health, as
 * PostgreSQL actually stores them ([#194](https://github.com/NobuData/ouroboros/issues/194)).
 *
 * `resolve.spec.ts` runs the whole decision matrix over hand-written inputs, and that is
 * exactly what makes this suite necessary: a hand-written input is written to the rules its
 * author believes the schema has. Four things can only be asserted here, and three of them are
 * the ticket's own criteria:
 *
 *   * **the four statements are ones the server accepts** — a route found through its kind's
 *     name, a chain left-joined to its providers, every alias in the workspace, and the
 *     enabled rules in order;
 *   * **the card's sentence reaches the explanation panel verbatim.** `display` is a
 *     `generated always … stored` column, so the string in a resolution is one PostgreSQL
 *     derived from the rule's structure — which is decision **M5** proved end to end rather
 *     than asserted against a fixture that could have been written to match;
 *   * **an unbound alias is a dropped hop rather than a missing one.** V019 permits the row;
 *     the left join is what admits it, and only a real join can demonstrate that; and
 *   * **one workspace's rules do not reach another's routes**, which is a property of every
 *     `where organization_id` in the module and of nothing a unit test can see.
 *
 * Rows are inserted with SQL rather than through a service, for `registry.integration-spec.ts`'s
 * reason: decision **M2** leaves every write over these tables to Z.2 (#195), and giving this
 * module a writer for a test would be the pre-emption M2 exists to prevent.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

describe("route resolution, against a migrated database", () => {
  let api: ApiHarness;
  let resolution: ResolutionService;

  beforeAll(async () => {
    api = await ApiHarness.start();
    resolution = api.nest.get(ResolutionService);
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * A workspace with an owner.
   *
   * @returns The workspace's id.
   */
  async function workspace(): Promise<string> {
    return (await api.workspace(await api.signIn())).id;
  }

  /**
   * Insert one provider connection, optionally with a health snapshot.
   *
   * @param organizationId - The workspace.
   * @param kind - Which adapter reaches it.
   * @param displayName - What the inspector prints.
   * @param health - The status, and what a check measured. V015 refuses a non-empty `health`
   *   without a `last_checked_at`, so the two are written together or not at all.
   * @returns The connection's id.
   */
  async function connection(
    organizationId: string,
    kind: string,
    displayName: string,
    health: { status?: string; latencyMs?: number; detail?: string } = {},
  ): Promise<string> {
    const measured: Record<string, unknown> = { check: "reachability" };

    if (health.latencyMs !== undefined) {
      measured.latency_ms = health.latencyMs;
    }

    if (health.detail !== undefined) {
      measured.detail = health.detail;
    }

    const checked = health.status !== undefined && health.status !== "unknown";
    const baseUrl =
      kind === "ollama" || kind === "openai_compatible" ? "http://127.0.0.1:11434" : null;

    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (organization_id, kind, display_name, base_url, status, last_checked_at, health)
       values ($1, $2, $3, $4, coalesce($5, 'unknown'), $6, $7::jsonb)
       returning id`,
      [
        organizationId,
        kind,
        displayName,
        baseUrl,
        health.status ?? null,
        checked ? new Date() : null,
        checked ? JSON.stringify(measured) : "{}",
      ],
    );

    return rows[0].id;
  }

  /**
   * Insert one alias.
   *
   * @param organizationId - The workspace.
   * @param alias - The name routes use.
   * @param connectionId - Where it runs, or null for V019's unbound state.
   * @param modelId - The raw provider model string — the only place one lives (decision M1).
   * @returns The alias's id.
   */
  async function registerAlias(
    organizationId: string,
    alias: string,
    connectionId: string | null,
    modelId: string,
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.model_aliases
         (organization_id, alias, provider_connection_id, model_id, enabled)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [organizationId, alias, connectionId, modelId, connectionId !== null],
    );

    return rows[0].id;
  }

  /**
   * Insert a task kind, its route, and the route's chain.
   *
   * @param organizationId - The workspace.
   * @param name - The kind's name.
   * @param tag - The route's tag.
   * @param aliasIds - The chain, primary first.
   * @param policy - The route's floor and cap. Both default to *not configured*, which is what
   *   the mockup's switches are set to.
   */
  async function route(
    organizationId: string,
    name: string,
    tag: string,
    aliasIds: readonly string[],
    policy: { floor?: number; maxCostCents?: number; allowLocal?: boolean } = {},
  ): Promise<void> {
    // One transaction, because V016's `route_chain_intact()` is a **deferred** constraint
    // trigger: a route is its chain, so a route committed on its own — with no hops yet — is
    // refused at commit. The deferral exists precisely so a chain may be written, or rewritten,
    // in one unit of work, and this is what using it looks like.
    const client = await api.sql.connect();

    try {
      await client.query("begin");

      const { rows: kinds } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
         values ($1, $2, $3, 1) returning id`,
        [organizationId, name, `Everything ${name} needs`],
      );

      const { rows: routes } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.routes
           (organization_id, task_kind_id, tag, allow_local_fallback, floor_hop_index,
            max_cost_cents_per_run)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          organizationId,
          kinds[0].id,
          tag,
          policy.allowLocal ?? true,
          policy.floor ?? null,
          policy.maxCostCents ?? null,
        ],
      );

      for (const [offset, aliasId] of aliasIds.entries()) {
        await client.query(
          `insert into ${SCHEMA_NAME}.route_hops
             (organization_id, route_id, position, model_alias_id, note)
           values ($1, $2, $3, $4, $5)`,
          [
            organizationId,
            routes[0].id,
            offset + 1,
            aliasId,
            offset === 1 ? "Fallback on 5xx / timeouts" : null,
          ],
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
   * Insert one escalation rule. `display` is deliberately not supplied — the column is
   * generated, and PostgreSQL refuses a writer that supplies one.
   *
   * @param organizationId - The workspace.
   * @param sortOrder - Its place in the evaluation order.
   * @param when - The predicate.
   * @param then - The route modification.
   * @param enabled - Whether the card's switch is on.
   */
  async function rule(
    organizationId: string,
    sortOrder: number,
    when: Record<string, unknown>,
    then: Record<string, unknown>,
    enabled = true,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.escalation_rules
         (organization_id, enabled, sort_order, "when", "then")
       values ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [organizationId, enabled, sortOrder, JSON.stringify(when), JSON.stringify(then)],
    );
  }

  /**
   * The mockup's workspace: three providers, three aliases, and `implement-primary`.
   *
   * @param policy - The route's policies, for the cases that are about one.
   * @returns The workspace's id.
   */
  async function mockupWorkspace(
    policy: { floor?: number; maxCostCents?: number; allowLocal?: boolean } = {
      maxCostCents: 250,
    },
  ): Promise<string> {
    const organizationId = await workspace();

    const anthropic = await connection(organizationId, "anthropic", "Anthropic Claude", {
      status: "active",
      latencyMs: 42,
    });
    const copilot = await connection(organizationId, "copilot", "GitHub Copilot", {
      status: "active",
      detail: "elevated latency",
    });
    const ollama = await connection(organizationId, "ollama", "Ollama · workstation", {
      status: "active",
    });

    await route(
      organizationId,
      "implement",
      "implement-primary",
      [
        await registerAlias(organizationId, "coder-max", anthropic, "claude-fable-5"),
        await registerAlias(organizationId, "coder-fallback", copilot, "gpt-5-codex"),
        await registerAlias(organizationId, "local-docs", ollama, "qwen3-coder:32b"),
      ],
      policy,
    );

    return organizationId;
  }

  it("resolves the inspector's chain out of rows the server accepted", async () => {
    const organizationId = await mockupWorkspace();

    const resolved = await resolution.resolve(organizationId, "implement");

    expect(resolved.outcome).toBe("resolved");
    expect(resolved.routeTag).toBe("implement-primary");
    expect(resolved.maxCostCents).toBe(250);
    expect(resolved.chain.map((hop) => [hop.alias, hop.modelId, hop.decision])).toEqual([
      ["coder-max", "claude-fable-5", "kept"],
      ["coder-fallback", "gpt-5-codex", "kept"],
      ["local-docs", "qwen3-coder:32b", "kept"],
    ]);
  });

  it("reads health out of the column rather than out of a check it performed", async () => {
    const organizationId = await mockupWorkspace();

    const [primary, fallback] = (await resolution.resolve(organizationId, "implement")).chain;

    expect(primary.provider?.latencyMs).toBe(42);
    expect(primary.explanation).toBe("Primary · healthy · 42ms");
    expect(fallback.explanation).toBe("Fallback 1 · healthy · elevated latency");
  });

  it("drops a hop whose provider the column says is unusable", async () => {
    const organizationId = await mockupWorkspace();

    // The status and the detail move together, which is what V015's
    // `provider_connections_health_measured` insists on and what makes the quoted reason in
    // the sentence below a value a real check would have written.
    await api.sql.query(
      `update ${SCHEMA_NAME}.provider_connections
          set status = 'error',
              health = '{"check": "reachability", "detail": "503 upstream"}'::jsonb
        where organization_id = $1 and kind = 'anthropic'`,
      [organizationId],
    );

    const resolved = await resolution.resolve(organizationId, "implement");

    expect(resolved.chain[0].decision).toBe("dropped");
    expect(resolved.chain[0].explanation).toBe(
      "Primary dropped — Anthropic Claude is unreachable (503 upstream).",
    );
    expect(resolved.chain).toHaveLength(3);
  });

  it("renders the card's generated sentence in the explanation, unaltered", async () => {
    // Decision M5, end to end. Nothing in this service composes this string: PostgreSQL derives
    // it from `"when"` and `"then"` and refuses a hand-written one, so a resolution and the
    // rules card cannot print two sentences for one rule.
    const organizationId = await mockupWorkspace();

    await rule(
      organizationId,
      1,
      { effort_gte: "l" },
      { use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } } },
    );

    const resolved = await resolution.resolve(organizationId, "implement", { effort: "l" });

    expect(resolved.rules).toHaveLength(1);
    expect(resolved.rules[0].display).toBe("effort ≥ L → implement uses coder-max (max thinking)");
    expect(resolved.rules[0].applied).toBe(true);
    expect(resolved.chain[0].params).toEqual({ thinking: "max" });
  });

  it("evaluates the enabled rules and leaves a switched-off one out", async () => {
    // *The rules this workspace has* and *the rules that currently fire* are different
    // questions, and `where enabled` is in the statement so a resolver cannot be handed one it
    // should not evaluate.
    const organizationId = await mockupWorkspace();

    await rule(
      organizationId,
      1,
      { effort_gte: "l" },
      { use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } } },
      false,
    );

    const resolved = await resolution.resolve(organizationId, "implement", { effort: "xl" });

    expect(resolved.rules).toEqual([]);
    expect(resolved.chain[0].params).toEqual({});
  });

  it("filters the chain to local providers when a docs-only rule fires", async () => {
    const organizationId = await mockupWorkspace();

    await rule(organizationId, 1, { diff_kind: "docs_only" }, { route_local: {} });

    const resolved = await resolution.resolve(organizationId, "implement", {
      diffKind: "docs_only",
    });

    expect(resolved.chain.filter((hop) => hop.decision === "kept").map((hop) => hop.alias)).toEqual(
      ["local-docs"],
    );
  });

  it("keeps an unbound alias in the chain as a dropped hop", async () => {
    // V019 permits the row — a name created ahead of its key — and the left join is what admits
    // it. `registry`'s own alias read inner-joins and would simply not return it, which is why
    // this module has its own statement and why only a real join can demonstrate the difference.
    const organizationId = await mockupWorkspace();

    await api.sql.query(
      `update ${SCHEMA_NAME}.model_aliases set provider_connection_id = null, enabled = false
        where organization_id = $1 and alias = 'coder-max'`,
      [organizationId],
    );

    const resolved = await resolution.resolve(organizationId, "implement");

    expect(resolved.chain).toHaveLength(3);
    expect(resolved.chain[0].provider).toBeNull();
    expect(resolved.chain[0].explanation).toBe(
      "Primary dropped — the alias coder-max is not bound to a provider connection.",
    );
  });

  it("fails the run rather than degrading below a floor the route set", async () => {
    const organizationId = await mockupWorkspace({ floor: 2, maxCostCents: 250 });

    await api.sql.query(
      `update ${SCHEMA_NAME}.provider_connections set status = 'error'
        where organization_id = $1 and kind in ('anthropic', 'copilot')`,
      [organizationId],
    );

    const resolved = await resolution.resolve(organizationId, "implement");

    expect(resolved.outcome).toBe("fail_run");
    expect(resolved.failure?.code).toBe("floor_breached");
    expect(resolved.chain.filter((hop) => hop.decision === "kept")).toEqual([]);
    expect(resolved.maxCostCents).toBe(250);
  });

  it("does not let one workspace's rules reach another's route", async () => {
    // Every statement in this module carries the workspace. This is the assertion that a
    // missing predicate would fail, and it cannot be made without two real workspaces.
    const mine = await mockupWorkspace();
    const theirs = await mockupWorkspace();

    await rule(
      theirs,
      1,
      { effort_gte: "l" },
      { use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } } },
    );

    const resolved = await resolution.resolve(mine, "implement", { effort: "xl" });

    expect(resolved.rules).toEqual([]);
    expect(resolved.chain[0].params).toEqual({});
  });

  it("refuses a task kind this workspace does not route", async () => {
    const organizationId = await mockupWorkspace();

    await expect(resolution.resolve(organizationId, "commit-msg")).rejects.toMatchObject({
      response: { code: ROUTING_ERRORS.routeNotFound },
    });
  });

  it("answers identically when asked twice", async () => {
    // Determinism over a real read: the rows do not move, so neither does the answer.
    const organizationId = await mockupWorkspace();
    const context = { effort: "l" } as const;

    const first = await resolution.resolve(organizationId, "implement", context);
    const second = await resolution.resolve(organizationId, "implement", context);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
