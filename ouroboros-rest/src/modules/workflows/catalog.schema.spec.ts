import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { SYNTHETIC_CONFIG, SYNTHETIC_NODE_TYPE, withSyntheticNodeType } from "./catalog.fixture";
import {
  DslSchemaError,
  PUBLISHED_DSL_SCHEMA_PATH,
  nodeTypeSchemas,
  publishedSchemaId,
  readPublishedDslSchema,
  type JsonSchema,
} from "./catalog.schema";
import { SCHEMA_PATH, readExpectedCases, readFixture } from "./dsl.golden.fixture";

/**
 * The published schema, read as per-type config schemas — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * Two of the ticket's acceptance criteria are claims about this file, and each is asserted here
 * rather than argued:
 *
 *   * **"Config schemas served here are the same artifacts P.2 validates against — not a
 *     copy."** The path is the conformance suite's, the served keywords are the published
 *     definition's own parsed values (by identity), and over every document in the golden set
 *     each served schema classifies each node's config exactly as the definition inside
 *     `v1.json` does.
 *   * **"Adding a node type … proven by a fixture test with a synthetic node type."** A clone of
 *     the committed schema with `sandbox` added surfaces `sandbox`, with a config schema that
 *     compiles and validates, and with nothing else changed.
 */

/** The committed schema's `$id`. */
const SCHEMA_ID = "https://ouroboros.build/schemas/workflow-dsl/v1.json";

/** The committed schema's definitions, typed for reading. */
function definitionsOf(schema: JsonSchema): Record<string, Record<string, unknown>> {
  return schema.$defs as Record<string, Record<string, unknown>>;
}

/** The definition name a served entry names — `llm_config` for `…v1.json#/$defs/llm_config`. */
function definitionNamed(configSchemaRef: string): string {
  return configSchemaRef.slice(`${SCHEMA_ID}#/$defs/`.length);
}

/** A strict ajv, as the conformance suite configures it. */
function strictAjv(): Ajv2020 {
  return new Ajv2020({ allErrors: true, strict: true });
}

/** A scratch directory for the files the failure cases need. */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ouroboros-catalog-schema-"));
}

describe("the schema the stage catalog reads", () => {
  it("is the file the conformance suite compiles — the same artifact, not a copy", () => {
    expect(PUBLISHED_DSL_SCHEMA_PATH).toBe(SCHEMA_PATH);
  });

  it("carries the `$id` the DSL is published under", () => {
    expect(publishedSchemaId(readPublishedDslSchema())).toBe(SCHEMA_ID);
  });
});

describe("the node types of the committed schema", () => {
  const schema = readPublishedDslSchema();
  const definitions = definitionsOf(schema);
  const entries = nodeTypeSchemas(schema);

  it("are the node's `type` enum, in its order", () => {
    const node = definitions.node as { properties: { type: { enum: string[] } } };

    expect(entries.map((entry) => entry.type)).toEqual(node.properties.type.enum);
    expect(entries.map((entry) => entry.type)).toEqual(["trigger", "llm", "infra", "flow", "term"]);
  });

  it("name each config definition through the node's own dispatch", () => {
    expect(entries.map((entry) => entry.configSchemaRef)).toEqual([
      `${SCHEMA_ID}#/$defs/trigger_config`,
      `${SCHEMA_ID}#/$defs/llm_config`,
      `${SCHEMA_ID}#/$defs/infra_config`,
      `${SCHEMA_ID}#/$defs/flow_config`,
      `${SCHEMA_ID}#/$defs/term_config`,
    ]);
  });

  it.each(entries.map((entry) => [entry.type, entry] as const))(
    "serve %s's config schema out of the published definition, by identity",
    (_type, entry) => {
      const definition = definitions[definitionNamed(entry.configSchemaRef)];
      const served = entry.configSchema as Record<string, unknown>;

      // Every keyword is the parsed value from `v1.json` itself — not an equal object, the
      // same one — so there is no second copy that could be edited on its own.
      for (const [keyword, value] of Object.entries(definition)) {
        expect(served[keyword]).toBe(value);
      }
      for (const [name, value] of Object.entries(served.$defs ?? {})) {
        expect(value).toBe(definitions[name]);
      }

      // And nothing beyond the definition, its dialect and the definitions it reaches.
      const added = Object.keys(served).filter(
        (keyword) => !Object.hasOwn(definition, keyword) && keyword !== "$defs",
      );
      expect(added).toEqual(["$schema"]);
      expect(served.$schema).toBe(schema.$schema);
    },
  );

  it("bundle exactly the definitions each config reaches, in the published order", () => {
    const reached = Object.fromEntries(
      entries.map((entry) => [entry.type, Object.keys(entry.configSchema.$defs ?? {})]),
    );

    expect(reached).toEqual({
      trigger: [],
      llm: ["reference", "alias_name"],
      infra: ["reference"],
      // `predicate` is reached from `flow_config`, and `effort`, `source_kind` and `label` from it.
      flow: ["effort", "source_kind", "label", "predicate"],
      term: [],
    });
  });

  it("compile, one by one, in ajv's strict mode", () => {
    for (const entry of entries) {
      expect(() => strictAjv().compile(entry.configSchema)).not.toThrow();
    }
  });

  it("classify every config in the golden set exactly as the published definitions do", () => {
    const published = strictAjv();
    published.addSchema(schema);
    const served = strictAjv();

    const verdicts = new Set<boolean>();
    let compared = 0;

    for (const golden of readExpectedCases()) {
      const document = readFixture(golden.document) as { nodes?: unknown };
      if (!Array.isArray(document.nodes)) continue;

      for (const node of document.nodes as { type?: unknown; config?: unknown }[]) {
        const entry = entries.find((candidate) => candidate.type === node.type);
        if (entry === undefined || node.config === undefined) continue;

        const fromServed = served.compile(entry.configSchema)(node.config);
        const fromPublished = published.getSchema(entry.configSchemaRef)!(node.config);

        expect({ document: golden.document, type: entry.type, valid: fromServed }).toEqual({
          document: golden.document,
          type: entry.type,
          valid: fromPublished,
        });
        verdicts.add(fromServed);
        compared += 1;
      }
    }

    // Teeth: the comparison has to have seen configs both definitions accept and configs both
    // refuse, or agreeing would prove nothing.
    expect(compared).toBeGreaterThan(20);
    expect([...verdicts].sort()).toEqual([false, true]);
  });
});

describe("a node type added to the published schema", () => {
  const committed = readPublishedDslSchema();
  const synthetic = withSyntheticNodeType(committed);

  it("is a well-formed addition that the whole schema accepts a document with", () => {
    const validate = strictAjv().compile(synthetic);
    const minimal = readFixture("valid/minimal.json") as { nodes: unknown[] };
    const sandboxNode = {
      id: "sandbox",
      type: SYNTHETIC_NODE_TYPE,
      title: "Sandbox",
      position: { x: 0, y: 200 },
      config: SYNTHETIC_CONFIG,
    };

    expect(validate({ ...minimal, nodes: [...minimal.nodes, sandboxNode] })).toBe(true);
    expect(
      validate({ ...minimal, nodes: [...minimal.nodes, { ...sandboxNode, config: {} }] }),
    ).toBe(false);
  });

  it("surfaces, last, with a config schema read from the edited document", () => {
    const entries = nodeTypeSchemas(synthetic);
    const sandbox = entries.at(-1)!;

    expect(entries.map((entry) => entry.type)).toEqual([
      "trigger",
      "llm",
      "infra",
      "flow",
      "term",
      SYNTHETIC_NODE_TYPE,
    ]);
    expect(sandbox.configSchemaRef).toBe(`${SCHEMA_ID}#/$defs/sandbox_config`);
    expect(Object.keys(sandbox.configSchema.$defs as object)).toEqual(["reference"]);

    const validate = strictAjv().compile(sandbox.configSchema);
    expect(validate(SYNTHETIC_CONFIG)).toBe(true);
    expect(validate({})).toBe(false);
  });

  it("changes nothing about the types that were already there", () => {
    expect(nodeTypeSchemas(synthetic).slice(0, 5)).toEqual(nodeTypeSchemas(committed));
  });

  it("is made to a clone, leaving the document it was given alone", () => {
    expect(nodeTypeSchemas(committed).map((entry) => entry.type)).not.toContain(
      SYNTHETIC_NODE_TYPE,
    );
  });
});

describe("what the reader refuses, at boot", () => {
  it("names the path it looked in when the file is missing", () => {
    const path = join(scratch(), "v1.json");

    expect(() => readPublishedDslSchema(path)).toThrow(DslSchemaError);
    expect(() => readPublishedDslSchema(path)).toThrow(path);
  });

  it("refuses a file that is not JSON", () => {
    const path = join(scratch(), "v1.json");
    writeFileSync(path, "{ not json");

    expect(() => readPublishedDslSchema(path)).toThrow(/could not be read as JSON/);
  });

  it("refuses JSON that is not a schema object", () => {
    const path = join(scratch(), "v1.json");
    writeFileSync(path, "[]");

    expect(() => readPublishedDslSchema(path)).toThrow(/is not a JSON Schema document/);
  });

  it("refuses a schema with no `$id`", () => {
    const { $id: _id, ...anonymous } = readPublishedDslSchema();

    expect(() => nodeTypeSchemas(anonymous)).toThrow(/carries no `\$id`/);
  });

  it("refuses a schema with no node-type dispatch to read", () => {
    expect(() => nodeTypeSchemas({ $id: SCHEMA_ID, $defs: {} })).toThrow(
      /no `\$defs\.node\.properties\.type\.enum`/,
    );
  });

  it("refuses a declared type the inspector could not configure", () => {
    const edited = structuredClone(readPublishedDslSchema()) as {
      $defs: { node: { properties: { type: { enum: string[] } } } };
    };
    edited.$defs.node.properties.type.enum.push("orphan");

    expect(() => nodeTypeSchemas(edited)).toThrow(/declares the node type `orphan` but no/);
  });

  it("refuses a config reference outside the document", () => {
    const edited = structuredClone(readPublishedDslSchema()) as {
      $defs: { node: { allOf: { then: { properties: { config: { $ref: string } } } }[] } };
    };
    edited.$defs.node.allOf[1].then.properties.config.$ref = "https://elsewhere.invalid/llm.json";

    expect(() => nodeTypeSchemas(edited)).toThrow(/resolves only `#\/\$defs\/…` references/);
  });

  it("refuses a reference to a definition that does not exist", () => {
    const edited = structuredClone(readPublishedDslSchema()) as { $defs: Record<string, unknown> };
    delete edited.$defs.reference;

    expect(() => nodeTypeSchemas(edited)).toThrow(/`#\/\$defs\/reference`, which is not defined/);
  });
});
