/**
 * A node type the published schema does not have — the fixture proof R.3 asks for
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * *"Adding a node type in P.2's schema surfaces it in the Add-stage menu and gets a working
 * inspector form with zero UI changes — proven by a fixture test with a synthetic node type."*
 * {@link withSyntheticNodeType} makes exactly the edit a real addition would: a member appended
 * to `$defs.node.properties.type.enum`, a `sandbox_config` definition, and the
 * `if type = sandbox then config: {$ref}` branch in `$defs.node.allOf`. Nothing else — no entry
 * in `catalog.presentation.ts`, no line of this service — so whatever the catalog serves for
 * it is what the UI would render for a type nobody wrote a line of UI for.
 *
 * Nothing here ships: `*.fixture.ts` is outside `tsconfig.build.json`.
 */

import type { JsonSchema } from "./catalog.schema";

/** The synthetic type's name — deliberately one the published schema will not grow by accident. */
export const SYNTHETIC_NODE_TYPE = "sandbox";

/** A config the synthetic type's schema accepts. */
export const SYNTHETIC_CONFIG = Object.freeze({
  image: "ghcr.io/acme/zephyr-sdk:0.17",
  timeout_seconds: 900,
});

/** The parts of the published schema the addition touches, typed for the edit. */
interface EditableSchema {
  $defs: Record<string, unknown> & {
    node: { properties: { type: { enum: string[] } }; allOf: unknown[] };
  };
}

/**
 * The published schema, with one more node type.
 *
 * @param schema - The parsed published schema. Not modified: the edit is made to a clone.
 * @returns The clone. It still compiles in ajv's strict mode, and a document with a `sandbox`
 *   node validates against it — `catalog.schema.spec.ts` checks both, so the proof is about a
 *   well-formed schema addition rather than an arbitrary object.
 */
export function withSyntheticNodeType(schema: JsonSchema): JsonSchema {
  const clone = structuredClone(schema) as unknown as EditableSchema;
  const definition = `${SYNTHETIC_NODE_TYPE}_config`;

  clone.$defs.node.properties.type.enum.push(SYNTHETIC_NODE_TYPE);
  clone.$defs[definition] = {
    description: "A synthetic node type, added by catalog.fixture.ts and never committed.",
    type: "object",
    additionalProperties: false,
    required: ["image"],
    properties: {
      image: { $ref: "#/$defs/reference" },
      timeout_seconds: { type: "integer", minimum: 1, maximum: 86400 },
    },
  };
  clone.$defs.node.allOf.push({
    if: { required: ["type"], properties: { type: { const: SYNTHETIC_NODE_TYPE } } },
    then: { properties: { config: { $ref: `#/$defs/${definition}` } } },
  });

  return clone as unknown as JsonSchema;
}
