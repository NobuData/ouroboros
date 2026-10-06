import { readFileSync } from "node:fs";
import { join } from "node:path";

import type request from "supertest";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { VALIDATION_FAILED } from "../errors/validation";
import type { RoutingMatrixResource } from "../routing/resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { ResearchEstimateService } from "./estimate.service";
import { RESEARCH_ERRORS } from "./research.errors";
import type { ScopeEstimateResource } from "./resources";

/**
 * CM.3's estimate and research routing, over a socket and against a migrated database
 * ([#622](https://github.com/NobuData/ouroboros/issues/622)).
 *
 * `estimate.spec.ts` proves the arithmetic and `estimate.service.spec.ts` the reads around it
 * with stubs; what only exists here is the whole path: a `research` route in real rows, resolved
 * by Z.1, priced by CH.3 against the **bundled catalog the migrations ship** (`claude-sonnet-4-6`
 * at `$3 · $15`), and the composer's line coming back over HTTP — plus V109's columns and fill,
 * written and read through the service.
 *
 * **The bundled price catalog is restored after each truncation.** `ApiHarness.truncate()`
 * empties `model_prices`, and without the catalog every alias is unpriced; it is re-applied from
 * what the migrations ship before any workspace is created. (V106's `research_tools` registry is
 * one of the harness's kept reference tables, so tool slugs survive truncation.)
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test. */
const ESTIMATES = "/api/v1/research/estimates";

/** Routing's matrix read — where the `research` kinds must show up. */
const MATRIX = "/api/v1/routing";

/** The seeded deep dive's five tools — RS-127's selection. */
const FIVE_TOOLS = ["web", "competitor", "code", "tickets", "telemetry"];

/** The committed catalog import — one `select ouroboros.import_model_price_catalog(…)`. */
const CATALOG_SQL = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "ouroboros-db",
    "migrations",
    "R__model_price_catalog.sql",
  ),
  "utf8",
);

/** A workspace with its research routing in place, and the ids a test changes it through. */
interface ResearchBench extends Workspace {
  readonly owner: Person;
  /** Alias ids by name. */
  readonly aliases: Record<string, string>;
}

describe("the research estimate endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
    await api.truncate();
    await restoreReferenceRows();
  });

  afterAll(() => api.close());

  afterEach(async () => {
    await api.truncate();
    await restoreReferenceRows();
  });

  /** Re-apply the shipped catalog. */
  async function restoreReferenceRows(): Promise<void> {
    await api.sql.query(CATALOG_SQL);
  }

  /**
   * A workspace whose `research` and `research-plan` kinds route as Y.4's amendment seeds them:
   * `research-primary` → `researcher-long-ctx` (`claude-sonnet-4-6`), then `coder-std`;
   * `researchplan-primary` → `sizer`, then `local-free`.
   *
   * @param options - `researcherModel` overrides the researcher alias's model; `withRoutes:
   *   false` leaves the workspace with no research routing at all.
   * @returns The bench.
   */
  async function bench(
    options: { researcherModel?: string; withRoutes?: boolean } = {},
  ): Promise<ResearchBench> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    if (options.withRoutes === false) {
      return { ...workspace, owner, aliases: {} };
    }

    const anthropic = await connection(workspace.id, "anthropic", "Anthropic Claude");
    const ollama = await connection(workspace.id, "ollama", "Ollama");

    const aliases: Record<string, string> = {
      "researcher-long-ctx": await alias(
        workspace.id,
        "researcher-long-ctx",
        anthropic,
        options.researcherModel ?? "claude-sonnet-4-6",
      ),
      "coder-std": await alias(workspace.id, "coder-std", anthropic, "claude-sonnet-5"),
      sizer: await alias(workspace.id, "sizer", anthropic, "claude-haiku-4-5"),
      "local-free": await alias(workspace.id, "local-free", ollama, "llama3.3:70b"),
    };

    await kind(workspace.id, "research-plan", 9);
    await kind(workspace.id, "research", 10);
    await route(workspace.id, "research-plan", "researchplan-primary", [
      aliases.sizer,
      aliases["local-free"],
    ]);
    await route(workspace.id, "research", "research-primary", [
      aliases["researcher-long-ctx"],
      aliases["coder-std"],
    ]);

    return { ...workspace, owner, aliases };
  }

  /**
   * Insert one healthy provider connection.
   *
   * @param organizationId - The workspace.
   * @param providerKind - Which adapter reaches it.
   * @param displayName - Its name.
   * @returns Its id.
   */
  async function connection(
    organizationId: string,
    providerKind: string,
    displayName: string,
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (organization_id, kind, display_name, base_url, status, last_checked_at, health)
       values ($1, $2, $3, $4, 'active', now(), '{"check": "reachability", "latency_ms": 40}')
       returning id`,
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
   * Insert one bound, enabled alias.
   *
   * @param organizationId - The workspace.
   * @param name - The alias.
   * @param connectionId - Where it runs.
   * @param modelId - The raw model id.
   * @returns Its id.
   */
  async function alias(
    organizationId: string,
    name: string,
    connectionId: string,
    modelId: string,
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.model_aliases
         (organization_id, alias, provider_connection_id, model_id, enabled)
       values ($1, $2, $3, $4, true) returning id`,
      [organizationId, name, connectionId, modelId],
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
   * Insert a route and its chain in one transaction — V016's chain trigger is deferred.
   *
   * @param organizationId - The workspace.
   * @param taskKind - The kind it answers for.
   * @param tag - Its tag.
   * @param aliasIds - The chain, primary first.
   */
  async function route(
    organizationId: string,
    taskKind: string,
    tag: string,
    aliasIds: readonly string[],
  ): Promise<void> {
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
   * Ask for an estimate, as the bench's owner, in a workspace.
   *
   * @param space - The bench.
   * @param body - The composer's choices.
   * @param workspace - The workspace to ask in; the bench's own by default.
   * @returns The pending request.
   */
  function estimate(
    space: ResearchBench,
    body: Record<string, unknown>,
    workspace: Workspace = space,
  ): request.Test {
    return api.as(space.owner)("post", ESTIMATES).set(TENANT_HEADER, workspace.slug).send(body);
  }

  /**
   * An estimate's body, expecting `200`.
   *
   * @param space - The bench.
   * @param body - The composer's choices.
   * @returns The estimate.
   */
  async function estimated(
    space: ResearchBench,
    body: Record<string, unknown>,
  ): Promise<ScopeEstimateResource> {
    return bodyOf<ScopeEstimateResource>(await estimate(space, body).expect(200));
  }

  const DEEP_DIVE = { kind: "gap_analysis", depth: "deep_dive", tools: FIVE_TOOLS };

  describe("the seeded deep dive", () => {
    it("answers mockup 22's line, priced from the shipped catalog", async () => {
      const space = await bench();

      const answer = await estimated(space, DEEP_DIVE);

      expect(answer.label).toBe("est. 40–60 sources · ~$6");
      expect(answer.sources).toEqual({ min: 40, max: 60 });
      expect(answer.costCents).toEqual({ min: 522, max: 687 });
      expect(answer.calibrationVersion).toBe(1);
    });

    it("names the alias routing resolved `research` to — the composer's pill", async () => {
      const space = await bench();

      expect((await estimated(space, DEEP_DIVE)).researcher).toEqual({
        taskKind: "research",
        routeTag: "research-primary",
        alias: "researcher-long-ctx",
        modelId: "claude-sonnet-4-6",
      });
    });

    it("follows the route when its primary changes — resolved, not a constant", async () => {
      const space = await bench();

      await api.sql.query(
        `update ${SCHEMA_NAME}.route_hops h set model_alias_id = $2
           from ${SCHEMA_NAME}.routes r
          where h.route_id = r.id and r.organization_id = $1 and r.tag = 'research-primary'
            and h.position = 1`,
        [space.id, space.aliases.sizer],
      );

      const answer = await estimated(space, DEEP_DIVE);

      expect(answer.researcher?.alias).toBe("sizer");
      expect(answer.researcher?.modelId).toBe("claude-haiku-4-5");
      // Haiku at $1 · $5 — a third of the price, and the line moves with it.
      expect(answer.costCents).toEqual({ min: 174, max: 229 });
      expect(answer.label).toBe("est. 40–60 sources · ~$2");
    });

    it("uses the kind's playbook tools when none are sent", async () => {
      const space = await bench();

      const answer = await estimated(space, { kind: "gap_analysis", depth: "quick" });

      const { rows } = await api.sql.query<{ tools: string[] }>(
        `select playbook -> 'default_tools' as tools from ${SCHEMA_NAME}.investigation_kinds
          where organization_id = $1 and slug = 'gap_analysis'`,
        [space.id],
      );
      expect(answer.tools).toEqual(rows[0].tools);
    });
  });

  describe("moving with the composer", () => {
    it("narrows the range when a tool is disabled", async () => {
      const space = await bench();

      const all = await estimated(space, DEEP_DIVE);
      const fewer = await estimated(space, { ...DEEP_DIVE, tools: FIVE_TOOLS.slice(1) });

      expect(fewer.sources).toEqual({ min: 28, max: 42 });
      expect(fewer.sources.max - fewer.sources.min).toBeLessThan(all.sources.max - all.sources.min);
      expect(fewer.costCents!.max).toBeLessThan(all.costCents!.max);
    });

    it("rises from quick to standard to deep dive", async () => {
      const space = await bench();

      const [quick, standard, deep] = await Promise.all(
        ["quick", "standard", "deep_dive"].map((depth) =>
          estimated(space, { ...DEEP_DIVE, depth }),
        ),
      );

      expect(quick.sources.max).toBeLessThan(standard.sources.min);
      expect(standard.sources.max).toBeLessThan(deep.sources.min);
      expect(quick.costCents!.max).toBeLessThan(standard.costCents!.min);
      expect(standard.costCents!.max).toBeLessThan(deep.costCents!.min);
    });
  });

  describe("no dollars without a price", () => {
    it("gives a source range and no dollar figure anywhere for an unpriced alias", async () => {
      const space = await bench({ researcherModel: "claude-internal-preview" });

      const response = await estimate(space, DEEP_DIVE).expect(200);
      const answer = bodyOf<ScopeEstimateResource>(response);

      expect(answer.researcher?.alias).toBe("researcher-long-ctx");
      expect(answer.sources).toEqual({ min: 40, max: 60 });
      expect(answer.costCents).toBeNull();
      expect(answer.label).toBe("est. 40–60 sources");
      expect(response.text).not.toContain("$");
    });

    it("has no researcher and no dollars in a workspace with no research route", async () => {
      const space = await bench({ withRoutes: false });

      const response = await estimate(space, DEEP_DIVE).expect(200);
      const answer = bodyOf<ScopeEstimateResource>(response);

      expect(answer.researcher).toBeNull();
      expect(answer.costCents).toBeNull();
      expect(answer.sources).toEqual({ min: 40, max: 60 });
      expect(response.text).not.toContain("$");
    });
  });

  describe("routing's matrix", () => {
    it("draws the research kinds with their seeded routes", async () => {
      const space = await bench();

      const matrix = bodyOf<RoutingMatrixResource>(
        await api.as(space.owner)("get", MATRIX).set(TENANT_HEADER, space.slug).expect(200),
      );
      const rows = Object.fromEntries(matrix.taskKinds.map((row) => [row.name, row]));

      expect(rows.research?.route?.tag).toBe("research-primary");
      expect(rows.research?.route?.hops.map((hop) => hop.alias)).toEqual([
        "researcher-long-ctx",
        "coder-std",
      ]);
      expect(rows["research-plan"]?.route?.tag).toBe("researchplan-primary");
      expect(rows["research-plan"]?.route?.hops.map((hop) => hop.alias)).toEqual([
        "sizer",
        "local-free",
      ]);
    });
  });

  describe("refusals", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("post", ESTIMATES).send(DEEP_DIVE).expect(401);
    });

    it("answers 404 for a kind the workspace lacks", async () => {
      const space = await bench();

      const response = await estimate(space, { ...DEEP_DIVE, kind: "market_sizing" }).expect(404);

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: RESEARCH_ERRORS.kindNotFound,
        details: { kind: "market_sizing" },
      });
    });

    it("answers 422 naming an unregistered tool", async () => {
      const space = await bench();

      const response = await estimate(space, { ...DEEP_DIVE, tools: ["web", "patents"] }).expect(
        422,
      );

      expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
        code: RESEARCH_ERRORS.toolUnknown,
        details: { tools: ["patents"] },
      });
    });

    it.each([
      [{ kind: "gap_analysis", depth: "deep" }],
      [{ kind: "gap_analysis", depth: "quick", tools: [] }],
      [{ kind: "gap_analysis", depth: "quick", tools: ["web", "web"] }],
      [{ depth: "quick" }],
      [{ ...DEEP_DIVE, organizationId: "someone-else" }],
    ])("answers 422 for the malformed body %p", async (body) => {
      const space = await bench();

      const response = await estimate(space, body).expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(VALIDATION_FAILED);
    });

    it("keeps workspaces apart — another workspace's kind is not found here", async () => {
      const space = await bench();
      const other = await bench();
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.investigation_kinds
           (organization_id, slug, display_name, tint_key, playbook)
         values ($1, 'market_sizing', 'Market sizing', 'gap',
                 '{"version": 1, "default_tools": ["web"], "synthesis_template": "t",
                   "deliverables": ["brief"]}')`,
        [other.id],
      );

      await estimate(other, { ...DEEP_DIVE, kind: "market_sizing" }).expect(200);
      const response = await estimate(space, { ...DEEP_DIVE, kind: "market_sizing" }).expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(RESEARCH_ERRORS.kindNotFound);
    });

    it("does not acknowledge a workspace the caller is not a member of", async () => {
      const space = await bench();
      const other = await bench();

      await estimate(space, DEEP_DIVE, other).expect(404);
    });
  });

  describe("storing and reconciling, through the service", () => {
    /**
     * Insert one queued investigation of the bench's gap analysis kind.
     *
     * @param space - The bench.
     * @param tools - Its tools.
     * @returns Its id.
     */
    async function investigation(
      space: ResearchBench,
      tools: readonly string[] = FIVE_TOOLS,
    ): Promise<string> {
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.investigations
           (organization_id, kind_id, question, depth, tools_enabled)
         select $1, k.id, 'Autonomous docking vs. the field', 'deep_dive', $2::jsonb
           from ${SCHEMA_NAME}.investigation_kinds k
          where k.organization_id = $1 and k.slug = 'gap_analysis'
         returning id`,
        [space.id, JSON.stringify(tools)],
      );
      return rows[0].id;
    }

    /**
     * Start it and record what it used — the moment CM.1 (#620) reconciles. `brief_ready` is not
     * reached: V108 requires a brief for it, and the comparison needs only the actuals.
     *
     * @param id - The investigation.
     * @param sourcesUsed - Sources it used.
     * @param spendCents - What it spent, or null when unpriced.
     */
    async function finish(
      id: string,
      sourcesUsed: number,
      spendCents: number | null,
    ): Promise<void> {
      await api.sql.query(
        `update ${SCHEMA_NAME}.investigations
            set status = 'running',
                provenance = '{"researcher": "loop-v1", "alias": "researcher-long-ctx", "resolution_ref": null}',
                actuals = $2::jsonb
          where id = $1`,
        [
          id,
          JSON.stringify({
            sources_used: sourcesUsed,
            spend_cents: spendCents,
            duration_ms: 1_860_000,
          }),
        ],
      );
    }

    /** @returns The application's estimate service. */
    function service(): ResearchEstimateService {
      return api.nest.get(ResearchEstimateService);
    }

    it("stores the estimate on a queued investigation with its calibration version", async () => {
      const space = await bench();
      const id = await investigation(space);

      const stored = await service().storeEstimate(space.id, id);

      expect(stored.label).toBe("est. 40–60 sources · ~$6");
      const { rows } = await api.sql.query(
        `select estimate, estimate_calibration_version from ${SCHEMA_NAME}.investigations where id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({
        estimate: { sources: { min: 40, max: 60 }, cost_cents: { min: 522, max: 687 } },
        estimate_calibration_version: 1,
      });
    });

    it("stores a null cost for an unpriced researcher", async () => {
      const space = await bench({ researcherModel: "claude-internal-preview" });
      const id = await investigation(space);

      await service().storeEstimate(space.id, id);

      const { rows } = await api.sql.query<{ estimate: unknown }>(
        `select estimate from ${SCHEMA_NAME}.investigations where id = $1`,
        [id],
      );
      expect(rows[0].estimate).toEqual({ sources: { min: 40, max: 60 }, cost_cents: null });
    });

    it("refuses to re-estimate one that has started", async () => {
      const space = await bench();
      const id = await investigation(space);
      await service().storeEstimate(space.id, id);
      await api.sql.query(
        `update ${SCHEMA_NAME}.investigations
            set status = 'running',
                provenance = '{"researcher": "loop-v1", "alias": "researcher-long-ctx", "resolution_ref": null}'
          where id = $1`,
        [id],
      );

      await expect(service().storeEstimate(space.id, id)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.investigationNotQueued,
        details: { status: "running" },
      });
    });

    it("refuses another workspace's investigation", async () => {
      const space = await bench();
      const other = await bench();
      const id = await investigation(other);

      await expect(service().storeEstimate(space.id, id)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.investigationNotFound,
      });
    });

    it("records RS-127's comparison — 44 sources and 612¢ inside 40–60 and 522–687¢ — idempotently", async () => {
      const space = await bench();
      const id = await investigation(space);
      await service().storeEstimate(space.id, id);
      await finish(id, 44, 612);

      const first = await service().reconcile(space.id, id);
      const second = await service().reconcile(space.id, id);

      expect(first).toMatchObject({
        investigationId: id,
        calibrationVersion: 1,
        depth: "deep_dive",
        tools: FIVE_TOOLS,
        alias: "researcher-long-ctx",
        estimated: { sources: { min: 40, max: 60 }, costCents: { min: 522, max: 687 } },
        actual: { sources: 44, spendCents: 612 },
        sourcesWithinEstimate: true,
        costWithinEstimate: true,
      });
      expect({ ...second, recordedAt: first.recordedAt }).toEqual(first);
      const { rows } = await api.sql.query<{ n: number }>(
        `select count(*)::int as n from ${SCHEMA_NAME}.investigation_estimate_outcomes
          where investigation_id = $1`,
        [id],
      );
      expect(rows[0].n).toBe(1);
    });

    it("records an overrun as outside, and an unpriced spend as no verdict", async () => {
      const space = await bench();
      const id = await investigation(space);
      await service().storeEstimate(space.id, id);
      await finish(id, 71, null);

      expect(await service().reconcile(space.id, id)).toMatchObject({
        sourcesWithinEstimate: false,
        costWithinEstimate: null,
        actual: { sources: 71, spendCents: null },
      });
    });

    it("refuses to compare before there are actuals", async () => {
      const space = await bench();
      const id = await investigation(space);
      await service().storeEstimate(space.id, id);

      await expect(service().reconcile(space.id, id)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.outcomeUnavailable,
      });
    });
  });
});
