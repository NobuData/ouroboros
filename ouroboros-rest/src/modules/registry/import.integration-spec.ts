import type request from "supertest";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { FREE, UNPRICED } from "../pricing/price";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { AliasListResource } from "../routing/resources";
import type { ModelAliasListResource } from "./aliases.resources";
import { ALIAS_FIELD, IMPORT_ERRORS, MODEL_ID_FIELD } from "./import.errors";
import {
  NO_MODELS_DISCOVERED,
  type ImportCandidateListResource,
  type ImportResultResource,
} from "./import.resources";
import { REGISTRY_ERRORS } from "./registry.errors";

/**
 * `/api/v1/registry/import`, over a socket and against a migrated database
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * The ticket's eight acceptance criteria, one `it` each and in its own words:
 *
 *   * candidates for the seeded Anthropic connection mark the three already-aliased models and
 *     suggest names for the rest;
 *   * a batch containing one colliding alias returns `422` with per-item errors and **creates
 *     nothing** — asserted against the table, not against the response;
 *   * a valid batch of two creates both, enabled, with the requested names and params;
 *   * re-running the same import skips the existing aliases and reports what it skipped;
 *   * imported aliases appear immediately in routing's swap menus;
 *   * an Ollama connection's candidates show `$0`;
 *   * a connection with no discovered models returns the honest empty response;
 *   * member requests return `403`.
 *
 * Rows this surface does not write — connections, discovered models, prices — are seeded with
 * SQL, the way `aliases.integration-spec.ts` seeds them: those tables have surfaces of their
 * own, and driving them through here would test two things at once.
 */
const IMPORT = "/api/v1/registry/import";
const ALIASES = "/api/v1/registry/aliases";
const ROUTING_ALIASES = "/api/v1/routing/aliases";

/** The four models the seed's Anthropic connection has discovered. */
const ANTHROPIC_MODELS = ["claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"];

interface AliasRow {
  alias: string;
  enabled: boolean;
  model_id: string;
  params: Record<string, unknown>;
  updated_by: string | null;
}

interface RevisionRow {
  alias: string;
  action: string;
  actor: string | null;
}

describe("the import endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /**
   * A signed-in request into a workspace.
   *
   * @param person - Who.
   * @param workspace - Where.
   * @param method - The verb.
   * @param path - The path.
   * @returns The request, to be sent.
   */
  function call(
    person: Person,
    workspace: Workspace,
    method: "get" | "post",
    path: string,
  ): request.Test {
    return api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  async function connection(
    organizationId: string,
    kind: string,
    displayName: string,
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (organization_id, kind, display_name, base_url, status, last_checked_at, health)
       values ($1, $2, $3, $4, 'active', now(), '{}'::jsonb) returning id`,
      [organizationId, kind, displayName, kind === "ollama" ? "http://workstation:11434" : null],
    );

    return rows[0].id;
  }

  async function discovered(
    connectionId: string,
    modelId: string,
    contextTokens = 1_000_000,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.provider_models (provider_connection_id, model_id, display, meta)
       values ($1, $2, $2, $3::jsonb)`,
      [connectionId, modelId, JSON.stringify({ context_tokens: contextTokens })],
    );
  }

  /**
   * A bundled catalog row, the way `R__model_price_catalog.sql` writes one.
   *
   * `organization_id` is null and `catalog_version` is set, which V012 requires of a bundled
   * row and which is the shape CH.3 resolves through — the harness truncates the table between
   * tests, so the shipped catalog is not there to be relied on.
   *
   * @param kind - The provider kind, or `*`.
   * @param modelId - The model, or `*`.
   * @param billingMode - Which of V012's four.
   */
  async function priced(kind: string, modelId: string, billingMode: string): Promise<void> {
    const amounts = billingMode === "token" ? [1000, 5000] : [null, null];

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.model_prices
         (organization_id, match_provider_kind, match_model, billing_mode,
          input_cents_per_1m, output_cents_per_1m, source, catalog_version, effective_at)
       values (null, $1, $2, $3, $4, $5, 'bundled', '2026-08-15+test', now())`,
      [kind, modelId, billingMode, ...amounts],
    );
  }

  async function aliases(organizationId: string): Promise<AliasRow[]> {
    const { rows } = await api.sql.query<AliasRow>(
      `select alias, enabled, model_id, params, updated_by from ${SCHEMA_NAME}.model_aliases
        where organization_id = $1 order by alias`,
      [organizationId],
    );

    return rows;
  }

  async function revisions(organizationId: string): Promise<RevisionRow[]> {
    const { rows } = await api.sql.query<RevisionRow>(
      `select alias, action, actor from ${SCHEMA_NAME}.alias_revisions
        where organization_id = $1 order by created_at, alias`,
      [organizationId],
    );

    return rows;
  }

  /** A workspace whose Anthropic connection has discovered the seed's four models. */
  async function seeded(owner: Person): Promise<{ workspace: Workspace; anthropic: string }> {
    const workspace = await api.workspace(owner);
    const anthropic = await connection(workspace.id, "anthropic", "Anthropic Claude");

    for (const model of ANTHROPIC_MODELS) {
      await discovered(anthropic, model);
    }

    return { workspace, anthropic };
  }

  /** The three aliases the seed's registry already has on that connection. */
  async function alreadyAliased(
    owner: Person,
    workspace: Workspace,
    anthropic: string,
  ): Promise<void> {
    for (const [alias, model] of [
      ["coder-max", "claude-fable-5"],
      ["coder-std", "claude-sonnet-5"],
      ["sizer", "claude-haiku-4-5"],
    ]) {
      await call(owner, workspace, "post", ALIASES)
        .send({ alias, connectionId: anthropic, modelId: model })
        .expect(201);
    }
  }

  function candidatesPath(connectionId: string): string {
    return `${IMPORT}/${connectionId}/candidates`;
  }

  describe("who may", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("post", IMPORT).send({ connectionId: "x", items: [] }).expect(401);
    });

    it("refuses a session acting in no workspace", async () => {
      const nomad = await api.signIn();
      const response = await api.as(nomad)("post", IMPORT).send({}).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it.each(["member", "viewer"] as const)("refuses a %s both halves", async (role) => {
      // Both, deliberately: the candidates list is the first half of a write rather than a
      // view of the registry, and there is nothing in it a member could act on.
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const person = await api.signIn();

      await api.join(workspace.id, person, role);

      for (const attempt of [
        call(person, workspace, "get", candidatesPath(anthropic)),
        call(person, workspace, "post", IMPORT).send({
          connectionId: anthropic,
          items: [{ modelId: "claude-opus-5", alias: "opus-5" }],
        }),
      ]) {
        const response = await attempt.expect(403);
        expect(bodyOf<ErrorEnvelope>(response).code).toBe("forbidden");
      }

      expect(await aliases(workspace.id)).toEqual([]);
    });

    it("answers 404 for another workspace's connection, and writes nothing", async () => {
      const owner = await api.signIn();
      const { anthropic } = await seeded(owner);
      const stranger = await api.signIn();
      const elsewhere = await api.workspace(stranger);

      const read = await call(stranger, elsewhere, "get", candidatesPath(anthropic)).expect(404);
      expect(bodyOf<ErrorEnvelope>(read).code).toBe(REGISTRY_ERRORS.connectionNotFound);

      const written = await call(stranger, elsewhere, "post", IMPORT)
        .send({ connectionId: anthropic, items: [{ modelId: "claude-opus-5", alias: "opus-5" }] })
        .expect(404);
      expect(bodyOf<ErrorEnvelope>(written).code).toBe(REGISTRY_ERRORS.connectionNotFound);

      expect(await aliases(elsewhere.id)).toEqual([]);
    });
  });

  describe("the candidates", () => {
    it("marks the three already-aliased models and suggests names for the rest", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      await alreadyAliased(owner, workspace, anthropic);

      const response = await call(owner, workspace, "get", candidatesPath(anthropic)).expect(200);
      const {
        connection: bound,
        candidates,
        empty,
      } = bodyOf<ImportCandidateListResource>(response);

      expect(bound).toEqual({
        id: anthropic,
        kind: "anthropic",
        displayName: "Anthropic Claude",
      });
      expect(empty).toBeNull();
      expect(candidates.map((row) => [row.modelId, row.alias?.alias ?? null])).toEqual([
        ["claude-fable-5", "coder-max"],
        ["claude-haiku-4-5", "sizer"],
        ["claude-opus-5", null],
        ["claude-sonnet-5", "coder-std"],
      ]);
      // Only the unnamed one arrives ticked — the curation is the feature.
      expect(candidates.filter((row) => row.selected).map((row) => row.modelId)).toEqual([
        "claude-opus-5",
      ]);
      // And the shared `claude` prefix is dropped, so the suggestion is what somebody would
      // have typed.
      expect(candidates.map((row) => row.suggestedName)).toEqual([
        "fable-5",
        "haiku-4-5",
        "opus-5",
        "sonnet-5",
      ]);
    });

    it("carries the price preview and the capability headline on every row", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      await priced("anthropic", "claude-opus-5", "token");

      const response = await call(owner, workspace, "get", candidatesPath(anthropic)).expect(200);
      const { candidates } = bodyOf<ImportCandidateListResource>(response);
      const opus = candidates.find((row) => row.modelId === "claude-opus-5");

      expect(opus?.price.price?.billingMode).toBe("token");
      expect(opus?.price.price?.provenance.source).toBe("bundled");
      // An uncovered model is an em dash and never a zero — CH.3's distinction, carried here.
      expect(candidates.find((row) => row.modelId === "claude-fable-5")?.price.display).toBe(
        UNPRICED,
      );
      // The context window discovery reported, not a form bound.
      expect(opus?.capabilities.contextTokens).toBe(1_000_000);
    });

    it("shows $0 for an Ollama connection's models", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const ollama = await connection(workspace.id, "ollama", "Ollama · workstation");

      await discovered(ollama, "qwen3-coder:32b", 262_144);
      await priced("ollama", "*", "free");

      const response = await call(owner, workspace, "get", candidatesPath(ollama)).expect(200);
      const { candidates } = bodyOf<ImportCandidateListResource>(response);

      expect(candidates[0].price.display).toBe(FREE);
      expect(candidates[0].price.price?.billingMode).toBe("free");
      // A tag separator is not a name; the suggestion is one V015 would store.
      expect(candidates[0].suggestedName).toBe("qwen3-coder-32b");
    });

    it("answers an honest empty for a connection with nothing discovered", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const quiet = await connection(workspace.id, "ollama", "Ollama · laptop");

      const response = await call(owner, workspace, "get", candidatesPath(quiet)).expect(200);
      const { candidates, empty } = bodyOf<ImportCandidateListResource>(response);

      expect(candidates).toEqual([]);
      expect(empty?.code).toBe(NO_MODELS_DISCOVERED);
      expect(empty?.message).toContain("Ollama · laptop");
      expect(empty?.fix).toBe("/models/providers");
    });

    it("refuses a connection id that is not a uuid", async () => {
      const owner = await api.signIn();
      const { workspace } = await seeded(owner);

      const response = await call(owner, workspace, "get", `${IMPORT}/anthropic/candidates`).expect(
        422,
      );

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
    });
  });

  describe("the batch", () => {
    it("creates both of two, enabled, with the requested names and params", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      const response = await call(owner, workspace, "post", IMPORT)
        .send({
          connectionId: anthropic,
          items: [
            { modelId: "claude-opus-5", alias: "opus-5", params: { thinking: "max" } },
            { modelId: "claude-haiku-4-5", alias: "haiku-tiny" },
          ],
        })
        .expect(200);
      const result = bodyOf<ImportResultResource>(response);

      expect(result.skipped).toEqual([]);
      expect(result.created.map((entry) => entry.alias.alias)).toEqual(["opus-5", "haiku-tiny"]);
      expect(result.created.every((entry) => entry.alias.enabled)).toBe(true);
      expect(result.created[0].alias.params).toEqual({ thinking: "max" });
      expect(result.created.every((entry) => entry.revisionId.length > 0)).toBe(true);

      // Enabled in the table too, which is where V019's CHECK would have had an opinion.
      expect(await aliases(workspace.id)).toEqual([
        expect.objectContaining({
          alias: "haiku-tiny",
          enabled: true,
          model_id: "claude-haiku-4-5",
          updated_by: owner.id,
        }),
        expect.objectContaining({
          alias: "opus-5",
          enabled: true,
          model_id: "claude-opus-5",
          params: { thinking: "max" },
        }),
      ]);
    });

    it("leaves one `created` revision per alias, attributed to the session", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      await call(owner, workspace, "post", IMPORT)
        .send({
          connectionId: anthropic,
          items: [
            { modelId: "claude-opus-5", alias: "opus-5" },
            { modelId: "claude-haiku-4-5", alias: "haiku-tiny" },
          ],
        })
        .expect(200);

      expect(await revisions(workspace.id)).toEqual([
        { alias: "haiku-tiny", action: "created", actor: owner.id },
        { alias: "opus-5", action: "created", actor: owner.id },
      ]);
    });

    it("returns 422 itemized and creates nothing when one name collides", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      await call(owner, workspace, "post", ALIASES)
        .send({ alias: "opus-5", connectionId: anthropic, modelId: "claude-sonnet-5" })
        .expect(201);

      const response = await call(owner, workspace, "post", IMPORT)
        .send({
          connectionId: anthropic,
          items: [
            { modelId: "claude-haiku-4-5", alias: "haiku-tiny" },
            { modelId: "claude-opus-5", alias: "opus-5" },
          ],
        })
        .expect(422);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe(IMPORT_ERRORS.invalid);
      expect(envelope.details.items).toEqual({
        "1": { [ALIAS_FIELD]: [expect.stringContaining("already has an alias by that name")] },
      });

      // Nothing partial: the good item did not land either, and the table is what says so.
      expect((await aliases(workspace.id)).map((row) => row.alias)).toEqual(["opus-5"]);
      expect(await revisions(workspace.id)).toHaveLength(1);
    });

    it("refuses a model discovery has not reported, and creates nothing", async () => {
      // Decision R7 — the rule that makes import safe. CH.1's create would have warned and
      // saved; a bulk path cannot make that allowance.
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      const response = await call(owner, workspace, "post", IMPORT)
        .send({
          connectionId: anthropic,
          items: [
            { modelId: "claude-opus-5", alias: "opus-5" },
            { modelId: "claude-3-5-sonnet-20241022-v2", alias: "sonnet-legacy" },
          ],
        })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).details.items).toEqual({
        "1": { [MODEL_ID_FIELD]: [expect.stringContaining("has not discovered a model")] },
      });
      expect(await aliases(workspace.id)).toEqual([]);
    });

    it("skips what it already imported when the same import is run again", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const body = {
        connectionId: anthropic,
        items: [
          { modelId: "claude-opus-5", alias: "opus-5" },
          { modelId: "claude-haiku-4-5", alias: "haiku-tiny" },
        ],
      };

      await call(owner, workspace, "post", IMPORT).send(body).expect(200);

      const again = await call(owner, workspace, "post", IMPORT).send(body).expect(200);
      const result = bodyOf<ImportResultResource>(again);

      expect(result.created).toEqual([]);
      expect(result.skipped).toEqual([
        {
          modelId: "claude-opus-5",
          requestedAlias: "opus-5",
          alias: { id: expect.any(String) as string, alias: "opus-5" },
        },
        {
          modelId: "claude-haiku-4-5",
          requestedAlias: "haiku-tiny",
          alias: { id: expect.any(String) as string, alias: "haiku-tiny" },
        },
      ]);
      // Two aliases and two revisions, still — a re-run wrote nothing.
      expect(await aliases(workspace.id)).toHaveLength(2);
      expect(await revisions(workspace.id)).toHaveLength(2);
    });

    it("imports the new one and skips the old after a discovery refresh", async () => {
      // The shape the idempotency exists for: an operator refreshes discovery and asks for
      // *the new ones*, not for an error about the old ones.
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      await call(owner, workspace, "post", IMPORT)
        .send({ connectionId: anthropic, items: [{ modelId: "claude-opus-5", alias: "opus-5" }] })
        .expect(200);

      await discovered(anthropic, "claude-opus-6");

      const response = await call(owner, workspace, "post", IMPORT)
        .send({
          connectionId: anthropic,
          items: [
            { modelId: "claude-opus-5", alias: "opus-5" },
            { modelId: "claude-opus-6", alias: "opus-6" },
          ],
        })
        .expect(200);
      const result = bodyOf<ImportResultResource>(response);

      expect(result.created.map((entry) => entry.alias.alias)).toEqual(["opus-6"]);
      expect(result.skipped.map((entry) => entry.modelId)).toEqual(["claude-opus-5"]);
    });

    it("refuses a batch that asks for one name twice", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      const response = await call(owner, workspace, "post", IMPORT)
        .send({
          connectionId: anthropic,
          items: [
            { modelId: "claude-opus-5", alias: "twin" },
            { modelId: "claude-haiku-4-5", alias: "twin" },
          ],
        })
        .expect(422);

      expect(Object.keys(bodyOf<ErrorEnvelope>(response).details.items as object)).toEqual([
        "0",
        "1",
      ]);
      expect(await aliases(workspace.id)).toEqual([]);
    });

    it("refuses params the model does not accept, naming the field on the item", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      // A kind this build has an adapter for, and a param outside what it publishes.
      const anthropic = await connection(workspace.id, "anthropic", "Anthropic Claude");

      await discovered(anthropic, "claude-opus-5");

      const response = await call(owner, workspace, "post", IMPORT)
        .send({
          connectionId: anthropic,
          items: [{ modelId: "claude-opus-5", alias: "opus-5", params: { thinking: "extreme" } }],
        })
        .expect(422);
      const items = bodyOf<ErrorEnvelope>(response).details.items as Record<
        string,
        Record<string, string[]>
      >;

      expect(Object.keys(items)).toEqual(["0"]);
      expect(Object.keys(items["0"])).toEqual(["params.thinking"]);
      expect(await aliases(workspace.id)).toEqual([]);
    });

    it("refuses an import of nothing", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      const response = await call(owner, workspace, "post", IMPORT)
        .send({ connectionId: anthropic, items: [] })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
    });
  });

  describe("what an import is, once it exists", () => {
    it("puts the alias in the registry list and in routing's swap menus at once", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      await call(owner, workspace, "post", IMPORT)
        .send({ connectionId: anthropic, items: [{ modelId: "claude-opus-5", alias: "opus-5" }] })
        .expect(200);

      const registry = await call(owner, workspace, "get", ALIASES).expect(200);
      expect(bodyOf<ModelAliasListResource>(registry).aliases.map((row) => row.alias)).toEqual([
        "opus-5",
      ]);

      // Z.2's read, which is what the routing matrix's swap menus are built from. Nothing had
      // to be published, refreshed or invalidated — an imported alias is an alias.
      const swap = await call(owner, workspace, "get", ROUTING_ALIASES).expect(200);
      const menu = bodyOf<AliasListResource>(swap).aliases;

      expect(menu.map((entry) => entry.alias)).toEqual(["opus-5"]);
      // With the binding the import gave it, so the menu can preview what a swap would mean.
      expect(menu[0].modelId).toBe("claude-opus-5");
      expect(menu[0].provider).toMatchObject({ id: anthropic, kind: "anthropic" });
    });

    it("drops the imported name out of the next read's suggestions", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      await call(owner, workspace, "post", IMPORT)
        .send({ connectionId: anthropic, items: [{ modelId: "claude-opus-5", alias: "opus-5" }] })
        .expect(200);

      const response = await call(owner, workspace, "get", candidatesPath(anthropic)).expect(200);
      const { candidates } = bodyOf<ImportCandidateListResource>(response);
      const opus = candidates.find((row) => row.modelId === "claude-opus-5");

      expect(opus?.alias?.alias).toBe("opus-5");
      expect(opus?.selected).toBe(false);
    });
  });
});
