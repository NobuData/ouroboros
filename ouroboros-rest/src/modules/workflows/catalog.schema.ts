/**
 * The published workflow DSL schema, read as the stage catalog serves it — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * `GET /api/v1/workflows/catalog` hands the inspector one JSON Schema per node type, and the
 * ticket is specific about where those come from: *"the same artifacts P.2 validates against —
 * not a copy"*. So this file reads
 * [`schemas/workflow-dsl/v1.json`](../../../../schemas/workflow-dsl/v1.json) — the file
 * `dsl.conformance.spec.ts` compiles with ajv and `ouroboros-engine` compiles with
 * `jsonschema` — and nothing here restates a field of it.
 *
 * ---------------------------------------------------------------------------
 * ## How a node type's config schema is found
 *
 * The schema already says it, once: `$defs.node.properties.type.enum` lists the types, and
 * `$defs.node.allOf` holds one `if type = X then config: {$ref}` branch per type. Reading
 * *that* dispatch rather than guessing `X_config` by name is what makes a node type added to
 * the schema appear here with no edit to this file — the fixture proof in
 * `catalog.schema.spec.ts` adds one to a clone of the committed schema and finds it served.
 *
 * ## Why each served schema carries a `$defs` of its own
 *
 * `llm_config` says `skill: {$ref: "#/$defs/reference"}`, and a `#` pointer resolves against
 * the document it is *in*. A config schema handed over on its own would therefore point at
 * nothing. So each one is served as a small self-contained document: the definition's own
 * keywords, plus a `$defs` holding exactly the definitions it reaches, transitively — under
 * the same names, so every `$ref` in it resolves unchanged. The values are the parsed
 * subtrees of `v1.json` themselves, not re-serialised copies, which the spec asserts by
 * identity.
 *
 * ## When it is read
 *
 * Once, at boot, by `workflows.module.ts`' factory. A container built without the file fails
 * to start naming the path it looked in — `openapi/specification.ts`' rule and its reason:
 * that is when a packaging mistake is still cheap.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A JSON Schema document or subschema, as parsed from disk. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * Where the published schema is, resolved from this file rather than from the working
 * directory.
 *
 * `tsconfig.json` pins `rootDir` to `src` and `outDir` to `dist`, so `src/modules/workflows`
 * and `dist/modules/workflows` are both four directories below the repository root — the
 * same pinning `version.ts` relies on. In the container that root is `/app`, which is why the
 * Dockerfile copies the file to `/app/schemas/workflow-dsl/v1.json` and `container.spec.ts`
 * checks that it does.
 */
export const PUBLISHED_DSL_SCHEMA_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "schemas",
  "workflow-dsl",
  "v1.json",
);

/** The prefix every `$ref` in the DSL schema carries — local definitions, and nothing else. */
const LOCAL_DEFINITION = "#/$defs/";

/**
 * The published schema could not be read, or does not have the shape this file reads.
 *
 * Thrown at boot. Every cause is a packaging mistake or a schema edit this reader was not
 * told about, and the message names which.
 */
export class DslSchemaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DslSchemaError";
  }
}

/** One node type, as the published schema declares it. */
export interface NodeTypeSchema {
  /** The `type` value a node carries — `llm`, `flow`. */
  readonly type: string;
  /**
   * Where its config schema lives in the published document, as an absolute reference —
   * `https://ouroboros.build/schemas/workflow-dsl/v1.json#/$defs/llm_config`.
   */
  readonly configSchemaRef: string;
  /** The config schema, self-contained. See this file's header. */
  readonly configSchema: JsonSchema;
}

/**
 * Is this a JSON object — not an array, not `null`?
 *
 * Exported for `code.symbols.schema.ts`, which reads the same document.
 *
 * @param value - Anything parsed from JSON.
 * @returns Whether it can be read as a keyword map.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read and parse the published schema.
 *
 * @param path - The file to read. Defaults to the committed `v1.json`; the parameter exists
 *   so the failure branches can be exercised.
 * @returns The parsed document.
 * @throws {DslSchemaError} If the file is missing, is not JSON, or is not a JSON object.
 */
export function readPublishedDslSchema(path: string = PUBLISHED_DSL_SCHEMA_PATH): JsonSchema {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new DslSchemaError(
      "The published workflow DSL schema is missing — the stage catalog serves its config " +
        `schemas from that file, so a build has to ship it. Looked in: ${path}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DslSchemaError(`${path} could not be read as JSON`, { cause: error });
  }

  if (!isObject(parsed)) {
    throw new DslSchemaError(`${path} is not a JSON Schema document`);
  }

  return parsed;
}

/**
 * The published schema's `$id` — the name every consumer quotes.
 *
 * @param schema - The parsed document.
 * @returns The `$id`.
 * @throws {DslSchemaError} If the document has none.
 */
export function publishedSchemaId(schema: JsonSchema): string {
  const id = schema.$id;
  if (typeof id !== "string" || id === "") {
    throw new DslSchemaError("The workflow DSL schema carries no `$id`.");
  }

  return id;
}

/**
 * Every `$ref` anywhere below a value.
 *
 * @param value - A schema or any part of one.
 * @returns The references, in document order, duplicates included.
 */
function referencesIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referencesIn);
  if (!isObject(value)) return [];

  return Object.entries(value).flatMap(([keyword, child]) =>
    keyword === "$ref" && typeof child === "string" ? [child] : referencesIn(child),
  );
}

/**
 * The name a local reference points at.
 *
 * @param reference - A `$ref` value.
 * @param definitions - The document's `$defs`.
 * @returns The definition's name.
 * @throws {DslSchemaError} If the reference is not local, or names nothing.
 */
function definitionName(reference: string, definitions: Record<string, unknown>): string {
  if (!reference.startsWith(LOCAL_DEFINITION)) {
    throw new DslSchemaError(
      `The workflow DSL schema references \`${reference}\`; the stage catalog resolves only ` +
        `\`${LOCAL_DEFINITION}…\` references.`,
    );
  }

  const name = reference.slice(LOCAL_DEFINITION.length);
  if (!Object.hasOwn(definitions, name) || !isObject(definitions[name])) {
    throw new DslSchemaError(
      `The workflow DSL schema references \`${reference}\`, which is not defined.`,
    );
  }

  return name;
}

/**
 * One definition as a self-contained schema: its keywords, and the definitions it reaches.
 *
 * @param schema - The published document.
 * @param definitions - Its `$defs`.
 * @param name - The definition to serve.
 * @returns The bundled schema. `$defs` is omitted when the definition references nothing, and
 *   is listed in the published document's own order when it does.
 */
function bundle(
  schema: JsonSchema,
  definitions: Record<string, unknown>,
  name: string,
): JsonSchema {
  const reached = new Set<string>();
  const pending = [definitions[name]];

  while (pending.length > 0) {
    for (const reference of referencesIn(pending.pop())) {
      const target = definitionName(reference, definitions);
      if (!reached.has(target)) {
        reached.add(target);
        pending.push(definitions[target]);
      }
    }
  }

  const reachedDefinitions = Object.keys(definitions)
    .filter((definition) => reached.has(definition))
    .map((definition) => [definition, definitions[definition]] as const);

  return {
    $schema: schema.$schema,
    ...(definitions[name] as Record<string, unknown>),
    ...(reachedDefinitions.length > 0 ? { $defs: Object.fromEntries(reachedDefinitions) } : {}),
  };
}

/**
 * The node types the published schema declares, each with its config schema.
 *
 * @param schema - The parsed document — the committed `v1.json`, or a clone of it with a
 *   type added (the fixture proof).
 * @returns One entry per `$defs.node.properties.type.enum` member, in that order — the order
 *   the schema lists them, which is the order the Add-stage menu offers them.
 * @throws {DslSchemaError} If the dispatch this reads is absent, or a declared type has no
 *   config branch — a type the canvas could drop but the inspector could not configure.
 */
export function nodeTypeSchemas(schema: JsonSchema): NodeTypeSchema[] {
  const id = publishedSchemaId(schema);
  const definitions = schema.$defs;
  const node = isObject(definitions) ? definitions.node : undefined;
  const properties = isObject(node) ? node.properties : undefined;
  const typeProperty = isObject(properties) ? properties.type : undefined;
  const types = isObject(typeProperty) ? typeProperty.enum : undefined;

  if (
    !isObject(definitions) ||
    !isObject(node) ||
    !Array.isArray(types) ||
    !types.every((type) => typeof type === "string")
  ) {
    throw new DslSchemaError(
      "The workflow DSL schema has no `$defs.node.properties.type.enum` to read node types from.",
    );
  }

  const branches = Array.isArray(node.allOf) ? node.allOf : [];
  const configReferences = new Map<string, string>();

  for (const branch of branches) {
    if (!isObject(branch) || !isObject(branch.if) || !isObject(branch.then)) continue;

    const ifProperties = branch.if.properties;
    const thenProperties = branch.then.properties;
    const condition = isObject(ifProperties) ? ifProperties.type : undefined;
    const config = isObject(thenProperties) ? thenProperties.config : undefined;

    if (isObject(condition) && typeof condition.const === "string" && isObject(config)) {
      if (typeof config.$ref === "string") configReferences.set(condition.const, config.$ref);
    }
  }

  return types.map((type) => {
    const reference = configReferences.get(type);
    if (reference === undefined) {
      throw new DslSchemaError(
        `The workflow DSL schema declares the node type \`${type}\` but no ` +
          "`if type = … then config: {$ref}` branch for it in `$defs.node.allOf`.",
      );
    }

    return {
      type,
      configSchemaRef: `${id}${reference}`,
      configSchema: bundle(schema, definitions, definitionName(reference, definitions)),
    };
  });
}
