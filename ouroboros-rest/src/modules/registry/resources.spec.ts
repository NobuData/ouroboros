import { toParamFields } from "../providers/param.forms";
import { MODEL_PARAM_DIALECT, type ModelParamSchema } from "../providers/provider.params";
import { NO_METADATA, mergeParamSchema } from "./params.merge";
import { toParamSchemaResource } from "./resources";

/**
 * The seam between the merge and the wire, and the three decisions it makes.
 *
 * The schemas cross **as JSON Schema, unchanged** — a client hands one to a generic validator
 * and gets the same answer the server will give it. The rendered fields ride beside them so a
 * client that wants a form has one, computed from the schema in one place so the two cannot
 * disagree. And `reason` is a code, never a sentence this service wrote for somebody's UI.
 */

const CONNECTION = "9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e01";

/** A merged schema with something in both halves. */
function bound() {
  const adapter: ModelParamSchema = {
    $schema: MODEL_PARAM_DIALECT,
    type: "object",
    title: "Ollama model parameters",
    properties: {
      context_clamp: { type: "integer", title: "Context clamp", minimum: 1 },
      temperature: { type: "number", title: "Temperature", minimum: 0, maximum: 2 },
    },
    additionalProperties: false,
  };

  return mergeParamSchema(adapter, { contextTokens: 32_768, maxOutputTokens: null }, NO_METADATA);
}

describe("toParamSchemaResource", () => {
  it("echoes the pair it answers for", () => {
    const resource = toParamSchemaResource(bound(), CONNECTION, "qwen3-coder:32b");

    expect(resource.modelId).toBe("qwen3-coder:32b");
    expect(resource.connectionId).toBe(CONNECTION);
  });

  it("publishes each schema unchanged rather than translating it", () => {
    // No renaming into camelCase and no flattening: `$schema`, `properties`, `minimum` and
    // `enum` are a vocabulary every client already has a library for, and CI.3 renders fields
    // from it with zero special-casing — which is impossible if this layer invents a dialect on
    // the way out.
    const merged = bound();
    const resource = toParamSchemaResource(merged, CONNECTION, "qwen3-coder:32b");

    expect(resource.params.schema).toBe(merged.params);
    expect(resource.restrictions.schema).toBe(merged.restrictions);
    expect(resource.params.schema.$schema).toBe(MODEL_PARAM_DIALECT);
  });

  it("derives each section's fields from that section's own schema", () => {
    const merged = bound();
    const resource = toParamSchemaResource(merged, CONNECTION, "qwen3-coder:32b");

    expect(resource.params.fields).toEqual(toParamFields(merged.params));
    expect(resource.restrictions.fields).toEqual(toParamFields(merged.restrictions));
  });

  it("carries the annotation a bound picked up on its way through the merge", () => {
    // The whole reason the annotation exists: a client can tell a live bound from a catalogued
    // one rather than having to distrust both.
    const [clamp] = toParamSchemaResource(bound(), CONNECTION, "qwen3-coder:32b").params.fields;

    expect(clamp.maximum).toBe(32_768);
    expect(clamp.sources).toEqual(["adapter", "discovery"]);
  });

  it("summarises the sources above the form as well as on each field", () => {
    const resource = toParamSchemaResource(bound(), CONNECTION, "qwen3-coder:32b");

    expect(resource.sources).toEqual(["adapter", "discovery", "registry"]);
  });

  it("answers a null reason when there is nothing to explain", () => {
    expect(toParamSchemaResource(bound(), CONNECTION, "qwen3-coder:32b").reason).toBeNull();
  });

  describe("an unbound alias", () => {
    const resource = () =>
      toParamSchemaResource(
        mergeParamSchema(null, NO_METADATA, NO_METADATA),
        null,
        "gpt-5.2-preview",
      );

    it("reports no connection", () => {
      expect(resource().connectionId).toBeNull();
    });

    it("has an empty params section and a full restrictions one", () => {
      expect(resource().params.fields).toEqual([]);
      expect(resource().restrictions.fields).toHaveLength(2);
    });

    it("gives the reason as a code, and the prose in the schema's description", () => {
      // A server that shipped the inspector's copy would be a server somebody has to redeploy
      // to change a wording.
      expect(resource().reason).toBe("alias_unbound");
      expect(resource().params.schema.description).toContain("no provider bound");
    });
  });

  it("survives a JSON round trip with its field order intact", () => {
    // The wire is JSON, and field order is a contract: the inspector draws the fields in the
    // order their author wrote them.
    const resource = toParamSchemaResource(bound(), CONNECTION, "qwen3-coder:32b");
    const roundTripped = JSON.parse(JSON.stringify(resource)) as typeof resource;

    expect(roundTripped.params.fields.map((field) => field.name)).toEqual(
      resource.params.fields.map((field) => field.name),
    );
    expect(Object.keys(roundTripped.params.schema.properties)).toEqual(
      Object.keys(resource.params.schema.properties),
    );
  });
});
