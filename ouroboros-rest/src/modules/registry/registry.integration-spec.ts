import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Logger } from "@nestjs/common";

import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { VaultRotation } from "../vault/vault.rotation";
import { VaultService } from "../vault/vault.service";
import { paramChips } from "./params.chips";
import { ParamSchemaService } from "./params.service";
import {
  isProviderConnectionInUse,
  providerConnectionInUse,
  REGISTRY_ERRORS,
} from "./registry.errors";
import { REGISTRY_ROWS } from "./registry.rows.fixture";
import { ProviderCredentialStore } from "./registry.secrets";
import { RegistryService } from "./registry.service";
import type { ParamSchemaResource } from "./resources";

/**
 * The registry against a migrated database — V015's two tables, their constraints and the
 * refusal one of them raises ([#189](https://github.com/NobuData/ouroboros/issues/189)).
 *
 * The unit suites run the same code over recorded statements and hand-written rows, and that
 * is exactly what makes this one necessary: a hand-written row is written to the rules its
 * author believes V015 has. Four things can only be asserted here, and three of them are
 * acceptance criteria:
 *
 *   * **A credential does not reach an answer.** A real ciphertext, sealed by the real vault,
 *     is put on a connection — and then every accessor is asked for everything it can give
 *     and the ciphertext is looked for in what comes back and in what was logged. That is the
 *     ticket's *verified by a probe, not by inspection*.
 *   * **The refusal is real, and it is recognisable.** A `delete` of a connection aliases
 *     depend on is issued against the server, and the error it raises is run through
 *     `isProviderConnectionInUse` and turned into the designed message. A hand-written error
 *     object would only prove a predicate matches a literal.
 *   * **Resolution is one statement the server accepts**, joining two tables whose composite
 *     foreign key is the thing keeping them in the same workspace.
 *   * **The vault's sweep re-seals this column**, which is the reason the store lands with
 *     the migration rather than with the first thing that writes a credential.
 *
 * CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)) adds three more, and each is
 * also a criterion:
 *
 *   * **The param schema is served over a socket**, bound and unbound, with a bound really
 *     narrowed by a row in V017's `provider_models` and labelled as coming from there.
 *   * **All eight mockup rows' chips reproduce from rows the database accepted.** Each row's
 *     `params` and `restrictions` are inserted through V019's own CHECKs — so a document this
 *     product could not store fails here rather than in the unit suite, where the constraint is
 *     not present.
 *   * **A write the model does not support is a `422` naming the field**, resolved through the
 *     real adapter registry rather than a hand-written schema.
 *
 * ---------------------------------------------------------------------------
 * **This suite reaches into the injector**, which integration suites are warned off doing,
 * and for `vault.integration-spec.ts`'s reason: most of `RegistryModule` has no route.
 * Decision **M2** left every *write* over these tables to mockups 07 and 21, and CH.2's one
 * controller is a read — so resolution, the credential store and the write-validation seam
 * have no request that exercises them, and the injector is the only door. The param-schema
 * read itself is exercised over a socket, as everything with a route is.
 *
 * Rows are inserted with SQL rather than through a service, for the same reason: this module
 * has no writer, and giving it one for a test would be the pre-emption M2 exists to prevent.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The plaintext sealed into the fixture connection. Never expected to appear anywhere. */
const API_KEY = "sk-ant-api03-registry-integration-000000000000000";

/** The record the envelope is bound to — the connection's own id, as V015 intends. */
const CONNECTION_ID = "e0000000-0000-0000-0000-0000000000aa";

/** The surface under test, for the half of it that has one. */
const PARAM_SCHEMA = "/api/v1/registry/param-schema";

/**
 * The connection the param-schema cases address, as a **v4** uuid.
 *
 * {@link CONNECTION_ID} predates them and is not one — `…-0000-0000-…` has no version nibble —
 * and it reaches those cases through a query string, where `@IsUUID()` checks it. That check is
 * right and this fixture is the odd one: `gen_random_uuid()` produces v4, so a connection a
 * workspace really has is one, and a hand-written id that is not says more about the fixture
 * than about the rule.
 */
const PARAM_CONNECTION_ID = "e0000000-0000-4000-8000-0000000000a1";

/** The repository root, from which `ouroboros-db` is a sibling of this module. */
const REPOSITORY_ROOT = join(__dirname, "..", "..", "..", "..");

/**
 * The committed catalog import, read once.
 *
 * `ApiHarness.truncate()` empties every table the migrations created, `model_prices` included,
 * so the enrichment cases below would otherwise be about an empty catalog. Re-running the
 * committed repeatable migration verbatim — rather than inserting a fixture — is what makes
 * *the shipped snapshot enriches a real schema* the thing being asserted;
 * `pricing.integration-spec.ts` does the same and says why at greater length.
 */
const CATALOG_SQL = readFileSync(
  join(REPOSITORY_ROOT, "ouroboros-db", "migrations", "R__model_price_catalog.sql"),
  "utf8",
);

describe("the model registry, against a migrated database", () => {
  let api: ApiHarness;
  let registry: RegistryService;
  let vault: VaultService;
  let rotation: VaultRotation;
  let store: ProviderCredentialStore;
  let params: ParamSchemaService;

  beforeAll(async () => {
    api = await ApiHarness.start();
    registry = api.nest.get(RegistryService);
    vault = api.nest.get(VaultService);
    rotation = api.nest.get(VaultRotation);
    store = api.nest.get(ProviderCredentialStore);
    params = api.nest.get(ParamSchemaService);
  });

  afterAll(() => api.close());
  afterEach(async () => {
    await api.truncate();
    // The truncation empties `model_prices` too, so the enrichment cases would otherwise be
    // about an empty catalog. Re-applied rather than fixtured — see `CATALOG_SQL`.
    await importCatalog();
  });

  /**
   * A workspace with an owner.
   *
   * @returns The workspace's id.
   */
  async function workspace(): Promise<string> {
    return (await api.workspace(await api.signIn())).id;
  }

  /**
   * Insert one provider connection.
   *
   * @param organizationId - The workspace it belongs to.
   * @param overrides - Columns to set: `id`, `kind`, `display_name`, `base_url` and the
   *   sealed credential. Everything else takes V015's defaults, which is the point — a
   *   connection nothing has checked is `unknown` with no health, and that is what a fixture
   *   should reproduce rather than paper over.
   * @returns The connection's id.
   */
  async function connection(
    organizationId: string,
    overrides: {
      id?: string;
      kind?: string;
      displayName?: string;
      baseUrl?: string | null;
      sealed?: string | null;
    } = {},
  ): Promise<string> {
    const {
      id = CONNECTION_ID,
      kind = "anthropic",
      displayName = "Anthropic",
      baseUrl = null,
      sealed = null,
    } = overrides;

    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (id, organization_id, kind, display_name, base_url, credentials_encrypted)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [id, organizationId, kind, displayName, baseUrl, sealed],
    );

    return rows[0].id;
  }

  /**
   * Insert one alias.
   *
   * @param organizationId - The workspace.
   * @param alias - The name.
   * @param connectionId - The connection it resolves on.
   * @param modelId - The raw provider model string — the only place one lives (decision M1).
   * @param params - Per-alias invocation defaults.
   */
  async function alias(
    organizationId: string,
    alias: string,
    connectionId: string | null,
    modelId: string,
    params: Record<string, unknown> = {},
    restrictions: Record<string, unknown> = {},
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.model_aliases
         (organization_id, alias, provider_connection_id, model_id, enabled, params, restrictions)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        organizationId,
        alias,
        connectionId,
        modelId,
        // V019's `model_aliases_unbound_disabled` refuses an enabled row with no binding, so
        // the fixture says `false` for one rather than papering over the CHECK.
        connectionId !== null,
        JSON.stringify(params),
        JSON.stringify(restrictions),
      ],
    );
  }

  /** Record one discovered model against a connection, as AE.4's sweep will. */
  async function discovered(
    connectionId: string,
    modelId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.provider_models
         (provider_connection_id, model_id, display, meta)
       values ($1, $2, $3, $4)`,
      [connectionId, modelId, modelId, JSON.stringify(meta)],
    );
  }

  /** Re-apply the committed bundled catalog after a truncation. */
  async function importCatalog(): Promise<void> {
    await api.sql.query(CATALOG_SQL);
  }

  /**
   * The refusal a call is expected to raise.
   *
   * A helper rather than `rejects.toMatchObject`, because what these cases assert is the
   * envelope's *contents* — the code, the status and which fields `details` names — and a
   * matcher over a rejected promise would only say that something was thrown.
   *
   * @param call - The call that must be refused.
   * @returns The error it raised.
   * @throws {Error} When the call succeeded, which would otherwise pass silently.
   */
  async function refused(
    call: () => Promise<unknown>,
  ): Promise<{ getStatus(): number; code: string; details: object }> {
    try {
      await call();
    } catch (error) {
      return error as { getStatus(): number; code: string; details: object };
    }

    throw new Error("expected the write to be refused, and it was not");
  }

  /**
   * The sealed credential a connection is carrying, straight from the table.
   *
   * @param connectionId - The connection.
   * @returns The envelope, or null.
   */
  async function sealedOn(connectionId: string): Promise<string | null> {
    const { rows } = await api.sql.query<{ credentials_encrypted: string | null }>(
      `select credentials_encrypted from ${SCHEMA_NAME}.provider_connections where id = $1`,
      [connectionId],
    );

    return rows[0].credentials_encrypted;
  }

  describe("resolving an alias", () => {
    it("joins the alias to its connection in one statement the server accepts", async () => {
      const organizationId = await workspace();
      const connectionId = await connection(organizationId);
      await alias(organizationId, "coder-max", connectionId, "claude-fable-5", {
        thinking: "max",
      });

      await expect(registry.resolve(organizationId, "coder-max")).resolves.toEqual({
        alias: "coder-max",
        modelId: "claude-fable-5",
        params: { thinking: "max" },
        connection: {
          id: connectionId,
          kind: "anthropic",
          displayName: "Anthropic",
          baseUrl: null,
          // V015's default, and decision M8: nothing has checked this connection, so the
          // honest answer is `unknown` rather than a green dot.
          status: "unknown",
        },
      });
    });

    it("resolves a local provider to its address", async () => {
      const organizationId = await workspace();
      const connectionId = await connection(organizationId, {
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: "http://workstation.local:11434",
      });
      await alias(organizationId, "local-docs", connectionId, "llama-4-maverick");

      const resolved = await registry.resolve(organizationId, "local-docs");

      expect(resolved.connection.baseUrl).toBe("http://workstation.local:11434");
      expect(resolved.connection.kind).toBe("ollama");
    });

    it("refuses a name this workspace does not have", async () => {
      const organizationId = await workspace();

      await expect(registry.resolve(organizationId, "coder-max")).rejects.toMatchObject({
        code: REGISTRY_ERRORS.aliasNotFound,
      });
    });

    it("does not resolve another workspace's alias", async () => {
      // The composite foreign key holds an alias and its connection to one workspace; this is
      // the other half — a *lookup* scoped to the caller's workspace, so the same name in two
      // workspaces is two answers and never one.
      const mine = await workspace();
      const theirs = await workspace();
      const theirConnection = await connection(theirs, {
        id: "e0000000-0000-0000-0000-0000000000bb",
      });
      await alias(theirs, "coder-max", theirConnection, "claude-opus-5");

      await expect(registry.resolve(mine, "coder-max")).rejects.toMatchObject({
        code: REGISTRY_ERRORS.aliasNotFound,
      });
      await expect(registry.resolve(theirs, "coder-max")).resolves.toMatchObject({
        modelId: "claude-opus-5",
      });
    });

    it("lists every alias in the workspace, resolved and ordered", async () => {
      const organizationId = await workspace();
      const anthropic = await connection(organizationId);
      const ollama = await connection(organizationId, {
        id: "e0000000-0000-0000-0000-0000000000cc",
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: "http://workstation.local:11434",
      });
      await alias(organizationId, "local-docs", ollama, "llama-4-maverick");
      await alias(organizationId, "coder-max", anthropic, "claude-fable-5");

      const listed = await registry.list(organizationId);

      expect(listed.map((entry) => `${entry.alias} → ${entry.modelId}`)).toEqual([
        "coder-max → claude-fable-5",
        "local-docs → llama-4-maverick",
      ]);
    });
  });

  describe("the credential a resolution must never carry", () => {
    /**
     * A workspace with a connection carrying a genuinely sealed credential.
     *
     * The envelope comes from the real vault rather than from a literal, which is what makes
     * this a probe rather than a string comparison: it is bound to this workspace and this
     * record, and it is what a production row would hold.
     *
     * @returns The workspace, the connection and the ciphertext on it.
     */
    async function sealedConnection(): Promise<{
      organizationId: string;
      connectionId: string;
      envelope: string;
    }> {
      const organizationId = await workspace();
      const envelope = await vault.encryptText(organizationId, CONNECTION_ID, API_KEY);
      const connectionId = await connection(organizationId, { sealed: envelope });
      await alias(organizationId, "coder-max", connectionId, "claude-fable-5");

      return { organizationId, connectionId, envelope };
    }

    it("stores the envelope, so the fixture is not testing an empty column", async () => {
      const { connectionId, envelope } = await sealedConnection();

      expect(await sealedOn(connectionId)).toBe(envelope);
      expect(envelope).toMatch(/^ouro\.v1\.\d+\./);
    });

    it("refuses to store a credential that is not sealed", async () => {
      // V015's provider_connections_credentials_sealed, from this side: the column cannot
      // hold a plaintext, so what leaks in the worst case is ciphertext. Asserted here as
      // well as in `ouroboros-db/tests/constraints.sql` because this is the writer's view of
      // it — a service that forgot to seal is refused rather than silently storing a key.
      const organizationId = await workspace();

      await expect(connection(organizationId, { sealed: API_KEY })).rejects.toThrow(
        /provider_connections_credentials_sealed/,
      );
    });

    it("does not appear in anything the accessors answer with", async () => {
      const { organizationId, connectionId, envelope } = await sealedConnection();

      const answers = JSON.stringify([
        await registry.resolve(organizationId, "coder-max"),
        await registry.list(organizationId),
        await registry.dependentAliases(organizationId, connectionId),
      ]);

      expect(answers).not.toContain(envelope);
      expect(answers).not.toContain(API_KEY);
      // The ciphertext is base64url with no separators, so a partial leak would not match the
      // whole envelope. The magic prefix is what any fragment of one would carry.
      expect(answers).not.toContain("ouro.v1.");
    });

    it("does not appear in anything the accessors log", async () => {
      // The other half of *never in logs or responses*. `no-secret-logging` is the lint rule
      // that catches the line somebody adds tomorrow; this is the assertion about the paths
      // that run today, and it spies on every sink Nest publishes rather than on `log` alone.
      const { organizationId, connectionId, envelope } = await sealedConnection();
      const written: unknown[] = [];
      const sinks = ["log", "warn", "error", "debug", "verbose", "fatal"] as const;
      const spies = sinks.map((sink) =>
        jest.spyOn(Logger.prototype, sink).mockImplementation((...args: unknown[]) => {
          written.push(...args);
        }),
      );

      try {
        await registry.resolve(organizationId, "coder-max");
        await registry.list(organizationId);
        await registry.dependentAliases(organizationId, connectionId);
      } finally {
        for (const spy of spies) {
          spy.mockRestore();
        }
      }

      const logged = written.map((entry) => String(entry)).join(" ");
      expect(logged).not.toContain(envelope);
      expect(logged).not.toContain(API_KEY);
      expect(logged).not.toContain("ouro.v1.");
    });
  });

  describe("removing a connection aliases depend on", () => {
    it("is refused by the server, naming V015's constraint", async () => {
      const organizationId = await workspace();
      const connectionId = await connection(organizationId);
      await alias(organizationId, "coder-max", connectionId, "claude-fable-5");

      const refusal = await api.sql
        .query(`delete from ${SCHEMA_NAME}.provider_connections where id = $1`, [connectionId])
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(refusal).toBeDefined();
      expect(isProviderConnectionInUse(refusal)).toBe(true);
    });

    it("turns that refusal into a message naming what is in the way", async () => {
      // The ticket's fourth acceptance criterion, end to end: the rule is the database's, the
      // recogniser tells this violation from every other one, and the names come from the
      // pre-flight read. What a person is shown is the last line.
      const organizationId = await workspace();
      const connectionId = await connection(organizationId);
      await alias(organizationId, "coder-max", connectionId, "claude-fable-5");
      await alias(organizationId, "local-docs", connectionId, "claude-sonnet-5");

      const refusal = await api.sql
        .query(`delete from ${SCHEMA_NAME}.provider_connections where id = $1`, [connectionId])
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(isProviderConnectionInUse(refusal)).toBe(true);

      const blocking = await registry.dependentAliases(organizationId, connectionId);
      const designed = providerConnectionInUse(connectionId, blocking);

      expect(designed.getStatus()).toBe(409);
      expect(designed.envelope().message).toBe(
        "This provider connection cannot be removed while coder-max and local-docs resolve on it. " +
          "Repoint or remove them first.",
      );
    });

    it("names nothing once the aliases are gone, and the removal goes through", async () => {
      const organizationId = await workspace();
      const connectionId = await connection(organizationId);
      await alias(organizationId, "coder-max", connectionId, "claude-fable-5");

      await api.sql.query(`delete from ${SCHEMA_NAME}.model_aliases where organization_id = $1`, [
        organizationId,
      ]);

      await expect(registry.dependentAliases(organizationId, connectionId)).resolves.toEqual([]);
      await expect(
        api.sql.query(`delete from ${SCHEMA_NAME}.provider_connections where id = $1`, [
          connectionId,
        ]),
      ).resolves.toBeDefined();
    });

    it("does not stop the workspace itself being deleted", async () => {
      // The interaction V015's header writes down: both tables cascade from `organization`,
      // and the restrict is checked immediately — so a reader would reasonably fear that the
      // connection cascade meets aliases that have not been deleted yet and refuses, making a
      // workspace undeletable the moment it configured a provider. It does not, and this is
      // the assertion that would fail if that ever stopped being true.
      const organizationId = await workspace();
      const connectionId = await connection(organizationId);
      await alias(organizationId, "coder-max", connectionId, "claude-fable-5");

      await expect(
        api.sql.query(`delete from ${SCHEMA_NAME}.organization where "id" = $1`, [organizationId]),
      ).resolves.toBeDefined();

      await expect(registry.list(organizationId)).resolves.toEqual([]);
    });
  });

  describe("the vault's sweep, over the column V015 added", () => {
    it("finds a credential sealed on an older key version", async () => {
      const organizationId = await workspace();
      const envelope = await vault.encryptText(organizationId, CONNECTION_ID, API_KEY);
      const connectionId = await connection(organizationId, { sealed: envelope });

      await expect(store.pending(organizationId, 2)).resolves.toEqual([
        { recordId: connectionId, secret: envelope, sealed: true },
      ]);
      // Nothing to do on the version it is already sealed on.
      await expect(store.pending(organizationId, 1)).resolves.toEqual([]);
    });

    it("re-seals it onto the new version, and the plaintext survives the trip", async () => {
      // This is why the store lands with the migration rather than with the first thing that
      // writes a credential: without it, a rotation would retire version 1 while a row was
      // still sealed under it.
      //
      // `vault.rotate` then `rotation.sweep` rather than `rotation.rotate`, which starts the
      // sweep *detached* — deliberately, so a request that rotated a key does not wait for the
      // re-encryption. A suite that awaited the same background promise would be asserting on
      // a race; running the two halves in order asserts on the work.
      const organizationId = await workspace();
      const before = await vault.encryptText(organizationId, CONNECTION_ID, API_KEY);
      const connectionId = await connection(organizationId, { sealed: before });

      expect(await vault.rotate(organizationId)).toBe(2);
      expect(await rotation.sweep(organizationId)).toMatchObject({
        resealed: 1,
        adopted: 0,
        failed: 0,
      });

      const after = await sealedOn(connectionId);
      expect(after).not.toBe(before);
      expect(after).toMatch(/^ouro\.v1\.2\./);
      expect(await vault.decryptText(organizationId, connectionId, after ?? "")).toBe(API_KEY);
    });

    it("leaves a connection with no credential alone", async () => {
      const organizationId = await workspace();
      const connectionId = await connection(organizationId, {
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: "http://workstation.local:11434",
      });

      await rotation.sweep(organizationId);

      expect(await sealedOn(connectionId)).toBeNull();
    });

    it("does not overwrite a credential that changed under it", async () => {
      // The conditional write, against the race it exists for: AD.2's lifecycle replacing a
      // key between the sweep reading a row and writing it back. Re-sealing the value that
      // write replaced would resurrect a superseded credential.
      const organizationId = await workspace();
      const stale = await vault.encryptText(organizationId, CONNECTION_ID, API_KEY);
      const connectionId = await connection(organizationId, { sealed: stale });
      const replacement = await vault.encryptText(organizationId, CONNECTION_ID, "sk-ant-api03-b");

      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections set credentials_encrypted = $2 where id = $1`,
        [connectionId, replacement],
      );

      await store.store({ recordId: connectionId, secret: stale, sealed: true }, stale);

      expect(await sealedOn(connectionId)).toBe(replacement);
    });
  });

  describe("the param schema, over a socket", () => {
    it("offers thinking and a budget on a thinking model", async () => {
      // CH.2's first acceptance criterion, end to end: the real Anthropic adapter, through the
      // real registry, over the real route.
      const person = await api.signIn();
      const space = await api.workspace(person);
      const connectionId = await connection(space.id, { id: PARAM_CONNECTION_ID });

      const response = await api
        .as(person)("get", `${PARAM_SCHEMA}?connection=${connectionId}&model=claude-fable-5`)
        .set(TENANT_HEADER, space.slug)
        .expect(200);

      const body = bodyOf<ParamSchemaResource>(response);

      expect(body.params.fields.map((field) => field.name)).toEqual([
        "thinking",
        "token_budget",
        "max_output",
        "temperature",
      ]);
      expect(body.reason).toBeNull();
    });

    it("does not offer thinking on the model the ticket names", async () => {
      const person = await api.signIn();
      const space = await api.workspace(person);
      const connectionId = await connection(space.id, {
        id: PARAM_CONNECTION_ID,
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: "http://workstation.local:11434",
      });

      const response = await api
        .as(person)("get", `${PARAM_SCHEMA}?connection=${connectionId}&model=qwen3-coder:32b`)
        .set(TENANT_HEADER, space.slug)
        .expect(200);

      const body = bodyOf<ParamSchemaResource>(response);

      expect(body.params.fields.map((field) => field.name)).not.toContain("thinking");
      expect(body.params.fields.map((field) => field.name)).toContain("context_clamp");
    });

    it("narrows a bound to what discovery reported, and says where it came from", async () => {
      // The metadata merge against a real `provider_models` row — the table V017 created and
      // AE.4's sweep will fill.
      const person = await api.signIn();
      const space = await api.workspace(person);
      const connectionId = await connection(space.id, {
        id: PARAM_CONNECTION_ID,
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: "http://workstation.local:11434",
      });
      await discovered(connectionId, "qwen3-coder:32b", { context_tokens: 32_768 });

      const response = await api
        .as(person)("get", `${PARAM_SCHEMA}?connection=${connectionId}&model=qwen3-coder:32b`)
        .set(TENANT_HEADER, space.slug)
        .expect(200);

      const clamp = bodyOf<ParamSchemaResource>(response).params.fields.find(
        (field) => field.name === "context_clamp",
      );

      expect(clamp?.maximum).toBe(32_768);
      expect(clamp?.sources).toEqual(["adapter", "discovery"]);
    });

    it("fills an absent bound from the shipped catalog, labelled as catalogued", async () => {
      // The enrichment doing real work against the snapshot that actually ships: no adapter
      // can answer Anthropic's maximum output offline, and `claude-fable-5`'s is in
      // `model_prices.meta`. A catalog bump that moved it fails here rather than in production.
      const person = await api.signIn();
      const space = await api.workspace(person);
      const connectionId = await connection(space.id, { id: PARAM_CONNECTION_ID });

      const response = await api
        .as(person)("get", `${PARAM_SCHEMA}?connection=${connectionId}&model=claude-fable-5`)
        .set(TENANT_HEADER, space.slug)
        .expect(200);

      const output = bodyOf<ParamSchemaResource>(response).params.fields.find(
        (field) => field.name === "max_output",
      );

      expect(output?.maximum).toBe(128_000);
      expect(output?.sources).toEqual(["adapter", "catalog"]);
    });

    it("answers an unbound alias with the generic schema and its reason", async () => {
      // Mockup 21's `gpt5-experiments`. No connection means no adapter, no discovery row and —
      // since the catalog is keyed by provider kind — no catalog row either.
      const person = await api.signIn();
      const space = await api.workspace(person);

      const response = await api
        .as(person)("get", `${PARAM_SCHEMA}?model=gpt-5.2-preview`)
        .set(TENANT_HEADER, space.slug)
        .expect(200);

      const body = bodyOf<ParamSchemaResource>(response);

      expect(body.reason).toBe("alias_unbound");
      expect(body.params.fields).toEqual([]);
      expect(body.connectionId).toBeNull();
      // The restrictions are still offered: policy about the alias is not a claim about a
      // model, and an alias with no key can still be restricted.
      expect(body.restrictions.fields.map((field) => field.name)).toEqual([
        "review_vote_only",
        "batch_ok",
      ]);
    });

    it("refuses a connection from another workspace as though it did not exist", async () => {
      // The two are deliberately one answer: a caller who could tell them apart could
      // enumerate another workspace's connections by watching which ids answer differently.
      const owner = await api.signIn();
      const theirs = await api.workspace(owner);
      const stranger = await api.signIn({ email: "stranger@example.test" });
      const ours = await api.workspace(stranger);
      const connectionId = await connection(theirs.id, { id: PARAM_CONNECTION_ID });

      const response = await api
        .as(stranger)("get", `${PARAM_SCHEMA}?connection=${connectionId}&model=claude-fable-5`)
        .set(TENANT_HEADER, ours.slug)
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(REGISTRY_ERRORS.connectionNotFound);
    });

    it("refuses a query with no model at all", async () => {
      const person = await api.signIn();
      const space = await api.workspace(person);

      const response = await api
        .as(person)("get", PARAM_SCHEMA)
        .set(TENANT_HEADER, space.slug)
        .expect(422);

      expect(Object.keys(bodyOf<ErrorEnvelope>(response).details)).toEqual(["model"]);
    });

    it("is readable by a viewer, because it describes a model rather than a workspace", async () => {
      const owner = await api.signIn();
      const space = await api.workspace(owner);
      const viewer = await api.signIn({ email: "viewer@example.test" });
      await api.join(space.id, viewer, "viewer");
      const connectionId = await connection(space.id, { id: PARAM_CONNECTION_ID });

      await api
        .as(viewer)("get", `${PARAM_SCHEMA}?connection=${connectionId}&model=claude-fable-5`)
        .set(TENANT_HEADER, space.slug)
        .expect(200);
    });
  });

  describe("mockup 21's eight rows, as the database really stores them", () => {
    it("accepts every row's params and restrictions, and derives the chips the mockup draws", async () => {
      // The fifth acceptance criterion where V019's CHECKs are present. The unit suite proves
      // the derivation; this proves the *documents* are ones this product can store — a
      // vocabulary the constraint refuses would fail on the insert rather than in a spec.
      const organizationId = await workspace();
      const byKind = new Map<string, string>();

      for (const row of REGISTRY_ROWS) {
        if (row.kind === null) {
          await alias(organizationId, row.alias, null, row.modelId, row.params, row.restrictions);

          continue;
        }

        let connectionId = byKind.get(row.kind);

        if (connectionId === undefined) {
          connectionId = await connection(organizationId, {
            // One connection per kind, each with an id of its own: five of the eight rows share
            // three connections, exactly as mockup 21's table does.
            id: `e0000000-0000-4000-8000-00000000000${byKind.size + 1}`,
            kind: row.kind,
            displayName: row.kind,
            baseUrl:
              row.kind === "ollama" || row.kind === "openai_compatible"
                ? "http://box.local:8000"
                : null,
          });
          byKind.set(row.kind, connectionId);
        }

        await alias(
          organizationId,
          row.alias,
          connectionId,
          row.modelId,
          row.params,
          row.restrictions,
        );
      }

      const { rows } = await api.sql.query<{
        alias: string;
        params: Record<string, unknown>;
        restrictions: Record<string, unknown>;
      }>(
        `select alias, params, restrictions from ${SCHEMA_NAME}.model_aliases
          where organization_id = $1`,
        [organizationId],
      );

      expect(rows).toHaveLength(REGISTRY_ROWS.length);

      for (const row of rows) {
        const expected = REGISTRY_ROWS.find((candidate) => candidate.alias === row.alias)!;

        expect(paramChips(row.params, row.restrictions)).toEqual(expected.chips);
      }
    });
  });

  describe("validating a write", () => {
    it("refuses a thinking budget on a model with no thinking, naming the field", async () => {
      // The ticket's second acceptance criterion, through the real adapter registry: this is
      // the check CH.1 (#584) will call before every create and every update.
      const organizationId = await workspace();
      const connectionId = await connection(organizationId, {
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: "http://workstation.local:11434",
      });

      const error = await refused(() =>
        params.assertWriteValid(organizationId, connectionId, "qwen3-coder:32b", {
          params: { thinking: "max" },
        }),
      );

      expect(error.getStatus()).toBe(422);
      expect(error.code).toBe(REGISTRY_ERRORS.aliasParamsInvalid);
      expect(Object.keys(error.details)).toEqual(["params.thinking"]);
    });

    it("refuses a temperature outside what the provider publishes", async () => {
      const organizationId = await workspace();
      const connectionId = await connection(organizationId);

      const error = await refused(() =>
        params.assertWriteValid(organizationId, connectionId, "claude-fable-5", {
          params: { temperature: 3 },
        }),
      );

      expect((error.details as Record<string, string[]>)["params.temperature"][0]).toContain(
        "between 0 and 1",
      );
    });

    it("accepts a write the model really supports, and the database then stores it", async () => {
      // The two halves agreeing is the point: a schema that accepted something V019 refuses
      // would move the failure from a designed `422` to a constraint violation.
      const organizationId = await workspace();
      const connectionId = await connection(organizationId);
      const written = { thinking: "max", token_budget: 400_000 };

      await expect(
        params.assertWriteValid(organizationId, connectionId, "claude-fable-5", {
          params: written,
        }),
      ).resolves.toBeUndefined();

      await alias(organizationId, "coder-max", connectionId, "claude-fable-5", written);

      const { rows } = await api.sql.query<{ params: Record<string, unknown> }>(
        `select params from ${SCHEMA_NAME}.model_aliases where organization_id = $1`,
        [organizationId],
      );

      expect(rows[0].params).toEqual(written);
      expect(paramChips(rows[0].params, {})).toEqual(["max thinking", "400k budget"]);
    });
  });
});
