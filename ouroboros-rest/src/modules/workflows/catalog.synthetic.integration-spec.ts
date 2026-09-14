import Ajv2020 from "ajv/dist/2020";

import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { SYNTHETIC_CONFIG, SYNTHETIC_NODE_TYPE, withSyntheticNodeType } from "./catalog.fixture";
import { FALLBACK_GLYPH } from "./catalog.presentation";
import type { StageCatalog, StageCatalogEntry } from "./catalog.resources";
import { readPublishedDslSchema } from "./catalog.schema";
import { PUBLISHED_DSL_SCHEMA } from "./catalog.service";
import type { CodeSymbolTable } from "./code.symbols";

/**
 * A node type the published schema does not have, served by the running application — R.4
 * ([#146](https://github.com/NobuData/ouroboros/issues/146)), over R.3's catalog
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * R.3's promise is *"adding a node type in P.2's schema surfaces it in the Add-stage menu and gets
 * a working inspector form with zero UI changes"*. `catalog.service.spec.ts` proves it one layer
 * above the pure functions; this proves it where the studio meets it — a real application, booted
 * with `catalog.fixture.ts`' schema under {@link PUBLISHED_DSL_SCHEMA}, answering
 * `GET /api/v1/workflows/catalog` over a socket, through every guard.
 *
 * Its own file because its application is not the process's: one provider differs, and a suite
 * sharing a harness with it would be asserting against a schema `v1.json` does not publish.
 *
 * ```bash
 * yarn test:integration src/modules/workflows/catalog.synthetic.integration-spec.ts
 * ```
 */

/** The published schema, as `workflows.module.ts` provides it. */
const PUBLISHED = readPublishedDslSchema();

/** The node types `v1.json` publishes, in its order. */
const PUBLISHED_TYPES = (
  PUBLISHED as unknown as { $defs: { node: { properties: { type: { enum: string[] } } } } }
).$defs.node.properties.type.enum;

const CATALOG = "/api/v1/workflows/catalog";
const CODE_SYMBOLS = "/api/v1/workflows/code-symbols";

describe("a synthetic node type, through the running catalog", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({}, [
      { provide: PUBLISHED_DSL_SCHEMA, useValue: withSyntheticNodeType(PUBLISHED) },
    ]);
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * Read the catalog as a workspace owner.
   *
   * @returns The catalog.
   */
  async function catalog(): Promise<StageCatalog> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    return bodyOf<StageCatalog>(
      await api.as(owner)("get", CATALOG).set(TENANT_HEADER, workspace.slug).expect(200),
    );
  }

  /**
   * The synthetic type's entry.
   *
   * @returns The entry.
   */
  async function synthetic(): Promise<StageCatalogEntry> {
    return (await catalog()).nodeTypes.find((entry) => entry.type === SYNTHETIC_NODE_TYPE)!;
  }

  it("is still the application the process builds, guards included", async () => {
    // The override replaced one provider and nothing else: a stranger is refused exactly as the
    // process refuses one.
    await api.anonymous("get", CATALOG).expect(401);
  });

  it("is offered after every published type, drawn with the neutral presentation", async () => {
    const { nodeTypes } = await catalog();

    expect(nodeTypes.map((entry) => entry.type)).toEqual([...PUBLISHED_TYPES, SYNTHETIC_NODE_TYPE]);
    // No line of `catalog.presentation.ts` names it, so it is drawn the way any type nobody wrote
    // a presentation for is drawn.
    expect(nodeTypes.at(-1)).toMatchObject({
      type: SYNTHETIC_NODE_TYPE,
      label: SYNTHETIC_NODE_TYPE,
      glyph: FALLBACK_GLYPH,
      class: SYNTHETIC_NODE_TYPE,
      defaults: { title: SYNTHETIC_NODE_TYPE, config: {} },
    });
  });

  it("carries a config schema an inspector form can be built and validated from", async () => {
    const entry = await synthetic();
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(entry.configSchema);

    expect(validate(SYNTHETIC_CONFIG)).toBe(true);
    expect(validate({ ...SYNTHETIC_CONFIG, timeout_seconds: 0 })).toBe(false);
  });

  it("asks for the field its schema requires before a dropped node validates", async () => {
    // A neutral presentation defaults nothing, and this type's schema requires `image` — so the
    // form the studio builds from the schema is the one that has to ask for it.
    const entry = await synthetic();
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(entry.configSchema);

    expect(validate(entry.defaults.config)).toBe(false);
    expect(validate.errors?.map((error) => error.params)).toContainEqual({
      missingProperty: "image",
    });
  });

  it("boots the code view's symbol table from the same schema", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    const table = bodyOf<CodeSymbolTable>(
      await api.as(owner)("get", CODE_SYMBOLS).set(TENANT_HEADER, workspace.slug).expect(200),
    );

    expect(table.schemaId).toBe((await catalog()).schemaId);
  });
});
