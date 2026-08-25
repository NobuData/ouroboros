import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { Client } from "pg";
import type request from "supertest";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { PricingService } from "../pricing/pricing.service";
import { ProviderHealthService } from "../provider-health/provider-health.service";
import { ModelProviderRegistry } from "../providers/provider.registry";
import { PROVIDERS_FIX_PATH } from "../registry/aliases.errors";
import { REGISTRY_ROWS } from "../registry/registry.rows.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { VaultService } from "../vault/vault.service";
import { ALIAS_HEALTH_STATES, NO_KEY_NOTE } from "./alias.health";
import type { RegistryReadModelResource } from "./registry-read.resources";

/**
 * `GET /api/v1/registry`, over a socket and against a migrated database
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)).
 *
 * The ticket's acceptance criteria, one `describe` each:
 *
 *   * **the payload reproduces every cell of mockup 21's eight rows** — bindings, monograms,
 *     chips, health, prices and `Used by`, against the *shipped* price catalog and the seed's
 *     own provider states rather than against numbers written into this file;
 *   * **stopping a local provider flips its alias to degraded within one Z.3 cycle** — a real
 *     sweep against a port nothing is listening on, and **zero adapter calls** made by the read,
 *     counted at `ModelProviderRegistry` rather than inferred;
 *   * **a discovery-mismatch fixture renders the `model_missing` warning**;
 *   * **members read, and a cross-workspace read returns nothing**;
 *   * **the query count is constant in the number of aliases**, counted at the driver.
 *
 * Rows this endpoint does not write — it writes none — are seeded with SQL, the way
 * `aliases.integration-spec.ts` seeds them: those tables have surfaces of their own, and driving
 * them through here would test two things at once.
 *
 * **Three of mockup 21's figures are the drawing's rather than the database's**, and the
 * expectations below are the database's. `docs/ROADMAP_MOCKUP_21_MODEL_REGISTRY.md` records the
 * correction under CG.4: the bundled catalog prices `claude-fable-5` at `$10 · $50` and
 * `claude-sonnet-5` at `$2 · $10`, not the `$15 · $75` and `$3 · $15` the drawing shows, and the
 * `Used by` counts are computed from the routing matrix rather than read off the picture. What
 * *is* the drawing's, exactly, is every shape: which cell is a dash, which is a rate, which row
 * has no provider, and which row is amber.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test. */
const REGISTRY = "/api/v1/registry";

/** The repository root, from which `ouroboros-db` is a sibling of this module. */
const REPOSITORY_ROOT = join(__dirname, "..", "..", "..", "..");

/** The committed catalog import — one statement, exactly as the repeatable migration runs it. */
const CATALOG_SQL = readFileSync(
  join(REPOSITORY_ROOT, "ouroboros-db", "migrations", "R__model_price_catalog.sql"),
  "utf8",
);

/** The five connections AC.6 seeds, as this suite writes them. */
const CONNECTIONS = [
  {
    kind: "anthropic",
    displayName: "Anthropic Claude",
    baseUrl: null,
    status: "active",
    health: { latency_ms: 42 },
  },
  { kind: "cursor", displayName: "Cursor", baseUrl: null, status: "active", health: {} },
  {
    kind: "copilot",
    displayName: "GitHub Copilot",
    baseUrl: null,
    // The row mockup 21 draws amber. Nothing stores the word *degraded*; #588 derives it.
    status: "error",
    health: { detail: "elevated latency" },
  },
  {
    kind: "openai_compatible",
    displayName: "OpenAI-compatible · local vLLM",
    baseUrl: "http://10.0.4.20:8000/v1",
    status: "active",
    health: { detail: "vLLM local" },
  },
  {
    kind: "ollama",
    displayName: "Ollama · workstation",
    baseUrl: "http://ken-station.local:11434",
    status: "active",
    health: { models: 3, detail: "workstation" },
  },
] as const;

/** What discovery has reported in the seeded workspace — the eleven rows AC.6 writes. */
const DISCOVERED: readonly [string, string][] = [
  ["Anthropic Claude", "claude-fable-5"],
  ["Anthropic Claude", "claude-opus-5"],
  ["Anthropic Claude", "claude-sonnet-5"],
  ["Anthropic Claude", "claude-haiku-4-5"],
  ["Cursor", "composer-2"],
  ["GitHub Copilot", "gpt-5-codex"],
  ["OpenAI-compatible · local vLLM", "llama-4-maverick"],
  ["OpenAI-compatible · local vLLM", "deepseek-v3.2"],
  ["Ollama · workstation", "qwen3-coder:32b"],
  ["Ollama · workstation", "llama4:scout"],
  ["Ollama · workstation", "phi4:14b"],
];

/** Which connection each of mockup 21's aliases is bound to, by display name. */
const BINDINGS: Readonly<Record<string, string | null>> = {
  "coder-max": "Anthropic Claude",
  "coder-std": "Anthropic Claude",
  sizer: "Anthropic Claude",
  "coder-fallback": "GitHub Copilot",
  "second-opinion": "Cursor",
  "local-docs": "Ollama · workstation",
  "local-free": "OpenAI-compatible · local vLLM",
  "gpt5-experiments": null,
};

/** The routing matrix this suite seeds — the chains the `Used by` counts are computed from. */
const ROUTES: readonly { kind: string; tag: string; hops: readonly string[] }[] = [
  {
    kind: "implement",
    tag: "implement-primary",
    hops: ["coder-max", "coder-fallback", "local-docs"],
  },
  { kind: "plan", tag: "plan-primary", hops: ["coder-max", "coder-std"] },
  { kind: "review", tag: "review-primary", hops: ["coder-max", "coder-std"] },
  { kind: "docs", tag: "docs-primary", hops: ["local-docs", "sizer"] },
  { kind: "commit-msg", tag: "commit-msg-primary", hops: ["local-free", "coder-fallback"] },
];

/**
 * Every cell of mockup 21's table, in the order the payload publishes it — by alias name.
 *
 * `monogram`, `chips` and `health` are the drawing's exactly. `price` is the shipped catalog's
 * and `usedBy` is the seeded matrix's; see this file's header for why those two differ from the
 * picture and where that is written down.
 */
const EXPECTED: readonly {
  alias: string;
  monogram: string | null;
  modelId: string;
  chips: readonly string[];
  health: string;
  note: string | null;
  price: string;
  usedBy: number;
  enabled: boolean;
}[] = [
  {
    alias: "coder-fallback",
    monogram: "GH",
    modelId: "gpt-5-codex",
    chips: [],
    health: ALIAS_HEALTH_STATES.degraded,
    note: "elevated latency",
    price: "seat-based",
    usedBy: 2,
    enabled: true,
  },
  {
    alias: "coder-max",
    monogram: "AN",
    modelId: "claude-fable-5",
    chips: ["max thinking", "400k budget"],
    health: ALIAS_HEALTH_STATES.ok,
    note: null,
    price: "$10 · $50",
    usedBy: 4,
    enabled: true,
  },
  {
    alias: "coder-std",
    monogram: "AN",
    modelId: "claude-sonnet-5",
    chips: ["std thinking"],
    health: ALIAS_HEALTH_STATES.ok,
    note: null,
    price: "$2 · $10",
    usedBy: 2,
    enabled: true,
  },
  {
    alias: "gpt5-experiments",
    monogram: null,
    modelId: "gpt-5.2-preview",
    chips: [],
    health: ALIAS_HEALTH_STATES.noKey,
    note: NO_KEY_NOTE,
    price: "—",
    usedBy: 0,
    enabled: false,
  },
  {
    alias: "local-docs",
    monogram: "OL",
    modelId: "qwen3-coder:32b",
    chips: ["ctx 32k"],
    health: ALIAS_HEALTH_STATES.ok,
    note: null,
    price: "$0",
    usedBy: 2,
    enabled: true,
  },
  {
    alias: "local-free",
    monogram: "VL",
    modelId: "llama-4-maverick",
    chips: ["batch ok"],
    health: ALIAS_HEALTH_STATES.ok,
    note: null,
    price: "$0",
    usedBy: 1,
    enabled: true,
  },
  {
    alias: "second-opinion",
    monogram: "CU",
    modelId: "composer-2",
    chips: ["review vote only"],
    health: ALIAS_HEALTH_STATES.ok,
    note: null,
    price: "usage-based",
    usedBy: 1,
    enabled: true,
  },
  {
    alias: "sizer",
    monogram: "AN",
    modelId: "claude-haiku-4-5",
    chips: ["temp 0", "8k out"],
    health: ALIAS_HEALTH_STATES.ok,
    note: null,
    price: "$1 · $5",
    usedBy: 1,
    enabled: true,
  },
];

describe("the registry's composed read, against a migrated database", () => {
  let api: ApiHarness;
  let pricing: PricingService;

  beforeAll(async () => {
    api = await ApiHarness.start();
    pricing = api.nest.get(PricingService);
  });

  afterAll(() => api.close());

  afterEach(async () => {
    await api.truncate();
    // The process outlives the truncation and the price cache does not know about it — a
    // property of the deployment rather than of this suite, and dropped here so each test
    // starts from the database.
    pricing.invalidateCatalog();
  });

  /**
   * A signed-in request into a workspace.
   *
   * @param person - Who.
   * @param workspace - Where.
   * @returns The request, to be sent.
   */
  function call(person: Person, workspace: Workspace): request.Test {
    return api.as(person)("get", REGISTRY).set(TENANT_HEADER, workspace.slug);
  }

  /**
   * Read the registry and answer the payload.
   *
   * @param person - Who.
   * @param workspace - Where.
   * @returns The composed payload.
   */
  async function registryOf(
    person: Person,
    workspace: Workspace,
  ): Promise<RegistryReadModelResource> {
    return bodyOf<RegistryReadModelResource>(await call(person, workspace).expect(200));
  }

  /**
   * One provider connection.
   *
   * @param organizationId - The workspace.
   * @param connection - The row to write, as `CONNECTIONS` describes it.
   * @returns Its id.
   */
  async function connection(
    organizationId: string,
    connection_: {
      kind: string;
      displayName: string;
      baseUrl: string | null;
      status: string;
      health: Record<string, unknown>;
      enabled?: boolean;
    },
  ): Promise<string> {
    const measured = Object.keys(connection_.health).length > 0;
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (organization_id, kind, display_name, base_url, status, enabled, last_checked_at, health)
       values ($1, $2, $3, $4, $5, $6, case when $7 then now() else null end, $8::jsonb)
       returning id`,
      [
        organizationId,
        connection_.kind,
        connection_.displayName,
        connection_.baseUrl,
        connection_.status,
        connection_.enabled ?? true,
        measured,
        JSON.stringify(connection_.health),
      ],
    );

    return rows[0].id;
  }

  /**
   * One discovered model.
   *
   * @param connectionId - Which connection lists it.
   * @param modelId - The provider's own identifier.
   */
  async function discovered(connectionId: string, modelId: string): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.provider_models (provider_connection_id, model_id, display, meta)
       values ($1, $2, $2, '{"context_tokens": 200000}'::jsonb)`,
      [connectionId, modelId],
    );
  }

  /**
   * One alias.
   *
   * @param organizationId - The workspace.
   * @param row - The alias, from mockup 21's own fixture.
   * @param connectionId - Where it binds, or null for the orphan.
   * @returns Its id.
   */
  async function alias(
    organizationId: string,
    row: { alias: string; modelId: string; params: unknown; restrictions: unknown },
    connectionId: string | null,
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.model_aliases
         (organization_id, alias, provider_connection_id, model_id, enabled, params, restrictions)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) returning id`,
      [
        organizationId,
        row.alias,
        connectionId,
        row.modelId,
        connectionId !== null,
        JSON.stringify(row.params),
        JSON.stringify(row.restrictions),
      ],
    );

    return rows[0].id;
  }

  /**
   * One route and its hops — the `Used by` column's route leg.
   *
   * @param organizationId - The workspace.
   * @param taskKind - Which kind the route serves.
   * @param tag - The route's tag, which is the reference's chip.
   * @param aliasIds - The chain, in order.
   */
  async function route(
    organizationId: string,
    taskKind: string,
    tag: string,
    aliasIds: readonly string[],
  ): Promise<void> {
    // One transaction, because V016's deferred trigger refuses a route with no hops: *a route
    // is its chain, and resolution has nothing to return for an empty one*. The same shape
    // `aliases.integration-spec.ts` seeds its routes with.
    const client = await api.sql.connect();

    try {
      await client.query("begin");
      const { rows } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.routes (organization_id, task_kind_id, tag)
         select $1, k.id, $2 from ${SCHEMA_NAME}.task_kinds k
          where k.organization_id = $1 and k.name = $3
         returning id`,
        [organizationId, tag, taskKind],
      );

      for (const [offset, aliasId] of aliasIds.entries()) {
        await client.query(
          `insert into ${SCHEMA_NAME}.route_hops (organization_id, route_id, position, model_alias_id)
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
   * One escalation rule — the `Used by` column's other leg.
   *
   * @param organizationId - The workspace.
   * @param sortOrder - Where it sits in the rule list.
   * @param when - V018's predicate.
   * @param then - V018's route modification, which names the alias.
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

  /** Mockup 21's whole workspace: five connections, eleven discovered models, eight aliases. */
  async function mockup21(): Promise<{
    owner: Person;
    workspace: Workspace;
    connections: Map<string, string>;
    aliases: Map<string, string>;
  }> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    await api.sql.query(CATALOG_SQL);
    // V012's narrowing 3: the OpenAI-compatible adapter fronts a local vLLM *and*
    // api.openai.com, so nothing at the level of a kind can tell them apart. Local-ness is a
    // property of the connection, and the workspace says so once — which is what makes
    // `local-free` render `$0` rather than `—`.
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.model_prices
         (organization_id, match_provider_kind, match_model, billing_mode, source)
       values ($1, 'openai_compatible', '*', 'free', 'override')`,
      [workspace.id],
    );

    const connections = new Map<string, string>();
    for (const row of CONNECTIONS) {
      connections.set(row.displayName, await connection(workspace.id, row));
    }

    for (const [displayName, modelId] of DISCOVERED) {
      await discovered(connections.get(displayName) as string, modelId);
    }

    const aliases = new Map<string, string>();
    for (const row of REGISTRY_ROWS) {
      const boundTo = BINDINGS[row.alias];

      aliases.set(
        row.alias,
        await alias(
          workspace.id,
          row,
          boundTo === null ? null : (connections.get(boundTo) ?? null),
        ),
      );
    }

    for (const [offset, plan] of ROUTES.entries()) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
         values ($1, $2, $3, $4)`,
        [workspace.id, plan.kind, `Everything ${plan.kind} needs`, offset + 1],
      );
      await route(
        workspace.id,
        plan.kind,
        plan.tag,
        plan.hops.map((name) => aliases.get(name) as string),
      );
    }

    await escalationRule(
      workspace.id,
      1,
      { effort_gte: "l" },
      { use_alias: { task_kind: "implement", alias: "coder-max" } },
    );
    await escalationRule(
      workspace.id,
      2,
      { label: "security" },
      { add_vote: { task_kind: "review", alias: "second-opinion" } },
    );

    return { owner, workspace, connections, aliases };
  }

  /**
   * Run `work` while counting the statements the application's pool actually sent.
   *
   * `pg.Client.prototype.query` is what Kysely's dialect and BetterAuth's adapter both call,
   * once per statement, so counting there counts round trips rather than method calls in this
   * service. The suite's own pool must be idle inside `work` for the number to be attributable.
   *
   * @param work - What to measure.
   * @returns How many statements it sent.
   */
  async function statementsIssuedBy(work: () => Promise<unknown>): Promise<number> {
    const query = jest.spyOn(Client.prototype, "query");
    try {
      await work();
      return query.mock.calls.length;
    } finally {
      query.mockRestore();
    }
  }

  describe("who may", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", REGISTRY).expect(401);
    });

    it("refuses a session acting in no workspace", async () => {
      const nomad = await api.signIn();
      const response = await api.as(nomad)("get", REGISTRY).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it.each(["member", "viewer"] as const)("lets a %s read the whole table", async (role) => {
      const { workspace } = await mockup21();
      const person = await api.signIn();
      await api.join(workspace.id, person, role);

      const payload = await registryOf(person, workspace);

      expect(payload.aliases.map((row) => row.alias)).toEqual(EXPECTED.map((row) => row.alias));
    });

    it("answers another workspace's member nothing, rather than somebody else's registry", async () => {
      // The read is scoped, so a cross-workspace request finds no rows — the same shape every
      // `/api/v1` read keeps, and the reason an id from elsewhere is a 404 rather than a 403.
      const { workspace } = await mockup21();
      const outsider = await api.signIn();
      const elsewhere = await api.workspace(outsider);

      await expect(registryOf(outsider, elsewhere)).resolves.toEqual({ aliases: [] });
      await api.as(outsider)("get", REGISTRY).set(TENANT_HEADER, workspace.slug).expect(404);
    });
  });

  describe("mockup 21's eight rows", () => {
    it.each(EXPECTED)("draws $alias exactly as the table does", async (expected) => {
      const { owner, workspace } = await mockup21();

      const payload = await registryOf(owner, workspace);
      const row = payload.aliases.find((candidate) => candidate.alias === expected.alias);

      expect(row).toBeDefined();
      expect(row).toMatchObject({
        modelId: expected.modelId,
        enabled: expected.enabled,
        chips: expected.chips,
        usedBy: expected.usedBy,
      });
      expect(row?.binding?.monogram ?? null).toBe(expected.monogram);
      expect(row?.health.state).toBe(expected.health);
      expect(row?.health.note).toBe(expected.note);
      expect(row?.price.display).toBe(expected.price);
    });

    it("orders the rows by name, unbound ones included", async () => {
      const { owner, workspace } = await mockup21();

      const payload = await registryOf(owner, workspace);

      expect(payload.aliases.map((row) => row.alias)).toEqual(EXPECTED.map((row) => row.alias));
    });

    it("draws the Copilot row amber with the note the check left", async () => {
      // The ticket's first criterion by name. AC.6 seeds that connection in `error` with
      // `elevated latency`; nothing stores the word *degraded*, and this is where it comes from.
      const { owner, workspace } = await mockup21();

      const payload = await registryOf(owner, workspace);
      const fallback = payload.aliases.find((row) => row.alias === "coder-fallback");

      expect(fallback?.health).toMatchObject({
        state: ALIAS_HEALTH_STATES.degraded,
        note: "elevated latency",
      });
      expect(fallback?.binding).toMatchObject({ kind: "copilot", displayName: "GitHub Copilot" });
    });

    it("draws the orphan's err state with its fix pointer", async () => {
      const { owner, workspace } = await mockup21();

      const payload = await registryOf(owner, workspace);
      const orphan = payload.aliases.find((row) => row.alias === "gpt5-experiments");

      expect(orphan).toMatchObject({
        binding: null,
        enabled: false,
        usedBy: 0,
        references: [],
        health: { state: ALIAS_HEALTH_STATES.noKey, note: NO_KEY_NOTE, fix: PROVIDERS_FIX_PATH },
        price: { connectionKind: null, price: null, display: "—" },
      });
    });

    it("carries provenance on every price it has one for, and the dash shape where it has none", async () => {
      const { owner, workspace } = await mockup21();

      const payload = await registryOf(owner, workspace);

      for (const row of payload.aliases) {
        if (row.alias === "gpt5-experiments") {
          expect(row.price.price).toBeNull();
          expect(row.price.display).toBe("—");
          continue;
        }

        expect(row.price.price?.provenance.source).toMatch(/^(bundled|override)$/);
        expect(row.price.price?.provenance.effectiveAt).toEqual(expect.any(String));
      }

      // A bundled row names the snapshot it came from; an override names none, because an
      // override is a workspace's own statement rather than a version of anything.
      const local = payload.aliases.find((row) => row.alias === "local-free");
      expect(local?.price.price?.provenance).toMatchObject({
        source: "override",
        catalogVersion: null,
      });
    });

    it("names the referrers CG.3 indexes, and counts exactly those", async () => {
      // The ticket's *`Used by` values come from #581 and match the table for all eight rows*.
      // The count is the list's length by construction, so this asserts the list is the view's.
      const { owner, workspace } = await mockup21();

      const payload = await registryOf(owner, workspace);
      const byAlias = new Map(payload.aliases.map((row) => [row.alias, row]));

      expect(byAlias.get("coder-max")?.references.map((reference) => reference.label)).toEqual([
        "implement-primary",
        "plan-primary",
        "review-primary",
        "escalation:effort≥L",
      ]);
      const vote = byAlias.get("second-opinion")?.references ?? [];
      expect(vote).toHaveLength(1);
      expect(vote[0]).toMatchObject({
        kind: "escalation",
        label: "escalation:security label",
        blocking: true,
      });
      // The chip is derived from the rule's structure rather than cut out of its sentence, and
      // the id it carries is the rule's — stable enough for the inspector to link to.
      expect(typeof vote[0].refId).toBe("string");

      for (const row of payload.aliases) {
        expect(row.usedBy).toBe(row.references.length);
      }
    });

    it("serves the same rows CH.1's list serves, composed rather than restated", async () => {
      // One definition of *what is an alias*: the composed payload is built on
      // `/api/v1/registry/aliases`, so the two cannot describe one alias differently.
      const { owner, workspace } = await mockup21();

      const composed = await registryOf(owner, workspace);
      const list = bodyOf<{
        aliases: { id: string; alias: string; modelId: string; references: unknown[] }[];
      }>(
        await api
          .as(owner)("get", "/api/v1/registry/aliases")
          .set(TENANT_HEADER, workspace.slug)
          .expect(200),
      );

      expect(composed.aliases.map((row) => [row.id, row.alias, row.modelId])).toEqual(
        list.aliases.map((row) => [row.id, row.alias, row.modelId]),
      );
      expect(composed.aliases.map((row) => row.references)).toEqual(
        list.aliases.map((row) => row.references),
      );
    });
  });

  describe("the health cell, derived from what the system already knows", () => {
    it("flips a local alias to degraded within one Z.3 cycle, and makes no adapter call", async () => {
      // The ticket's second criterion, as close to *stop the compose stack's Ollama* as a suite
      // can get: a daemon at an address nothing is listening on. The sweep probes it, the probe
      // fails, Z.3 writes `error` — and the registry read that follows derives `degraded` from
      // the row rather than asking anybody.
      const { owner, workspace, connections } = await mockup21();
      const closed = await closedPort();

      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections
            set base_url = $2, status = 'active', last_checked_at = null, health = '{}'::jsonb
          where id = $1`,
        [connections.get("Ollama · workstation"), `http://127.0.0.1:${closed.toString()}`],
      );

      const before = await registryOf(owner, workspace);
      expect(before.aliases.find((row) => row.alias === "local-docs")?.health.state).toBe(
        ALIAS_HEALTH_STATES.ok,
      );

      const report = await api.nest.get(ProviderHealthService).sweep();
      expect(report.failed).toBeGreaterThanOrEqual(1);

      const find = jest.spyOn(ModelProviderRegistry.prototype, "find");
      const get = jest.spyOn(ModelProviderRegistry.prototype, "get");

      try {
        const after = await registryOf(owner, workspace);
        const local = after.aliases.find((row) => row.alias === "local-docs");

        expect(local?.health.state).toBe(ALIAS_HEALTH_STATES.degraded);
        expect(local?.health.checkedAt).toEqual(expect.any(String));
        // Decision R8, counted: the whole page is composed and no provider is asked anything.
        expect(find).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();
      } finally {
        find.mockRestore();
        get.mockRestore();
      }
    }, 30_000);

    it("makes no adapter call for the ordinary eight-row read either", async () => {
      const { owner, workspace } = await mockup21();
      const find = jest.spyOn(ModelProviderRegistry.prototype, "find");
      const get = jest.spyOn(ModelProviderRegistry.prototype, "get");

      try {
        const payload = await registryOf(owner, workspace);

        expect(payload.aliases).toHaveLength(8);
        expect(find.mock.calls.length + get.mock.calls.length).toBe(0);
      } finally {
        find.mockRestore();
        get.mockRestore();
      }
    });

    it("renders the model_missing warning when a bound model leaves the catalog", async () => {
      // The ticket's third criterion. Discovery refreshes `provider_models`; an alias whose
      // model is no longer in it is a configuration that used to work, and the cell says so
      // rather than staying green.
      const { owner, workspace, connections } = await mockup21();

      await api.sql.query(
        `delete from ${SCHEMA_NAME}.provider_models
          where provider_connection_id = $1 and model_id = 'claude-fable-5'`,
        [connections.get("Anthropic Claude")],
      );

      const payload = await registryOf(owner, workspace);
      const row = payload.aliases.find((candidate) => candidate.alias === "coder-max");

      expect(row?.health).toMatchObject({
        state: ALIAS_HEALTH_STATES.modelMissing,
        note: "claude-fable-5 is no longer listed on Anthropic Claude",
      });
      // Its three siblings on the same connection are unaffected — the warning is about a pair.
      expect(
        payload.aliases.find((candidate) => candidate.alias === "coder-std")?.health.state,
      ).toBe(ALIAS_HEALTH_STATES.ok);
    });

    it("says nothing about a connection discovery has never reached", async () => {
      const { owner, workspace, connections } = await mockup21();

      await api.sql.query(
        `delete from ${SCHEMA_NAME}.provider_models where provider_connection_id = $1`,
        [connections.get("Anthropic Claude")],
      );

      const payload = await registryOf(owner, workspace);

      expect(payload.aliases.find((row) => row.alias === "coder-max")?.health.state).toBe(
        ALIAS_HEALTH_STATES.ok,
      );
    });

    it("reads a switched-off connection as provider_disabled, with the Providers pointer", async () => {
      const { owner, workspace, connections } = await mockup21();

      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections set enabled = false where id = $1`,
        [connections.get("Cursor")],
      );

      const payload = await registryOf(owner, workspace);

      expect(payload.aliases.find((row) => row.alias === "second-opinion")?.health).toMatchObject({
        state: ALIAS_HEALTH_STATES.providerDisabled,
        note: "Cursor is switched off",
        fix: PROVIDERS_FIX_PATH,
      });
    });

    it("never draws an unchecked connection as healthy", async () => {
      // Decision M8, end to end: `unknown` is the absence of a measurement, and a green dot for
      // it would be the product's one claim about the outside world made on no evidence.
      const { owner, workspace, connections } = await mockup21();

      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections
            set status = 'unknown', last_checked_at = null, health = '{}'::jsonb
          where id = $1`,
        [connections.get("Cursor")],
      );

      const payload = await registryOf(owner, workspace);

      expect(payload.aliases.find((row) => row.alias === "second-opinion")?.health).toMatchObject({
        state: ALIAS_HEALTH_STATES.unknown,
        checkedAt: null,
      });
    });
  });

  describe("the masked key on the inspector's provider line", () => {
    it("publishes the same four characters the providers API does, and no more", async () => {
      const { owner, workspace, connections } = await mockup21();
      const anthropic = connections.get("Anthropic Claude") as string;
      // Sealed through the real vault rather than written as a literal: V015 refuses any value
      // that is not one of this service's envelopes, and the mask is what is under test here
      // rather than the credential lifecycle, which `provider-connections.integration-spec.ts`
      // drives through its own API.
      const sealed = await api.nest
        .get(VaultService)
        .encryptText(workspace.id, anthropic, "sk-ant-api03-not-a-real-value-Xq4A");

      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections set credentials_encrypted = $2 where id = $1`,
        [anthropic, sealed],
      );

      const payload = await registryOf(owner, workspace);
      const bound = payload.aliases.filter((row) => row.binding?.kind === "anthropic");

      expect(bound).toHaveLength(3);
      for (const row of bound) {
        expect(row.binding?.mask).toBe("••••Xq4A");
      }
    });

    it("carries no credential anywhere in the payload", async () => {
      const { owner, workspace, connections } = await mockup21();
      const anthropic = connections.get("Anthropic Claude") as string;
      const value = "sk-ant-api03-not-a-real-value-Xq4A";
      const sealed = await api.nest.get(VaultService).encryptText(workspace.id, anthropic, value);

      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections set credentials_encrypted = $2 where id = $1`,
        [anthropic, sealed],
      );

      const response = await call(owner, workspace).expect(200);

      expect(response.text).not.toContain(value);
      expect(response.text).not.toContain(sealed);
      expect(response.text).not.toContain("credentials_encrypted");
    });

    it("publishes null for a provider that stores no credential", async () => {
      const { owner, workspace } = await mockup21();

      const payload = await registryOf(owner, workspace);

      expect(payload.aliases.find((row) => row.alias === "local-docs")?.binding?.mask).toBeNull();
    });
  });

  describe("the cost of the page", () => {
    it("issues the same number of statements for eight aliases as for two", async () => {
      // The ticket's *the endpoint's query count is constant in the number of aliases*, counted
      // at the driver rather than inferred from the code. The connections are held still, so
      // what varies between the two measurements is only the registry's size.
      const { owner, workspace } = await mockup21();

      // Warm the pool and the session lookups, so neither measurement pays a one-off cost the
      // other does not.
      await registryOf(owner, workspace);

      pricing.invalidateCatalog();
      const eight = await statementsIssuedBy(() => registryOf(owner, workspace));

      // The routes go rather than their hops: V016's deferred trigger refuses a route with an
      // empty chain, and `route_hops` cascades from the route it belongs to.
      await api.sql.query(`delete from ${SCHEMA_NAME}.routes where organization_id = $1`, [
        workspace.id,
      ]);
      await api.sql.query(
        `delete from ${SCHEMA_NAME}.escalation_rules where organization_id = $1`,
        [workspace.id],
      );
      await api.sql.query(
        `delete from ${SCHEMA_NAME}.model_aliases
          where organization_id = $1 and alias not in ('coder-max', 'local-docs')`,
        [workspace.id],
      );

      pricing.invalidateCatalog();
      const two = await statementsIssuedBy(() => registryOf(owner, workspace));

      expect(two).toBe(eight);
    });

    it("answers an empty registry rather than failing on one", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await expect(registryOf(owner, workspace)).resolves.toEqual({ aliases: [] });
    });
  });
});

/**
 * A TCP port with nothing listening on it.
 *
 * Bound and released, which is as close to *a daemon that was stopped* as a suite can arrange:
 * the address is well-formed and the connection is refused.
 *
 * @returns The port.
 */
async function closedPort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  return port;
}
