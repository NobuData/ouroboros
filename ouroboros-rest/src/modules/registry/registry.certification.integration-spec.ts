import { Client } from "pg";
import type request from "supertest";

import {
  FAKE_BASE_URL,
  FAKE_MODELS,
  FAKE_NOVEL_PARAM_SCHEMA,
  FakeModelProviderAdapter,
} from "../providers/adapters/fake.adapter.fixture";
import { ApiHarness, type Method, type Person } from "../../testing/harness.fixture";
import { bodyOf, integrationDatabaseUrl } from "../../testing/integration.fixture";
import {
  memberOf,
  seedRegistry,
  seededAliases,
  seededAliasWhere,
  type SeededAlias,
  type SeededRegistry,
} from "../../testing/registry.seed.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { FREE, SEAT_BASED, UNPRICED, USAGE_BASED } from "../pricing/price";
import { PricingService } from "../pricing/pricing.service";
import type { PriceOverrideResource } from "../pricing/resources";
import { MODEL_PROVIDER_ADAPTERS, ModelProviderRegistry } from "../providers/provider.registry";
import { ALIAS_HEALTH_STATES } from "../registry-read/alias.health";
import type { RegistryReadModelResource } from "../registry-read/registry-read.resources";
import { HOP_CODES } from "../routing/explanations";
import type { Resolution } from "../routing/resolution";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { ALIAS_ERRORS } from "./aliases.errors";
import type { AliasChangeResource, ModelAliasListResource } from "./aliases.resources";
import {
  NO_MODELS_DISCOVERED,
  type ImportCandidateListResource,
  type ImportResultResource,
} from "./import.resources";
import { REGISTRY_ERRORS } from "./registry.errors";
import { REGISTRY_ROWS } from "./registry.rows.fixture";
import type { ParamSchemaResource } from "./resources";
import type { LatestResolutionResource } from "./resolutions.resources";

/**
 * The registry epic's certification suite — CH.7
 * ([#590](https://github.com/NobuData/ouroboros/issues/590)).
 *
 * Almost every guarantee CH.1–CH.6 made is cross-table logic that fails **quietly**: a reference
 * index that misses a leg returns a smaller number, a precedence bug shows a plausible price, a
 * rebind that renumbers references breaks routing somewhere else a day later. The per-ticket
 * suites prove each endpoint; this one runs the whole registry, over the committed #582 seeds,
 * and is written so that removing a constraint turns it red:
 *
 *   * **the unbound CHECK** (V019 `model_aliases_unbound_disabled`) — *the database refuses an
 *     unbound alias that is switched on*;
 *   * **the delete guard** — *a referenced alias answers 409 and survives*;
 *   * **the rename guard** — *a referenced alias answers 422 and keeps its name*;
 *   * **pricing precedence** — *an override beats the bundled catalog, and says so*;
 *   * **the read path's purity** — *a registry read makes zero adapter calls*.
 *
 * **Two reference kinds are asserted absent, deliberately.** `alias_references` (V023) declares
 * `workflow` and `chat_pin` and contributes rows for neither yet, although the seeded published
 * workflows pin aliases. The suite holds that to be today's behaviour, so the day a migration adds
 * the leg is the day this suite asks for its draft/published blocking tests.
 *
 * The raw-model publish rejection is certified in `workflows/catalog.integration-spec.ts`, beside
 * the engine stub the publish gate needs; this suite certifies the other half of CH.6 — dropped
 * hops and the persisted snapshot.
 *
 * ```bash
 * yarn test:integration registry.certification
 * ```
 */

const REGISTRY = "/api/v1/registry";
const ALIASES = `${REGISTRY}/aliases`;
const PARAM_SCHEMA = `${REGISTRY}/param-schema`;
const IMPORT = `${REGISTRY}/import`;
const PRICES = `${REGISTRY}/prices`;
const LATEST = `${REGISTRY}/resolutions/latest`;
const SIMULATE = "/api/v1/routing/simulate";

/** Whether a scenario's target has something referencing it. */
type Guard = "guarded" | "unguarded";

/** A `pg` failure, as far as these assertions read it. */
interface DatabaseFailure {
  readonly code: string;
  readonly constraint?: string;
}

describe("the model registry, certified over the #582 seeds", () => {
  let api: ApiHarness;
  let pricing: PricingService;
  let seeded: SeededRegistry;

  beforeAll(async () => {
    api = await ApiHarness.start();
    pricing = api.nest.get(PricingService);
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    seeded = await seedRegistry(api);
  });

  afterEach(async () => {
    await api.truncate();
    // The process outlives the truncation and the price cache does not know about it.
    pricing.invalidateCatalog();
  });

  /**
   * A signed-in request into the seeded workspace, or another.
   *
   * @param person - Who.
   * @param method - The verb.
   * @param path - The path.
   * @param slug - The workspace, the seeded one by default.
   * @returns The request, to be sent.
   */
  function call(
    person: Person,
    method: Method,
    path: string,
    slug: string = seeded.workspace.slug,
  ): request.Test {
    return api.as(person)(method, path).set(TENANT_HEADER, slug);
  }

  /**
   * Read the composed registry as the owner.
   *
   * @returns The payload.
   */
  async function registry(): Promise<RegistryReadModelResource> {
    return bodyOf<RegistryReadModelResource>(await call(seeded.owner, "get", REGISTRY).expect(200));
  }

  /**
   * One row of the composed registry.
   *
   * @param payload - The payload.
   * @param alias - The alias's name.
   * @returns The row.
   */
  function rowOf(payload: RegistryReadModelResource, alias: string) {
    const row = payload.aliases.find((entry) => entry.alias === alias);

    expect(row).toBeDefined();

    return row!;
  }

  /**
   * A bound, switched-on alias that something references — the guarded target.
   *
   * @returns The alias.
   */
  function guarded(): SeededAlias {
    return seededAliasWhere(
      seeded,
      "bound, enabled alias with references",
      (alias) => alias.connectionId !== null && alias.enabled && alias.references > 0,
    );
  }

  /**
   * A bound alias that nothing references — the unguarded target.
   *
   * @returns The alias.
   */
  function unguarded(): SeededAlias {
    return seededAliasWhere(
      seeded,
      "bound alias with no references",
      (alias) => alias.connectionId !== null && alias.references === 0,
    );
  }

  /**
   * The seeded unbound alias.
   *
   * @returns The alias.
   */
  function unbound(): SeededAlias {
    return seededAliasWhere(seeded, "unbound alias", (alias) => alias.connectionId === null);
  }

  /**
   * The target for a scenario.
   *
   * @param guard - Whether it should be referenced.
   * @returns The alias.
   */
  function target(guard: Guard): SeededAlias {
    return guard === "guarded" ? guarded() : unguarded();
  }

  /**
   * A second connection of an alias's kind that has discovered the alias's model — somewhere a
   * rebind can go.
   *
   * @param alias - The alias to be rebound.
   * @returns The new connection's id.
   */
  async function twinConnection(alias: SeededAlias): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (organization_id, kind, display_name, base_url, status, last_checked_at, health)
       select organization_id, kind, 'Rebind target', base_url, 'active', now(),
              '{"latency_ms": 1}'::jsonb
         from ${SCHEMA_NAME}.provider_connections where id = $1
       returning id`,
      [alias.connectionId],
    );

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.provider_models (provider_connection_id, model_id, display, meta)
       values ($1, $2, $2, '{}'::jsonb)`,
      [rows[0].id, alias.modelId],
    );

    return rows[0].id;
  }

  /**
   * The references the alias list answers for an alias.
   *
   * @param alias - The alias's name.
   * @returns Its references' labels, in the list's order.
   */
  async function referenceLabels(alias: string): Promise<string[]> {
    const list = bodyOf<ModelAliasListResource>(
      await call(seeded.owner, "get", ALIASES).expect(200),
    );

    return (list.aliases.find((entry) => entry.alias === alias)?.references ?? []).map(
      (reference) => reference.label,
    );
  }

  /**
   * A task kind whose route chain contains an alias.
   *
   * @param alias - The alias.
   * @returns The kind's name.
   */
  async function taskKindRouting(alias: SeededAlias): Promise<string> {
    const { rows } = await api.sql.query<{ name: string }>(
      `select k.name
         from ${SCHEMA_NAME}.route_hops h
         join ${SCHEMA_NAME}.routes r on r.id = h.route_id
         join ${SCHEMA_NAME}.task_kinds k on k.id = r.task_kind_id
        where h.model_alias_id = $1
        order by k.sort_order, h.position
        limit 1`,
      [alias.id],
    );

    expect(rows).toHaveLength(1);

    return rows[0].name;
  }

  /**
   * Simulate routing for a task kind and answer the hop an alias contributed.
   *
   * @param taskKind - The kind.
   * @param alias - The alias's name.
   * @returns The hop.
   */
  async function simulatedHop(taskKind: string, alias: string) {
    const response = await call(seeded.owner, "post", SIMULATE).send({ taskKind }).expect(200);
    const hop = bodyOf<Resolution>(response).chain.find((entry) => entry.alias === alias);

    expect(hop).toBeDefined();

    return hop!;
  }

  /**
   * The workspace's alias revision actions, oldest first.
   *
   * @returns The actions.
   */
  async function revisionActions(): Promise<string[]> {
    const { rows } = await api.sql.query<{ action: string }>(
      `select action from ${SCHEMA_NAME}.alias_revisions
        where organization_id = $1 order by created_at, id`,
      [seeded.workspace.id],
    );

    return rows.map((row) => row.action);
  }

  /**
   * What the database holds for an alias id now.
   *
   * @param id - `model_aliases.id`.
   * @returns Its name, or undefined when the row is gone.
   */
  async function aliasNamed(id: string): Promise<string | undefined> {
    const { rows } = await api.sql.query<{ alias: string }>(
      `select alias from ${SCHEMA_NAME}.model_aliases where id = $1`,
      [id],
    );

    return rows[0]?.alias;
  }

  describe("the lifecycle matrix", () => {
    it("creates a bound alias switched on", async () => {
      const bound = guarded();
      const response = await call(seeded.owner, "post", ALIASES)
        .send({ alias: "matrix-bound", connectionId: bound.connectionId, modelId: bound.modelId })
        .expect(201);

      expect(bodyOf<AliasChangeResource>(response).alias).toMatchObject({
        alias: "matrix-bound",
        enabled: true,
        connection: { id: bound.connectionId },
        references: [],
      });
    });

    it("creates an unbound alias switched off, whatever the body asked for", async () => {
      const response = await call(seeded.owner, "post", ALIASES)
        .send({ alias: "matrix-unbound", modelId: "gpt-5.2-preview", enabled: true })
        .expect(201);

      expect(bodyOf<AliasChangeResource>(response).alias).toMatchObject({
        enabled: false,
        connection: null,
      });
    });

    it("has the database refuse an unbound alias that is switched on (the unbound CHECK)", async () => {
      const failure = await api.sql
        .query(
          `insert into ${SCHEMA_NAME}.model_aliases
             (organization_id, alias, provider_connection_id, model_id, enabled)
           values ($1, 'check-probe', null, 'gpt-5.2-preview', true)`,
          [seeded.workspace.id],
        )
        .then(
          () => undefined,
          (error: unknown) => error as DatabaseFailure,
        );

      expect(failure).toMatchObject({
        code: "23514",
        constraint: "model_aliases_unbound_disabled",
      });
    });

    it("refuses enabling the seeded unbound alias with the designed error, never a constraint", async () => {
      const response = await call(seeded.owner, "patch", `${ALIASES}/${unbound().id}`)
        .send({ enabled: true })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(ALIAS_ERRORS.unbound);
    });

    it.each(["guarded", "unguarded"] as const)(
      "edits the %s alias's notes as one revision",
      async (guard) => {
        const alias = target(guard);

        await call(seeded.owner, "patch", `${ALIASES}/${alias.id}`)
          .send({ notes: "certified" })
          .expect(200);

        expect((await revisionActions()).at(-1)).toBe("edited");
      },
    );

    it.each(["guarded", "unguarded"] as const)(
      "rebinds the %s alias, keeping every reference",
      async (guard) => {
        const alias = target(guard);
        const before = await referenceLabels(alias.alias);
        const twin = await twinConnection(alias);

        const response = await call(seeded.owner, "patch", `${ALIASES}/${alias.id}`)
          .send({ connectionId: twin })
          .expect(200);

        expect(bodyOf<AliasChangeResource>(response).alias.connection?.id).toBe(twin);
        expect(await referenceLabels(alias.alias)).toEqual(before);
        expect((await revisionActions()).at(-1)).toBe("rebound");
      },
    );

    it.each(["guarded", "unguarded"] as const)(
      "duplicates the %s alias switched off, with no references of its own",
      async (guard) => {
        const alias = target(guard);

        const response = await call(
          seeded.owner,
          "post",
          `${ALIASES}/${alias.id}/duplicate`,
        ).expect(201);
        const copy = bodyOf<AliasChangeResource>(response).alias;

        expect(copy).toMatchObject({
          alias: `${alias.alias}-copy`,
          enabled: false,
          references: [],
        });
      },
    );

    it.each(["guarded", "unguarded"] as const)(
      "disables and re-enables the %s alias, naming exactly the hops it drops",
      async (guard) => {
        const alias = target(guard);
        const path = `${ALIASES}/${alias.id}`;

        const disabled = bodyOf<AliasChangeResource>(
          await call(seeded.owner, "patch", path).send({ enabled: false }).expect(200),
        );
        expect(disabled.droppedHops).toHaveLength(alias.references);

        const enabled = bodyOf<AliasChangeResource>(
          await call(seeded.owner, "patch", path).send({ enabled: true }).expect(200),
        );
        expect(enabled.alias.enabled).toBe(true);
        expect((await revisionActions()).slice(-2)).toEqual(["disabled", "enabled"]);
      },
    );

    it("renames the unguarded alias", async () => {
      const alias = unguarded();

      await call(seeded.owner, "patch", `${ALIASES}/${alias.id}`)
        .send({ alias: `${alias.alias}-renamed` })
        .expect(200);

      expect(await aliasNamed(alias.id)).toBe(`${alias.alias}-renamed`);
    });

    it("refuses renaming the guarded alias, naming every referrer, and keeps the name (the rename guard)", async () => {
      const alias = guarded();

      const response = await call(seeded.owner, "patch", `${ALIASES}/${alias.id}`)
        .send({ alias: `${alias.alias}-renamed` })
        .expect(422);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe(ALIAS_ERRORS.renameBlocked);
      expect((envelope.details as { references: unknown[] }).references).toHaveLength(
        alias.references,
      );
      expect(await aliasNamed(alias.id)).toBe(alias.alias);
    });

    it("deletes the unguarded alias", async () => {
      const alias = unguarded();

      await call(seeded.owner, "delete", `${ALIASES}/${alias.id}`).expect(204);

      expect(await aliasNamed(alias.id)).toBeUndefined();
    });

    it("refuses deleting the guarded alias with a 409 listing every referrer, and keeps it (the delete guard)", async () => {
      const alias = guarded();

      const response = await call(seeded.owner, "delete", `${ALIASES}/${alias.id}`).expect(409);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe(ALIAS_ERRORS.referenced);
      expect((envelope.details as { references: unknown[] }).references).toHaveLength(
        alias.references,
      );
      expect(await aliasNamed(alias.id)).toBe(alias.alias);
    });
  });

  describe("rebind invariants", () => {
    it("keeps the referrer set, changes the next resolution, and records the revision", async () => {
      const alias = guarded();
      const taskKind = await taskKindRouting(alias);
      const referrers = await referenceLabels(alias.alias);

      expect((await simulatedHop(taskKind, alias.alias)).provider?.id).toBe(alias.connectionId);

      const twin = await twinConnection(alias);
      await call(seeded.owner, "patch", `${ALIASES}/${alias.id}`)
        .send({ connectionId: twin })
        .expect(200);

      expect(await referenceLabels(alias.alias)).toEqual(referrers);
      expect((await simulatedHop(taskKind, alias.alias)).provider?.id).toBe(twin);

      const { rows } = await api.sql.query<{
        diff: Record<string, { from: unknown; to: unknown }>;
      }>(
        `select diff from ${SCHEMA_NAME}.alias_revisions
          where alias_id = $1 and action = 'rebound'`,
        [alias.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].diff.provider_connection_id).toEqual({ from: alias.connectionId, to: twin });
    });
  });

  describe("param validation against the adapters", () => {
    /**
     * Patch an alias's params and answer the refusal's field keys.
     *
     * @param alias - The alias.
     * @param params - The params to write.
     * @returns The keys of the refusal's details.
     */
    async function refusedFields(
      alias: SeededAlias,
      params: Record<string, unknown>,
    ): Promise<string[]> {
      const response = await call(seeded.owner, "patch", `${ALIASES}/${alias.id}`)
        .send({ params })
        .expect(422);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe(REGISTRY_ERRORS.aliasParamsInvalid);

      return Object.keys(envelope.details);
    }

    it("refuses thinking on a model that has none", async () => {
      const local = seededAliasWhere(seeded, "alias bound to Ollama", (a) => a.kind === "ollama");

      expect(await refusedFields(local, { thinking: "max" })).toEqual(["params.thinking"]);
    });

    it("refuses a temperature outside the provider's range", async () => {
      const anthropic = seededAliasWhere(
        seeded,
        "alias bound to Anthropic",
        (a) => a.kind === "anthropic",
      );

      expect(await refusedFields(anthropic, { temperature: 3 })).toEqual(["params.temperature"]);
    });

    it("refuses a key no schema declares", async () => {
      const anthropic = seededAliasWhere(
        seeded,
        "alias bound to Anthropic",
        (a) => a.kind === "anthropic",
      );

      expect(await refusedFields(anthropic, { not_a_param: true })).toEqual(["params.not_a_param"]);
    });

    it("answers an unbound alias with the generic schema and its reason", async () => {
      const alias = unbound();
      const response = await call(seeded.owner, "get", PARAM_SCHEMA)
        .query({ model: alias.modelId })
        .expect(200);
      const schema = bodyOf<ParamSchemaResource>(response);

      expect(schema.connectionId).toBeNull();
      expect(schema.reason).not.toBeNull();
    });

    describe("a provider whose adapter publishes a parameter this build has never seen", () => {
      let fake: ApiHarness;

      beforeAll(async () => {
        fake = await ApiHarness.start({}, [
          {
            provide: MODEL_PROVIDER_ADAPTERS,
            useValue: [
              new FakeModelProviderAdapter({
                kind: "custom",
                paramSchema: FAKE_NOVEL_PARAM_SCHEMA,
              }),
            ],
          },
        ]);
      });

      afterAll(() => fake.close());

      it("offers it in the schema and accepts it on a write", async () => {
        const owner = await fake.signIn();
        await fake.join(seeded.workspace.id, owner, "owner");
        const modelId = FAKE_MODELS[0].id;
        const { rows } = await fake.sql.query<{ id: string }>(
          `insert into ${SCHEMA_NAME}.provider_connections
             (organization_id, kind, display_name, base_url, status, health)
           values ($1, 'custom', 'Fake', $2, 'active', '{}'::jsonb) returning id`,
          [seeded.workspace.id, FAKE_BASE_URL],
        );
        await fake.sql.query(
          `insert into ${SCHEMA_NAME}.provider_models (provider_connection_id, model_id, display, meta)
           values ($1, $2, $2, '{}'::jsonb)`,
          [rows[0].id, modelId],
        );
        const as = (method: Method, path: string) =>
          fake.as(owner)(method, path).set(TENANT_HEADER, seeded.workspace.slug);

        const schema = bodyOf<ParamSchemaResource>(
          await as("get", PARAM_SCHEMA)
            .query({ connection: rows[0].id, model: modelId })
            .expect(200),
        );
        expect(Object.keys(schema.params.schema.properties ?? {})).toContain(
          "speculative_decoding",
        );

        const created = await as("post", ALIASES)
          .send({
            alias: "speculative",
            connectionId: rows[0].id,
            modelId,
            params: { speculative_decoding: true },
          })
          .expect(201);
        expect(bodyOf<AliasChangeResource>(created).alias.params).toEqual({
          speculative_decoding: true,
        });
      });
    });
  });

  describe("chip derivation", () => {
    it("matches all eight seeded rows, and regenerates identically", async () => {
      const first = await registry();
      const second = await registry();

      expect(first.aliases).toHaveLength(REGISTRY_ROWS.length);

      for (const row of REGISTRY_ROWS) {
        expect([row.alias, rowOf(first, row.alias).chips]).toEqual([row.alias, row.chips]);
      }

      expect(second.aliases.map((row) => row.chips)).toEqual(first.aliases.map((row) => row.chips));
    });
  });

  describe("pricing", () => {
    it("resolves all four billing modes from the bundled catalog, each with provenance", async () => {
      const payload = await registry();
      const priced = payload.aliases.filter((row) => row.price.price !== null);

      expect(new Set(priced.map((row) => row.price.price!.billingMode))).toEqual(
        new Set(["token", "seat", "usage", "free"]),
      );
      expect(payload.aliases.map((row) => row.price.display)).toEqual(
        expect.arrayContaining([SEAT_BASED, USAGE_BASED, FREE]),
      );

      for (const row of priced) {
        expect(row.price.price!.provenance).toEqual(
          expect.objectContaining({
            source: expect.any(String) as string,
            effectiveAt: expect.any(String) as string,
          }),
        );
      }
    });

    it("prices the uncovered unbound alias as the dash, never as zero", async () => {
      const row = rowOf(await registry(), unbound().alias);

      expect(row.price).toMatchObject({ price: null, display: UNPRICED });
    });

    it("lets an override beat the catalog at once, and falls back when it is removed (pricing precedence)", async () => {
      const bundled = await registry();
      const tokenRow = bundled.aliases.find((row) => row.price.price?.billingMode === "token");
      expect(tokenRow).toBeDefined();
      const alias = seeded.aliases.get(tokenRow!.alias)!;
      const pair = { connectionKind: alias.kind!, modelId: alias.modelId };

      expect(tokenRow!.price.price!.provenance.source).not.toBe("override");

      // The read above warmed the cache; the write must invalidate it for the next read.
      const written = bodyOf<PriceOverrideResource>(
        await call(seeded.owner, "put", PRICES)
          .send({ ...pair, billingMode: "token", inputCentsPer1m: 1, outputCentsPer1m: 2 })
          .expect(200),
      );

      const overridden = rowOf(await registry(), alias.alias).price;
      expect(overridden.price!.provenance.source).toBe("override");
      expect(overridden.display).toBe(written.display);
      expect(overridden.display).not.toBe(tokenRow!.price.display);

      await call(seeded.owner, "delete", PRICES).query(pair).expect(204);

      expect(rowOf(await registry(), alias.alias).price).toEqual(tokenRow!.price);
    });
  });

  describe("import transactionality", () => {
    /**
     * A seeded connection that has discovered at least two models nothing is aliased to yet.
     *
     * @returns The connection's id and those models.
     */
    async function importable(): Promise<{ connectionId: string; models: string[] }> {
      const { rows } = await api.sql.query<{ connectionId: string; models: string[] }>(
        `select c.id as "connectionId", array_agg(m.model_id order by m.model_id) as models
           from ${SCHEMA_NAME}.provider_connections c
           join ${SCHEMA_NAME}.provider_models m on m.provider_connection_id = c.id
          where c.organization_id = $1
            and not exists (select 1 from ${SCHEMA_NAME}.model_aliases a
                             where a.provider_connection_id = c.id and a.model_id = m.model_id)
          group by c.id, c.display_name
         having count(*) >= 2
          order by c.display_name
          limit 1`,
        [seeded.workspace.id],
      );

      expect(rows).toHaveLength(1);

      return rows[0];
    }

    /**
     * How many aliases the seeded workspace holds.
     *
     * @returns The count.
     */
    async function aliasCount(): Promise<number> {
      return (await seededAliases(api, seeded.workspace.id)).size;
    }

    it("marks already-aliased models among the candidates and suggests names for the rest", async () => {
      const { connectionId, models } = await importable();

      const list = bodyOf<ImportCandidateListResource>(
        await call(seeded.owner, "get", `${IMPORT}/${connectionId}/candidates`).expect(200),
      );

      for (const candidate of list.candidates) {
        if (models.includes(candidate.modelId)) {
          expect(candidate.alias).toBeNull();
        } else {
          expect(candidate.alias).not.toBeNull();
        }
      }
    });

    it("creates nothing and itemizes the error when one item collides", async () => {
      const { connectionId, models } = await importable();
      const before = await aliasCount();
      const revisions = await revisionActions();

      const response = await call(seeded.owner, "post", IMPORT)
        .send({
          connectionId,
          items: [
            { modelId: models[0], alias: "imported-fresh" },
            { modelId: models[1], alias: guarded().alias },
          ],
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).details).toBeTruthy();
      expect(await aliasCount()).toBe(before);
      expect(await revisionActions()).toEqual(revisions);
    });

    it("is idempotent: a re-run skips what the first run created", async () => {
      const { connectionId, models } = await importable();
      const body = { connectionId, items: [{ modelId: models[0], alias: "imported-once" }] };

      const first = bodyOf<ImportResultResource>(
        await call(seeded.owner, "post", IMPORT).send(body).expect(201),
      );
      const second = bodyOf<ImportResultResource>(
        await call(seeded.owner, "post", IMPORT).send(body).expect(201),
      );

      expect(first.created.map((entry) => entry.alias.alias)).toEqual(["imported-once"]);
      expect(second.created).toEqual([]);
      expect(second.skipped.map((entry) => entry.modelId)).toEqual([models[0]]);
    });

    it("answers an honest empty for a connection discovery has reported nothing on", async () => {
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.provider_connections
           (organization_id, kind, display_name, base_url, status, health)
         values ($1, 'ollama', 'Empty daemon', 'http://empty.local:11434', 'active', '{}'::jsonb)
         returning id`,
        [seeded.workspace.id],
      );

      const list = bodyOf<ImportCandidateListResource>(
        await call(seeded.owner, "get", `${IMPORT}/${rows[0].id}/candidates`).expect(200),
      );

      expect(list.candidates).toEqual([]);
      expect(list.empty?.code).toBe(NO_MODELS_DISCOVERED);
    });
  });

  describe("the reference index", () => {
    /**
     * `alias_references` for the seeded workspace, counted by kind.
     *
     * @returns Kind → count, for the kinds that have rows.
     */
    async function referencesByKind(): Promise<Record<string, number>> {
      const { rows } = await api.sql.query<{ kind: string; count: string }>(
        `select kind, count(*) from ${SCHEMA_NAME}.alias_references
          where organization_id = $1 group by kind`,
        [seeded.workspace.id],
      );

      return Object.fromEntries(rows.map((row) => [row.kind, Number(row.count)]));
    }

    it("indexes route and escalation references, and no workflow or chat-pin rows yet", async () => {
      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*) from ${SCHEMA_NAME}.workflow_versions v
           join ${SCHEMA_NAME}.workflows w on w.id = v.workflow_id
          where w.organization_id = $1 and v.published_at is not null
            and v.definition::text like '%pinned_model%'`,
        [seeded.workspace.id],
      );
      // The seeds really do pin aliases from published workflows, so the absence below is the
      // index's, not the fixture's.
      expect(Number(rows[0].count)).toBeGreaterThan(0);

      const kinds = await referencesByKind();

      expect(kinds.route).toBeGreaterThan(0);
      expect(kinds.escalation).toBeGreaterThan(0);
      expect(Object.keys(kinds).sort()).toEqual(["escalation", "route"]);
    });

    it("counts every alias's Used by as exactly its index rows", async () => {
      const payload = await registry();

      for (const alias of seeded.aliases.values()) {
        const row = rowOf(payload, alias.alias);

        expect([alias.alias, row.usedBy, row.references.length]).toEqual([
          alias.alias,
          alias.references,
          alias.references,
        ]);
      }
    });

    it("still counts a switched-off escalation rule as a reference", async () => {
      const before = await referencesByKind();

      await api.sql.query(
        `update ${SCHEMA_NAME}.escalation_rules set enabled = false where organization_id = $1`,
        [seeded.workspace.id],
      );

      expect(await referencesByKind()).toEqual(before);
    });

    it("lets exactly one of a route save and a racing delete win", async () => {
      // The guard's lock, exercised: `alias_reference_guard` takes FOR UPDATE on the alias, and
      // a route hop's foreign key needs FOR KEY SHARE on it, so the save waits for the delete —
      // and then fails its foreign key, rather than both succeeding and leaving a dangling hop.
      const alias = unguarded();
      const { rows: routes } = await api.sql.query<{ routeId: string; next: number }>(
        `select route_id as "routeId", max(position) + 1 as next
           from ${SCHEMA_NAME}.route_hops where organization_id = $1
          group by route_id order by route_id limit 1`,
        [seeded.workspace.id],
      );
      const deleter = new Client({ connectionString: integrationDatabaseUrl() });
      const saver = new Client({ connectionString: integrationDatabaseUrl() });
      await deleter.connect();
      await saver.connect();

      try {
        await deleter.query("begin");
        const guard = await deleter.query(
          `select * from ${SCHEMA_NAME}.alias_reference_guard($1, $2::uuid)`,
          [seeded.workspace.id, alias.id],
        );
        expect(guard.rows).toEqual([]);

        const saved = saver
          .query(
            `insert into ${SCHEMA_NAME}.route_hops (organization_id, route_id, position, model_alias_id)
             values ($1, $2, $3, $4)`,
            [seeded.workspace.id, routes[0].routeId, routes[0].next, alias.id],
          )
          .then(
            () => undefined,
            (error: unknown) => error as DatabaseFailure,
          );

        await waitForLockWait();
        await deleter.query(`delete from ${SCHEMA_NAME}.model_aliases where id = $1`, [alias.id]);
        await deleter.query("commit");

        expect(await saved).toMatchObject({ code: "23503" });
        expect(await aliasNamed(alias.id)).toBeUndefined();
      } finally {
        await deleter.end();
        await saver.end();
      }
    });

    /**
     * Wait until some backend is blocked on a lock — the racing save, queued behind the guard.
     *
     * @throws {Error} When nothing blocks within five seconds, which would mean the save did not
     *   need the lock and the race was never run.
     */
    async function waitForLockWait(): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const { rows } = await api.sql.query<{ count: string }>(
          `select count(*) from pg_stat_activity where wait_event_type = 'Lock'`,
        );

        if (Number(rows[0].count) > 0) {
          return;
        }

        await new Promise((settle) => setTimeout(settle, 50));
      }

      throw new Error("The route save never waited on the reference guard's lock.");
    }
  });

  describe("governance", () => {
    it("explains a disabled alias's hops as dropped, in the change and in simulate", async () => {
      const alias = guarded();
      const taskKind = await taskKindRouting(alias);

      const change = bodyOf<AliasChangeResource>(
        await call(seeded.owner, "patch", `${ALIASES}/${alias.id}`)
          .send({ enabled: false })
          .expect(200),
      );
      expect(change.droppedHops.map((hop) => hop.label)).toEqual(
        await referenceLabels(alias.alias),
      );

      const hop = await simulatedHop(taskKind, alias.alias);
      expect(hop).toMatchObject({ decision: "dropped", code: HOP_CODES.disabled });
      expect(hop.explanation).toContain("dropped");
    });

    it("round-trips the seeded run's snapshot through the latest-resolution read", async () => {
      const { rows } = await api.sql.query<{
        alias: string;
        issueNumber: number;
        chain: { alias: string }[];
      }>(
        `select hop->>'alias' as alias, r.issue_number as "issueNumber", s.chain
           from ${SCHEMA_NAME}.resolution_snapshots s
           join ${SCHEMA_NAME}.runs r on r.id = s.run_id
           cross join lateral jsonb_array_elements(s.chain) hop
          where s.organization_id = $1
          order by s.resolved_at desc
          limit 1`,
        [seeded.workspace.id],
      );
      expect(rows).toHaveLength(1);

      const latest = bodyOf<LatestResolutionResource>(
        await call(seeded.owner, "get", LATEST).query({ alias: rows[0].alias }).expect(200),
      );

      expect(latest.snapshot?.run.issueNumber).toBe(rows[0].issueNumber);
      expect(latest.snapshot?.chain.map((hop) => hop.alias)).toEqual(
        rows[0].chain.map((hop) => hop.alias),
      );
    });
  });

  describe("the read model", () => {
    let find: jest.SpyInstance;
    let get: jest.SpyInstance;

    beforeEach(() => {
      find = jest.spyOn(ModelProviderRegistry.prototype, "find");
      get = jest.spyOn(ModelProviderRegistry.prototype, "get");
    });

    afterEach(() => {
      // Every read in this block is a registry read: none of them may ask an adapter anything.
      expect(find.mock.calls.length + get.mock.calls.length).toBe(0);
      find.mockRestore();
      get.mockRestore();
    });

    /**
     * A bound, switched-on alias on a healthy active connection.
     *
     * @returns The alias.
     */
    async function healthy(): Promise<SeededAlias> {
      const payload = await registry();

      return seededAliasWhere(
        seeded,
        "alias whose health is ok",
        (alias) => rowOf(payload, alias.alias).health.state === ALIAS_HEALTH_STATES.ok,
      );
    }

    it("draws the seeded ok, degraded and no-key rows", async () => {
      const states = new Set((await registry()).aliases.map((row) => row.health.state));

      expect([...states]).toEqual(
        expect.arrayContaining([
          ALIAS_HEALTH_STATES.ok,
          ALIAS_HEALTH_STATES.degraded,
          ALIAS_HEALTH_STATES.noKey,
        ]),
      );
      expect(rowOf(await registry(), unbound().alias).health.state).toBe(ALIAS_HEALTH_STATES.noKey);
    });

    it.each([
      [
        ALIAS_HEALTH_STATES.degraded,
        `update ${SCHEMA_NAME}.provider_connections
            set status = 'error', last_checked_at = now(), health = '{"detail": "down"}'::jsonb
          where id = $1`,
      ],
      [
        ALIAS_HEALTH_STATES.unknown,
        `update ${SCHEMA_NAME}.provider_connections
            set status = 'active', last_checked_at = null, health = '{}'::jsonb
          where id = $1`,
      ],
      [
        ALIAS_HEALTH_STATES.providerDisabled,
        `update ${SCHEMA_NAME}.provider_connections set enabled = false where id = $1`,
      ],
      [
        ALIAS_HEALTH_STATES.modelMissing,
        `delete from ${SCHEMA_NAME}.provider_models
          where provider_connection_id = $1 and model_id = $2`,
      ],
    ])("derives %s from what the connection row says", async (state, statement) => {
      const alias = await healthy();
      const parameters = statement.includes("$2")
        ? [alias.connectionId, alias.modelId]
        : [alias.connectionId];

      await api.sql.query(statement, parameters);

      expect(rowOf(await registry(), alias.alias).health.state).toBe(state);
    });
  });

  describe("isolation and roles", () => {
    /** One registry route, as a request builder. */
    interface RegistryRoute {
      readonly name: string;
      readonly send: (person: Person, slug?: string) => request.Test;
    }

    /**
     * Every registry read, each addressed at a seeded row.
     *
     * @returns The routes.
     */
    function reads(): RegistryRoute[] {
      const bound = guarded();

      return [
        { name: "GET /registry", send: (p, s) => call(p, "get", REGISTRY, s) },
        { name: "GET /registry/aliases", send: (p, s) => call(p, "get", ALIASES, s) },
        {
          name: "GET /registry/aliases/model-options",
          send: (p, s) =>
            call(p, "get", `${ALIASES}/model-options`, s).query({ connection: bound.connectionId }),
        },
        {
          name: "GET /registry/param-schema",
          send: (p, s) =>
            call(p, "get", PARAM_SCHEMA, s).query({
              connection: bound.connectionId,
              model: bound.modelId,
            }),
        },
        {
          name: "GET /registry/resolutions/latest",
          send: (p, s) => call(p, "get", LATEST, s).query({ alias: bound.alias }),
        },
        { name: "GET /registry/prices", send: (p, s) => call(p, "get", PRICES, s) },
      ];
    }

    /**
     * Every registry route only an administrator may use, each addressed at a seeded row.
     *
     * @returns The routes.
     */
    function writes(): RegistryRoute[] {
      const bound = guarded();
      const pair = { connectionKind: bound.kind, modelId: bound.modelId };

      return [
        {
          name: "POST /registry/aliases",
          send: (p, s) =>
            call(p, "post", ALIASES, s).send({
              alias: "intruder",
              connectionId: bound.connectionId,
              modelId: bound.modelId,
            }),
        },
        {
          name: "PATCH /registry/aliases/:id",
          send: (p, s) => call(p, "patch", `${ALIASES}/${bound.id}`, s).send({ notes: "mine" }),
        },
        {
          name: "POST /registry/aliases/:id/duplicate",
          send: (p, s) => call(p, "post", `${ALIASES}/${bound.id}/duplicate`, s),
        },
        {
          name: "DELETE /registry/aliases/:id",
          send: (p, s) => call(p, "delete", `${ALIASES}/${bound.id}`, s),
        },
        {
          name: "GET /registry/import/:connectionId/candidates",
          send: (p, s) => call(p, "get", `${IMPORT}/${bound.connectionId}/candidates`, s),
        },
        {
          name: "POST /registry/import",
          send: (p, s) =>
            call(p, "post", IMPORT, s).send({
              connectionId: bound.connectionId,
              items: [{ modelId: bound.modelId, alias: "intruder" }],
            }),
        },
        {
          name: "PUT /registry/prices",
          send: (p, s) =>
            call(p, "put", PRICES, s).send({
              ...pair,
              billingMode: "token",
              inputCentsPer1m: 1,
              outputCentsPer1m: 2,
            }),
        },
        {
          name: "DELETE /registry/prices",
          send: (p, s) => call(p, "delete", PRICES, s).query(pair),
        },
      ];
    }

    it("lets a member read every registry route", async () => {
      const member = await memberOf(api, seeded.workspace, "member");

      for (const route of reads()) {
        const response = await route.send(member);

        expect([route.name, response.status]).toEqual([route.name, 200]);
      }
    });

    it("refuses a member every registry write, and writes nothing", async () => {
      const member = await memberOf(api, seeded.workspace, "member");
      const before = await revisionActions();

      for (const route of writes()) {
        const response = await route.send(member);

        expect([route.name, response.status]).toEqual([route.name, 403]);
      }

      expect(await revisionActions()).toEqual(before);
    });

    it("answers another workspace's owner 404 for every seeded row, and nothing of this registry", async () => {
      const stranger = await api.signIn();
      const elsewhere = await api.workspace(stranger);
      const addressed = [
        ...reads().filter(
          (route) => route.name.includes("model-options") || route.name.includes("param-schema"),
        ),
        ...writes().filter(
          (route) =>
            route.name !== "POST /registry/aliases" &&
            route.name !== "PUT /registry/prices" &&
            route.name !== "DELETE /registry/prices",
        ),
      ];

      for (const route of addressed) {
        const response = await route.send(stranger, elsewhere.slug);

        expect([route.name, response.status]).toEqual([route.name, 404]);
      }

      const theirs = bodyOf<RegistryReadModelResource>(
        await call(stranger, "get", REGISTRY, elsewhere.slug).expect(200),
      );
      expect(theirs.aliases).toEqual([]);

      const latest = bodyOf<LatestResolutionResource>(
        await call(stranger, "get", LATEST, elsewhere.slug)
          .query({ alias: guarded().alias })
          .expect(200),
      );
      expect(latest.snapshot).toBeNull();
      expect(await aliasNamed(guarded().id)).toBe(guarded().alias);
    });
  });
});
