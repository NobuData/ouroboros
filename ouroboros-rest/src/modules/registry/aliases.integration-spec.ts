import type request from "supertest";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { Resolution } from "../routing/resolution";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { ALIAS_ERRORS, PROVIDERS_FIX_PATH } from "./aliases.errors";
import {
  ALIAS_WARNINGS,
  type AliasChangeResource,
  type ModelAliasListResource,
  type ModelOptionListResource,
} from "./aliases.resources";
import { REGISTRY_ERRORS } from "./registry.errors";

/**
 * `/api/v1/registry/aliases`, over a socket and against a migrated database
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)).
 *
 * The ticket's acceptance criteria, one describe each:
 *
 *   * **who may** — a stranger, a session in no workspace, a member's read, a member's write,
 *     and an id or a connection from another workspace;
 *   * **the lifecycle** — create bound, create unbound, edit, duplicate, disable, enable,
 *     rename, delete, each leaving exactly one revision and each refusal designed;
 *   * **rebind, the BYOK story** — `coder-max` moved to a second connection with all four
 *     references intact and the next resolution, asked of the simulate endpoint, pointing at
 *     the new binding. Asserted, not assumed.
 *
 * Rows the lifecycle does not write — connections, discovered models, routes, rules — are
 * seeded with SQL, the way `simulate.integration-spec.ts` seeds them: those tables have
 * surfaces of their own, and driving them through here would test two things at once.
 */
const ALIASES = "/api/v1/registry/aliases";
const SIMULATE = "/api/v1/routing/simulate";

interface RevisionRow {
  alias_id: string | null;
  alias: string;
  actor: string | null;
  action: string;
  diff: Record<string, { from: unknown; to: unknown }>;
}

describe("the alias lifecycle endpoint", () => {
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
    method: "get" | "post" | "patch" | "delete",
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

  async function discovered(connectionId: string, modelId: string): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.provider_models (provider_connection_id, model_id, display, meta)
       values ($1, $2, $2, '{"context_tokens": 200000}'::jsonb)`,
      [connectionId, modelId],
    );
  }

  async function kind(organizationId: string, name: string, sortOrder: number): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
       values ($1, $2, $3, $4)`,
      [organizationId, name, `Everything ${name} needs`, sortOrder],
    );
  }

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

  async function escalationRule(
    organizationId: string,
    when: Record<string, unknown>,
    then: Record<string, unknown>,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.escalation_rules (organization_id, enabled, sort_order, "when", "then")
       values ($1, true, 1, $2::jsonb, $3::jsonb)`,
      [organizationId, JSON.stringify(when), JSON.stringify(then)],
    );
  }

  async function revisions(organizationId: string): Promise<RevisionRow[]> {
    const { rows } = await api.sql.query<RevisionRow>(
      `select alias_id, alias, actor, action, diff from ${SCHEMA_NAME}.alias_revisions
        where organization_id = $1 order by created_at, id`,
      [organizationId],
    );

    return rows;
  }

  /** A workspace with an Anthropic connection that has discovered `claude-fable-5`. */
  async function seeded(owner: Person): Promise<{ workspace: Workspace; anthropic: string }> {
    const workspace = await api.workspace(owner);
    const anthropic = await connection(workspace.id, "anthropic", "Anthropic Claude");

    await discovered(anthropic, "claude-fable-5");
    await discovered(anthropic, "claude-sonnet-5");

    return { workspace, anthropic };
  }

  async function created(
    owner: Person,
    workspace: Workspace,
    body: Record<string, unknown>,
  ): Promise<AliasChangeResource> {
    const response = await call(owner, workspace, "post", ALIASES).send(body).expect(201);

    return bodyOf<AliasChangeResource>(response);
  }

  describe("who may", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", ALIASES).expect(401);
      await api.anonymous("post", ALIASES).send({ alias: "x", modelId: "m" }).expect(401);
    });

    it("refuses a session acting in no workspace", async () => {
      const nomad = await api.signIn();
      const response = await api.as(nomad)("get", ALIASES).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it.each(["member", "viewer"] as const)(
      "lets a %s read and refuses their writes",
      async (role) => {
        const owner = await api.signIn();
        const { workspace, anthropic } = await seeded(owner);
        const person = await api.signIn();

        await api.join(workspace.id, person, role);
        const { alias } = await created(owner, workspace, {
          alias: "coder-max",
          connectionId: anthropic,
          modelId: "claude-fable-5",
        });

        const list = await call(person, workspace, "get", ALIASES).expect(200);
        expect(bodyOf<ModelAliasListResource>(list).aliases.map((entry) => entry.alias)).toEqual([
          "coder-max",
        ]);
        await call(
          person,
          workspace,
          "get",
          `${ALIASES}/model-options?connection=${anthropic}`,
        ).expect(200);

        for (const attempt of [
          call(person, workspace, "post", ALIASES).send({ alias: "x", modelId: "m" }),
          call(person, workspace, "patch", `${ALIASES}/${alias.id}`).send({ notes: "n" }),
          call(person, workspace, "post", `${ALIASES}/${alias.id}/duplicate`),
          call(person, workspace, "delete", `${ALIASES}/${alias.id}`),
        ]) {
          const response = await attempt.expect(403);
          expect(bodyOf<ErrorEnvelope>(response).code).toBe("forbidden");
        }
      },
    );

    it("answers 404 for another workspace's alias and connection", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const { alias } = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
      });
      const stranger = await api.signIn();
      const elsewhere = await api.workspace(stranger);

      const patched = await call(stranger, elsewhere, "patch", `${ALIASES}/${alias.id}`)
        .send({ notes: "mine now" })
        .expect(404);
      expect(bodyOf<ErrorEnvelope>(patched).code).toBe(ALIAS_ERRORS.notFound);

      await call(stranger, elsewhere, "delete", `${ALIASES}/${alias.id}`).expect(404);
      await call(stranger, elsewhere, "post", `${ALIASES}/${alias.id}/duplicate`).expect(404);

      const bound = await call(stranger, elsewhere, "post", ALIASES)
        .send({ alias: "borrowed", connectionId: anthropic, modelId: "claude-fable-5" })
        .expect(404);
      expect(bodyOf<ErrorEnvelope>(bound).code).toBe(REGISTRY_ERRORS.connectionNotFound);

      await call(
        stranger,
        elsewhere,
        "get",
        `${ALIASES}/model-options?connection=${anthropic}`,
      ).expect(404);

      // And nothing of it is visible from the other side.
      const list = await call(stranger, elsewhere, "get", ALIASES).expect(200);
      expect(bodyOf<ModelAliasListResource>(list).aliases).toEqual([]);
      expect(await revisions(elsewhere.id)).toEqual([]);
    });
  });

  describe("the lifecycle", () => {
    it("creates a bound alias, switched on, checked against discovery, and records it", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      const change = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
        params: { thinking: "max" },
        notes: "prod key",
      });

      expect(change.alias).toMatchObject({
        alias: "coder-max",
        enabled: true,
        modelId: "claude-fable-5",
        params: { thinking: "max" },
        restrictions: {},
        notes: "prod key",
        references: [],
        updatedBy: owner.id,
      });
      expect(change.alias.connection).toEqual({
        id: anthropic,
        kind: "anthropic",
        displayName: "Anthropic Claude",
      });
      expect(change.warnings).toEqual([]);
      expect(change.nextResolution).toBeNull();
      expect(change.revisionId).toEqual(expect.any(String));

      const trail = await revisions(workspace.id);
      expect(trail).toEqual([
        expect.objectContaining({
          alias_id: change.alias.id,
          alias: "coder-max",
          actor: owner.id,
          action: "created",
        }),
      ]);
      expect(trail[0].diff.alias).toEqual({ from: null, to: "coder-max" });
      expect(trail[0].diff.provider_connection_id).toEqual({ from: null, to: anthropic });
    });

    it("surfaces the discovery warning for a model the connection has not reported", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      const change = await created(owner, workspace, {
        alias: "coder-next",
        connectionId: anthropic,
        modelId: "claude-opus-5",
      });

      expect(change.warnings).toEqual([
        expect.objectContaining({ code: ALIAS_WARNINGS.modelNotDiscovered, fix: null }),
      ]);
      expect(change.warnings[0].message).toContain("lists other models");
      expect(change.alias.enabled).toBe(true);
    });

    it("creates an unbound alias switched off, whatever the body said, with the pointer", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const change = await created(owner, workspace, {
        alias: "gpt5-experiments",
        modelId: "gpt-5.2-preview",
        enabled: true,
      });

      expect(change.alias).toMatchObject({
        alias: "gpt5-experiments",
        enabled: false,
        connection: null,
        modelId: "gpt-5.2-preview",
      });
      expect(change.warnings).toEqual([
        expect.objectContaining({ code: ALIAS_WARNINGS.unbound, fix: PROVIDERS_FIX_PATH }),
      ]);
    });

    it("refuses a second alias by the same name with a designed 422", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
      });
      const response = await call(owner, workspace, "post", ALIASES)
        .send({ alias: "coder-max", modelId: "claude-fable-5" })
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe(ALIAS_ERRORS.nameTaken);
      expect(envelope.details).toEqual({ alias: "coder-max" });
      expect(envelope.message).not.toMatch(/model_aliases_organization_alias_key|duplicate key/);
      expect(await revisions(workspace.id)).toHaveLength(1);
    });

    it("refuses a malformed body naming the field, and nothing is written", async () => {
      const owner = await api.signIn();
      const { workspace } = await seeded(owner);

      const response = await call(owner, workspace, "post", ALIASES)
        .send({ alias: "Coder-Max", modelId: "claude-fable-5", params: [] })
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("validation_failed");
      expect(Object.keys(envelope.details).sort()).toEqual(["alias", "params"]);
      expect(await revisions(workspace.id)).toEqual([]);
    });

    it("edits params and notes as one revision, and records nothing for a no-op", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const { alias } = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
      });

      const edited = await call(owner, workspace, "patch", `${ALIASES}/${alias.id}`)
        .send({ params: { thinking: "std" }, notes: "prod key" })
        .expect(200);
      const change = bodyOf<AliasChangeResource>(edited);

      expect(change.alias.params).toEqual({ thinking: "std" });
      expect(change.alias.notes).toBe("prod key");
      expect(change.revisionId).toEqual(expect.any(String));

      const again = await call(owner, workspace, "patch", `${ALIASES}/${alias.id}`)
        .send({ params: { thinking: "std" }, notes: "prod key" })
        .expect(200);
      expect(bodyOf<AliasChangeResource>(again).revisionId).toBeNull();

      const trail = await revisions(workspace.id);
      expect(trail.map((row) => row.action)).toEqual(["created", "edited"]);
      expect(trail[1].diff).toEqual({
        params: { from: {}, to: { thinking: "std" } },
        notes: { from: null, to: "prod key" },
      });
    });

    it("refuses params the binding cannot honour, through CH.2's schema", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const { alias } = await created(owner, workspace, {
        alias: "gpt5-experiments",
        modelId: "gpt-5.2-preview",
      });

      // Unbound: nothing knows what the model supports, so every param is refused by name.
      const response = await call(owner, workspace, "patch", `${ALIASES}/${alias.id}`)
        .send({ params: { thinking: "max" } })
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe(REGISTRY_ERRORS.aliasParamsInvalid);
      expect(Object.keys(envelope.details)).toEqual(["params.thinking"]);
      expect(await revisions(workspace.id)).toHaveLength(1);
    });

    it("refuses enabling an unbound alias with the pointer — never a constraint error", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const { alias } = await created(owner, workspace, {
        alias: "gpt5-experiments",
        modelId: "gpt-5.2-preview",
      });

      const response = await call(owner, workspace, "patch", `${ALIASES}/${alias.id}`)
        .send({ enabled: true })
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe(ALIAS_ERRORS.unbound);
      expect(envelope.details).toEqual({ alias: "gpt5-experiments", fix: PROVIDERS_FIX_PATH });
      expect(envelope.message).not.toContain("model_aliases_unbound_disabled");
      expect(await revisions(workspace.id)).toHaveLength(1);
    });

    it("binds an unbound alias and then enables it — the Fix in Providers path, completed", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const { alias } = await created(owner, workspace, {
        alias: "gpt5-experiments",
        modelId: "gpt-5.2-preview",
      });

      const bound = await call(owner, workspace, "patch", `${ALIASES}/${alias.id}`)
        .send({ connectionId: anthropic, modelId: "claude-sonnet-5", enabled: true })
        .expect(200);
      const change = bodyOf<AliasChangeResource>(bound);

      expect(change.alias.enabled).toBe(true);
      expect(change.alias.connection?.id).toBe(anthropic);
      expect(change.warnings).toEqual([]);
      expect(change.nextResolution).toEqual({
        connection: { id: anthropic, kind: "anthropic", displayName: "Anthropic Claude" },
        modelId: "claude-sonnet-5",
      });
      expect((await revisions(workspace.id)).map((row) => row.action)).toEqual([
        "created",
        "rebound",
      ]);
    });

    it("duplicates to -copy, switched off, with binding and params copied, and suffixes the next", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const { alias } = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
        params: { thinking: "max" },
        restrictions: { batch_ok: true },
        notes: "prod key",
      });

      const first = bodyOf<AliasChangeResource>(
        await call(owner, workspace, "post", `${ALIASES}/${alias.id}/duplicate`).expect(201),
      );
      expect(first.alias).toMatchObject({
        alias: "coder-max-copy",
        enabled: false,
        modelId: "claude-fable-5",
        params: { thinking: "max" },
        restrictions: { batch_ok: true },
        notes: "prod key",
      });
      expect(first.alias.connection?.id).toBe(anthropic);
      expect(first.alias.id).not.toBe(alias.id);

      const second = bodyOf<AliasChangeResource>(
        await call(owner, workspace, "post", `${ALIASES}/${alias.id}/duplicate`).expect(201),
      );
      expect(second.alias.alias).toBe("coder-max-copy-2");

      const trail = await revisions(workspace.id);
      expect(trail.map((row) => `${row.action}:${row.alias}`)).toEqual([
        "created:coder-max",
        "duplicated:coder-max-copy",
        "duplicated:coder-max-copy-2",
      ]);
      expect(trail[1].diff.duplicate_of).toEqual({ from: null, to: "coder-max" });
    });

    it("renames an unreferenced alias, and refuses a referenced one naming the referrers", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const { alias: free } = await created(owner, workspace, {
        alias: "sizer",
        connectionId: anthropic,
        modelId: "claude-sonnet-5",
      });
      const { alias: held } = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
      });
      await kind(workspace.id, "implement", 1);
      await route(workspace.id, "implement", "implement-primary", [held.id]);

      const renamed = await call(owner, workspace, "patch", `${ALIASES}/${free.id}`)
        .send({ alias: "estimator" })
        .expect(200);
      expect(bodyOf<AliasChangeResource>(renamed).alias.alias).toBe("estimator");

      const refused = await call(owner, workspace, "patch", `${ALIASES}/${held.id}`)
        .send({ alias: "coder-primary" })
        .expect(422);
      const envelope = bodyOf<ErrorEnvelope>(refused);
      expect(envelope.code).toBe(ALIAS_ERRORS.renameBlocked);
      expect(envelope.details).toEqual({
        alias: "coder-max",
        references: [
          {
            kind: "route",
            refId: expect.any(String) as string,
            label: "implement-primary",
            blocking: true,
          },
        ],
      });

      const trail = await revisions(workspace.id);
      expect(trail.map((row) => `${row.action}:${row.alias}`)).toEqual([
        "created:sizer",
        "created:coder-max",
        "renamed:estimator",
      ]);
      expect(trail[2].diff).toEqual({ alias: { from: "sizer", to: "estimator" } });
    });

    it("deletes an unreferenced alias, leaving a deleted revision that outlives the row", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const { alias } = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
      });

      await call(owner, workspace, "delete", `${ALIASES}/${alias.id}`).expect(204);
      await call(owner, workspace, "delete", `${ALIASES}/${alias.id}`).expect(404);

      const list = await call(owner, workspace, "get", ALIASES).expect(200);
      expect(bodyOf<ModelAliasListResource>(list).aliases).toEqual([]);

      const trail = await revisions(workspace.id);
      expect(trail.map((row) => row.action)).toEqual(["created", "deleted"]);
      expect(trail[1]).toMatchObject({ alias_id: null, alias: "coder-max", actor: owner.id });
      expect(trail[1].diff.alias).toEqual({ from: "coder-max", to: null });
      // The create's record survives the delete too, with its reference cleared rather than
      // the row removed.
      expect(trail[0].alias_id).toBeNull();
    });

    it("refuses deleting a referenced alias with a 409 listing every referrer with its kind", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const { alias } = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
      });
      await kind(workspace.id, "implement", 1);
      await route(workspace.id, "implement", "implement-primary", [alias.id]);
      await escalationRule(
        workspace.id,
        { effort_gte: "l" },
        { use_alias: { task_kind: "implement", alias: "coder-max" } },
      );

      const response = await call(owner, workspace, "delete", `${ALIASES}/${alias.id}`).expect(409);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe(ALIAS_ERRORS.referenced);
      expect(envelope.details).toEqual({
        alias: "coder-max",
        references: [
          {
            kind: "route",
            refId: expect.any(String) as string,
            label: "implement-primary",
            blocking: true,
          },
          {
            kind: "escalation",
            refId: expect.any(String) as string,
            label: "escalation:effort≥L",
            blocking: true,
          },
        ],
      });

      const list = await call(owner, workspace, "get", ALIASES).expect(200);
      expect(bodyOf<ModelAliasListResource>(list).aliases[0].references).toHaveLength(2);
      expect((await revisions(workspace.id)).map((row) => row.action)).toEqual(["created"]);
    });

    it("leaves exactly one revision per write across the whole lifecycle", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);
      const { alias } = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
      });
      const patch = (body: Record<string, unknown>) =>
        call(owner, workspace, "patch", `${ALIASES}/${alias.id}`).send(body).expect(200);

      await patch({ notes: "edited" });
      await patch({ enabled: false });
      await patch({ enabled: true });
      await patch({ modelId: "claude-sonnet-5" });
      await patch({ alias: "coder-primary" });
      await patch({ alias: "coder-primary" });
      const copy = bodyOf<AliasChangeResource>(
        await call(owner, workspace, "post", `${ALIASES}/${alias.id}/duplicate`).expect(201),
      );
      await call(owner, workspace, "delete", `${ALIASES}/${copy.alias.id}`).expect(204);

      expect((await revisions(workspace.id)).map((row) => row.action)).toEqual([
        "created",
        "edited",
        "disabled",
        "enabled",
        "rebound",
        "renamed",
        "duplicated",
        "deleted",
      ]);
    });
  });

  describe("rebind — the BYOK story", () => {
    /**
     * `coder-max` referenced four times, exactly as mockup 21's inspector draws it: three
     * routes and the effort ≥ L rule.
     */
    async function referenced(owner: Person): Promise<{
      workspace: Workspace;
      anthropic: string;
      bedrock: string;
      aliasId: string;
    }> {
      const { workspace, anthropic } = await seeded(owner);
      const bedrock = await connection(workspace.id, "anthropic", "Anthropic — Bedrock");
      await discovered(bedrock, "claude-fable-5");
      const { alias } = await created(owner, workspace, {
        alias: "coder-max",
        connectionId: anthropic,
        modelId: "claude-fable-5",
        params: { thinking: "max" },
      });
      const { alias: fallback } = await created(owner, workspace, {
        alias: "coder-std",
        connectionId: anthropic,
        modelId: "claude-sonnet-5",
      });

      for (const [offset, name] of ["plan", "implement", "review"].entries()) {
        await kind(workspace.id, name, offset + 1);
        await route(workspace.id, name, `${name}-primary`, [alias.id, fallback.id]);
      }
      await escalationRule(
        workspace.id,
        { effort_gte: "l" },
        { use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } } },
      );

      return { workspace, anthropic, bedrock, aliasId: alias.id };
    }

    async function primaryProvider(owner: Person, workspace: Workspace): Promise<string | null> {
      const response = await call(owner, workspace, "post", SIMULATE)
        .send({ taskKind: "implement" })
        .expect(200);

      return bodyOf<Resolution>(response).chain[0].provider?.id ?? null;
    }

    it("leaves all four references intact and points the next resolution at the new binding", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic, bedrock, aliasId } = await referenced(owner);

      const before = await call(owner, workspace, "get", ALIASES).expect(200);
      const coderMax = bodyOf<ModelAliasListResource>(before).aliases.find(
        (entry) => entry.alias === "coder-max",
      );
      expect(coderMax?.references.map((reference) => reference.label)).toEqual([
        "implement-primary",
        "plan-primary",
        "review-primary",
        "escalation:effort≥L",
      ]);
      expect(await primaryProvider(owner, workspace)).toBe(anthropic);

      const rebound = await call(owner, workspace, "patch", `${ALIASES}/${aliasId}`)
        .send({ connectionId: bedrock })
        .expect(200);
      const change = bodyOf<AliasChangeResource>(rebound);

      expect(change.nextResolution).toEqual({
        connection: { id: bedrock, kind: "anthropic", displayName: "Anthropic — Bedrock" },
        modelId: "claude-fable-5",
      });
      expect(change.alias.connection?.id).toBe(bedrock);
      expect(change.alias.params).toEqual({ thinking: "max" });
      expect(change.alias.references).toEqual(coderMax?.references);
      expect(change.warnings).toEqual([]);
      expect(change.droppedHops).toEqual([]);

      // Asserted, not assumed: the next resolution goes to Bedrock, and every route still
      // names the alias it always did.
      expect(await primaryProvider(owner, workspace)).toBe(bedrock);

      const trail = await revisions(workspace.id);
      expect(trail.at(-1)).toMatchObject({
        action: "rebound",
        diff: { provider_connection_id: { from: anthropic, to: bedrock } },
      });
    });

    it("switches a referenced alias off and names the hops the next resolution will drop", async () => {
      const owner = await api.signIn();
      const { workspace, aliasId } = await referenced(owner);

      const disabled = await call(owner, workspace, "patch", `${ALIASES}/${aliasId}`)
        .send({ enabled: false })
        .expect(200);
      const change = bodyOf<AliasChangeResource>(disabled);

      expect(change.alias.enabled).toBe(false);
      expect(change.droppedHops.map((reference) => reference.label)).toEqual([
        "implement-primary",
        "plan-primary",
        "review-primary",
        "escalation:effort≥L",
      ]);
      expect(change.alias.references).toHaveLength(4);
      expect((await revisions(workspace.id)).at(-1)?.action).toBe("disabled");
    });
  });

  describe("model options", () => {
    it("lists the models discovery reported on a connection, under the connection", async () => {
      const owner = await api.signIn();
      const { workspace, anthropic } = await seeded(owner);

      const response = await call(
        owner,
        workspace,
        "get",
        `${ALIASES}/model-options?connection=${anthropic}`,
      ).expect(200);
      const options = bodyOf<ModelOptionListResource>(response);

      expect(options.connection).toEqual({
        id: anthropic,
        kind: "anthropic",
        displayName: "Anthropic Claude",
      });
      expect(options.models.map((model) => model.modelId)).toEqual([
        "claude-fable-5",
        "claude-sonnet-5",
      ]);
      expect(options.models[0]).toMatchObject({
        display: "claude-fable-5",
        meta: { context_tokens: 200_000 },
        discoveredAt: expect.any(String) as string,
      });
    });

    it("answers an honest empty list for a connection discovery has not run on", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const ollama = await connection(workspace.id, "ollama", "Ollama");

      const response = await call(
        owner,
        workspace,
        "get",
        `${ALIASES}/model-options?connection=${ollama}`,
      ).expect(200);

      expect(bodyOf<ModelOptionListResource>(response).models).toEqual([]);
    });

    it("refuses a connection that is not a uuid, naming the field", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const response = await call(
        owner,
        workspace,
        "get",
        `${ALIASES}/model-options?connection=anthropic`,
      ).expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
    });
  });
});
