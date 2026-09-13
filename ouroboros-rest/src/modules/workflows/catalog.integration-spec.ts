import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { toDslCatalogue, type StageCatalog } from "./catalog.resources";
import type { CodeSymbolTable } from "./code.symbols";
import { DslWarningCode } from "./dsl.errors";
import { validateWorkflowDocument } from "./dsl.validator";
import type { WorkflowDetail } from "./workflows.resources";

/**
 * The stage catalog, against a migrated database — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)) — and the code view's symbol table
 * served beside it — W.1 ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * The unit suites hold each layer to its rules: the schema reader to `v1.json`, the
 * presentations to mockup 04, the statement to its workspace predicate. What only this suite can
 * certify is the route as a client meets it:
 *
 *   * **It is served at `catalog`**, and not swallowed by `GET /api/v1/workflows/{id}` — which
 *     would answer a `422` for an id that is not a uuid. The same for `code-symbols`.
 *   * **Every member reads it**, `viewer` included, and a stranger or a session acting in no
 *     workspace does not.
 *   * **The config schemas compile and accept mockup 04's canvas**, and defaults a canvas drops
 *     make a document that publishes.
 *   * **Task routes are this workspace's `task_kinds`**, in matrix order, and never another's —
 *     in the catalog's suggestions and in the code editor's completions alike.
 *   * **An unknown skill or model is a warning path, not a `4xx`**: a draft and a publish naming
 *     both succeed, and the suggestions, as a catalogue, answer `valid` with a warning.
 *
 * The publish gate's engine leg runs against the engine stub, as `lifecycle.integration-spec.ts`
 * argues, and its violations are asserted empty after every test.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** Where the shared contract lives. */
const SCHEMAS = join(__dirname, "..", "..", "..", "..", "schemas", "workflow-dsl");

/** The published schema, as the service reads it. */
const SCHEMA = JSON.parse(readFileSync(join(SCHEMAS, "v1.json"), "utf8")) as {
  $id: string;
  $defs: { node: { properties: { type: { enum: string[] } } } };
};

/** Mockup 04's canvas, as P.2 committed it. */
function standardFix(): { nodes: { id: string; type: string; config: Record<string, unknown> }[] } {
  return JSON.parse(
    readFileSync(join(SCHEMAS, "fixtures", "valid", "standard-fix.json"), "utf8"),
  ) as {
    nodes: { id: string; type: string; config: Record<string, unknown> }[];
  };
}

/** The skills this suite's deployment suggests. */
const SKILLS = ["repo-map", "zephyr-conventions"];

const CATALOG = "/api/v1/workflows/catalog";
const CODE_SYMBOLS = "/api/v1/workflows/code-symbols";
const WORKFLOWS = "/api/v1/workflows";

describe("the stage catalog, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      OURO_WORKFLOW_SKILL_SUGGESTIONS: SKILLS.join(","),
    });
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  beforeEach(() => {
    engine.reset();
  });

  afterEach(async () => {
    // Read first, truncate, assert last — `lifecycle.integration-spec.ts`' order and reason.
    const unfaithful = new Set(engine.violations);

    await api.truncate();

    expect([...unfaithful]).toEqual([]);
  });

  /** A workspace, its owner, and the id and slug that name it. */
  interface Bench {
    owner: Person;
    id: string;
    slug: string;
  }

  /**
   * A workspace with an owner signed in.
   *
   * @param email - The owner's address, so two benches in one test get two people.
   * @returns The bench.
   */
  async function bench(email = "owner@ouroboros.invalid"): Promise<Bench> {
    const owner = await api.signIn({ email });
    const workspace = await api.workspace(owner);

    return { owner, id: workspace.id, slug: workspace.slug };
  }

  /** A request as somebody, already carrying the workspace. */
  function as(person: Person, place: Bench) {
    return (method: "get" | "post" | "put", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, place.slug);
  }

  /**
   * Give a workspace task kinds, as the routing matrix holds them.
   *
   * @param organizationId - The workspace.
   * @param names - The kinds, in the `sort_order` they should have.
   * @param from - The first `sort_order`, for a case that adds kinds after others.
   */
  async function seedTaskKinds(
    organizationId: string,
    names: readonly string[],
    from = 1,
  ): Promise<void> {
    for (const [index, name] of names.entries()) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
         values ($1, $2, $3, $4)`,
        [organizationId, name, `The ${name} kind of work.`, from + index],
      );
    }
  }

  /** Read the catalog as somebody. */
  async function catalog(person: Person, place: Bench): Promise<StageCatalog> {
    return bodyOf<StageCatalog>(await as(person, place)("get", CATALOG).expect(200));
  }

  /** Read the code symbol table as somebody. */
  async function codeSymbols(person: Person, place: Bench): Promise<CodeSymbolTable> {
    return bodyOf<CodeSymbolTable>(await as(person, place)("get", CODE_SYMBOLS).expect(200));
  }

  describe("who may read it", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", CATALOG).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", CATALOG).expect(400);

      expect(bodyOf<{ code: string }>(response).code).toBe("organization_required");
    });

    it("answers an owner, a member and a viewer with the same catalog", async () => {
      const place = await bench();
      const member = await api.signIn({ email: "member@ouroboros.invalid" });
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
      await api.join(place.id, member, "member");
      await api.join(place.id, viewer, "viewer");

      const owners = await catalog(place.owner, place);

      expect(await catalog(member, place)).toEqual(owners);
      expect(await catalog(viewer, place)).toEqual(owners);
    });
  });

  describe("the node types", () => {
    it("are the published schema's, in its order, drawn as mockup 04 draws them", async () => {
      const place = await bench();

      const body = await catalog(place.owner, place);

      expect(body.schemaId).toBe(SCHEMA.$id);
      expect(body.nodeTypes.map((entry) => entry.type)).toEqual(
        SCHEMA.$defs.node.properties.type.enum,
      );
      expect(body.nodeTypes.map((entry) => [entry.type, entry.glyph, entry.class])).toEqual([
        ["trigger", "▸", "trigger"],
        ["llm", "◆", "llm"],
        ["infra", "▣", "infra"],
        ["flow", "◇", "flow"],
        ["term", "●", "term"],
      ]);
    });

    it("carry config schemas a validator compiles, and that accept every stage of mockup 04", async () => {
      const place = await bench();
      const { nodeTypes } = await catalog(place.owner, place);

      for (const node of standardFix().nodes) {
        const entry = nodeTypes.find((candidate) => candidate.type === node.type)!;
        const validate = new Ajv2020({ allErrors: true, strict: true }).compile(entry.configSchema);

        expect({ node: node.id, valid: validate(node.config) }).toEqual({
          node: node.id,
          valid: true,
        });
      }
    });

    it("carry defaults that make a document which publishes", async () => {
      const place = await bench();
      const { nodeTypes } = await catalog(place.owner, place);
      const dropped = (type: string, id: string, y: number) => {
        const { defaults } = nodeTypes.find((entry) => entry.type === type)!;
        return { id, type, title: defaults.title, position: { x: 0, y }, config: defaults.config };
      };

      // Three nodes dropped from the menu and joined, with nothing typed into the inspector.
      const definition = {
        dsl_version: "1.0",
        trigger: { event: "ticket_queued", conditions: {} },
        nodes: [
          dropped("trigger", "queued", 0),
          dropped("infra", "build", 150),
          dropped("term", "done", 300),
        ],
        edges: [
          { from: "queued", to: "build", kind: "default" },
          { from: "build", to: "done", kind: "default" },
        ],
      };

      const created = bodyOf<WorkflowDetail>(
        await as(place.owner, place)("post", WORKFLOWS).send({ name: "Dropped" }).expect(201),
      );
      await as(place.owner, place)("put", `${WORKFLOWS}/${created.id}/draft`)
        .set("If-Match", created.draft.etag)
        .send({ definition })
        .expect(200);
      await as(place.owner, place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(200);
    });
  });

  describe("the suggestions", () => {
    it("are the configured skills and this workspace's task kinds, in the matrix's order", async () => {
      const place = await bench();
      await seedTaskKinds(place.id, ["implement", "analyze", "review"]);

      expect((await catalog(place.owner, place)).suggestions).toEqual({
        skills: SKILLS,
        taskRoutes: ["implement", "analyze", "review"],
      });
    });

    it("suggest no task routes for a workspace whose routing has not been seeded", async () => {
      const place = await bench();

      expect((await catalog(place.owner, place)).suggestions.taskRoutes).toEqual([]);
    });

    it("never carry another workspace's task kinds", async () => {
      const first = await bench("first@ouroboros.invalid");
      const second = await bench("second@ouroboros.invalid");
      await seedTaskKinds(first.id, ["analyze"]);
      await seedTaskKinds(second.id, ["docs", "commit-msg"]);

      expect((await catalog(first.owner, first)).suggestions.taskRoutes).toEqual(["analyze"]);
      expect((await catalog(second.owner, second)).suggestions.taskRoutes).toEqual([
        "docs",
        "commit-msg",
      ]);
    });

    it("reach the next request once the matrix gains a kind", async () => {
      const place = await bench();
      await seedTaskKinds(place.id, ["analyze"]);
      await catalog(place.owner, place);

      await seedTaskKinds(place.id, ["docs"], 2);

      expect((await catalog(place.owner, place)).suggestions.taskRoutes).toEqual([
        "analyze",
        "docs",
      ]);
    });
  });

  describe("an unknown skill or model", () => {
    it("is saved and published, and is a warning when checked against the suggestions", async () => {
      const place = await bench();
      const definition = standardFix();
      definition.nodes.find((node) => node.id === "implement")!.config.skill = "no-such-skill";
      definition.nodes.find((node) => node.id === "analyze")!.config.routing = {
        pinned_model: "no-such-model",
      };

      const created = bodyOf<WorkflowDetail>(
        await as(place.owner, place)("post", WORKFLOWS).send({ name: "Standard Fix" }).expect(201),
      );
      await as(place.owner, place)("put", `${WORKFLOWS}/${created.id}/draft`)
        .set("If-Match", created.draft.etag)
        .send({ definition })
        .expect(200);
      await as(place.owner, place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(200);

      const verdict = validateWorkflowDocument(definition, {
        catalogue: toDslCatalogue((await catalog(place.owner, place)).suggestions),
      });

      // Valid, with the skill flagged. The model is not: the catalog suggests no models, so it
      // has no opinion about one — and nothing anywhere refused the publish.
      expect(verdict.valid).toBe(true);
      expect(verdict.warnings.map((warning) => warning.code)).toEqual([
        DslWarningCode.REFERENCE_UNKNOWN_SKILL,
      ]);
    });
  });

  describe("the code symbol table", () => {
    /**
     * The labels a table offers at a scope.
     *
     * @param table - The served table.
     * @param scope - The scope.
     * @returns The labels, or `undefined` for a scope it does not have.
     */
    function offered(table: CodeSymbolTable, scope: string): string[] | undefined {
      return table.scopes.find((entry) => entry.scope === scope)?.completions.map((c) => c.label);
    }

    it("refuses a stranger, and a session acting in no workspace", async () => {
      await api.anonymous("get", CODE_SYMBOLS).expect(401);

      const nomad = await api.signIn();
      const response = await api.as(nomad)("get", CODE_SYMBOLS).expect(400);

      expect(bodyOf<{ code: string }>(response).code).toBe("organization_required");
    });

    it("answers an owner, a member and a viewer with the same table", async () => {
      const place = await bench();
      const member = await api.signIn({ email: "member@ouroboros.invalid" });
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
      await api.join(place.id, member, "member");
      await api.join(place.id, viewer, "viewer");

      const owners = await codeSymbols(place.owner, place);

      expect(await codeSymbols(member, place)).toEqual(owners);
      expect(await codeSymbols(viewer, place)).toEqual(owners);
    });

    it("is read from the published schema, with mockup 05's route.task card", async () => {
      const place = await bench();

      const table = await codeSymbols(place.owner, place);

      expect(table.schemaId).toBe(SCHEMA.$id);
      expect(table.symbols.find((symbol) => symbol.symbol === "route.task")).toEqual({
        symbol: "route.task",
        signature: [
          { text: "route.task", role: "name" },
          { text: "(name: ", role: "text" },
          { text: "TaskKind", role: "type" },
          { text: "): ", role: "text" },
          { text: "ModelRoute", role: "type" },
        ],
        doc: "Resolves the model assigned to a task kind in Model Routing.",
      });
    });

    it("offers this workspace's task kinds and the configured skills, and no other workspace's", async () => {
      const first = await bench("first@ouroboros.invalid");
      const second = await bench("second@ouroboros.invalid");
      await seedTaskKinds(first.id, ["implement", "analyze"]);
      await seedTaskKinds(second.id, ["docs"]);

      const table = await codeSymbols(first.owner, first);

      expect(offered(table, "route.task")).toEqual(["implement", "analyze"]);
      expect(offered(table, "stage.llm.skill")).toEqual(SKILLS);
      expect(offered(await codeSymbols(second.owner, second), "route.task")).toEqual(["docs"]);
    });

    it("offers the same task routes as the catalog's suggestions", async () => {
      const place = await bench();
      await seedTaskKinds(place.id, ["analyze", "plan"]);

      const { suggestions } = await catalog(place.owner, place);

      expect(offered(await codeSymbols(place.owner, place), "route.task")).toEqual(
        suggestions.taskRoutes,
      );
    });
  });
});
